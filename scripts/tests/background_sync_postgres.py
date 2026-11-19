"""Opt-in synthetic browser benchmark. Run through structured_cards_postgres.py."""
from contextvars import ContextVar
from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from threading import Thread
from unittest.mock import patch

import uvicorn
from peewee import Model

ROOT = Path(__file__).resolve().parents[2]
BASELINE = '30737439fe3ad77f4ab2cdc307941a4934de78ad'
CLIENT_FILES = ('src/App.jsx', 'src/hooks/useAppInitialization.js', 'src/hooks/useCollaborativeSync.js',
                'src/services/cardOutboxSync.js', 'src/services/entityBatchSync.js', 'src/services/offlineUi.js',
                'src/services/syncService.js', 'src/store/useAuthStore.js')


def verify(db, scratch):
    from scripts.tests.run_knowledge_http_postgres import free_port, loopback_only, wait_http
    sys.addaudithook(loopback_only)
    from api import database
    with patch.object(database, 'initialize_database', return_value=False):
        from api import models
    from api.auth.service import _create_session, utcnow
    from api.db_workers import db_worker
    from api.main import app
    from api import services
    from api.services import offline_sync, structured_card_api
    from api.services.structured_cards_v2 import normalize_card

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    db.create_tables([model for model in vars(models).values()
                      if isinstance(model, type) and issubclass(model, Model)
                      and model not in (Model, models.BaseModel)
                      and model._meta.database in (models.tma_db, models.lerne_db)])
    for user_id in [1, 2]:
        models.TMAUser.create(user_id=user_id, first_name='Synthetic learner', active_language='de',
                              has_selected_language=True, default_decks_initialized=True)
    tokens = _create_session(models.TMAAuthAccount.create(user=1), utcnow())
    deck = models.TMA_Deck.create(user_id=1, name='Sync benchmark deck', updated_at=datetime(2026, 1, 1))
    target = models.TMA_Deck.create(user_id=1, name='Offline move target')
    shared = models.TMA_Deck.create(user_id=2, name='Shared sync benchmark')
    trainer = models.TMA_Deck.create(user_id=1, name='Sync benchmark Trainer')
    models.TMA_Collaborator.create(target_type='deck', target_id=shared.id, user_id=1, role='viewer', added_by=2)
    for entry, total in [(deck, 60), (target, 250), (shared, 289)]:
        rows = []
        for position in range(total):
            prompt = f'Synthetische Frage {entry.id}-{position}'
            payload = {'schema_version': 2, 'card': normalize_card({'type': 'standard', 'data': {
                'prompt': prompt, 'answer': 'Synthetische Antwort'},
                'explanation': 'Synthetischer Kartenkontext mit mehreren Wörtern. ' * 32})}
            rows.append(dict(deck=entry.id, creator_id=entry.user_id, content_v2=payload, position=position))
        models.TMA_Card.insert_many(rows).execute()
    models.TMA_Card.create(deck=trainer.id, creator_id=1, position=0,
        content_v2={'schema_version': 2, 'card': normalize_card({'type': 'trainer', 'data': {'parts': [
            {'type': 'text', 'text': 'Sie '}, {'type': 'input', 'answers': ['hatte']},
            {'type': 'text', 'text': ' den Brief geschrieben.'}]}})})
    models.TMASetting.create(key='USER_SETTINGS_1', value='{"autoPlay":false,"gradeSoundEnabled":false}')
    current_decks = services.get_active_decks
    current_decks(1, strict=True)  # Provision the same inbox for both cold clients.
    ids = [row.id for row in models.TMA_Card.select(models.TMA_Card.id).where(
        models.TMA_Card.deck_id == deck.id).order_by(models.TMA_Card.position)]

    counts = ContextVar('background_sync_metrics', default=None)

    @app.post('/api/__sync_fixture/publish')
    @db_worker
    def publish_catalogue_update():
        models.TMA_Deck.create(scope='library', name=deck.name, updated_at=datetime.now())
        return {'published': True}

    @app.middleware('http')
    async def metrics(request, call_next):
        with_scope = [0, 0]
        token = counts.set(with_scope)
        try:
            response = await call_next(request)
            response.headers['X-Sync-SQL'] = str(with_scope[0])
            response.headers['X-Sync-Decodes'] = str(with_scope[1])
            return response
        finally:
            counts.reset(token)

    def count(index, fn):
        def counted(*args, **kwargs):
            scope = counts.get()
            if scope is not None:
                scope[index] += 1
            return fn(*args, **kwargs)
        return counted

    def before(path):
        return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], cwd=ROOT)

    # Measure the actual legacy server implementation for legacy clients too.
    baseline = {'__name__': 'api.services.offline_sync_baseline', '__package__': 'api.services'}
    exec(compile(before('api/services/offline_sync.py'), 'legacy pull benchmark', 'exec'), baseline)
    baseline_decks = {'__name__': 'api.services.decks_baseline', '__package__': 'api.services'}
    exec(compile(before('api/services/decks.py'), 'legacy deck benchmark', 'exec'), baseline_decks)
    current_pull = offline_sync.pull_offline

    def pull(user_id, snapshot_version=None):
        if snapshot_version is None:
            return baseline['pull_offline'](user_id)
        return current_pull(user_id, snapshot_version)

    app_dir = scratch / 'browser-app'
    shutil.copytree(ROOT / 'app', app_dir, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*'))
    # The offline npm cache can be restored into an ignored directory when the
    # developer's installation is in use or incomplete.
    cached_modules = ROOT / 'local/test-data/sync-browser-deps/node_modules'
    shutil.copytree(cached_modules if cached_modules.is_dir() else ROOT / 'app/node_modules',
                    app_dir / 'node_modules', ignore=shutil.ignore_patterns('.vite', '.vite-temp', '.cache'))
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='off', access_log=False))
    thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    config = scratch / 'background-sync-fixture.json'
    try:
        with patch.object(db, 'execute_sql', count(0, db.execute_sql)), \
                patch.object(structured_card_api, 'decode_v2_content', count(1, structured_card_api.decode_v2_content)), \
                patch.object(offline_sync, 'pull_offline', pull):
            for variant in ('before', 'after'):
                for name in CLIENT_FILES:
                    path = app_dir / name
                    if variant == 'before':
                        path.write_bytes(before('app/' + name))
                    elif (ROOT / 'app' / name).is_file():
                        shutil.copyfile(ROOT / 'app' / name, path)
                    else:
                        path.unlink()
                web = f'http://127.0.0.1:{free_port()}'
                config.write_text(json.dumps({'web': web, 'api': f'http://127.0.0.1:{port}', 'variant': variant,
                    'token': tokens.access_token, 'deck': deck.id, 'deckName': deck.name,
                    'target': target.id, 'trainer': trainer.name,
                    'ids': ids[:5], 'output': str(scratch / (variant + '.json'))}), encoding='utf-8')
                env = {**os.environ, 'LERNE_ISOLATED_CHECKS': '1', 'VITE_API_URL': '/api'}
                with (scratch / (variant + '-vite.log')).open('wb') as log:
                    vite = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
                                             '--port', web.rsplit(':', 1)[1], '--strictPort'],
                                            cwd=app_dir, env=env, stdout=log, stderr=log)
                    try:
                        wait_http(web, vite)
                        with patch.object(services, 'get_active_decks',
                                          baseline_decks['get_active_decks'] if variant == 'before' else current_decks):
                            subprocess.run(['node', 'scripts/tests/background_sync_browser.cjs', str(config)],
                                           cwd=ROOT, env=env, check=True, timeout=240)
                    finally:
                        vite.terminate()
                        vite.wait(timeout=10)
    finally:
        config.unlink(missing_ok=True)
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
    print(f'Browser measurements: {scratch}', flush=True)
    return True
