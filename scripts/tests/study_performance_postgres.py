"""Reproducible Study measurements. Only the disposable cluster runner calls verify.

No developer configuration, production connections or schema migrations. Timings
include real HTTP, auth, worker connections, SQL, validation and serialization.
"""
import json
import base64
import socket
import os
import subprocess
import sys
from pathlib import Path
from contextvars import ContextVar
from threading import Thread
from time import perf_counter, sleep
from unittest.mock import patch
from uuid import uuid4

import httpx
import uvicorn
from fastapi import FastAPI
from peewee import Model


def baseline_sources():
    """Load reviewed HEAD sources in memory; never overwrite the working tree."""
    import importlib.abc
    import importlib.util
    paths = ['api.routers.study', 'api.routers.knowledge', 'api.services.study',
             'api.services.cards', 'api.services.structured_card_api', 'api.services.collaborative_service']
    sources = {name: subprocess.check_output(['git', 'show', 'HEAD:' + name.replace('.', '/') + '.py'],
                encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)) for name in paths}

    class SourceLoader(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, fullname, path=None, target=None):
            return importlib.util.spec_from_loader(fullname, self) if fullname in sources else None

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            exec(compile(sources[module.__name__], module.__name__, 'exec'), module.__dict__)
    sys.meta_path.insert(0, SourceLoader())


def verify(db, scratch, *, browser=False, baseline=False):
    from scripts.tests.run_knowledge_http_postgres import loopback_only
    sys.addaudithook(loopback_only)
    if baseline:
        baseline_sources()
    from api import database
    with patch.object(database, 'initialize_database', return_value=False):
        from api import models
    from api.auth.service import _create_session, utcnow
    from api.routers import study, knowledge, decks, sync, media as media_router, card_notes, card_ratings
    from api.services import structured_card_api, collaborative_service, media, cards
    from api.services.structured_cards_v2 import normalize_card
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    tables = [value for value in vars(models).values() if isinstance(value, type)
              and issubclass(value, Model) and value not in (Model, models.BaseModel)
              and value._meta.database in (models.tma_db, models.lerne_db)]
    db.create_tables(tables)
    models.TMAUser.create(user_id=1, default_decks_initialized=True)
    tokens = _create_session(models.TMAAuthAccount.create(user=1), utcnow())
    deck = models.TMA_Deck.create(user_id=1, name='Synthetic large Study deck')
    payload = {'schema_version': 2, 'card': normalize_card({'type': 'standard', 'data': {
        'prompt': 'Synthetischer deutscher Beispielsatz.', 'answer': 'Синтетический ответ.'},
        'explanation': 'Synthetic shared context. ' * 100})}
    # A repeated context models JSONB payload costs without private snapshots.
    rows = [dict(deck=deck.id, creator_id=1, content_v2=payload, position=i,
                 image_path=f'synthetic-{i % 3}.png') for i in range(1000)]
    with db.atomic():
        for start in range(0, len(rows), 100):
            models.TMA_Card.insert_many(rows[start:start + 100]).execute()
    ids = [row.id for row in models.TMA_Card.select(models.TMA_Card.id).order_by(models.TMA_Card.position)]
    ki = models.TMAKnowledgeItem.create(name='Synthetic KI')
    with db.atomic():
        for start in range(0, len(ids), 100):
            models.TMACardKnowledgeItem.insert_many([dict(card_id=i, knowledge_item=ki.id, role='primary')
                                                    for i in ids[start:start + 100]]).execute()
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6tUAAAAASUVORK5CYII=')
    for i in range(3):
        models.TMAMedia.create(filename=f'synthetic-{i}.png', folder='images', content=png)
    app = FastAPI()
    for router in (study.router, knowledge.router, decks.router, sync.router, media_router.router,
                   card_notes.router, card_ratings.router):
        app.include_router(router, prefix='/api')
    queries, timings = [], {}
    request_queries = ContextVar('study_queries', default=None)
    phase, browser_samples = [None], []

    @app.get('/api/__study_phase/{name}')
    def set_phase(name: str):
        phase[0] = name
        return {'status': 'ready'}

    @app.middleware('http')
    async def metrics(request, call_next):
        sql = []
        current_phase = phase[0]
        request_queries.set(sql)
        response = await call_next(request)
        response.headers['X-Study-SQL'] = str(len(sql))
        if current_phase and request.url.path.startswith('/api/') and '/__study_phase/' not in request.url.path:
            browser_samples.append({'phase': current_phase, 'path': request.url.path,
                                    'sql': len(sql), 'status': response.status_code})
        return response
    execute = db.execute_sql

    def counted(sql, *args, **kwargs):
        queries.append(sql)
        current = request_queries.get()
        if current is not None:
            current.append(sql)
        return execute(sql, *args, **kwargs)

    def timed(name, original):
        def call(*args, **kwargs):
            before = perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                row = timings.setdefault(name, [0, 0.0])
                row[0] += 1
                row[1] += (perf_counter() - before) * 1000
        return call

    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off', access_log=False))
    thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    results = []
    processes = []
    streams = []
    try:
        for _ in range(100):
            if server.started:
                break
            sleep(.05)
        assert server.started
        with patch.object(db, 'execute_sql', counted), patch.object(structured_card_api, 'decode_v2_content',
                timed('pydantic_decode', structured_card_api.decode_v2_content)), patch.object(structured_card_api, '_digest',
                timed('revision', structured_card_api._digest)), patch.object(collaborative_service, 'get_effective_user_role',
                timed('access', collaborative_service.get_effective_user_role)), patch.object(media, '_check_media_exists',
                timed('media', media._check_media_exists)), patch.object(study.services, 'get_deck_stats_counts',
                timed('deck_stats', cards.get_deck_stats_counts)), patch.object(study, 'content_response',
                timed('content_response', study.content_response)), patch.object(structured_card_api, 'content_response',
                timed('content_response', structured_card_api.content_response)), patch.object(study, 'get_effective_user_role',
                timed('access', study.get_effective_user_role)), patch.object(cards, '_build_media_exists_map',
                timed('media_batch', cards._build_media_exists_map)), httpx.Client(
                    base_url=f'http://127.0.0.1:{port}/api', headers={'Authorization': f'Bearer {tokens.access_token}'},
                    trust_env=False, timeout=60) as client:
            def request(label, method, path, **kwargs):
                queries.clear()
                timings.clear()
                before = perf_counter()
                response = client.request(method, path, **kwargs)
                elapsed = (perf_counter() - before) * 1000
                assert response.status_code == 200, response.text
                results.append(dict(label=label, ms=round(elapsed, 2), sql=len(queries), bytes=len(response.content),
                                    stages={k: [v[0], round(v[1], 2)] for k, v in timings.items()}))
                return response.json()
            content = None
            for run in ('cold', 'repeat'):
                request(run + ':cards', 'GET', f'/decks/{deck.id}/cards')
                content = request(run + ':knowledge', 'GET', f'/knowledge/decks/{deck.id}',
                                  params={'revision': content['revision']} if content and 'revision' in content else {})
                request(run + ':next', 'GET', f'/decks/{deck.id}/next')
            for i in range(10):
                request(f'grade:{i}', 'POST', '/study/grade', json=dict(card_id=ids[i], deck_id=deck.id,
                        grade=2, return_next=False, include_progress=True, action_id=str(uuid4())))
                request(f'card:{i}', 'GET', f'/study/card/{ids[i]}')
                request(f'navigate:{i}', 'GET', f'/study/card/{ids[i+1]}')
            if not baseline:
                # Genuine authenticated PostgreSQL contracts, separate from timing samples.
                action = dict(card_id=ids[0], deck_id=deck.id, grade=2, return_next=False,
                              include_progress=True, action_id=str(uuid4()))
                first = client.post('/study/grade', json=action).json()
                history = models.TMAReviewHistory.select().count()
                assert client.post('/study/grade', json=action).json() == first
                assert models.TMAReviewHistory.select().count() == history
                assert client.post('/study/grade', json={**action, 'grade': 3}).status_code == 409
                assert first['graded_progress']['id'] == ids[0]
                models.TMAUser.create(user_id=2)
                other = _create_session(models.TMAAuthAccount.create(user=2), utcnow())
                foreign_headers = {'Authorization': f'Bearer {other.access_token}'}
                for path in (f'/study/card/{ids[0]}', f'/knowledge/decks/{deck.id}'):
                    assert client.get(path, headers=foreign_headers).status_code == 403
                assert client.post('/study/grade', headers=foreign_headers, json=action).status_code == 403
                assert not models.TMAProgress.select().where(models.TMAProgress.user_id == 2).exists()
                forced = client.get(f'/decks/{deck.id}/next', params={
                    'review_context': 'forced', 'exclude_ids': str(ids[0])}).json()
                assert forced['id'] == ids[1]
                previous_content = client.get(f'/knowledge/decks/{deck.id}').json()
                unchanged = client.get(f'/knowledge/decks/{deck.id}', params={'revision': previous_content['revision']}).json()
                assert unchanged == {'revision': previous_content['revision'], 'unchanged': True}
                models.TMAKnowledgeItem.update(name='Changed synthetic KI').where(models.TMAKnowledgeItem.id == ki.id).execute()
                changed = client.get(f'/knowledge/decks/{deck.id}', params={'revision': previous_content['revision']}).json()
                assert changed['revision'] != previous_content['revision'] and changed['knowledge_items'][0]['name'] == 'Changed synthetic KI'
                models.TMAKnowledgeItem.update(name='Synthetic KI').where(models.TMAKnowledgeItem.id == ki.id).execute()
                print('PASS: PostgreSQL grade snapshot/replay/conflict, cross-user denial, forced order and KI invalidation', flush=True)
            if browser:
                root = Path(__file__).resolve().parents[2]
                web_socket = socket.socket()
                web_socket.bind(('127.0.0.1', 0))
                web_port = web_socket.getsockname()[1]
                web_socket.close()
                env = {**os.environ, 'LERNE_ISOLATED_CHECKS': '1', 'KNOWLEDGE_HTTP_TARGET': f'http://127.0.0.1:{port}',
                       'STUDY_BASELINE': '1' if baseline else '0'}
                def start(command, log):
                    stream = (scratch / log).open('w', encoding='utf-8')
                    streams.append(stream)
                    process = subprocess.Popen(command, cwd=root, env=env, stdout=stream, stderr=stream,
                                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    processes.append(process)
                    return process
                vite = start(['node', 'app/node_modules/vite/bin/vite.js', '--config',
                    'scripts/tests/study_performance_vite.config.mjs', '--host', '127.0.0.1', '--port', str(web_port), '--strictPort'], 'vite.log')
                url = f'http://127.0.0.1:{web_port}'
                from scripts.tests.run_knowledge_http_postgres import wait_http
                wait_http(url + '/knowledge-harness.html', vite)
                manifest = scratch / 'study-browser-fixture.json'
                manifest.write_text(json.dumps({'web': url, 'token': tokens.access_token, 'deck': {
                    'id': deck.id, 'name': deck.name, 'target_language': 'de'}, 'output': str(scratch / 'study-browser.json')}), encoding='utf-8')
                try:
                    process = start(['node', 'scripts/tests/study_performance_browser.cjs', str(manifest)], 'browser.log')
                    assert process.wait(timeout=180) == 0, 'Browser benchmark failed: ' + str(scratch / 'browser.log')
                    output = scratch / 'study-browser.json'
                    rows = json.loads(output.read_text(encoding='utf-8'))
                    for row in rows:
                        row['backend_requests'] = [sample for sample in browser_samples if sample['phase'] == row['run']]
                    output.write_text(json.dumps(rows, indent=2), encoding='utf-8')
                    print(output.read_text(encoding='utf-8'), flush=True)
                finally:
                    manifest.unlink(missing_ok=True)
        (scratch / 'study-metrics.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(json.dumps(results, indent=2), flush=True)
        print('Evidence: ' + str(scratch / 'study-metrics.json'), flush=True)
        return True
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        for stream in streams:
            stream.close()
        server.should_exit = True
        thread.join(timeout=10)
