"""Optional actual-app checks on a separately restored migrated private DB.

Not a CI fixture reader: the explicit rehearsal runner supplies the fresh copy.
No startup schema initialization or cloud credentials; all network is loopback.
"""
import copy
import hashlib
import ipaddress
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


ROOT = Path(__file__).resolve().parents[1]


def verify_target(database):
    if database.in_transaction():
        raise RuntimeError('Migration requires its own transaction')
    name, role, address, port, directory = database.execute_sql(
        "SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port(),current_setting('data_directory')"
    ).fetchone()
    data = Path(directory).resolve()
    if (name == 'lerne_tma_local' or role != 'cards_test' or port == 55432 or
            ipaddress.ip_interface(address).ip != ipaddress.ip_address('127.0.0.1') or
            data.parent.parent != (ROOT / 'local/test-data').resolve() or
            not data.parent.name.startswith('structured-cards-pg-') or data.name != 'data' or
            not (data / 'postmaster.pid').is_file()):
        raise RuntimeError('Only this worktree disposable runner cluster is authorized')


def verify(db, output, admin_root, *, browser=True, smoke=False):
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
            for cid, did, kind in db.execute_sql('''SELECT DISTINCT ON (c.content_v2->'card'->>'type') c.id,c.deck_id,c.content_v2->'card'->>'type'
                    FROM tma_card c JOIN tma_deck d ON d.id=c.deck_id
                    WHERE d.scope='library' AND NOT c.is_deleted AND NOT d.is_deleted
                    ORDER BY c.content_v2->'card'->>'type',c.id''').fetchall():
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
            if smoke:
                # Bound this new account's fixture after the full data/ACL and
                # nine-type checks. Published roots otherwise pull unrelated
                # tens of megabytes into a one-deck create/offline scenario.
                models.TMA_Folder.update(access_scope='private').where(
                    models.TMA_Folder.access_scope == 'global_readonly').execute()
                user = 777000111
                models.TMAUser.get_or_create(user_id=user, defaults={'is_guest': False, 'default_decks_initialized': True})
                deck = models.TMA_Deck.create(user_id=user, name='Unified storage smoke')
                sample = next(c for c in browser_cards if c['type'] == 'standard')
                from api.services.structured_card_storage import create_v2_card
                create_v2_card(sample['content_v2']['card'], deck_id=deck.id, creator_id=user, position=1)
                results_path = output / 'smoke-results.json'
                smoke_fixture = output / 'smoke-fixture.json'
                smoke_fixture.write_text(json.dumps({'tma_origin': origins[0], 'admin_origin': origins[1],
                    'user_id': user, 'token': token(user), 'deck_id': deck.id,
                    'sample_image': image[0] if image else None, 'output_results': str(results_path)}), encoding='utf-8')
                completed = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
                    'native-smoke-acceptance.spec.cjs', '--project=extended', '--workers=1'],
                    env={**os.environ, 'LERNE_SMOKE_FIXTURE': str(smoke_fixture)},
                    cwd=Path(__file__).resolve().parents[1], timeout=240)
                result['smoke'] = {'exit_code': completed.returncode}
                if completed.returncode == 0:
                    saved = json.loads(results_path.read_text(encoding='utf-8'))
                    created = models.TMA_Card.get_by_id(saved['createdId'])
                    offline = models.TMA_Card.get_by_id(saved['resolvedRealId'])
                    assert created.deck_id == offline.deck_id == deck.id
                    assert created.content_v2['card']['data']['prompt'] == 'Smoke Test Front (Admin UI Saved)'
                    assert offline.content_v2['card']['type'] == 'quiz'
                    assert models.TMAReviewHistory.select().where(models.TMAReviewHistory.card_id == created.id).exists()
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


def verify_copy_roundtrip(db):
    """Real library import, scoped pull and JSON roundtrip on the supplied test DB."""
    from fastapi.testclient import TestClient
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.main import app
    from lerne_admin.core.api import models as admin_models
    from lerne_admin.services import native_cards

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    admin_models.tma_db.initialize(db)
    admin_models.lerne_db.initialize(db)
    user = 777000112
    models.TMAUser.get_or_create(user_id=user, defaults={'is_guest': False, 'default_decks_initialized': True})
    account, _ = models.TMAAuthAccount.get_or_create(user=user)
    token = _create_session(account, utcnow()).access_token
    client = TestClient(app, headers={'Authorization': 'Bearer ' + token})
    source_id = db.execute_sql("""SELECT d.id FROM tma_deck d JOIN tma_card c ON c.deck_id=d.id
        WHERE d.scope='library' AND NOT d.is_deleted AND NOT c.is_deleted
        GROUP BY d.id ORDER BY count(*),d.id LIMIT 1""").fetchone()[0]
    response = client.post(f'/api/decks/external/import/{source_id}?mode=copy')
    assert response.status_code == 200, response.text
    target_id = response.json()['deck_id']
    target = models.TMA_Deck.get_by_id(target_id)
    assert target.id != source_id and target.scope == 'personal' and target.category_id is None
    source = list(models.TMA_Card.select().where(models.TMA_Card.deck == source_id,
        models.TMA_Card.is_deleted == False).order_by(models.TMA_Card.position, models.TMA_Card.id))
    copied = list(models.TMA_Card.select().where(models.TMA_Card.deck == target_id,
        models.TMA_Card.is_deleted == False).order_by(models.TMA_Card.position, models.TMA_Card.id))
    assert source and len(copied) == len(source)
    media = ('image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path', 'image_data')
    for original, card in zip(source, copied, strict=True):
        assert original.id != card.id and original.content_v2 == card.content_v2
        assert all(getattr(original, field) == getattr(card, field) for field in media)
    exported = json.loads(native_cards.export_document(f'lib_{source_id}')['text'])
    request = {'import_id': str(uuid4()), 'document': exported}
    imported = client.post('/api/decks/import-json', json=request)
    assert imported.status_code == 200, imported.text
    assert client.post('/api/decks/import-json', json=request).json() == imported.json()
    restored_id = imported.json()['deck_id']
    restored = list(models.TMA_Card.select().where(models.TMA_Card.deck == restored_id).order_by(models.TMA_Card.position))
    assert [c.content_v2 for c in restored] == [c.content_v2 for c in source]
    pull = client.get('/api/sync/v2/pull')
    assert pull.status_code == 200, pull.text
    deck_ids = {d['id'] for d in pull.json()['decks']}
    assert target_id in deck_ids and restored_id in deck_ids and source_id not in deck_ids
    assert not models.TMAProgress.select().where(models.TMAProgress.card_id.in_([c.id for c in copied])).exists()
    assert not models.TMACardNote.select().where(models.TMACardNote.card.in_([c.id for c in copied])).exists()
    print('PASS: restored-copy library HTTP import, all media attachments, Admin JSON export/TMA import/replay, scoped offline pull', flush=True)
