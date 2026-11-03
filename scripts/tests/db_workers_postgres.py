"""Called only by the disposable PostgreSQL security harness, never live DBs."""
import asyncio
from contextlib import asynccontextmanager
import socket
import sys
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
    from api.routers import sync
    # Legacy feedback imports `models` by its short name. Keep the harness on
    # its already-created fixture model module; never run schema init here.
    # Do not snapshot/restore all sys.modules: that unloads newly imported PIL
    # plugins while the media router still retains their original Image module.
    assert sys.modules.setdefault('models', models) is models
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
            await verify_sync(client, pool, headers, accounts[1].account_id, disconnect_review)
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
