"""Optional actual-app checks on a separately restored migrated private DB.

Not a CI fixture reader: the explicit rehearsal runner supplies the fresh copy.
No startup schema initialization or cloud credentials; all network is loopback.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
from threading import Thread
import time
from uuid import uuid4
from urllib.parse import quote

import httpx
import uvicorn


def verify(db, output, admin_root, *, browser=True):
    from tools.migrate_native_v2_local import verify_target
    verify_target(db)
    from peewee import PostgresqlDatabase
    from api import models
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    from api.main import app as tma
    from api.auth.service import _create_session, utcnow
    os.environ['LERNE_ADMIN_STATE_DIR'] = str(output / 'admin-state')
    listeners = []
    for _ in range(2):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listeners.append(listener)
    os.environ['LERNE_ADMIN_PORT'] = str(listeners[1].getsockname()[1])
    from lerne_admin.core.api import models as admin_models
    admin_db = PostgresqlDatabase(db.database, **db.connect_params)
    admin_models.tma_db.initialize(admin_db)
    admin_models.lerne_db.initialize(admin_db)
    from lerne_admin.server import app as admin
    servers, threads = [], []
    result = {'tma': {}, 'library': {}, 'failures': [], 'browser': None}
    tokens = {}

    def token(user):
        if user not in tokens:
            account, _ = models.TMAAuthAccount.get_or_create(user=user)
            tokens[user] = _create_session(account, utcnow()).access_token
        return tokens[user]

    try:
        for application, listener in zip((tma, admin), listeners):
            server = uvicorn.Server(uvicorn.Config(application, lifespan='off', access_log=False, log_level='error'))
            thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            thread.start()
            servers.append(server)
            threads.append(thread)
            for _ in range(100):
                if server.started or not thread.is_alive():
                    break
                time.sleep(.05)
            if not server.started:
                raise RuntimeError('Actual application failed to start')
        origins = [f'http://127.0.0.1:{s.getsockname()[1]}' for s in listeners]
        browser_cards = []
        with httpx.Client(base_url=origins[0] + '/api/', trust_env=False, timeout=30) as client, \
                httpx.Client(base_url=origins[1], headers={'Origin': origins[1]}, trust_env=False, timeout=30) as console:
            compatibility = console.get('/api/admin/compatibility').json()
            (output / 'admin-compatibility.json').write_text(json.dumps(compatibility, ensure_ascii=False, indent=2), encoding='utf-8')
            result['compatibility_warnings'] = []
            for operation in ('native_cards', 'native_library'):
                status = compatibility['operations'][operation]
                if status['critical']:
                    raise AssertionError(f'Admin critical compatibility findings: {operation}')
                findings = [f for f in compatibility['findings'] if operation in f['operations'] and f['severity'] == 'warning']
                # Existing reviewed nullable-schema warnings only. Never waive a
                # critical finding or disable the normal Admin write perimeter.
                if any('NULL не обнаружены' not in str(f['actual']) for f in findings):
                    raise AssertionError('Unexpected Admin warning requires separate review')
                result['compatibility_warnings'].append({'operation': operation, 'count': status['warnings']})
                if status['warnings']:
                    acknowledgement = console.post('/api/admin/compatibility/acknowledge', json={
                        'target': 'current', 'operation': operation, 'token': compatibility['token'],
                        'actor': 'isolated-rehearsal', 'reason': 'Reviewed known nullable columns, no NULL violations; disposable private copy only',
                        'confirmed': True})
                    assert acknowledgement.status_code == 200, acknowledgement.text[:400]
            def request(method, path, *, user, body=None):
                response = client.request(method, path, headers={'Authorization': 'Bearer ' + token(user)}, json=body)
                if response.status_code != 200:
                    raise AssertionError((method, path, response.status_code, response.text[:400]))
                return response.json()

            # Actual migrated cards, not freshly authored substitutes.
            samples = db.execute_sql('''SELECT DISTINCT ON (c.content_v2->'card'->>'type') c.id,c.deck_id,d.user_id
                FROM tma_card c JOIN tma_deck d ON c.deck_id=d.id JOIN tma_user u ON u.user_id=d.user_id
                WHERE NOT c.is_deleted AND NOT d.is_deleted AND NOT u.is_guest
                ORDER BY c.content_v2->'card'->>'type',
                CASE WHEN c.content_v2::text LIKE %s THEN 0 ELSE 1 END,c.id''', ('%"distractors": "auto"%',)).fetchall()
            for cid, did, user in samples:
                try:
                    original = request('GET', f'cards/{cid}', user=user)
                    kind = original['content_v2']['card']['type']
                    body = copy.deepcopy(original['content_v2'])
                    body['card']['explanation'] += '\nRehearsal edit.'
                    updated = request('PATCH', f'cards/{cid}', user=user, body={
                        'request_id': str(uuid4()), 'revision': original['revision'], 'content_v2': body})
                    response = console.get(f'/api/admin/cards/{cid}', params={'deck_id': did})
                    assert response.status_code == 200, response.text[:400]
                    detail = response.json()
                    assert detail['content_v2'] == updated['content_v2']
                    response = console.put(f'/api/admin/cards/{cid}', params={'deck_id': did}, json={
                        'revision': detail['revision'], 'content_v2': original['content_v2']})
                    assert response.status_code == 200, response.text[:400]
                    assert request('GET', f'cards/{cid}', user=user)['content_v2'] == original['content_v2']
                    study = request('GET', f'study/card/{cid}', user=user)
                    request('POST', 'study/grade', user=user, body={'action_id': str(uuid4()), 'card_id': cid,
                        'deck_id': did, 'grade': 2, 'return_next': False})
                    if kind in ('free_text', 'editable_text'):
                        data = original['content_v2']['card']['data']
                        answer = data.get('sample_answer') or data.get('correct_text')
                        evaluation = request('POST', 'ai/evaluate-answer', user=user, body={'card_id': cid, 'answer': answer})
                        assert evaluation['result']['verdict'] == 'correct', evaluation
                    result['tma'][kind] = {'id': cid, 'read_edit_admin_roundtrip_study_grade': True}
                    browser_cards.append({'id': cid, 'deck_id': did, 'user_id': user, 'token': token(user), 'type': kind,
                                          'content_v2': original['content_v2'], 'study': study})
                except Exception as exc:
                    result['failures'].append({'card_id': cid, 'stage': 'tma', 'error': str(exc)[:600]})
            for cid, did, kind in db.execute_sql('''SELECT DISTINCT ON (content_v2->'card'->>'type') id,deck_id,content_v2->'card'->>'type'
                    FROM card WHERE NOT is_deleted ORDER BY content_v2->'card'->>'type',id''').fetchall():
                response = console.get(f'/api/admin/cards/{cid}', params={'deck_id': 'lib_' + str(did)})
                # Admin's public library identifier is verified in deck_target.
                if response.status_code != 200:
                    result['failures'].append({'stage': 'library', 'card_id': cid, 'status': response.status_code, 'error': response.text[:300]})
                else:
                    original = response.json()
                    content = copy.deepcopy(original['content_v2'])
                    content['card']['explanation'] += '\nLibrary rehearsal edit.'
                    path = f'/api/admin/cards/{cid}?deck_id=lib_{did}'
                    edited = console.put(path, json={'revision': original['revision'], 'content_v2': content})
                    assert edited.status_code == 200, edited.text[:400]
                    restored = console.put(path, json={'revision': edited.json()['revision'], 'content_v2': original['content_v2']})
                    assert restored.status_code == 200, restored.text[:400]
                    assert console.get(path).json()['content_v2'] == original['content_v2']
                    result['library'][kind] = {'id': cid, 'read_edit_roundtrip': True}
            image = db.execute_sql("SELECT filename,content FROM tmamedia WHERE folder='images' AND octet_length(content)>0 ORDER BY id LIMIT 1").fetchone()
            if image:
                response = client.get('media/images/' + quote(image[0], safe=''))
                equal = hashlib.sha256(response.content).digest() == hashlib.sha256(bytes(image[1])).digest()
                result['embedded_image'] = {'status': response.status_code, 'bytes': len(response.content), 'sha256_equal': equal}
                assert response.status_code == 200 and equal, 'Embedded image streaming differs from database bytes'
            fixture = {'tma_origin': origins[0], 'admin_origin': origins[1], 'cards': browser_cards}
            private_fixture = output / 'migrated-browser-fixture.json'
            private_fixture.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
            env = {**os.environ, 'LERNE_MIGRATED_FIXTURE': str(private_fixture)}
            command = ['node', 'node_modules/@playwright/test/cli.js', 'test', 'native-migrated.spec.cjs',
                       '--project=extended', '--workers=1']
            if browser:
                completed = subprocess.run(command, env=env, cwd=Path(__file__).resolve().parents[1], timeout=240)
                result['browser'] = {'exit_code': completed.returncode}
            else:
                result['browser'] = {'not_run': 'Explicit HTTP-only follow-up; separate Chromium evidence required'}
        return result
    finally:
        for server in servers:
            server.should_exit = True
        for thread in threads:
            thread.join(timeout=10)
        for listener in listeners:
            listener.close()
        admin_db.close()
        db.close()
