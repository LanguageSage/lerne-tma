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
    from api.routers import study

    assert database_name.startswith('lerne_security_test_')
    accounts = [register_email_password(f'study-{name}@example.invalid', 'synthetic study password')
                for name in ('owner', 'other', 'viewer', 'editor')]
    pool = PooledPostgresqlDatabase(database_name, max_connections=2, stale_timeout=300, **connection_args)
    previous = models.tma_db.obj, models.lerne_db.obj
    models.tma_db.initialize(pool)
    models.lerne_db.initialize(pool)
    app = FastAPI()
    app.include_router(study.router, prefix='/api')
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
