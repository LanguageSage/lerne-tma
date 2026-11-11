"""7.5a: synthetic Chromium + authenticated FastAPI + disposable PostgreSQL."""
import datetime
import json
import os
from pathlib import Path
import socket
import subprocess
from threading import Thread
import time
from uuid import uuid4


def verify(db, *, baseline=False):
    os.environ['SUPABASE_DB_URL'] = f'postgresql://cards_test@127.0.0.1:{db.connect_params["port"]}/postgres'
    from peewee import Model
    from api import models
    from api.auth.service import _create_session, utcnow
    from api.main import app
    import uvicorn

    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    db.create_tables([value for value in vars(models).values() if isinstance(value, type)
        and issubclass(value, Model) and value.__module__ == models.__name__ and value is not models.BaseModel])
    tokens = {}
    for user in (1, 2):
        models.TMAUser.create(user_id=user, is_guest=False, default_decks_initialized=True)
        tokens[str(user)] = _create_session(models.TMAAuthAccount.create(user=user), utcnow()).access_token
    deck = models.TMA_Deck.create(user_id=1, name='Legacy drain synthetic', target_language='de')
    other = models.TMA_Deck.create(user_id=2, name='Private other account')
    base_time = datetime.datetime(2026, 1, 1)
    cases = {}
    for name in ('replay', 'conflict', 'isolation', 'followup', 'unscoped'):
        card = models.TMA_Card.create(deck=deck, front_text=name + ' original', back_text='Original', updated_at=base_time)
        models.TMAProgress.create(user_id=1, card_id=card.id, repetitions=2, interval=6, updated_at=base_time)
        cases[name] = {'id': card.id, 'batch_id': str(uuid4()), 'note_id': str(uuid4()), 'action_id': str(uuid4())}
    config = {'deck': {'id': deck.id, 'user_id': 1, 'role': 'owner', 'name': deck.name, 'target_language': 'de'},
        'other_deck': other.id, 'tokens': tokens, 'cases': cases}
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off', access_log=False))
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    config['origin'] = f'http://127.0.0.1:{listener.getsockname()[1]}'
    thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started or not thread.is_alive():
                break
            time.sleep(.05)
        if not server.started:
            raise RuntimeError('Synthetic HTTP server failed to start')
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(['node', 'node_modules/@playwright/test/cli.js', 'test',
            'legacy-sync-drain.spec.cjs', '--project=extended', '--workers=1',
            *(['--grep', 'V2 confirmation'] if baseline else [])], cwd=root,
            env={**os.environ, 'LERNE_LEGACY_DRAIN_FIXTURE': json.dumps(config),
                 **({'LERNE_DRAIN_BASELINE_REF': '2a2db1f'} if baseline else {})}, timeout=240)
        if result.returncode:
            return False
        _verify_guarded_http(config, models)
        # Independent authoritative checks: old no-UUID review is not repeated,
        # temporary mappings preserve the note UUID, and peer content survives.
        created = models.TMA_Card.get(models.TMA_Card.front_text == 'legacy immutable creation')
        assert created.content_v2 is None
        assert models.TMA_Card.select().where(models.TMA_Card.front_text == 'legacy immutable creation').count() == 1
        assert models.TMAReviewHistory.select().where(models.TMAReviewHistory.card_id == created.id).count() == 1
        note = models.TMACardNote.get_by_id(cases['replay']['note_id'])
        assert note.card_id == created.id and note.text == 'Original pending note'
        assert models.TMAProgress.get(models.TMAProgress.card_id == created.id).repetitions == 4
        assert models.TMA_Card.get_by_id(cases['conflict']['id']).front_text == 'Peer edit survives'
        assert models.TMA_Card.select().where(models.TMA_Card.deck == other).count() == 0
        assert models.TMAOfflineBatch.select().where(models.TMAOfflineBatch.key == f"1:{cases['replay']['batch_id']}").count() == 1
        print('PASS: PostgreSQL confirms one legacy create/review/receipt, remapped note, peer content and account isolation')
        return True
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        if thread.is_alive():
            raise RuntimeError('Synthetic HTTP server failed to stop')


def _verify_guarded_http(config, models):
    from concurrent.futures import ThreadPoolExecutor
    import httpx
    root = config['origin'] + '/api'
    headers = {'Authorization': 'Bearer ' + config['tokens']['1']}
    deck = config['deck']['id']
    def post(path, body, authenticated=True):
        return httpx.post(root + path, json=body, headers=headers if authenticated else {}, trust_env=False)
    old = {'request_id': str(uuid4()), 'cards': [{'id': -99, 'deck_id': deck, 'front_text': 'HTTP original receipt', 'back_text': 'Original'}]}
    assert post('/sync/v2/push-legacy', old, False).status_code == 401
    first = post('/sync/v2/push', old)
    assert first.status_code == 200, first.text
    assert post('/sync/v2/push-legacy', old).json() == first.json()
    changed = {**old, 'cards': [{**old['cards'][0], 'front_text': 'Changed payload'}]}
    assert post('/sync/v2/push-legacy', changed).status_code == 409
    denied = {**old, 'request_id': str(uuid4()), 'cards': [{**old['cards'][0], 'deck_id': config['other_deck']}]}
    assert post('/sync/v2/push-legacy', denied).status_code == 403
    assert not models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == '1:' + denied['request_id'])
    unsupported = {**old, 'request_id': str(uuid4()), 'cards': [{**old['cards'][0], 'topics': 'Must not disappear'}]}
    assert post('/sync/v2/push-legacy', unsupported).status_code == 422
    row = models.TMA_Card.create(deck=deck, front_text='Concurrent base', back_text='Original', updated_at=datetime.datetime(2026, 1, 1))
    def race(text):
        return post('/sync/v2/push-legacy', {'request_id': str(uuid4()),
            'drain_bases': {f'cards:{row.id}': '2026-01-01T00:00:00Z'},
            'cards': [{'id': row.id, 'deck_id': deck, 'front_text': text, 'back_text': 'Original'}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(race, ['First peer', 'Second peer'])) == [200, 409]
    unknown = {'request_id': str(uuid4()), 'cards': [{'id': row.id, 'deck_id': deck,
        'front_text': 'Client clock is not a base', 'back_text': 'Original', 'updated_at': '2099-01-01T00:00:00Z'}]}
    assert post('/sync/v2/push-legacy', unknown).json()['detail']['code'] == 'legacy_base_unknown'
    native = models.TMA_Card.create(deck=deck, front_text=None, back_text=None, card_type=None,
        content_v2={'schema_version': 2, 'card': {'type': 'standard', 'data': {'prompt': 'Native SRS guard', 'answer': 'Original'}}})
    progress = models.TMAProgress.create(card_id=native.id, user_id=1, repetitions=9, interval=26, updated_at=datetime.datetime(2026, 1, 1))
    stale = {'request_id': str(uuid4()), 'progress': [{'card_id': native.id, 'queue': 'new',
        'repetitions': 0, 'interval': 0, 'lapses': 0, 'ease_factor': 2.5}]}
    assert post('/sync/v2/push-legacy', stale).json()['detail']['code'] == 'legacy_base_unknown'
    assert models.TMAProgress.get_by_id(progress.id).repetitions == 9
    print('PASS: guarded HTTP auth/permissions, historical receipts, UUID mismatch, unsupported fields, concurrent CAS and untrusted clocks')
