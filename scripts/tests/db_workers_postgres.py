"""Called only by the disposable PostgreSQL security harness, never live DBs."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
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
    from api.routers import card_notes, card_ratings, knowledge, messages, sync, trash
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
    for router in (card_notes.router, card_ratings.router, messages.router, trash.router):
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
            await verify_sync(client, pool, headers, accounts[1].account_id, disconnect_review)
            await verify_knowledge(client, pool, headers, [account.account_id for account in accounts])
            await verify_communications(client, pool, headers, [account.account_id for account in accounts])
            await verify_trash(client, pool, headers, [account.account_id for account in accounts])
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

    limiter = to_thread.current_default_thread_limiter()
    tokens = limiter.total_tokens
    limiter.total_tokens = 2
    try:
        results = await asyncio.gather(*(request() for _ in range(6)))
        assert results == [listing] * 6
    finally:
        limiter.total_tokens = tokens
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
