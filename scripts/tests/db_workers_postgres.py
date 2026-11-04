"""Called only by the disposable PostgreSQL security harness, never live DBs."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import os
import socket
import threading
from unittest.mock import patch
from uuid import uuid4

import httpx
from anyio import to_thread
from fastapi import FastAPI
from playhouse.pool import PooledPostgresqlDatabase
from uvicorn import Config, Server


@asynccontextmanager
async def http_client(app):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        host, port = listener.getsockname()
        server = Server(Config(app, lifespan='off', log_level='critical'))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(5):
                while not server.started:
                    if serving.done():
                        await serving
                        raise RuntimeError('Fixture HTTP server did not start')
                    await asyncio.sleep(0.01)
            async with httpx.AsyncClient(base_url=f'http://{host}:{port}', trust_env=False) as client:
                yield client
        finally:
            server.should_exit = True
            await serving


def verify(database_name, connection_args):
    from api import models
    from api.auth.service import register_email_password
    from api.db_workers import db_worker
    from api.routers import (
        auth, auth_v2, card_notes, card_ratings, decks, feedback, folders, knowledge, lid, messages, sync, trash,
    )
    from local.router import router as local_router
    with patch.object(models, 'create_all_tables'):
        from api.main import db_session_middleware

    events = []
    fail_initialization = threading.Event()
    disconnect_review = threading.Event()
    accounts = [register_email_password(f'sync-{suffix}@example.invalid', 'synthetic test password')
                for suffix in ('owner', 'viewer')]
    headers = [{'Authorization': f'Bearer {account.access_token}'} for account in accounts]

    class Pool(PooledPostgresqlDatabase):
        def _connect(self):
            connection = super()._connect()
            events.append(('checkout', threading.get_ident(), connection))
            return connection

        def _initialize_connection(self, connection):
            if fail_initialization.is_set():
                fail_initialization.clear()
                raise RuntimeError('connection initialization failed')

        def _close(self, connection, close_conn=False):
            events.append(('release', threading.get_ident(), connection))
            return super()._close(connection, close_conn=close_conn)

        def execute_sql(self, sql, *args, **kwargs):
            events.append(('sql', threading.get_ident(), None))
            cursor = super().execute_sql(sql, *args, **kwargs)
            if disconnect_review.is_set() and sql.startswith('INSERT INTO "tmareviewhistory"'):
                disconnect_review.clear()
                super().execute_sql('SELECT pg_terminate_backend(pg_backend_pid())')
            return cursor

    pool = Pool(database_name, max_connections=2, stale_timeout=300, **connection_args)
    previous = models.tma_db.obj, models.lerne_db.obj
    models.tma_db.initialize(pool)
    models.lerne_db.initialize(pool)
    release = threading.Event()
    entered = threading.Barrier(3)
    app = FastAPI()
    app.middleware('http')(db_session_middleware)
    app.include_router(sync.router, prefix='/api')
    app.include_router(knowledge.router, prefix='/api')
    for router in (card_notes.router, card_ratings.router, messages.router, trash.router,
                   decks.router, feedback.router, folders.router, lid.router,
                   auth.router, auth_v2.router, local_router):
        app.include_router(router, prefix='/api')

    @app.get('/hold')
    @db_worker
    def hold():
        pid = pool.execute_sql('SELECT pg_backend_pid()').fetchone()[0]
        entered.wait(timeout=5)
        if not release.wait(5):
            raise RuntimeError('test watchdog expired')
        return {'pid': pid}

    @app.get('/read')
    @db_worker(retry_reads=True)
    def read():
        return {'pid': pool.execute_sql('SELECT pg_backend_pid()').fetchone()[0]}

    @app.post('/fail')
    @db_worker
    def fail():
        with pool.atomic():
            models.TMASetting.create(key='C2_ROLLBACK_PROBE', value='synthetic')
            raise RuntimeError('rollback probe')

    @app.post('/disconnect')
    @db_worker
    def disconnect():
        pool.execute_sql('SELECT pg_terminate_backend(pg_backend_pid())')

    async def run():
        loop_thread = threading.get_ident()
        async with http_client(app) as client:
            held = [asyncio.create_task(client.get('/hold')) for _ in range(2)]
            try:
                await asyncio.to_thread(entered.wait, 5)
                assert len(pool._in_use) == 2
                # Exhaustion must fail promptly, leave the pool bound, and keep
                # the event loop responsive. No pool resize/replacement/retry loop.
                exhausted = await asyncio.wait_for(client.get('/read'), 2)
                assert exhausted.status_code == 500
                exhausted_sync = await asyncio.wait_for(client.get('/api/sync/v2/pull', headers=headers[0]), 2)
                assert exhausted_sync.status_code == 500
                exhausted_knowledge = await asyncio.wait_for(
                    client.get('/api/knowledge/diagnostics/summary', headers=headers[0]), 2)
                assert exhausted_knowledge.status_code == 500
                assert models.tma_db.obj is pool and models.lerne_db.obj is pool
            finally:
                release.set()
                results = await asyncio.gather(*held)
            assert all(result.status_code == 200 for result in results)
            assert len({result.json()['pid'] for result in results}) == 2
            assert not pool._in_use
            assert (await client.get('/read')).status_code == 200
            assert (await client.post('/fail')).status_code == 500
            assert not pool._in_use
            fail_initialization.set()
            # POST has no implicit retry; partial entry must discard its slot.
            assert (await client.post('/fail')).status_code == 500
            assert not pool._in_use
            assert (await client.get('/read')).status_code == 200
            assert not pool._in_use
            assert (await client.post('/disconnect')).status_code == 500
            assert not pool._in_use
            assert (await client.get('/read')).status_code == 200
            await verify_deck_list_and_json_import(client, pool, headers, [account.account_id for account in accounts])
            await verify_inbox_initialization(client, pool)
            await verify_sync(client, pool, headers, accounts[1].account_id, disconnect_review)
            await verify_knowledge(client, pool, headers, [account.account_id for account in accounts])
            await verify_communications(client, pool, headers, [account.account_id for account in accounts])
            await verify_trash(client, pool, headers, [account.account_id for account in accounts])
            await verify_feedback_lid_folders(client, pool, headers, accounts[0].account_id)
            await verify_decks(client, pool, headers, [account.account_id for account in accounts])
            await verify_deck_text_update(client, pool, headers, [account.account_id for account in accounts])
            await verify_library_deck_routes(client, pool, headers, [account.account_id for account in accounts])
            await verify_auth(client, pool)
            await verify_local_auth(client, app, pool, headers[0], accounts[0].account_id)
        assert all(thread != loop_thread for _, thread, _ in events)

    try:
        asyncio.run(run())
        active = {}
        for action, thread, connection in events:
            if action == 'checkout':
                assert connection not in active
                active[connection] = thread
            elif connection in active:
                assert active.pop(connection) == thread
        assert not active
        with pool.connection_context():
            assert pool.execute_sql('SELECT count(*) FROM tmasetting WHERE key=%s',
                                    ('C2_ROLLBACK_PROBE',)).fetchone()[0] == 0
        print('PASS: PostgreSQL worker ownership, concurrent HTTP, pool exhaustion/recovery, partial entry cleanup and rollback', flush=True)
    finally:
        pool.close_all()
        models.tma_db.initialize(previous[0])
        models.lerne_db.initialize(previous[1])


async def verify_auth(client, pool):
    from api import models
    from api.db_workers import run_db

    auth_v2 = '/api/auth/v2'
    me = f'{auth_v2}/me'
    credentials = {'email': 'auth-worker@example.invalid', 'password': 'synthetic test password'}
    registered = await client.post(f'{auth_v2}/email-password/register', json=credentials)
    assert registered.status_code == 200 and 'no-store' in registered.headers['cache-control']
    logged_in = await client.post(f'{auth_v2}/email-password/login', json=credentials)
    assert logged_in.status_code == 200
    refreshed = await client.post(f'{auth_v2}/refresh', json={'refresh_token': logged_in.json()['refresh_token']})
    assert refreshed.status_code == 200
    assert refreshed.json()['refresh_token'] != logged_in.json()['refresh_token']

    owner = {'Authorization': 'Bearer ' + refreshed.json()['access_token']}
    original = {'Authorization': 'Bearer ' + registered.json()['access_token']}
    assert (await client.post(f'{auth_v2}/logout', json={}, headers=owner)).status_code == 204
    assert (await client.get(me, headers=owner)).status_code == 401
    assert not pool._in_use

    other = await client.post(f'{auth_v2}/email-password/register',
                              json={**credentials, 'email': 'auth-worker-other@example.invalid'})
    assert other.status_code == 200
    other_headers = {'Authorization': 'Bearer ' + other.json()['access_token']}
    profiles = await asyncio.gather(client.get(me, headers=original), client.get(me, headers=other_headers))
    assert all(response.status_code == 200 for response in profiles)
    owner_id, other_id = (response.json()['user_id'] for response in profiles)
    assert owner_id != other_id
    assert not pool._in_use

    forged = {'X-User-ID': str(other_id)}
    account_url = '/api/auth/account'
    for method, url, kwargs in (
        ('GET', me, {}),
        ('GET', '/api/auth/me', {}),
        ('POST', '/api/auth/sync', {'json': {}}),
        ('POST', '/api/user/language', {'json': {}}),
        ('DELETE', account_url, {}),
    ):
        for headers in (forged, {**forged, 'Authorization': 'Bearer la_' + 'A' * 43}):
            rejected = await client.request(method, url, headers=headers, **kwargs)
            assert rejected.status_code == 401 and rejected.headers['www-authenticate'] == 'Bearer'
    assert not pool._in_use

    headers = {**original, **forged}
    synced = await client.post('/api/auth/sync', headers=headers, json={'first_name': 'Fixture Owner'})
    assert synced.status_code == 200 and synced.json()['user']['user_id'] == owner_id
    language = await client.post('/api/user/language', headers=headers,
                                 json={'active_language': 'no', 'native_language': 'en'})
    assert language.status_code == 200
    for url in (me, '/api/auth/me'):
        updated = await client.get(url, headers=headers)
        untouched = await client.get(url, headers=other_headers)
        assert updated.status_code == untouched.status_code == 200
        assert (updated.json()['first_name'], updated.json()['active_language'],
                updated.json()['native_language']) == ('Fixture Owner', 'no', 'en')
        assert untouched.json() == (profiles[1].json() if url == me else {**profiles[1].json(), 'phone': None})

    def seed_card():
        deck = models.TMA_Deck.create(user_id=owner_id, name='Auth deletion fixture')
        return models.TMA_Card.create(deck=deck, front_text='fixture', back_text='fixture').id

    card_id = await run_db(seed_card)
    # This final delete fails after the card and deck deletes in the same transaction.
    with patch.object(models.TMAUser, 'delete', side_effect=RuntimeError('auth delete fixture failure')):
        failed = await client.delete(account_url, headers=headers)
    assert failed.status_code == 500 and failed.json()['detail'] == 'auth delete fixture failure'
    assert not pool._in_use
    assert await run_db(models.TMA_Card.get_or_none, models.TMA_Card.id == card_id) is not None
    assert (await client.get(me, headers=original)).status_code == 200
    assert (await client.delete(account_url, headers=headers)).status_code == 200
    assert not pool._in_use
    assert await run_db(models.TMA_Card.get_or_none, models.TMA_Card.id == card_id) is None
    assert (await client.get(me, headers=original)).status_code == 401
    assert (await client.get(me, headers=other_headers)).json() == profiles[1].json()

    for method, url, kwargs in (
        ('POST', '/api/auth/session', {'params': {'guest_id': owner_id}}),
        ('GET', f'/api/auth/session/{owner_id}', {}),
        ('POST', '/api/auth/code/generate', {'json': {'user_id': owner_id}}),
        ('POST', '/api/auth/code/verify', {'json': {'code': '123456'}}),
    ):
        response = await client.request(method, url, **kwargs)
        assert response.status_code == 410 and response.json() == {'detail': 'legacy_auth_retired'}
    assert not pool._in_use
    print('PASS: pooled Auth HTTP lifecycle, Bearer and account isolation, deletion rollback and legacy 410', flush=True)


async def verify_local_auth(client, app, pool, other_headers, other_id):
    from api import local_runtime, models
    from api.db_workers import run_db

    local_user_id = local_runtime.LOCAL_USER_ID

    def seed_cards():
        user = models.TMAUser.create(user_id=local_user_id)
        models.TMAAuthAccount.create(user=user)
        card_ids = []
        for user_id in (local_user_id, other_id):
            deck = models.TMA_Deck.create(user_id=user_id, name='LOCAL auth fixture')
            card_ids.append(models.TMA_Card.create(deck=deck, front_text='fixture', back_text='fixture').id)
        return card_ids

    card_id, foreign_card_id = await run_db(seed_cards)
    login_url = '/api/auth/local/login'
    transfer_url = f'/api/local/transfer-card/{card_id}'
    origin = 'http://127.0.0.1:5173'
    secret = 'synthetic-local-worker-secret'
    local_headers = {'Origin': origin, 'X-Lerne-Local-Secret': secret}
    with patch.dict(os.environ, {'LERNE_MODE': 'LOCAL'}, clear=True), \
            patch.object(local_runtime, 'local_config', return_value={'login_secret': secret}):
        transport = httpx.ASGITransport(app=app, client=('192.0.2.1', 12345))
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as remote:
            assert (await remote.post(login_url, headers=local_headers)).status_code == 403
        bad_origin = await client.post(login_url, headers={**local_headers, 'Origin': 'https://example.invalid'})
        assert bad_origin.status_code == 403
        assert (await client.post(login_url, headers={'Origin': origin})).status_code == 401
        bad_secret = await client.post(login_url, headers={**local_headers, 'X-Lerne-Local-Secret': 'wrong'})
        assert bad_secret.status_code == 401

        session = await client.post(login_url, headers=local_headers)
        assert session.status_code == 200 and 'no-store' in session.headers['cache-control']
        bearer = {'Authorization': 'Bearer ' + session.json()['access_token']}
        profile = await client.get('/api/auth/v2/me', headers=bearer)
        assert profile.status_code == 200 and profile.json()['user_id'] == local_user_id
        assert (await client.get(transfer_url, headers={'X-User-ID': str(local_user_id)})).status_code == 401
        assert (await client.get(transfer_url, headers=other_headers)).status_code == 403
        assert (await client.get('/api/local/transfer-card/0', headers=bearer)).status_code == 403
        assert (await client.get(f'/api/local/transfer-card/{foreign_card_id}', headers=bearer)).status_code == 403
        transferred = await client.get(transfer_url, headers=bearer)
        assert transferred.status_code == 200 and transferred.json() == {
            'url': f'http://127.0.0.1:8050/?publish_card={card_id}'}

    with patch.dict(os.environ, {'LERNE_MODE': ''}):
        assert (await client.post(login_url, headers=local_headers)).status_code == 404
        assert (await client.get(transfer_url, headers=bearer)).status_code == 404
    assert not pool._in_use
    print('PASS: pooled LOCAL login and transfer-card access checks', flush=True)


async def verify_sync(client, pool, headers, viewer_id, disconnect_review):
    from api import models
    from api.db_workers import run_db

    owner, viewer = headers
    request_id = str(uuid4())
    progress = {'card_id': -3, 'queue': 'review', 'interval': 7, 'ease_factor': 2.5,
                'repetitions': 1, 'lapses': 0}
    review = {'card_id': -3, 'rating': 2, 'review_time': '2026-11-01T10:00:00Z',
              'scheduled_interval': 7}
    batch = {'request_id': request_id, 'folders': [{'id': -1, 'name': 'Offline folder'}],
             'decks': [{'id': -2, 'folder_id': -1, 'name': 'Offline deck'}],
             'cards': [{'id': -3, 'deck_id': -2, 'front_text': 'Offline card', 'back_text': 'Back'}],
             'progress': [progress], 'reviews': [review]}

    async def push(payload, auth=owner, expected=200):
        response = await client.post('/api/sync/v2/push', headers=auth, json=payload)
        assert response.status_code == expected, response.text
        return response

    async def pull(auth, path='/api/sync/v2/pull'):
        response = await client.get(path, headers=auth)
        assert response.status_code == 200, response.text
        return response.json()

    # Submit all eight requests concurrently, admitting at most two DB
    # workers at a time. Exhaustion itself is tested with both slots held.
    limiter = to_thread.current_default_thread_limiter()
    tokens = limiter.total_tokens
    limiter.total_tokens = 2
    try:
        duplicates = await asyncio.gather(*(push(batch) for _ in range(8)))
    finally:
        limiter.total_tokens = tokens
    assert not pool._in_use, 'Sync worker left a PostgreSQL connection checked out'
    receipt = duplicates[0].json()
    assert all(reply.json() == receipt for reply in duplicates)
    assert receipt['review_count'] == 1
    card_id = receipt['mappings']['cards']['-3']
    deck_id = receipt['mappings']['decks']['-2']
    folder_id = receipt['mappings']['folders']['-1']
    # Simulate a lost acknowledgement by submitting the original unchanged
    # request again. Then verify a conflicting payload cannot mutate the card.
    assert (await push(batch)).json() == receipt
    await push({**batch, 'reviews': [{**review, 'rating': 0}]}, expected=409)
    assert not pool._in_use
    def verify_original_batch():
        assert models.TMA_Card.select().where(models.TMA_Card.front_text == 'Offline card').count() == 1
        assert models.TMAReviewHistory.select().where(models.TMAReviewHistory.card_id == card_id).count() == 1
        assert models.TMA_Deck.get_by_id(deck_id).folder_id == folder_id

    await run_db(verify_original_batch)

    # Same request ID belongs to a different receipt namespace for each user.
    assert (await push({'request_id': request_id}, viewer)).json()['review_count'] == 0
    own, other = await asyncio.gather(pull(owner), pull(viewer))
    assert any(row['id'] == card_id for row in own['cards'])
    assert any(row['card_id'] == card_id and row['interval'] == 7 for row in own['progress'])
    assert all(row['id'] != card_id for row in other['cards'])
    assert all(row['card_id'] != card_id for row in other['progress'])

    legacy = await client.post('/api/sync/push', headers=owner,
                               json={'cards': [{**batch['cards'][0], 'id': card_id,
                                                'deck_id': deck_id, 'front_text': 'Legacy edit'}]})
    assert legacy.status_code == 200, legacy.text
    legacy_pull = await pull(owner, '/api/sync/pull')
    assert any(row['id'] == card_id and row['front_text'] == 'Legacy edit' for row in legacy_pull['cards'])

    grant_id = await run_db(models.TMA_Collaborator.insert(
        target_type='deck', target_id=deck_id, user_id=viewer_id, role='viewer').execute)
    shared = await pull(viewer, '/api/sync/collab-pull?since=2020-01-01T00:00:00Z')
    assert any(row['id'] == card_id for row in shared['cards'])
    assert shared['access_version']
    shared_review = {'request_id': str(uuid4()), 'reviews': [{**review, 'card_id': card_id}]}
    await push(shared_review, viewer)
    await run_db(models.TMA_Collaborator.delete_by_id, grant_id)
    assert (await push(shared_review, viewer)).json()['review_count'] == 1
    await push({**shared_review, 'request_id': str(uuid4())}, viewer, expected=403)
    assert not pool._in_use

    rollback = {**batch, 'request_id': str(uuid4()),
                'cards': [{**batch['cards'][0], 'front_text': 'Rollback probe'}]}

    def verify_rollback():
        assert not models.TMA_Card.select().where(models.TMA_Card.front_text == 'Rollback probe').exists()
        assert not models.TMAOfflineBatch.select().where(
            models.TMAOfflineBatch.key.endswith(rollback['request_id'])).exists()

    await push({**rollback, 'reviews': [review, {**review, 'rating': 7}]}, expected=422)
    assert not pool._in_use
    await run_db(verify_rollback)
    disconnect_review.set()
    await push(rollback, expected=500)
    assert not disconnect_review.is_set()
    assert not pool._in_use
    await run_db(verify_rollback)
    recovered = (await push(rollback)).json()
    assert (await push(rollback)).json() == recovered
    recovered_card = recovered['mappings']['cards']['-3']
    history = models.TMAReviewHistory.select().where(models.TMAReviewHistory.card_id == recovered_card)
    assert await run_db(history.count) == 1
    assert not pool._in_use
    print('PASS: Sync HTTP receipts, rollback, disconnect recovery, legacy, collaboration and account isolation',
          flush=True)


async def verify_knowledge(client, pool, headers, account_ids):
    from api import models
    from api.db_workers import run_db

    def seed():
        deck = models.TMA_Deck.create(user_id=account_ids[0], name='Knowledge worker fixture')
        card = models.TMA_Card.create(deck=deck.id, front_text='Front', back_text='Back')
        ki = models.TMAKnowledgeItem.create(name='Primary fixture')
        replacement = models.TMAKnowledgeItem.create(name='Replacement fixture')
        mapping = models.TMACardKnowledgeItem.create(card_id=card.id, knowledge_item=ki.id, role='primary')
        grant = models.TMA_Collaborator.create(target_type='deck', target_id=deck.id,
                                              user_id=account_ids[1], role='viewer')
        return deck.id, card.id, ki.id, replacement.id, mapping.id, grant.id

    deck, card, ki, replacement, mapping, grant = await run_db(seed)
    event = {'client_event_id': 'pooled-event', 'card_id': card, 'knowledge_item_id': ki,
             'evaluation_data': {'schema_version': 1, 'evaluation_type': 'self_rating', 'rating': 'good'}}

    async def send(item=event, account=0, expected=200):
        response = await client.post('/api/knowledge/attempts/sync', headers=headers[account],
                                     json={'attempts': [item]})
        assert response.status_code == expected, response.text
        if expected == 200:
            return response.json()['results'][0]['status']

    limiter = to_thread.current_default_thread_limiter()
    tokens = limiter.total_tokens
    limiter.total_tokens = 2
    try:
        results = await asyncio.gather(*(send() for _ in range(8)))
    finally:
        limiter.total_tokens = tokens
    assert sorted(results) == ['created'] + ['duplicate'] * 7
    assert not pool._in_use
    assert await send({**event, 'evaluation_data': {**event['evaluation_data'], 'rating': 'easy'}}) == 'event_conflict'
    assert await send(account=1) == 'created'
    await run_db(models.TMACardKnowledgeItem.update(knowledge_item=replacement).where(
        models.TMACardKnowledgeItem.id == mapping).execute)
    assert await send() == 'duplicate'
    assert await send({**event, 'client_event_id': 'stale-ki'}) == 'rejected'
    await run_db(models.TMA_Collaborator.delete_by_id, grant)
    assert await send(account=1) == 'duplicate'
    assert await send({**event, 'client_event_id': 'revoked', 'knowledge_item_id': replacement},
                      account=1) == 'rejected'

    # Fail after the attempt insert, during the projection write.
    def inject_projection_failure():
        pool.execute_sql('''CREATE FUNCTION c2e_fail_projection() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture projection failure'; END $$''')
        pool.execute_sql('''CREATE TRIGGER c2e_fail_projection BEFORE INSERT ON tma_user_knowledge_state
            FOR EACH ROW EXECUTE FUNCTION c2e_fail_projection()''')

    rollback = {**event, 'client_event_id': 'projection-rollback', 'knowledge_item_id': replacement}
    await run_db(inject_projection_failure)
    try:
        await send(rollback, expected=500)
        assert not pool._in_use
        attempts = models.TMAKnowledgeAttempt.select().where(
            models.TMAKnowledgeAttempt.client_event_id == rollback['client_event_id'])
        assert not await run_db(attempts.exists)
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION c2e_fail_projection() CASCADE')
    assert await send(rollback) == 'created'
    assert await send(rollback) == 'duplicate'

    for path in (f'/decks/{deck}', '/diagnostics/summary', '/diagnostics/items',
                 f'/diagnostics/items/{ki}', f'/diagnostics/items/{ki}/attempts',
                 f'/diagnostics/items/{replacement}'):
        response = await client.get('/api/knowledge' + path, headers=headers[0])
        assert response.status_code == 200, response.text
        assert not pool._in_use
        if path in (f'/diagnostics/items/{ki}', f'/diagnostics/items/{replacement}'):
            data = response.json()
            assert data['state_matches_rebuild']
            assert data['materialized_state']['evidence_event_count'] == 1
    print('PASS: pooled Knowledge HTTP ownership, replay, authorization, projection rollback and diagnostics',
          flush=True)


async def verify_communications(client, pool, headers, accounts):
    from api import models
    from api.db_workers import run_db

    def seed():
        deck = models.TMA_Deck.create(user_id=accounts[0], name='Shared communication fixture')
        card = models.TMA_Card.create(deck=deck, front_text='Front', back_text='Back')
        grant = models.TMA_Collaborator.create(target_type='deck', target_id=deck.id,
                                              user_id=accounts[1], role='viewer')
        return deck.id, card.id, grant.id

    deck, card, grant = await run_db(seed)
    note_id, root_id, reply_id = (str(uuid4()) for _ in range(3))
    notes = f'/card-notes/{card}'
    note = f'{notes}/{note_id}'
    ratings = f'/card-ratings/{card}'
    rating_list = f'/card-ratings/deck/{deck}'
    root = f'/messages/{root_id}'

    async def request(method, path, data=None, account=1, status=200):
        auth = headers[account] if account is not None else {}
        response = await client.request(method, '/api' + path, headers=auth, json=data)
        assert response.status_code == status, (path, response.text)
        return response.json() if status == 200 else None

    await request('GET', notes, account=None, status=401)
    await request('PUT', note, {'text': ' '}, status=422)
    first = await request('PUT', note, {'text': 'Private note'})
    assert first['id'] == note_id and first['user_id'] == accounts[1]
    await request('PUT', note, {'text': 'Collision'}, account=0, status=404)
    assert await request('GET', notes, account=0) == []
    assert await request('GET', f'/card-notes/deck/{deck}') == [first]

    # A failed update must roll back the preceding UUID insert.
    def reject_update():
        pool.execute_sql("""CREATE FUNCTION fail_note_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture update failure'; END $$""")
        pool.execute_sql("""CREATE TRIGGER fail_note_fixture BEFORE UPDATE ON tma_card_note
            FOR EACH ROW EXECUTE FUNCTION fail_note_fixture()""")

    await run_db(reject_update)
    failed_note = str(uuid4())
    try:
        await request('PUT', f'{notes}/{failed_note}', {'text': 'Rollback'}, status=500)
        assert not await run_db(models.TMACardNote.get_or_none, models.TMACardNote.id == failed_note)
        assert not pool._in_use
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_note_fixture() CASCADE')

    root_data = {'text': 'Suggestion', 'card_id': card}
    limiter = to_thread.current_default_thread_limiter()
    tokens = limiter.total_tokens
    limiter.total_tokens = 2
    try:
        edited = await asyncio.gather(*(request('PUT', note, {'text': 'Updated'}) for _ in range(4)))
        assert sorted(row['revision'] for row in edited) == list(range(first['revision'] + 1,
                                                                     first['revision'] + 5))
        votes = await asyncio.gather(*(request('PUT', ratings, {'rating': 1}) for _ in range(4)))
        assert all(row['rating'] == 1 for row in votes)
        threads = await asyncio.gather(*(request('PUT', root, root_data) for _ in range(4)))
        assert all(row == threads[0] for row in threads)
    finally:
        limiter.total_tokens = tokens

    assert (await request('PUT', note, {'is_deleted': True}))['is_deleted']
    assert (await request('PUT', note, {'text': 'Late edit'}))['is_deleted']
    assert (await request('GET', notes))[0]['is_deleted']
    assert (await request('PUT', ratings, {'rating': -1, 'reason': 'unclear'}))['reason'] == 'unclear'
    await request('PUT', ratings, {'rating': 1, 'reason': 'unclear'}, status=422)
    assert await request('GET', rating_list, account=0) == []
    assert len(await request('GET', rating_list)) == 1
    for _ in range(2):
        assert (await request('PUT', ratings, {'rating': None}))['rating'] is None
    assert await request('GET', rating_list) == []

    assert await request('GET', '/messages', account=0) == []
    await request('GET', root, account=0, status=404)
    await request('PUT', root, {'text': 'Conflicting retry'}, status=409)
    assert await request('GET', root + '/card') == {'id': card, 'deck_id': deck}
    reply_path = f'/messages/{reply_id}'
    reply = await request('PUT', reply_path, {'text': 'My reply', 'thread_id': root_id})
    await request('PUT', f'/messages/{uuid4()}', {'text': 'Other account', 'thread_id': root_id},
                  account=0, status=404)
    assert await request('GET', root) == [threads[0], reply]
    await run_db(models.TMAUserMessage.create, id=str(uuid4()), user_id=accounts[1],
                 sender='admin', kind='reply', text='Admin reply', thread=root_id)
    assert (await request('GET', '/messages'))[0]['unread_count'] == 1
    for read, unread in ((True, 0), (True, 0), (False, 1)):
        await request('PUT', root + '/read', {'read': read})
        assert (await request('GET', '/messages'))[0]['unread_count'] == unread

    await run_db(models.TMA_Collaborator.delete_by_id, grant)
    for path in (notes, f'/card-notes/deck/{deck}', rating_list, root + '/card'):
        await request('GET', path, status=403)
    await request('PUT', note, {'text': 'Revoked'}, status=403)
    await request('PUT', ratings, {'rating': 1}, status=403)
    await request('PUT', f'/messages/{uuid4()}', root_data, status=403)
    assert await request('PUT', root, root_data) == threads[0]
    assert len(await request('GET', root)) == 3
    assert not pool._in_use
    print('PASS: pooled Notes, Ratings and Messages HTTP, concurrency, rollback and isolation', flush=True)


async def verify_trash(client, pool, headers, accounts):
    from api import models
    from api.db_workers import run_db

    def seed():
        updated_at = datetime(2026, 11, 1, 12)
        deck = models.TMA_Deck.create(user_id=accounts[0], name='Trash fixture', is_deleted=True,
                                     updated_at=updated_at)
        card = models.TMA_Card.create(deck=deck.id, front_text='Front', back_text='Back', is_deleted=True,
                                     updated_at=updated_at)
        models.TMAProgress.create(user_id=accounts[0], card_id=card.id)
        return deck.id, card.id

    deck, card = await run_db(seed)
    restore_deck = f'/deck/{deck}/restore'
    restore_card = f'/card/{card}/restore'

    async def request(method='GET', path='', account=0, expected=200):
        auth = headers[account] if account is not None else {}
        response = await client.request(method, '/api/trash' + path, headers=auth)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        if expected < 500:
            assert response.headers['cache-control'] == 'no-cache, no-store, must-revalidate'
            return response.json()

    await request(account=None, expected=401)
    assert not pool._in_use
    assert await request(account=1) == {'decks': [], 'cards': []}
    await request('POST', restore_card, account=1, expected=404)
    await request('POST', restore_deck, account=1, expected=404)
    assert not pool._in_use

    listing = await request()
    assert listing['decks'][0]['id'] == deck and listing['decks'][0]['cards_count'] == 1
    assert listing['cards'][0]['id'] == card and listing['cards'][0]['deck_name'] == 'Trash fixture'

    slots = asyncio.Semaphore(2)

    async def concurrent_read():
        async with slots:
            return await request()

    results = await asyncio.gather(*(concurrent_read() for _ in range(6)))
    assert results == [listing] * 6
    assert not pool._in_use

    def reject_deck_change():
        pool.execute_sql('''CREATE FUNCTION fail_trash_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture deck mutation failure'; END $$''')
        pool.execute_sql('''CREATE TRIGGER fail_trash_fixture BEFORE UPDATE OR DELETE ON tma_deck
            FOR EACH ROW EXECUTE FUNCTION fail_trash_fixture()''')

    await run_db(reject_deck_change)
    progress = models.TMAProgress.select().where(models.TMAProgress.card_id == card)
    try:
        # Both operations have already changed the card before reaching the failing deck statement.
        await request('POST', restore_card, expected=500)
        assert not pool._in_use
        assert await request() == listing
        await request('DELETE', '/clear', expected=500)
        assert not pool._in_use
        assert await request() == listing
        assert await run_db(progress.exists)
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_trash_fixture() CASCADE')

    async def restore_and_check(path):
        assert await request('POST', path) == {'status': 'success'}
        assert await request() == {'decks': [], 'cards': []}
        assert await run_db(progress.exists)
        assert not pool._in_use

    await restore_and_check(restore_card)
    await run_db(models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == deck).execute)
    await run_db(models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == card).execute)
    await restore_and_check(restore_deck)

    deleted_deck, deleted_card = await run_db(seed)
    assert await request('DELETE', '/clear', account=1) == {'status': 'success'}
    assert (await request())['decks'][0]['id'] == deleted_deck
    assert await request('DELETE', '/clear') == {'status': 'success'}
    assert not pool._in_use
    assert await request() == {'decks': [], 'cards': []}
    assert not await run_db(models.TMA_Deck.get_or_none, models.TMA_Deck.id == deleted_deck)
    assert not await run_db(models.TMA_Card.get_or_none, models.TMA_Card.id == deleted_card)
    assert not await run_db(models.TMAProgress.select().where(models.TMAProgress.card_id == deleted_card).exists)
    assert await run_db(progress.exists)
    print('PASS: pooled Trash HTTP listing, concurrency, authorization, restore, clear and rollback', flush=True)


async def verify_feedback_lid_folders(client, pool, headers, owner_id):
    from api import models
    from api.db_workers import run_db
    from api.routers.lid import MASTER_UID

    async def request(method, path, payload=None, account=0, expected=200):
        response = await client.request(method, '/api' + path, json=payload,
                                        headers=headers[account] if account is not None else {})
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        if expected < 500:
            assert response.headers['cache-control'] == 'no-cache, no-store, must-revalidate'
            return response.json()

    for method, path in (('POST', '/feedback'), ('GET', '/lid/ticket'), ('GET', '/folders')):
        await request(method, path, account=None, expected=401)
    assert not pool._in_use

    async def send_feedback(path, message):
        return await request('POST', path, {'message': message, 'rating': 4})

    def seed_ticket():
        models.TMAMedia.create(filename='fixture.png', folder='images')
        folder = models.TMA_Folder.create(user_id=MASTER_UID, name='Leben in Deutschland')
        for name, count in (('1. Politik', 10), ('2. Geschichte', 10), ('3. Mensch', 10), ('Bayern', 3)):
            deck = models.TMA_Deck.create(folder=folder, user_id=MASTER_UID, name=name)
            for position in range(1, count + 1):
                models.TMA_Card.create(deck=deck, position=position, front_text='Frage',
                                       back_text='Вопрос\n\n1. Ответ', image_path='fixture.png')

    await run_db(seed_ticket)
    for index in range(3):
        feedback, ticket = await asyncio.gather(
            send_feedback('/feedback' if index % 2 else '/feedback/', f'Fixture {index}'),
            request('GET', '/lid/ticket?state_code=by'),
        )
        saved = await run_db(models.TMAFeedback.get_by_id, feedback['id'])
        assert feedback['status'] == 'success' and saved.user_id == owner_id
        assert saved.message == f'Fixture {index}' and saved.rating == 4
        assert ticket['state_code'] == 'BY' and ticket['state_name'] == 'Bayern'
        assert ticket['total'] == len(ticket['cards']) == 33
        assert len({card['id'] for card in ticket['cards']}) == 33
        assert ticket['cards'][0]['translationRu'] == {'question': 'Вопрос', 'a': 'Ответ'}
        assert ticket['cards'][0]['image_url'].endswith('/fixture.png')
        assert not pool._in_use

    with patch.object(pool, '_initialize_connection',
                      side_effect=[None, RuntimeError('connection initialization failed')]) as initialize:
        failed_checkout = await client.post('/api/feedback/', headers=headers[0],
                                            json={'message': 'Checkout fixture'})
        assert initialize.call_count == 2  # Real auth checkout, then one handler checkout.
    assert failed_checkout.status_code == 500
    assert failed_checkout.json() == {'detail': 'Could not save feedback'}
    assert not pool._in_use

    await run_db(pool.execute_sql, """ALTER TABLE tma_feedback ADD CONSTRAINT c2f_feedback_probe
        CHECK (message <> 'Rejected fixture')""")
    rejected = await client.post('/api/feedback', headers=headers[0], json={'message': 'Rejected fixture'})
    assert rejected.status_code == 500 and rejected.json() == {'detail': 'Could not save feedback'}
    assert not pool._in_use
    assert await run_db(models.TMAFeedback.select().where(models.TMAFeedback.user_id == owner_id).count) == 3

    listing = await request('GET', '/folders')
    assert any(folder['name'] == '📥 Входящие' and folder['is_owner'] for folder in listing)
    folder = (await request('POST', '/folders', {'name': 'Fixture'}))['id']
    path = f'/folders/{folder}'
    child = (await request('POST', '/folders', {'name': 'Child', 'parent_id': folder}))['id']
    assert (await request('POST', path + '/rename', {'name': 'Renamed'}))['name'] == 'Renamed'
    await request('POST', path + '/rename', {'name': 'Forbidden'}, account=1, expected=403)
    assert (await request('POST', path + '/color', {'color': '#123456'}))['color'] == '#123456'
    await request('POST', path + '/move', {'parent_id': child}, expected=400)
    await request('POST', f'/folders/{child}/move', {'parent_id': None})
    await request('POST', '/folders/reorder', {'folder_ids': [child, folder]})
    listing, concurrent_listing = await asyncio.gather(request('GET', '/folders'), request('GET', '/folders'))
    assert listing == concurrent_listing and not pool._in_use
    assert [item['id'] for item in listing if item['id'] in (child, folder)] == [child, folder]

    def seed_folder_card():
        deck = models.TMA_Deck.create(folder=folder, user_id=owner_id, name='Maintenance')
        card = models.TMA_Card.create(deck=deck, front_text='Before', back_text='Answer')
        return deck.id, card.id

    deck, card = await run_db(seed_folder_card)
    payload = {'cards': [{'number': 1, 'deck_id': deck, 'card_id': card, 'front': 'After',
                          'back': 'Answer', 'context': '', 'topics': '', 'card_type': 'standard'}]}
    await request('POST', path + '/text-update/preview', payload, account=1, expected=403)
    preview = await request('POST', path + '/text-update/preview', payload)
    apply = {**payload, 'preview_token': preview['preview_token'], 'request_id': str(uuid4())}
    result = await request('POST', path + '/text-update/apply', apply)
    assert result['updated'] == 1
    assert await request('POST', path + '/text-update/apply', apply) == result
    assert (await run_db(models.TMA_Card.get_by_id, card)).front_text == 'After'
    assert not pool._in_use

    def reject_folder_delete():
        pool.execute_sql("""CREATE FUNCTION fail_folder_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture folder deletion failure'; END $$""")
        pool.execute_sql("""CREATE TRIGGER fail_folder_fixture BEFORE UPDATE ON tma_folder
            FOR EACH ROW WHEN (NEW.is_deleted) EXECUTE FUNCTION fail_folder_fixture()""")

    await run_db(reject_folder_delete)
    try:
        await request('DELETE', path, expected=500)
        assert not pool._in_use
        # The earlier deck update belongs to the same transaction as the rejected folder update.
        assert not (await run_db(models.TMA_Deck.get_by_id, deck)).is_deleted
        assert not (await run_db(models.TMA_Folder.get_by_id, folder)).is_deleted
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_folder_fixture() CASCADE')

    assert await request('DELETE', path) == {'status': 'success'}
    assert (await run_db(models.TMA_Deck.get_by_id, deck)).is_deleted
    assert not pool._in_use
    print('PASS: pooled Feedback, LiD and Folders HTTP, concurrency, authorization and rollback', flush=True)


async def verify_deck_list_and_json_import(client, pool, headers, accounts):
    from api import models, services
    from api.db_workers import run_db

    name = 'JSON worker fixture'
    payload = {'name': name, 'cards': [{'front': 'Original', 'back': 'Answer'}]}
    path = '/api/decks'

    async def import_json(body, account=0, status=200):
        response = await client.post(path + '/import-json', json=body, headers=headers[account])
        assert response.status_code == status, response.text
        assert not pool._in_use
        return response.json()

    assert (await client.get(path)).status_code == 401
    assert (await client.post(path + '/import-json', json=payload)).status_code == 401
    deck_id = (await import_json(payload))['deck_id']

    def seed():
        library = models.Deck.create(name=name)
        for front in ('Original', 'Library addition'):
            models.Card.create(deck=library.id, front_text=front, back_text='Answer')
        models.TMAMedia.create(filename='json-worker.webp', folder='images')
        models.TMA_Deck.update(metadata='{"resources":[{"type":"image","path":"json-worker.webp"}]}').where(
            models.TMA_Deck.id == deck_id).execute()

    await run_db(seed)

    # Two accounts can enter with a cold library cache and no inboxes.
    first = await asyncio.gather(*(client.get(path, headers=auth) for auth in headers))
    assert all(response.status_code == 200 for response in first)
    assert not pool._in_use
    own = next(deck for deck in first[0].json() if deck['id'] == deck_id)
    assert own['has_updates'] and own['role'] == 'owner' and own['stats']['total'] == 1
    assert own['metadata']['resources'][0]['url'] == '/api/media/images/json-worker.webp'
    assert all(deck['id'] != deck_id for deck in first[1].json())

    def starter_state():
        for account in accounts:
            assert models.TMAUser.get_by_id(account).default_decks_initialized
            inbox = models.TMA_Deck.get(user_id=account, is_inbox=True, is_deleted=False)
            assert inbox.folder.user_id == account and not inbox.folder.is_deleted

    await run_db(starter_state)
    warm = await client.get(path, headers=headers[1])
    assert warm.status_code == 200 and any(deck['is_inbox'] for deck in warm.json())
    assert not pool._in_use

    # The second INSERT fails a NOT NULL constraint after a full first batch.
    invalid = {'name': name, 'cards': [{'front': 'Rollback'}] * 100 + [{'front': None}]}
    assert await import_json(invalid, status=400) == {'detail': 'Import failed: invalid data or empty deck'}

    def persisted_cards():
        return list(models.TMA_Card.select(models.TMA_Card.front_text, models.TMA_Card.back_text)
                    .where(models.TMA_Card.deck_id == deck_id).tuples())

    assert await run_db(persisted_cards) == [('Original', 'Answer')]

    new_name = 'JSON rollback fixture'
    cards_before = await run_db(models.TMA_Card.select().count)
    assert await import_json({**invalid, 'name': new_name}, status=400) == {
        'detail': 'Import failed: invalid data or empty deck'}
    assert not await run_db(models.TMA_Deck.select().where(
        models.TMA_Deck.user_id == accounts[0], models.TMA_Deck.name == new_name).exists)
    assert await run_db(models.TMA_Card.select().count) == cards_before
    assert await import_json({**payload, 'name': new_name}) == {
        'status': 'success', 'deck_id': await run_db(lambda: models.TMA_Deck.get(
            user_id=accounts[0], name=new_name).id)}

    assert (await import_json(payload, account=1))['deck_id'] != deck_id
    assert await run_db(persisted_cards) == [('Original', 'Answer')]

    def disconnect(_user_id):
        pool.execute_sql('SELECT pg_terminate_backend(pg_backend_pid())')

    with patch.object(services, 'get_active_decks', side_effect=disconnect) as listing:
        assert (await client.get(path, headers=headers[0])).status_code == 500
        listing.assert_called_once_with(accounts[0])
    assert not pool._in_use
    assert (await client.get(path, headers=headers[0])).status_code == 200
    assert not pool._in_use
    print('PASS: pooled Deck List and JSON Import HTTP, cold cache, inbox, isolation and rollback', flush=True)


async def verify_inbox_initialization(client, pool):
    from contextlib import closing

    import psycopg2
    from psycopg2 import sql

    from api import models
    from api.auth.service import register_email_password
    from api.db_workers import run_db

    account = await run_db(register_email_password, 'inbox-race@example.invalid', 'synthetic test password')
    auth = {'Authorization': f'Bearer {account.access_token}'}

    async def race(table, *requests):
        # Block writes while letting both requests reach the initialization.
        # A third connection releases the gate once both workers are waiting.
        with closing(psycopg2.connect(dbname=pool.database, **pool.connect_params)) as gate:
            with gate, gate.cursor() as cursor:
                cursor.execute(sql.SQL('LOCK TABLE {} IN SHARE MODE').format(sql.Identifier(table)))
                tasks = [asyncio.create_task(client.request(*args, headers=auth, **kwargs))
                         for args, kwargs in requests]
                try:
                    async with asyncio.timeout(5):
                        while True:
                            cursor.execute(
                                "SELECT count(*) FROM pg_locks WHERE database = "
                                "(SELECT oid FROM pg_database WHERE datname = current_database()) "
                                "AND NOT granted AND (relation = %s::regclass OR locktype = 'advisory')", (table,))
                            if cursor.fetchone()[0] == 2:
                                break
                            await asyncio.sleep(0.01)
                finally:
                    gate.rollback()
                    responses = await asyncio.gather(*tasks)
        assert all(response.status_code == 200 for response in responses), [r.text for r in responses]
        assert not pool._in_use
        return [response.json() for response in responses]

    listing = (('GET', '/api/decks'), {})
    await race('tma_deck', listing, listing)
    french_folders = await race('tma_folder', *[
        (('POST', '/api/folders'), {'json': {'name': '📥 Входящие', 'target_language': lang}})
        for lang in (' FR ', 'fr')
    ])
    assert french_folders[0]['id'] == french_folders[1]['id']

    def persisted():
        folders = dict(models.TMA_Folder.select(models.TMA_Folder.id, models.TMA_Folder.target_language)
                       .where(models.TMA_Folder.user_id == account.account_id).tuples())
        decks = list(models.TMA_Deck.select(models.TMA_Deck.folder, models.TMA_Deck.target_language)
                     .where(models.TMA_Deck.user_id == account.account_id, models.TMA_Deck.is_inbox).tuples())
        assert sorted(folders.values()) == ['de', 'fr']
        assert folders[french_folders[0]['id']] == 'fr'
        assert len(decks) == 1 and decks[0][1] == folders[decks[0][0]] == 'de'

    await run_db(persisted)
    print('PASS: concurrent Inbox deck and folder initialization for the same account', flush=True)


async def verify_decks(client, pool, headers, accounts):
    from peewee import OperationalError

    from api import models, services
    from api.db_workers import run_db

    async def request(method, path='', *, account=0, body=None, expected=200):
        auth = headers[account] if account is not None else {}
        response = await client.request(method, '/api/decks' + path, json=body, headers=auth)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        if expected < 500:
            return response.json()

    await request('POST', body={'name': 'Anonymous'}, account=None, expected=401)
    deck, other = await asyncio.gather(
        request('POST', body={'name': 'Worker deck'}),
        request('POST', body={'name': 'Other worker deck'}, account=1),
    )
    assert not pool._in_use
    deck_id = deck['id']
    path = f'/{deck_id}'

    def seed():
        folder = models.TMA_Folder.create(user_id=accounts[0], name='Deck worker folder')
        for front in ('Copied first', 'Rejected second'):
            models.TMA_Card.create(deck=deck_id, front_text=front, back_text='Back')
        return folder.id

    folder_id = await run_db(seed)
    destination = {'folder_id': folder_id}
    await request('POST', body={'name': 'Denied', **destination}, account=1, expected=403)
    await request('POST', f"/{other['id']}/move", body=destination, account=1, expected=403)
    await request('POST', path + '/copy', body={}, account=1, expected=403)
    await request('POST', path + '/toggle-learning', account=1, expected=404)
    await run_db(models.TMA_Collaborator.create, target_type='deck', target_id=deck_id,
                 user_id=accounts[1], role='viewer')
    await request('POST', path + '/rename', body={'name': 'Denied'}, account=1, expected=403)
    await request('DELETE', path, account=1, expected=403)
    await request('POST', path + '/copy', body=destination, account=1, expected=403)
    assert await request('POST', path + '/toggle-learning', account=1) == {
        'status': 'success', 'is_learning': True}
    assert await request('POST', path + '/toggle-learning', body={'is_learning': False}) == {
        'status': 'success', 'is_learning': False}
    assert await request('POST', path + '/move', body=destination) == {'status': 'success'}
    assert await request('POST', path + '/rename', body={'name': ' Renamed '}) == {
        'status': 'success', 'name': 'Renamed'}
    assert not pool._in_use

    await run_db(pool.execute_sql, """CREATE FUNCTION fail_deck_copy_fixture() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture copy connection failure'; END $$""")
    await run_db(pool.execute_sql, """CREATE TRIGGER fail_deck_copy_fixture BEFORE INSERT ON tma_card
        FOR EACH ROW WHEN (NEW.front_text = 'Rejected second')
        EXECUTE FUNCTION fail_deck_copy_fixture()""")
    try:
        await request('POST', path + '/copy', body={}, account=1, expected=500)
        assert not pool._in_use

        def copy_exists():
            return models.TMA_Deck.select().where(
                models.TMA_Deck.user_id == accounts[1],
                models.TMA_Deck.name == 'Renamed (Копия)').exists()

        assert not await run_db(copy_exists)
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_deck_copy_fixture() CASCADE')

    copied = await request('POST', path + '/copy', body={}, account=1)
    assert copied['status'] == 'success'
    await request('POST', path + '/pin', account=1, expected=403)
    await request('POST', path + '/metadata', body={}, account=1, expected=403)
    await request('POST', '/reorder', body={'deck_ids': [deck_id, other['id']]}, expected=403)

    def seed_progress():
        card = models.TMA_Card.get(deck=deck_id, front_text='Copied first')
        return [
            models.TMAProgress.create(user_id=user, card_id=card.id, queue='review', interval=5).id
            for user in accounts
        ]

    owner_progress, viewer_progress = await run_db(seed_progress)
    reset, pin = await asyncio.gather(
        request('POST', path + '/reset', account=1),
        request('POST', path + '/pin'),
    )
    assert reset == {'status': 'success'}
    assert pin == {'status': 'success', 'is_pinned': True}
    assert not pool._in_use

    metadata = {'resources': [], 'is_learning': True}
    assert await request('POST', path + '/metadata', body=metadata) == {
        'status': 'success', 'metadata': {'resources': []}}
    sibling = await request('POST', body={'name': 'Sibling', **destination})
    ordering = {'deck_ids': [sibling['id'], deck_id]}

    def positions():
        return tuple(models.TMA_Deck.get_by_id(deck).position for deck in ordering['deck_ids'])

    previous_positions = await run_db(positions)
    await run_db(pool.execute_sql, f"""ALTER TABLE tma_deck ADD CONSTRAINT deck_worker_reorder_fixture
        CHECK (id <> {deck_id} OR position <> 1) NOT VALID""")
    try:
        await request('POST', '/reorder', body=ordering, expected=500)
        assert not pool._in_use
        assert await run_db(positions) == previous_positions
    finally:
        await run_db(pool.execute_sql, 'ALTER TABLE tma_deck DROP CONSTRAINT deck_worker_reorder_fixture')

    assert await request('POST', '/reorder', body=ordering) == {'status': 'success'}
    assert await run_db(positions) == (0, 1)
    assert await request('DELETE', path) == {'status': 'success'}

    def verify_persisted():
        original = models.TMA_Deck.get_by_id(deck_id)
        assert original.is_deleted and original.name == 'Renamed' and original.folder_id == folder_id
        assert original.is_pinned
        assert models.TMAProgress.get_by_id(owner_progress).interval == 5
        reset_progress = models.TMAProgress.get_by_id(viewer_progress)
        assert (reset_progress.queue, reset_progress.interval) == ('new', 0)
        assert models.TMA_Card.select().where(
            models.TMA_Card.deck == deck_id, models.TMA_Card.is_deleted).count() == 2
        assert models.TMA_Card.select().where(
            models.TMA_Card.deck == copied['id'], ~models.TMA_Card.is_deleted).count() == 2
        assert [models.TMASetting.get(key=f'DECK_LEARNING_{user}_{deck_id}').value
                for user in accounts] == ['0', '1']

    await run_db(verify_persisted)
    assert not pool._in_use

    # An unhandled 500 can close the HTTP connection after the response arrives.
    with patch.object(services, 'create_deck', side_effect=OperationalError('connection closed')) as failed:
        await request('POST', body={'name': 'Failed create'}, expected=500)
        failed.assert_called_once()
    assert not pool._in_use
    print('PASS: pooled Decks HTTP, concurrent writes, permissions and copy/reorder rollback', flush=True)


async def verify_deck_text_update(client, pool, headers, accounts):
    from api import models
    from api.db_workers import run_db
    from api.routers import decks

    def seed():
        deck = models.TMA_Deck.create(user_id=accounts[0], name='Text update worker fixture')
        card = models.TMA_Card.create(deck=deck, front_text='Original', back_text='Back')
        return deck.id, card.id

    deck_id, card_id = await run_db(seed)
    path = f'/api/decks/{deck_id}'
    item = {'number': 1, 'card_id': card_id, 'front': 'Updated', 'back': 'Back',
            'context': '', 'topics': '', 'card_type': 'standard'}
    body = {'cards': [item, {**item, 'number': 2, 'card_id': None, 'front': 'New fixture card'}]}

    async def request(method, suffix, payload=None, account=0, expected=200):
        auth = headers[account] if account is not None else {}
        response = await client.request(method, path + suffix, json=payload, headers=auth)
        assert response.status_code == expected, (suffix, response.status_code, response.text)
        if expected < 500:
            return response.json()

    async def cards(**kwargs):
        return await request('GET', '/cards', **kwargs)

    async def preview(**kwargs):
        return await request('POST', '/text-update/preview', body, **kwargs)

    async def apply(payload, **kwargs):
        return await request('POST', '/text-update/apply', payload, **kwargs)

    await cards(account=None, expected=401)
    await cards(account=1, expected=403)
    grant_id = await run_db(models.TMA_Collaborator.insert(
        target_type='deck', target_id=deck_id, user_id=accounts[1], role='viewer').execute)
    original, proposed = await asyncio.gather(cards(account=1), preview())
    assert [(card['id'], card['front']) for card in original] == [(card_id, 'Original')]
    assert proposed['can_apply'] and proposed['updated'] == proposed['new'] == 1
    assert not pool._in_use
    payload = {**body, 'preview_token': proposed['preview_token'],
               'request_id': str(uuid4()), 'include_new': True}
    await preview(account=1, expected=403)
    await apply(payload, account=1, expected=403)
    invalid = await apply({**payload, 'preview_token': '0' * 64}, expected=409)
    assert invalid['detail']['code'] == 'preview_changed'
    assert not pool._in_use

    await run_db(pool.execute_sql, """CREATE FUNCTION fail_deck_text_fixture() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture connection failure'; END $$""")
    await run_db(pool.execute_sql, """CREATE TRIGGER fail_deck_text_fixture BEFORE INSERT ON tma_card
        FOR EACH ROW WHEN (NEW.front_text = 'New fixture card')
        EXECUTE FUNCTION fail_deck_text_fixture()""")
    try:
        with patch.object(decks, 'apply_text_update', wraps=decks.apply_text_update) as attempted:
            await apply(payload, expected=500)
            attempted.assert_called_once()
        assert not pool._in_use
        assert await cards() == original
        receipt = models.TMAOfflineBatch.select().where(
            models.TMAOfflineBatch.key == f"text-update:{accounts[0]}:{payload['request_id']}")
        assert not await run_db(receipt.exists)
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_deck_text_fixture() CASCADE')

    entered = threading.Barrier(2)
    apply_text_update = decks.apply_text_update

    def concurrent_apply(*args):
        entered.wait(timeout=5)
        return apply_text_update(*args)

    with patch.object(decks, 'apply_text_update', side_effect=concurrent_apply):
        first, second = await asyncio.gather(apply(payload), apply(payload))
    assert first == second == {'status': 'success', 'updated': 1, 'created': 1,
                               'unchanged': 0, 'skipped_new': 0}
    assert not pool._in_use
    assert [card['front'] for card in await cards()] == ['Updated', 'New fixture card']
    changed = await apply({**payload, 'include_new': False}, expected=409)
    assert changed['detail']['code'] == 'request_changed'
    await run_db(models.TMA_Collaborator.delete_by_id, grant_id)
    await cards(account=1, expected=403)
    assert not pool._in_use
    print('PASS: pooled Deck Cards and Text Update HTTP, permissions, token, concurrent replay and rollback',
          flush=True)


async def verify_library_deck_routes(client, pool, headers, accounts):
    from unittest.mock import patch
    import os
    from peewee import OperationalError
    from api import models, services
    from api.db_workers import run_db

    def seed_library():
        cat = models.LibraryCategory.create(name='Worker Cat', description='Desc')
        deck = models.Deck.create(name='Worker Lib Deck', target_language='de', category_id=cat.id)
        card = models.Card.create(deck=deck, front_text='Worker Front', back_text='Worker Back')
        deck2 = models.Deck.create(name='Worker Lib Deck 2', target_language='de')
        models.Card.create(deck=deck2, front_text='Worker Front 2', back_text='Worker Back 2')
        return cat.id, deck.id, card.id, deck2.id

    cat_id, lib_deck_id, lib_card_id, lib2_id = await run_db(seed_library)

    # 1. Public GET /api/decks/external and /api/decks/external/categories
    ext = await client.get('/api/decks/external')
    assert ext.status_code == 200
    assert any(d['id'] == lib_deck_id for d in ext.json())
    assert not pool._in_use

    cats = await client.get('/api/decks/external/categories')
    assert cats.status_code == 200
    assert any(c['id'] == cat_id for c in cats.json())
    assert not pool._in_use

    attempts = 0
    real_get_external = services.get_external_decks

    def transient_disconnect(_target_lang=None):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            pool.execute_sql('SELECT pg_terminate_backend(pg_backend_pid())')
        return real_get_external()

    with patch.object(services, 'get_external_decks', side_effect=transient_disconnect) as listing:
        recovered = await client.get('/api/decks/external')
        assert recovered.status_code == 200
        assert listing.call_count == 2
    assert not pool._in_use

    def persistent_disconnect(_target_lang=None):
        pool.execute_sql('SELECT pg_terminate_backend(pg_backend_pid())')

    with patch.object(services, 'get_external_decks', side_effect=persistent_disconnect) as exhausted:
        assert (await client.get('/api/decks/external')).status_code == 500
        assert exhausted.call_count == 2
    assert not pool._in_use
    assert (await client.get('/api/decks/external')).status_code == 200
    assert not pool._in_use

    # 2. POST /api/decks/external/{deck_id}/toggle-default (admin guard, write)
    assert (await client.post(f'/api/decks/external/{lib_deck_id}/toggle-default')).status_code == 401
    assert not pool._in_use
    assert (await client.post(f'/api/decks/external/{lib_deck_id}/toggle-default', headers=headers[0])).status_code == 403
    assert not pool._in_use

    with patch.dict(os.environ, {'ADMIN_USER_ID': str(accounts[0])}):
        toggled = await client.post(f'/api/decks/external/{lib_deck_id}/toggle-default', headers=headers[0])
        assert toggled.status_code == 200
        assert toggled.json() == {'status': 'success', 'is_default': True}
        assert not pool._in_use
        toggled_back = await client.post(f'/api/decks/external/{lib_deck_id}/toggle-default', headers=headers[0])
        assert toggled_back.status_code == 200
        assert toggled_back.json() == {'status': 'success', 'is_default': False}
        assert not pool._in_use
        invalid_default = await client.post('/api/decks/external/999999/toggle-default', headers=headers[0])
        assert invalid_default.status_code == 400
        assert not pool._in_use

    # 3. POST /api/decks/external/import/{deck_id} (modes: merge, copy, replace, force_trash, rollback)
    import_url = f'/api/decks/external/import/{lib_deck_id}'
    assert (await client.post(import_url)).status_code == 401
    assert not pool._in_use

    # Import single (merge default)
    imported = await client.post(import_url, headers=headers[0])
    assert imported.status_code == 200
    tma_deck_id = imported.json()['deck_id']
    assert not pool._in_use

    # Seed progress on imported card
    def seed_progress():
        card = models.TMA_Card.get(deck=tma_deck_id, front_text='Worker Front')
        return models.TMAProgress.create(user_id=accounts[0], card_id=card.id, queue='review', interval=10).id

    prog_id = await run_db(seed_progress)

    # Re-import merge preserves progress
    re_merge = await client.post(import_url + '?mode=merge', headers=headers[0])
    assert re_merge.status_code == 200 and re_merge.json()['deck_id'] == tma_deck_id
    assert not pool._in_use
    assert await run_db(lambda: models.TMAProgress.get_by_id(prog_id).interval) == 10

    # Mode copy creates v2
    copy_res = await client.post(import_url + '?mode=copy', headers=headers[0])
    assert copy_res.status_code == 200
    copy_deck_id = copy_res.json()['deck_id']
    assert copy_deck_id != tma_deck_id
    assert not pool._in_use

    # Mode replace replaces cards and removes progress
    rep_res = await client.post(import_url + '?mode=replace', headers=headers[0])
    assert rep_res.status_code == 200 and rep_res.json()['deck_id'] == tma_deck_id
    assert not pool._in_use
    assert not await run_db(lambda: models.TMAProgress.select().where(models.TMAProgress.id == prog_id).exists())

    # Trash conflict and force_trash
    await run_db(lambda: models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == tma_deck_id).execute())
    trash_conflict = await client.post(import_url, headers=headers[0])
    assert trash_conflict.status_code == 200 and trash_conflict.json().get('status') == 'in_trash'
    assert not pool._in_use

    forced = await client.post(import_url + '?force_trash=true', headers=headers[0])
    assert forced.status_code == 200 and forced.json().get('status') == 'success'
    new_tma_deck_id = forced.json()['deck_id']
    assert not pool._in_use

    # Rollback on error
    await run_db(pool.execute_sql, """CREATE FUNCTION fail_lib_import_fixture() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture lib import failure'; END $$""")
    await run_db(pool.execute_sql, """CREATE TRIGGER fail_lib_import_fixture BEFORE INSERT ON tma_card
        FOR EACH ROW WHEN (NEW.front_text = 'Worker Front 2')
        EXECUTE FUNCTION fail_lib_import_fixture()""")
    try:
        fail_imp = await client.post(f'/api/decks/external/import/{lib2_id}', headers=headers[0])
        assert fail_imp.status_code in (404, 500)
        assert not pool._in_use
        assert not await run_db(lambda: models.TMA_Deck.select().where(
            models.TMA_Deck.user_id == accounts[0], models.TMA_Deck.name == 'Worker Lib Deck 2').exists())
    finally:
        await run_db(pool.execute_sql, 'DROP FUNCTION fail_lib_import_fixture() CASCADE')

    # 4. POST /api/decks/external/import-batch
    batch_url = '/api/decks/external/import-batch'
    assert (await client.post(batch_url, json={'deck_ids': [lib2_id]})).status_code == 401
    assert not pool._in_use
    batch_res = await client.post(batch_url, json={'deck_ids': [lib2_id]}, headers=headers[1])
    assert batch_res.status_code == 200
    assert len(batch_res.json()['imported_deck_ids']) == 1
    assert not pool._in_use

    # 5. POST /api/decks/{deck_id}/sync
    sync_url = f'/api/decks/{new_tma_deck_id}/sync'
    assert (await client.post(sync_url)).status_code == 401
    assert not pool._in_use
    # account 1 cannot mutate account 0 deck
    assert (await client.post(sync_url, json={'mode': 'merge'}, headers=headers[1])).status_code in (403, 404)
    assert not pool._in_use
    # owner can sync
    sync_res = await client.post(sync_url, json={'mode': 'merge'}, headers=headers[0])
    assert sync_res.status_code == 200 and sync_res.json() == {'status': 'success'}
    assert not pool._in_use

    # 6. Concurrency with 2 pooled connections
    concurrent_reads = await asyncio.gather(
        client.get('/api/decks/external'),
        client.get('/api/decks/external/categories')
    )
    assert all(r.status_code == 200 for r in concurrent_reads)
    assert not pool._in_use

    concurrent_mix = await asyncio.gather(
        client.post(f'/api/decks/{new_tma_deck_id}/sync', json={'mode': 'merge'}, headers=headers[0]),
        client.get('/api/decks/external')
    )
    assert all(r.status_code == 200 for r in concurrent_mix)
    assert not pool._in_use

    print('PASS: pooled Library Deck HTTP routes, permissions, import modes, sync, concurrency and rollback', flush=True)
