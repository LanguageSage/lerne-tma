"""Real Study HTTP regressions; called only by the disposable PostgreSQL gate."""
import asyncio
from unittest.mock import patch

from fastapi import FastAPI
from peewee import OperationalError
from playhouse.pool import PooledPostgresqlDatabase

from scripts.tests.db_workers_postgres import http_client


def verify(database_name, connection_args):
    from api import models
    from api.auth.service import register_email_password
    from api.routers import study, sync

    assert database_name.startswith('lerne_security_test_')
    accounts = [register_email_password(f'study-{name}@example.invalid', 'synthetic study password')
                for name in ('owner', 'other', 'viewer', 'editor')]
    pool = PooledPostgresqlDatabase(database_name, max_connections=2, stale_timeout=300, **connection_args)
    previous = models.tma_db.obj, models.lerne_db.obj
    models.tma_db.initialize(pool)
    models.lerne_db.initialize(pool)
    app = FastAPI()
    app.include_router(study.router, prefix='/api')
    app.include_router(sync.router, prefix='/api')
    try:
        asyncio.run(verify_http(app, pool, accounts))
    finally:
        pool.close_all()
        models.tma_db.initialize(previous[0])
        models.lerne_db.initialize(previous[1])


async def verify_http(app, pool, accounts):
    from api import models, services
    from api.db_workers import run_db
    from api.routers import study

    owner, other, viewer, editor = [account.account_id for account in accounts]
    headers = {account.account_id: {'Authorization': f'Bearer {account.access_token}'} for account in accounts}

    def seed():
        root = models.TMA_Folder.create(user_id=owner, name='Synthetic shared root')
        child = models.TMA_Folder.create(user_id=owner, parent=root, name='Synthetic child')
        private = models.TMA_Deck.create(user_id=owner, name='Synthetic private')
        shared = models.TMA_Deck.create(user_id=owner, name='Synthetic direct grant')
        inherited = models.TMA_Deck.create(user_id=owner, folder=child, name='Synthetic inherited grant')
        public_root = models.TMA_Folder.create(user_id=owner, name='Synthetic published', access_scope='global_readonly')
        public_child = models.TMA_Folder.create(user_id=owner, parent=public_root, name='Synthetic published child')
        published = models.TMA_Deck.create(user_id=owner, folder=public_child, name='Synthetic published deck')
        deleted = models.TMA_Deck.create(user_id=owner, name='Synthetic deleted', is_deleted=True)
        for user, role in ((viewer, 'viewer'), (editor, 'editor')):
            for kind, target in (('deck', shared.id), ('folder', root.id)):
                models.TMA_Collaborator.create(target_type=kind, target_id=target, user_id=user, role=role)
        decks = (private, shared, inherited, published, deleted)
        cards = [models.TMA_Card.create(deck=deck, front_text='Synthetic duplicate', back_text='Synthetic answer')
                 for deck in decks]
        following = models.TMA_Card.create(deck=private, front_text='Synthetic next card', back_text='', position=10)
        removed = models.TMA_Card.create(deck=private, front_text='Synthetic removed', back_text='', is_deleted=True)
        # Card authorship and the client-supplied deck must never grant access.
        cards[0].creator_id = other
        cards[0].save()
        foreign_deck = models.TMA_Deck.create(user_id=other, name='Synthetic unrelated deck')
        return cards, removed.id, foreign_deck.id, following.id

    cards, removed_id, foreign_deck, following_id = await run_db(seed)
    private, shared, inherited, published, deleted = cards

    async def snapshot():
        return await run_db(lambda: (
            list(models.TMAProgress.select().order_by(models.TMAProgress.id).dicts()),
            list(models.TMAReviewHistory.select().order_by(models.TMAReviewHistory.id).dicts())))

    async with http_client(app) as client:
        async def call(method, path, user=owner, **kwargs):
            response = await client.request(method, '/api' + path, headers=headers[user], **kwargs)
            assert not pool._in_use, 'Study leaked a pooled connection'
            return response

        async def deny(method, path, status, user=other, **kwargs):
            before = await snapshot()
            response = await call(method, path, user, **kwargs)
            assert response.status_code == status, (path, response.status_code, response.text)
            assert await snapshot() == before, 'Denied request changed progress or history'

        async def grade(card, user=owner, duplicate=False, **changes):
            payload = dict(card_id=card.id, deck_id=card.deck_id, grade=2, return_next=False)
            payload.update(changes)
            return await call('POST', '/study/duplicates/grade' if duplicate else '/study/grade', user, json=payload)

        # Reject forged IDs/decks, soft-deleted resources and unauthenticated requests.
        await deny('GET', f'/study/card/{private.id}', 403)
        await deny('POST', '/study/grade', 403, json=dict(card_id=private.id, deck_id=private.deck_id, grade=2))
        await deny('POST', '/study/grade', 404, json=dict(card_id=private.id, deck_id=foreign_deck, grade=2))
        await deny('POST', '/study/duplicates/grade', 403,
                   json=dict(card_id=private.id, deck_id=foreign_deck, grade=2, return_next=False))
        for card_id, status in ((removed_id, 404), (999999999, 404), (deleted.id, 403)):
            await deny('GET', f'/study/card/{card_id}', status, user=owner)
            await deny('POST', '/study/duplicates/grade', status, user=owner,
                       json=dict(card_id=card_id, grade=2))
        for path, method, payload in ((f'/study/card/{private.id}', 'GET', None),
                                     ('/study/grade', 'POST', dict(card_id=private.id, deck_id=private.deck_id, grade=2)),
                                     ('/study/duplicates/grade', 'POST', dict(card_id=private.id, grade=2))):
            before = await snapshot()
            response = await client.request(method, '/api' + path, json=payload)
            assert response.status_code == 401, response.text
            assert await snapshot() == before
        print('PASS: Study access denial has no progress/history side effects', flush=True)

        # Ordinary Study retains owner, direct/inherited viewer/editor and published access.
        for card, users in ((private, (owner,)), (shared, (viewer, editor)),
                            (inherited, (viewer, editor)), (published, (other, viewer, editor))):
            for user in users:
                response = await call('GET', f'/study/card/{card.id}', user)
                assert response.status_code == 200 and response.json()['id'] == card.id, response.text
                before = len((await snapshot())[1])
                response = await grade(card, user)
                assert response.status_code == 200 and response.json() == {'status': 'success'}, response.text
                assert len((await snapshot())[1]) == before + 1

        # Duplicates/next is owner-only even for shared/published content.
        for user in (other, viewer, editor):
            response = await call('GET', '/study/duplicates/next', user)
            assert response.status_code == 200 and response.json() == {'finished': True}, response.text
        for card, user in ((shared, viewer), (inherited, editor), (published, other)):
            await deny('POST', '/study/duplicates/grade', 403, user=user,
                       json=dict(card_id=card.id, grade=2, return_next=False))
        response = await call('GET', '/study/duplicates/next')
        assert response.status_code == 200 and response.json()['deck_id'] in {card.deck_id for card in cards}, response.text
        before = len((await snapshot())[1])
        response = await grade(private, duplicate=True, return_next=True)
        assert response.status_code == 200 and response.json()['id'], response.text
        assert len((await snapshot())[1]) == before + 1
        print('PASS: legal Study/shared/published access and owner-only duplicate policy', flush=True)

        # The real service commits before the native PostgreSQL connection is closed.
        # The next query raises the exact failure that used to replay run_grade().
        original_update = services.update_card_progress

        def disconnect_after_commit(*args, **kwargs):
            result = original_update(*args, **kwargs)
            pool.connection().close()
            pool.execute_sql('SELECT 1')
            return result

        before = len((await snapshot())[1])
        with patch.object(services, 'update_card_progress', side_effect=disconnect_after_commit) as update:
            response = await grade(private, return_next=True)
        assert response.status_code == 500, response.text
        assert update.call_count == 1, 'One HTTP request reapplied SRS after commit'
        assert len((await snapshot())[1]) == before + 1
        assert await run_db(lambda: models.TMAProgress.get(
            models.TMAProgress.card_id == private.id, models.TMAProgress.user_id == owner).last_reviewed)

        # Failure during selection or serialization also cannot replay the grade.
        for target in ('selection', 'serialization'):
            before = len((await snapshot())[1])
            module, name = (services, 'get_next_card') if target == 'selection' else (study, '_card_to_response')
            with patch.object(services, 'update_card_progress', wraps=original_update) as update, patch.object(
                    module, name, side_effect=OperationalError('connection already closed')):
                response = await grade(private, return_next=True, review_context='forced')
            assert response.status_code == 500, response.text
            assert update.call_count == 1
            assert len((await snapshot())[1]) == before + 1

        # A failure inside the existing transaction still rolls back both writes.
        before = await snapshot()
        with patch.object(models.TMAReviewHistory, 'create', side_effect=OperationalError('synthetic history failure')):
            response = await grade(private)
        assert response.status_code == 500, response.text
        assert await snapshot() == before

        # Recovery uses a new request; forced selection/exclusions and old default return_next remain intact.
        for changes in ({'return_next': False}, {'return_next': True, 'review_context': 'forced'},
                        {'return_next': True, 'learn_more': True, 'exclude_ids': [private.id, following_id]}):
            before = len((await snapshot())[1])
            response = await grade(private, **changes)
            assert response.status_code == 200, response.text
            if changes.get('review_context') == 'forced':
                assert response.json()['id'] == following_id, response.text
            else:
                assert response.json() == ({'finished': True} if changes['return_next'] else {'status': 'success'})
            assert len((await snapshot())[1]) == before + 1
        before = len((await snapshot())[1])
        response = await call('POST', '/study/grade', json=dict(card_id=private.id, deck_id=private.deck_id, grade=2))
        assert response.status_code == 200 and ('id' in response.json() or response.json() == {'finished': True}), response.text
        assert len((await snapshot())[1]) == before + 1
        print('PASS: committed disconnect/selection/serialization failures never replay grades; rollback and recovery preserved', flush=True)
        await verify_idempotency(client, headers[owner], private, pool, run_db)


async def verify_idempotency(client, headers, card, pool, run_db):
    from uuid import uuid4
    from api import models, services

    async def state():
        return await run_db(lambda: (list(models.TMAProgress.select().dicts()), models.TMAReviewHistory.select().count()))

    slots = asyncio.Semaphore(2)  # Match the fixture pool; exercise overlap, not pool exhaustion.
    async def post(path, data):
        async with slots:
            return await client.post('/api' + path, headers=headers, json=data)

    action = str(uuid4())
    payload = dict(card_id=card.id, deck_id=card.deck_id, grade=2, return_next=False, action_id=action)
    before = await state()
    original = services.update_card_progress

    def lost_response(*args, **kwargs):
        original(*args, **kwargs)
        raise OperationalError('connection already closed')

    with patch.object(services, 'update_card_progress', side_effect=lost_response):
        assert (await post('/study/grade', payload)).status_code == 500
    committed = await state()
    assert committed[1] == before[1] + 1
    results = await asyncio.gather(*(post('/study/grade', payload) for _ in range(6)))
    assert all(response.status_code == 200 for response in results)
    assert await state() == committed
    assert (await post('/study/grade', {**payload, 'grade': 0})).status_code == 409
    assert await state() == committed

    event = dict(action_id=action, card_id=card.id, rating=2, review_time='2026-11-05T09:00:00Z', scheduled_interval=999)
    # A stale fallback snapshot must not roll SRS back, even in a fresh batch.
    batch = dict(request_id=str(uuid4()), reviews=[event], progress=[dict(card_id=card.id, queue='new', interval=999,
        ease_factor=2.5, repetitions=0, lapses=0)])
    assert (await post('/sync/v2/push', batch)).status_code == 200
    synced = await state()
    assert synced[1] == committed[1]
    for old, new in zip(committed[0], synced[0]):
        assert {k: v for k, v in old.items() if k != 'updated_at'} == {k: v for k, v in new.items() if k != 'updated_at'}
    assert (await post('/sync/v2/push', {**batch, 'request_id': str(uuid4())})).status_code == 200
    assert (await state())[1] == committed[1]

    # Offline first, then POST; different UUID means a new legitimate review.
    second = str(uuid4())
    batch = dict(request_id=str(uuid4()), reviews=[{**event, 'action_id': second}])
    assert (await post('/sync/v2/push', batch)).status_code == 200
    offline = await state()
    assert offline[1] == committed[1] + 1
    assert (await post('/study/grade', {**payload, 'action_id': second})).status_code == 200
    assert await state() == offline
    third = {**payload, 'action_id': str(uuid4())}
    results = await asyncio.gather(*(post('/study/grade', third) for _ in range(6)))
    assert all(response.status_code == 200 for response in results)
    assert (await state())[1] == offline[1] + 1
    assert (await post('/study/duplicates/grade', third)).status_code == 200
    assert (await state())[1] == offline[1] + 1
    retry = {**payload, 'action_id': str(uuid4())}
    before_failure = await state()
    with patch.object(models.TMAReviewHistory, 'create', side_effect=OperationalError('synthetic receipt rollback')):
        assert (await post('/study/grade', retry)).status_code == 500
    assert await state() == before_failure
    assert (await post('/study/grade', retry)).status_code == 200
    assert (await state())[1] == before_failure[1] + 1
    assert not pool._in_use
    print('PASS: grade UUID concurrency, lost response, POST/offline sync both directions, payload conflicts and stale snapshots', flush=True)
