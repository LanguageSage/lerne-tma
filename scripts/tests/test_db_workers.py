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

from api import models, services
from api.dependencies.auth import get_user_id
with patch.object(models, 'create_all_tables'):
    from api.main import db_session_middleware
from api.routers import cards, study, bot


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


class DbWorkerTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/db-workers'
        scratch.mkdir(parents=True, exist_ok=True)
        self.path = scratch / f'{uuid4().hex}.sqlite3'
        self.db = TrackedDatabase(self.path)
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
                models.TMAAuthPasswordThrottle])
            for uid in (1, 2, 3):
                models.TMAUser.create(user_id=uid, is_guest=uid == 3, default_decks_initialized=True)
            self.deck = models.TMA_Deck.create(user_id=1, name='Synthetic source')
            self.target = models.TMA_Deck.create(user_id=1, name='Synthetic target')
            self.card = models.TMA_Card.create(deck=self.deck, creator_id=1, front_text='Synthetic', back_text='Back')
            models.TMA_Card.create(deck=self.deck, front_text='Synthetic', back_text='Duplicate')
            models.TMAProgress.create(card_id=self.card.id, user_id=1, queue='new', next_review=datetime.datetime.now())
        self.app = FastAPI()
        self.app.middleware('http')(db_session_middleware)
        for module in (cards, study, bot):
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
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://fixture') as client:
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
        batch = dict(card_ids=[self.card.id], target_deck_id=self.target.id)
        return {
            'save': ('POST', '/api/cards/save', dict(deck_id=self.deck.id, front='Saved', auto_generate_audio=False)),
            'move': ('POST', '/api/cards/batch-move', batch),
            'copy': ('POST', '/api/cards/batch-copy', batch),
            'delete': ('POST', '/api/cards/batch-delete', batch),
            'update': ('PATCH', f'/api/cards/{self.card.id}', dict(front='Updated')),
            'flag': ('POST', f'/api/cards/{self.card.id}/flag', dict(flag=3)),
            'stats': ('GET', '/api/study/stats', None),
            'card': ('GET', f'/api/study/card/{self.card.id}', None),
            'next': ('GET', f'/api/decks/{self.deck.id}/next', None),
            'grade': ('POST', '/api/study/grade', self.grade_payload()),
            'duplicate_next': ('GET', '/api/study/duplicates/next', None),
            'duplicate_grade': ('POST', '/api/study/duplicates/grade', self.grade_payload()),
            'diagnostics': ('GET', '/api/bot/reminder-diagnostics', None),
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
            slow = asyncio.create_task(client.request(method, url, json=payload))
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
        from api.services import collaborative_service
        async def exercise(client):
            with patch.object(collaborative_service, 'touch_deck_and_parent_folders', side_effect=RuntimeError('touch failed')):
                result = await client.post('/api/cards/batch-move', json={
                    'card_ids': [self.card.id], 'target_deck_id': self.target.id})
                self.assertEqual(result.status_code, 400, result.text)
        self.run_asgi(exercise)
        with self.db.connection_context():
            self.assertEqual(models.TMA_Card.get_by_id(self.card.id).deck_id, self.deck.id)

    def test_grade_reconnect_retry_stays_in_worker_and_commits_once(self):
        original = services.update_card_progress
        attempts = []
        def disconnected(*args, **kwargs):
            attempts.append((threading.get_ident(), self.db.connection()))
            if len(attempts) == 1:
                raise OperationalError('connection already closed')
            return original(*args, **kwargs)
        async def exercise(client):
            with patch.object(services, 'update_card_progress', side_effect=disconnected):
                result = await client.post('/api/study/grade', json=self.grade_payload(return_next=False))
                self.assertEqual(result.json(), {'status': 'success'})
        self.run_asgi(exercise)
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0][0], attempts[1][0])
        self.assertIsNot(attempts[0][1], attempts[1][1])
        with self.db.connection_context():
            self.assertEqual(models.TMAReviewHistory.select().count(), 1)

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
                    with self.assertRaises(type(failure)):
                        await client.get('/api/bot/reminder-diagnostics')
                    self.assertEqual(call.call_count, attempts)
        self.run_asgi(exercise)

    def test_permissions_validation_and_guest_contracts(self):
        async def exercise(client):
            for uid in (2, 3):
                self.app.dependency_overrides[get_user_id] = lambda: uid
                result = await client.post('/api/cards/save', json={
                    'deck_id': self.deck.id, 'front': 'Forbidden', 'auto_generate_audio': False})
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
            with patch.object(services, 'ensure_card_audio', new_callable=AsyncMock) as tts:
                first = await client.get(f'/api/decks/{self.deck.id}/next?learn_more=true')
                self.assertEqual(first.json()['id'], self.card.id)
                self.assertIsNone(first.json()['audio_url'])
                graded = await client.post('/api/study/grade', json=self.grade_payload(review_context='forced'))
                self.assertNotEqual(graded.json()['id'], self.card.id)
                self.assertEqual(graded.json()['deck_name'], self.deck.name)
                tts.assert_not_called()
        self.run_asgi(exercise)

    def test_save_tts_starts_after_response_with_snapshot(self):
        response_started = threading.Event()
        seen = []
        async def audio(card, user_id, *, force=False, _offload_db=False):
            self.assertTrue(response_started.is_set(), 'TTS must remain a background task')
            self.assertTrue(_offload_db)
            seen.append((card['front_text'], user_id, force, threading.get_ident()))
            await asyncio.sleep(0)
            raise RuntimeError('TTS failed')
        # Record the actual ASGI response-start before BackgroundTasks executes.
        application = self.app
        async def observed(scope, receive, send):
            async def observe(message):
                if message['type'] == 'http.response.start':
                    response_started.set()
                await send(message)
            await application(scope, receive, observe)
        async def exercise(_client):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=observed, raise_app_exceptions=False), base_url='http://fixture') as client:
                with patch.object(services, 'ensure_card_audio', side_effect=audio):
                    result = await client.post('/api/cards/save', json={'deck_id': self.deck.id, 'front': 'Saved snapshot'})
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertIsNone(result.json()['audio_url'])
        self.run_asgi(exercise)
        self.assertEqual([(text, uid, force) for text, uid, force, _ in seen], [('Saved snapshot', 1, False)])

    def test_tts_persistence_success_and_failure_close_worker_connections(self):
        from api.services import media
        async def exercise(client):
            with patch('api.utils.audio.generate_audio', new_callable=AsyncMock,
                       return_value=('https://fixture.invalid/generated.mp3', None)):
                with patch.object(media, '_store_card_audio', side_effect=OperationalError('write failed')):
                    failed = await client.post('/api/cards/save', json={
                        'deck_id': self.deck.id, 'front': 'Failed TTS write'})
                    self.assertEqual(failed.status_code, 200, failed.text)
                saved = await client.post('/api/cards/save', json={
                    'deck_id': self.deck.id, 'front': 'Successful TTS write'})
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertIsNone(saved.json()['audio_url'])
                return failed.json()['id'], saved.json()['id']
        failed_id, saved_id = self.run_asgi(exercise)
        with self.db.connection_context():
            self.assertIsNone(models.TMA_Card.get_by_id(failed_id).audio_path)
            self.assertEqual(models.TMA_Card.get_by_id(saved_id).audio_path, 'https://fixture.invalid/generated.mp3')

    def test_save_preserves_tts_refresh_and_opt_out(self):
        with self.db.connection_context():
            models.TMA_Card.update(audio_path='https://fixture.invalid/old.mp3').where(models.TMA_Card.id == self.card.id).execute()
        async def exercise(client):
            with patch.object(services, 'ensure_card_audio', new_callable=AsyncMock) as tts:
                url = '/api/cards/save'
                data = dict(card_id=self.card.id, deck_id=self.deck.id)
                unchanged = await client.post(url, json=dict(data, front='Synthetic'))
                self.assertEqual(unchanged.status_code, 200, unchanged.text)
                tts.assert_not_called()
                changed = await client.post(url, json=dict(data, front='Changed'))
                self.assertEqual(changed.status_code, 200, changed.text)
                self.assertEqual(changed.json()['audio_path'], 'https://fixture.invalid/old.mp3')
                tts.assert_awaited_once()
                self.assertEqual(tts.call_args.kwargs, {'force': True, '_offload_db': True})
                self.assertEqual(tts.call_args.args[0]['front_text'], 'Changed')
                opted_out = await client.post(url, json=dict(data, front='Changed again', auto_generate_audio=False))
                self.assertEqual(opted_out.status_code, 200, opted_out.text)
                self.assertIsNone(opted_out.json()['audio_path'])
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
                saving = asyncio.create_task(client.post('/api/cards/save', json={
                    'card_id': self.card.id, 'deck_id': self.deck.id, 'front': 'TTS snapshot'}))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    self.assertFalse(saving.done())
                    probe = await asyncio.wait_for(client.get(f'/api/study/card/{self.card.id}'), 1)
                    self.assertEqual(probe.status_code, 200, probe.text)
                    changed = await client.patch(f'/api/cards/{self.card.id}', json={'front': 'Newer text'})
                    self.assertEqual(changed.status_code, 200, changed.text)
                finally:
                    release.set()
                    saved = await saving
                    self.assertEqual(saved.status_code, 200, saved.text)
        self.run_asgi(exercise)
        with self.db.connection_context():
            saved = models.TMA_Card.get_by_id(self.card.id)
            self.assertEqual(saved.front_text, 'Newer text')
            self.assertIsNone(saved.audio_path)


def concurrency_test(name):
    def test(self):
        self.concurrent_case(name)
    return test


for _name in ('save', 'move', 'copy', 'delete', 'update', 'flag', 'stats', 'card',
              'next', 'grade', 'duplicate_next', 'duplicate_grade', 'diagnostics'):
    setattr(DbWorkerTests, f'test_concurrent_asgi_{_name}', concurrency_test(_name))
