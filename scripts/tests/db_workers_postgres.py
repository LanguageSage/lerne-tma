"""Called only by the disposable PostgreSQL security harness, never live DBs."""
import asyncio
import threading
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from playhouse.pool import PooledPostgresqlDatabase


def verify(database_name, connection_args):
    from api import models
    from api.db_workers import db_worker
    with patch.object(models, 'create_all_tables'):
        from api.main import db_session_middleware

    events = []
    fail_initialization = threading.Event()

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

    pool = Pool(database_name, max_connections=2, stale_timeout=300, **connection_args)
    previous = models.tma_db.obj, models.lerne_db.obj
    models.tma_db.initialize(pool)
    models.lerne_db.initialize(pool)
    release = threading.Event()
    entered = threading.Barrier(3)
    app = FastAPI()
    app.middleware('http')(db_session_middleware)

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
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                    base_url='http://fixture') as client:
            held = [asyncio.create_task(client.get('/hold')) for _ in range(2)]
            try:
                await asyncio.to_thread(entered.wait, 5)
                assert len(pool._in_use) == 2
                # Exhaustion must fail promptly, leave the pool bound, and keep
                # the event loop responsive. No pool resize/replacement/retry loop.
                exhausted = await asyncio.wait_for(client.get('/read'), 2)
                assert exhausted.status_code == 500
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
        print('PASS: PostgreSQL worker ownership, concurrent ASGI, pool exhaustion/recovery, partial entry cleanup and rollback', flush=True)
    finally:
        pool.close_all()
        models.tma_db.initialize(previous[0])
        models.lerne_db.initialize(previous[1])
