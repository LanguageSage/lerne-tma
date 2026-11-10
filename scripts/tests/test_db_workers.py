"""C1 regressions over concurrent ASGI requests and real thread-local SQLite.

No shared connection, in-memory DB, SQL mocks or external services. The actual
production middleware is included so loop-thread connect/cleanup cannot hide.
"""
import asyncio
import datetime
from pathlib import Path
import threading
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from peewee import SqliteDatabase, OperationalError

from native_fixture import content, sqlite_native
from api.services.structured_card_api import content_response
from api import models, services
from api.dependencies.auth import get_user_id
with patch.object(models, 'create_all_tables'):
    from api.main import cache_headers_middleware
from api.routers import cards, study, bot, media


class TrackedDatabase(SqliteDatabase):
    def __init__(self, path):
        super().__init__(str(path), pragmas={'foreign_keys': 1, 'journal_mode': 'wal'}, timeout=5)
        self.events = []

    def _connect(self):
        connection = super()._connect()
        self.events.append(('open', threading.get_ident(), connection))
        return connection

    def _close(self, connection):
        try:
            super()._close(connection)
        finally:
            self.events.append(('close', threading.get_ident(), connection))

    def execute_sql(self, sql, params=None):
        connection = self.connection()
        self.events.append(('sql', threading.get_ident(), connection))
        return super().execute_sql(sql, params)


class DbPhaseAssertions:
    def assert_released(self):
        active = {}
        for action, thread, connection in self.db.events:
            self.assertNotEqual(thread, threading.get_ident(), 'SQL/lifecycle ran on event loop')
            if action == 'open':
                self.assertNotIn(connection, active)
                active[connection] = thread
            else:
                self.assertEqual(active.get(connection), thread, 'Connection crossed threads')
                if action == 'close':
                    del active[connection]
        self.assertFalse(active, 'A DB phase leaked its connection')
        if hasattr(self.db, '_in_use'):
            self.assertFalse(self.db._in_use)

    def run_asgi(self, operation):
        self.db.events.clear()
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(
                    app=self.app, raise_app_exceptions=False), base_url='http://fixture') as client:
                return await operation(client)
        try:
            return asyncio.run(run())
        finally:
            self.assert_released()


class DbWorkerTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/db-workers'
        scratch.mkdir(parents=True, exist_ok=True)
        self.path = scratch / f'{uuid4().hex}.sqlite3'
        self.db = TrackedDatabase(self.path)
        sqlite_native(self, self.db, writes=True)
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.cleanup)
        with self.db.connection_context():
            self.db.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
                models.TMA_Card, models.TMAProgress, models.TMAReviewHistory,
                models.TMA_Collaborator, models.TMAOfflineBatch, models.TMASetting,
                models.TMAMedia, models.TMAAuthAccount, models.TMAAuthIdentity,
                models.TMAAuthSession, models.TMAAuthToken, models.TMAAuthPassword,
                models.TMAAuthPasswordThrottle, models.TMAKnowledgeItem, models.TMACardKnowledgeItem])
            for uid in (1, 2, 3):
                models.TMAUser.create(user_id=uid, is_guest=uid == 3, default_decks_initialized=True)
            self.deck = models.TMA_Deck.create(user_id=1, name='Synthetic source')
            self.target = models.TMA_Deck.create(user_id=1, name='Synthetic target')
            self.card = models.TMA_Card.create(deck=self.deck, creator_id=1, content_v2=content('Synthetic', 'Back'), card_type=None)
            models.TMA_Card.create(deck=self.deck, content_v2=content('Synthetic', 'Back'), card_type=None)
            models.TMAProgress.create(card_id=self.card.id, user_id=1, queue='new', next_review=datetime.datetime.now())
        self.app = FastAPI()
        self.app.middleware('http')(cache_headers_middleware)
        for module in (cards, study, bot, media):
            self.app.include_router(module.router, prefix='/api')
        self.app.dependency_overrides[get_user_id] = lambda: 1

    def cleanup(self):
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def run_asgi(self, operation):
        self.db.events.clear()

        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app, raise_app_exceptions=False), base_url='http://fixture') as client:
                return await operation(client)

        result = asyncio.run(run())
        # Keep the connection objects themselves to rule out recycled Python ids.
        active = {}
        self.assertTrue(self.db.events, 'The real DB must be exercised')
        for action, thread, connection in self.db.events:
            self.assertNotEqual(thread, threading.get_ident(), 'DB touched the ASGI event-loop thread')
            if action == 'open':
                self.assertNotIn(connection, active)
                active[connection] = thread
            else:
                self.assertEqual(active.get(connection), thread, 'Connection used/closed by another thread')
                if action == 'close':
                    del active[connection]
        self.assertFalse(active, 'A worker leaked a connection')
        return result

    def grade_payload(self, **extra):
        return dict(card_id=self.card.id, deck_id=self.deck.id, grade=2) | extra

    def request_case(self, name):
        revision = content_response(self.card)['revision']
        batch = dict(card_ids=[self.card.id], target_deck_id=self.target.id, request_id=str(uuid4()), revisions={self.card.id: revision})
        return {
            'save': ('POST', '/api/cards/save', dict(deck_id=self.deck.id, content_v2=content('Saved'), request_id=str(uuid4()))),
            'move': ('POST', '/api/cards/batch-move', batch),
            'copy': ('POST', '/api/cards/batch-copy', batch),
            'delete': ('POST', '/api/cards/batch-delete', {key: value for key, value in batch.items() if key != 'target_deck_id'}),
            'update': ('PATCH', f'/api/cards/{self.card.id}', dict(content_v2=content('Updated'), revision=revision, request_id=str(uuid4()))),
            'flag': ('POST', f'/api/cards/{self.card.id}/flag', dict(flag=3)),
            'stats': ('GET', '/api/study/stats', None),
            'card': ('GET', f'/api/study/card/{self.card.id}', None),
            'next': ('GET', f'/api/decks/{self.deck.id}/next', None),
            'grade': ('POST', '/api/study/grade', self.grade_payload()),
            'duplicate_next': ('GET', '/api/study/duplicates/next', None),
            'duplicate_grade': ('POST', '/api/study/duplicates/grade', self.grade_payload()),
            'diagnostics': ('GET', '/api/bot/reminder-diagnostics', None),
            'bulk': ('POST', '/api/cards/bulk-save', {'import_id': str(uuid4()), 'cards': [{'deck_id': self.deck.id, 'content_v2': content('Bulk')}]}),
            'single_delete': ('DELETE', f'/api/cards/{self.card.id}', None),
            'duplicates': ('GET', '/api/cards/duplicates', None),
            'reorder': ('POST', '/api/cards/reorder', {'card_ids': [self.card.id], 'request_id': str(uuid4())}),
            'search': ('GET', '/api/cards/search?q=Synthetic', None),
        }[name]

    def concurrent_case(self, name):
        entered, release = threading.Event(), threading.Event()
        expired = []
        original = self.db.execute_sql
        lock = threading.Lock()

        def slow_sql(sql, params=None):
            with lock:
                first = not entered.is_set()
                if first:
                    entered.set()
            if first and not release.wait(3):
                expired.append(True)  # Finite watchdog also releases the broken async route.
            return original(sql, params)

        async def exercise(client):
            method, url, payload = self.request_case(name)
            headers = {'If-Match': '"' + content_response(self.card)['revision'] + '"'} if method == 'DELETE' else {}
            slow = asyncio.create_task(client.request(method, url, json=payload, headers=headers))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                self.assertFalse(expired, 'A blocking DB call stalled the event loop')
                self.assertFalse(slow.done(), 'The gate must still hold the first request')
                # A separate real ASGI request must complete while SQL is blocked.
                probe = await asyncio.wait_for(client.get(f'/api/study/card/{self.card.id}'), 1)
                self.assertEqual(probe.status_code, 200, probe.text)
                self.assertFalse(slow.done())
                return probe
            finally:
                release.set()
                response = await slow
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers['cache-control'], 'no-cache, no-store, must-revalidate')

        with patch.object(self.db, 'execute_sql', side_effect=slow_sql):
            self.run_asgi(exercise)
        opens = [(tid, conn) for action, tid, conn in self.db.events if action == 'open']
        self.assertGreaterEqual(len({tid for tid, _ in opens}), 2)
        self.assertGreaterEqual(len({conn for _, conn in opens}), 2)

    def test_failed_connection_initialization_releases_worker_connection(self):
        from api.db_workers import run_db
        original = self.db._initialize_connection
        attempts = []
        def initialize(connection):
            original(connection)
            attempts.append(connection)
            if len(attempts) == 1:
                raise RuntimeError('initialization failed')
        async def exercise(_client):
            with patch.object(self.db, '_initialize_connection', side_effect=initialize):
                with self.assertRaisesRegex(RuntimeError, 'initialization failed'):
                    await run_db(lambda: None)
                self.assertEqual(await run_db(lambda: self.db.execute_sql('SELECT 1').fetchone()), (1,))
        self.run_asgi(exercise)

    def test_grade_failure_rolls_back_and_a_later_request_can_commit(self):
        async def exercise(client):
            with patch.object(models.TMAReviewHistory, 'create', side_effect=RuntimeError('history failed')):
                response = await client.post('/api/study/grade', json=self.grade_payload(return_next=False))
                self.assertEqual(response.status_code, 500, response.text)
            return response
        self.run_asgi(exercise)
        with self.db.connection_context():
            progress = models.TMAProgress.get(card_id=self.card.id, user_id=1)
            self.assertEqual((progress.queue, progress.interval, progress.last_reviewed), ('new', 0, None))
            self.assertEqual(models.TMAReviewHistory.select().count(), 0)

        async def retry(client):
            result = await client.post('/api/study/grade', json=self.grade_payload(return_next=False))
            self.assertEqual(result.json(), {'status': 'success'})
        self.run_asgi(retry)
        with self.db.connection_context():
            self.assertEqual(models.TMAReviewHistory.select().count(), 1)

    def test_batch_failure_rolls_back_cards_and_deck_touch(self):
        from api.services import structured_card_api
        async def exercise(client):
            with patch.object(structured_card_api, 'touch_deck_and_parent_folders', side_effect=RuntimeError('touch failed')):
                result = await client.post('/api/cards/batch-move', json={
                    'card_ids': [self.card.id], 'target_deck_id': self.target.id, 'request_id': str(uuid4()),
                    'revisions': {self.card.id: content_response(self.card)['revision']}})
                self.assertEqual(result.status_code, 500, result.text)
        self.run_asgi(exercise)
        with self.db.connection_context():
            self.assertEqual(models.TMA_Card.get_by_id(self.card.id).deck_id, self.deck.id)

    def test_grade_connection_failure_is_not_retried_before_or_after_commit(self):
        original = services.update_card_progress
        for committed in (False, True):
            with self.subTest(committed=committed):
                with self.db.connection_context():
                    before = models.TMAReviewHistory.select().count()
                attempts = []

                def disconnected(*args, **kwargs):
                    attempts.append((threading.get_ident(), self.db.connection()))
                    if committed:
                        original(*args, **kwargs)
                    raise OperationalError('connection already closed')

                async def exercise(client):
                    with patch.object(services, 'update_card_progress', side_effect=disconnected):
                        result = await client.post('/api/study/grade', json=self.grade_payload(return_next=False))
                        self.assertEqual(result.status_code, 500, result.text)
                self.run_asgi(exercise)
                self.assertEqual(len(attempts), 1)
                self.assertNotEqual(attempts[0][0], threading.get_ident())
                with self.db.connection_context():
                    self.assertEqual(models.TMAReviewHistory.select().count(), before + int(committed))

    def test_get_middleware_retries_but_post_does_not(self):
        original = services.get_user_reminder_diagnostics
        # Build the expected value outside the ASGI loop/recording scope.
        with self.db.connection_context():
            expected = original(1)
        async def exercise(client):
            with patch.object(services, 'get_user_reminder_diagnostics', side_effect=[OperationalError('connection reset'), expected]) as call:
                result = await client.get('/api/bot/reminder-diagnostics')
                self.assertEqual(result.json(), expected)
                self.assertEqual(call.call_count, 2)
        self.run_asgi(exercise)

        async def post(client):
            with patch.object(services, 'update_card_progress', side_effect=OperationalError('connection reset')) as call:
                result = await client.post('/api/study/grade', json=self.grade_payload(return_next=False))
                self.assertEqual(result.status_code, 500)
                self.assertEqual(call.call_count, 1)
        self.run_asgi(post)

    def test_read_retry_is_bounded_and_does_not_retry_domain_failures(self):
        async def exercise(client):
            for failure, attempts in ((OperationalError('connection reset'), 2), (ValueError('bad data'), 1)):
                with patch.object(services, 'get_user_reminder_diagnostics', side_effect=failure) as call:
                    response = await client.get('/api/bot/reminder-diagnostics')
                    self.assertEqual(response.status_code, 500)
                    self.assertEqual(call.call_count, attempts)
        self.run_asgi(exercise)

    def test_permissions_validation_and_guest_contracts(self):
        async def exercise(client):
            for uid in (2, 3):
                self.app.dependency_overrides[get_user_id] = lambda: uid
                result = await client.post('/api/cards/save', json={
                    'deck_id': self.deck.id, 'content_v2': content('Forbidden'), 'request_id': str(uuid4())})
                self.assertEqual(result.status_code, 403, result.text)
            self.app.dependency_overrides[get_user_id] = lambda: 2
            result = await client.post('/api/study/grade', json=self.grade_payload())
            self.assertEqual(result.status_code, 403, result.text)
            self.app.dependency_overrides[get_user_id] = lambda: 1
            result = await client.post('/api/study/grade', json=self.grade_payload(grade=8))
            self.assertEqual(result.status_code, 422, result.text)
        self.run_asgi(exercise)
        with self.db.connection_context():
            self.assertEqual(models.TMA_Card.select().count(), 2)
            self.assertEqual(models.TMAReviewHistory.select().count(), 0)

    def test_real_auth_dependency_owns_its_worker_connection_on_success_and_failure(self):
        from api.auth.service import register_email_password
        with self.db.connection_context():
            tokens = register_email_password('worker@example.invalid', 'synthetic password')
        self.app.dependency_overrides.clear()
        async def exercise(client):
            for token, expected in ((tokens.access_token, 200), ('invalid', 401)):
                result = await client.get('/api/bot/reminder-diagnostics', headers={'Authorization': f'Bearer {token}'})
                self.assertEqual(result.status_code, expected, result.text)
        self.run_asgi(exercise)

    def test_study_does_not_start_tts_and_preserves_forced_selection(self):
        async def exercise(client):
            with patch('api.utils.audio.generate_audio', new_callable=AsyncMock) as tts:
                first = await client.get(f'/api/decks/{self.deck.id}/next?learn_more=true')
                self.assertEqual(first.json()['id'], self.card.id)
                self.assertIsNone(first.json()['audio_url'])
                graded = await client.post('/api/study/grade', json=self.grade_payload(review_context='forced'))
                self.assertNotEqual(graded.json()['id'], self.card.id)
                self.assertEqual(graded.json()['deck_name'], self.deck.name)
                tts.assert_not_called()
        self.run_asgi(exercise)

    def test_native_save_commits_without_implicit_tts(self):
        async def exercise(client):
            with patch('api.utils.audio.generate_audio', new_callable=AsyncMock) as native_tts:
                response = await client.post('/api/cards/save', json={'deck_id': self.deck.id,
                    'content_v2': content('Saved snapshot'), 'request_id': str(uuid4())})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIsNone(response.json()['audio_url'])
                self.assertEqual(response.json()['content_v2']['card']['data']['prompt'], 'Saved snapshot')
                native_tts.assert_not_called()
        self.run_asgi(exercise)

    def test_explicit_tts_persistence_success_and_failure_close_worker_connections(self):
        async def exercise(client):
            with patch('api.utils.audio.generate_audio', new_callable=AsyncMock,
                       return_value=('https://fixture.invalid/generated.mp3', None)):
                with patch.object(media, '_persist_card_audio', side_effect=OperationalError('write failed')):
                    failed = await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id})
                    self.assertEqual(failed.status_code, 500, failed.text)
                saved = await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id})
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertRegex(saved.json()['revision'], r'^[a-f0-9]{64}$')
        self.run_asgi(exercise)
        with self.db.connection_context():
            self.assertEqual(models.TMA_Card.get_by_id(self.card.id).audio_path, 'https://fixture.invalid/generated.mp3')

    def test_native_edits_preserve_audio_until_explicit_refresh_or_removal(self):
        with self.db.connection_context():
            models.TMA_Card.update(audio_path='https://fixture.invalid/old.mp3').where(models.TMA_Card.id == self.card.id).execute()
        async def exercise(client):
            current = (await client.get(f'/api/cards/{self.card.id}')).json()
            with patch('api.utils.audio.generate_audio', new_callable=AsyncMock,
                       return_value=('https://fixture.invalid/generated.mp3', None)) as tts:
                changed = await client.patch(f'/api/cards/{self.card.id}', json={'content_v2': content('Changed'),
                    'revision': current['revision'], 'request_id': str(uuid4())})
                self.assertEqual(changed.status_code, 200, changed.text)
                self.assertEqual(changed.json()['audio_path'], 'https://fixture.invalid/old.mp3')
                tts.assert_not_called()
                generated = await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id, 'force': True})
                self.assertEqual(generated.status_code, 200, generated.text)
                tts.assert_awaited_once()
                self.assertEqual(tts.call_args.args[0], 'Changed')
                self.assertNotIn('structured', tts.call_args.kwargs)
                self.assertTrue(tts.call_args.kwargs['force'])
                removed = await client.patch(f'/api/cards/{self.card.id}', json={'content_v2': content('Changed again'),
                    'audio_path': None, 'revision': generated.json()['revision'], 'request_id': str(uuid4())})
                self.assertEqual(removed.status_code, 200, removed.text)
                self.assertIsNone(removed.json()['audio_path'])
                self.assertEqual(tts.await_count, 1)
        self.run_asgi(exercise)

    def test_real_tts_db_work_is_offloaded_and_stale_generation_cannot_overwrite(self):
        entered, release = threading.Event(), threading.Event()
        async def generate(*_args, **_kwargs):
            self.assertEqual(threading.get_ident(), self.loop_thread, 'Async TTS/Storage must stay on the ASGI loop')
            self.assertEqual(sum(action == 'open' for action, _, _ in self.db.events),
                             sum(action == 'close' for action, _, _ in self.db.events),
                             'No DB connection should be held during network I/O')
            entered.set()
            await asyncio.to_thread(release.wait, 3)
            return 'https://fixture.invalid/generated.mp3', None
        async def exercise(client):
            self.loop_thread = threading.get_ident()
            with patch('api.utils.audio.generate_audio', side_effect=generate):
                generating = asyncio.create_task(client.post('/api/media/generate-card-audio', json={'card_id': self.card.id}))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    self.assertFalse(generating.done())
                    probe = await asyncio.wait_for(client.get(f'/api/study/card/{self.card.id}'), 1)
                    self.assertEqual(probe.status_code, 200, probe.text)
                    changed = await client.patch(f'/api/cards/{self.card.id}', json={'content_v2': content('Newer text'),
                        'revision': probe.json()['revision'], 'request_id': str(uuid4())})
                    self.assertEqual(changed.status_code, 200, changed.text)
                finally:
                    release.set()
                    saved = await generating
                    self.assertEqual(saved.status_code, 409, saved.text)
        self.run_asgi(exercise)
        with self.db.connection_context():
            saved = models.TMA_Card.get_by_id(self.card.id)
            self.assertEqual(saved.content_v2['card']['data']['prompt'], 'Newer text')
            self.assertIsNone(saved.audio_path)


def concurrency_test(name):
    def test(self):
        self.concurrent_case(name)
    return test


for _name in ('save', 'move', 'copy', 'delete', 'update', 'flag', 'stats', 'card',
              'next', 'grade', 'duplicate_next', 'duplicate_grade', 'diagnostics',
              'bulk', 'single_delete', 'duplicates', 'reorder', 'search'):
    setattr(DbWorkerTests, f'test_concurrent_asgi_{_name}', concurrency_test(_name))
