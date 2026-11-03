"""Media contracts and ownership over real thread-local SQL and production middleware.

External Storage/TTS are synthetic. Also run against a real pool of two connections
by test_supabase_security.py; no developer database or existing data is used.
"""
import asyncio
from io import BytesIO
from pathlib import Path
import shutil
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI, Header
from PIL import Image
from peewee import OperationalError

from api import models
from api.db_workers import run_db
from api.dependencies.auth import get_user_id
from api.routers import media
from scripts.tests import test_db_workers as fixtures


class MediaDbWorkerTests(unittest.TestCase):
    database_factory = None

    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/media-db-workers'
        scratch.mkdir(parents=True, exist_ok=True)
        self.root = scratch / uuid4().hex
        self.root.mkdir()
        def cleanup_files():
            assert self.root.resolve().parent == scratch.resolve()
            shutil.rmtree(self.root)
        self.addCleanup(cleanup_files)
        self.db = (self.database_factory() if self.database_factory else
                   fixtures.TrackedDatabase(self.root / 'fixture.sqlite3'))
        self.previous = models.tma_db.obj, models.lerne_db.obj
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        self.addCleanup(self.cleanup)
        with self.db.connection_context():
            self.db.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
                models.TMA_Card, models.TMA_Collaborator, models.TMASetting, models.TMAMedia])
            for uid in (1, 2, 3):
                models.TMAUser.create(user_id=uid, is_guest=False, default_decks_initialized=True)
            self.deck = models.TMA_Deck.create(user_id=1, name='Synthetic media')
            self.card = models.TMA_Card.create(deck=self.deck, creator_id=1,
                front_text='Haus', back_text='дом', audio_path='https://fixture.invalid/old.mp3')
            models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id,
                                          user_id=2, role='editor', added_by=1)
            models.TMASetting.create(key='TTS_VOICE', value='de-DE-KatjaNeural')
            models.TMASetting.create(key='TTS_SPEED', value='+15%')
        media._media_cache = media.MediaMemoryCache()
        self.app = FastAPI()
        self.app.middleware('http')(fixtures.db_session_middleware)
        self.app.include_router(media.router, prefix='/api')
        def user(x_test_user: int = Header(default=1)):
            return x_test_user
        self.app.dependency_overrides[get_user_id] = user
        self.local = patch.object(media, 'is_local', return_value=False)
        self.local.start()
        self.addCleanup(self.local.stop)

    def cleanup(self):
        self.db.close()
        if hasattr(self.db, 'close_all'):
            self.db.close_all()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])

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
        self.assertFalse(active, 'A media phase leaked its connection')
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

    async def saved_card(self):
        return await run_db(lambda: models.TMA_Card.get_by_id(self.card.id).__data__.copy())

    def test_upload_read_repeat_range_and_background_listing(self):
        async def exercise(client):
            for kind, folder in (('video', 'videos'), ('background', 'backgrounds')):
                for uid in (1, 2):
                    payload = b'0123456789 synthetic media'
                    response = await client.post(f'/api/media/upload-{kind}',
                        headers={'X-Test-User': str(uid)}, files={'file': ('fixture.mp4', payload)})
                    self.assertEqual(response.status_code, 200, response.text)
                    url = response.json()['url']
                    self.assertIn(f'_{uid}_', url)
                    for _ in range(2):
                        read = await client.get(url)
                        self.assertEqual(read.content, payload)
                        self.assertEqual(read.headers['cache-control'], 'public, max-age=604800')
                    partial = await client.get(url, headers={'Range': 'bytes=2-5'})
                    self.assertEqual((partial.status_code, partial.content), (206, b'2345'))
                    self.assertEqual((await client.get(url, headers={'If-None-Match': read.headers['etag']})).status_code, 304)
                    self.assertEqual((await client.get(url, headers={'Range': 'bytes=999-'})).status_code, 416)
                self.assertEqual((await client.get(f'/api/media/{folder}/missing.mp4')).status_code, 404)
            backgrounds = await client.get('/api/media/backgrounds')
            self.assertEqual(len(backgrounds.json()), 2)  # Existing shared gallery contract.
        self.run_asgi(exercise)

    def test_image_fallback_cache_and_storage_run_without_connection(self):
        image = BytesIO()
        Image.new('RGB', (8, 8), 'red').save(image, 'PNG')
        loop_thread = threading.get_ident()
        def upload(*_args):
            self.assertNotEqual(threading.get_ident(), loop_thread)
            self.assertTrue(self.db.is_closed(), 'Storage I/O holds a connection')
            return None  # Existing DB-blob fallback.
        async def exercise(client):
            with patch.object(media, 'upload_image_to_supabase', side_effect=upload):
                uploaded = await client.post('/api/media/upload-image', files={'file': ('fixture.png', image.getvalue())})
            self.assertEqual(uploaded.status_code, 200, uploaded.text)
            response = await client.get(uploaded.json()['url'])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['content-type'], 'image/webp')
            self.assertTrue(response.content.startswith(b'RIFF'))
            with patch.object(self.db, 'connect', side_effect=OperationalError('connection unavailable')):
                self.assertEqual((await client.get(uploaded.json()['url'])).content, response.content)
                self.assertEqual((await client.get('/api/media/audio/nonexistent-synthetic.mp3')).status_code, 307)
            with patch.dict('os.environ', SUPABASE_URL='https://fixture.invalid'):
                missing = await client.get('/api/media/images/missing.png')
                self.assertEqual(missing.status_code, 307)
                self.assertIn('/storage/v1/object/public/images/missing.png', missing.headers['location'])
        self.run_asgi(exercise)

    def test_tts_snapshots_settings_errors_permissions_and_repeat(self):
        async def generate(text, **kwargs):
            self.assert_released()
            self.assertEqual(text, 'Haus')
            self.assertEqual(kwargs['voice'], 'de-DE-KatjaNeural')
            self.assertEqual(kwargs['rate'], '+15%')
            return 'https://fixture.invalid/new.mp3', []
        async def exercise(client):
            with patch('api.utils.audio.generate_audio', side_effect=generate) as tts:
                response = await client.post('/api/media/generate-audio', json={'text': 'Haus'})
                self.assertEqual(response.json()['word_boundaries'], [])
                for uid, status in ((3, 403), (2, 200), (1, 200)):
                    response = await client.post('/api/media/generate-card-audio',
                        headers={'X-Test-User': str(uid)}, json={'card_id': self.card.id})
                    self.assertEqual(response.status_code, status, response.text)
                self.assertEqual(tts.call_count, 3)
            self.assertEqual((await self.saved_card())['audio_path'], 'https://fixture.invalid/new.mp3')
            for result, status in ((None, 500), ('/tmp/pending.mp3', 503)):
                with patch('api.utils.audio.generate_audio', return_value=result):
                    response = await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id})
                    self.assertEqual(response.status_code, status)
            self.assertEqual((await self.saved_card())['audio_path'], 'https://fixture.invalid/new.mp3')
            self.assertEqual((await client.post('/api/media/generate-card-audio', json={'card_id': 999999})).status_code, 404)
            self.assertEqual((await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id, 'side': 'invalid'})).status_code, 400)
            self.assertEqual((await client.post('/api/media/generate-audio', json={'text': ' '})).status_code, 400)
        self.run_asgi(exercise)

    def test_tts_wait_allows_other_requests_and_preserves_newer_edits(self):
        async def exercise(client):
            entered, release = asyncio.Event(), asyncio.Event()
            async def generate(*_args, **_kwargs):
                self.assert_released()
                entered.set()
                await release.wait()
                return 'https://fixture.invalid/generated.mp3'
            with patch('api.utils.audio.generate_audio', side_effect=generate):
                pending = asyncio.create_task(client.post('/api/media/generate-card-audio', json={'card_id': self.card.id}))
                try:
                    await asyncio.wait_for(entered.wait(), 3)
                    probe = await asyncio.wait_for(client.get('/api/media/backgrounds'), 2)
                    self.assertEqual(probe.status_code, 200)
                    await run_db(lambda: models.TMA_Card.update(front_text='Newer text',
                        audio_path='https://fixture.invalid/manual.mp3').where(models.TMA_Card.id == self.card.id).execute())
                finally:
                    release.set()
                    response = await pending
            self.assertEqual(response.status_code, 409, response.text)
            saved = await self.saved_card()
            self.assertEqual((saved['front_text'], saved['audio_path']), ('Newer text', 'https://fixture.invalid/manual.mp3'))
        self.run_asgi(exercise)

    def test_revocation_and_deletion_while_tts_waits_prevent_attachment(self):
        async def exercise(client):
            async def revoke(*_args, **_kwargs):
                self.assert_released()
                await run_db(lambda: models.TMA_Collaborator.delete().where(models.TMA_Collaborator.user_id == 2).execute())
                return 'https://fixture.invalid/revoked.mp3'
            with patch('api.utils.audio.generate_audio', side_effect=revoke):
                response = await client.post('/api/media/generate-card-audio',
                    headers={'X-Test-User': '2'}, json={'card_id': self.card.id})
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual((await self.saved_card())['audio_path'], 'https://fixture.invalid/old.mp3')
            async def delete(*_args, **_kwargs):
                await run_db(lambda: models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.card.id).execute())
                return 'https://fixture.invalid/deleted.mp3'
            with patch('api.utils.audio.generate_audio', side_effect=delete):
                response = await client.post('/api/media/generate-card-audio', json={'card_id': self.card.id})
            self.assertEqual(response.status_code, 403)
            self.assertEqual((await self.saved_card())['audio_path'], 'https://fixture.invalid/old.mp3')
        self.run_asgi(exercise)

    def test_slow_sql_does_not_block_the_event_loop(self):
        entered, release = threading.Event(), threading.Event()
        original = self.db.execute_sql
        def slow(sql, params=None):
            if 'SELECT' in sql and not entered.is_set():
                entered.set()
                if not release.wait(4):
                    raise AssertionError('SQL blocked the loop')
            return original(sql, params)
        async def exercise(client):
            with patch.object(self.db, 'execute_sql', side_effect=slow):
                pending = asyncio.create_task(client.get('/api/media/backgrounds'))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    response = await asyncio.wait_for(client.post('/api/media/upload-video',
                        files={'file': ('fixture.mp4', b'synthetic')}), 2)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertFalse(pending.done())
                finally:
                    release.set()
                    self.assertEqual((await pending).status_code, 200)
        self.run_asgi(exercise)

    def test_errors_do_not_retry_uploads_and_get_recovers_once(self):
        async def exercise(client):
            for kind in ('image', 'audio', 'video', 'background'):
                response = await client.post(f'/api/media/upload-{kind}', files={'file': ('empty', b'')})
                self.assertEqual(response.status_code, 400)
            self.assertEqual((await client.post('/api/media/upload-image', files={'file': ('bad.png', b'not an image')})).status_code, 400)
            with patch.object(models.TMAMedia, 'create', side_effect=OperationalError('connection reset')) as write:
                response = await client.post('/api/media/upload-video', files={'file': ('fixture.mp4', b'synthetic')})
                self.assertEqual(response.status_code, 500)
                self.assertEqual(write.call_count, 1)
            uploaded = await client.post('/api/media/upload-video', files={'file': ('fixture.mp4', b'synthetic')})
            original = models.TMAMedia.get_or_none
            calls = []
            def flaky(*args, **kwargs):
                calls.append(True)
                if len(calls) == 1:
                    raise OperationalError('connection reset')
                return original(*args, **kwargs)
            with patch.object(models.TMAMedia, 'get_or_none', side_effect=flaky):
                self.assertEqual((await client.get(uploaded.json()['url'])).content, b'synthetic')
                self.assertEqual(len(calls), 2)
            with patch.object(models.TMAMedia, 'get_or_none', side_effect=OperationalError('connection reset')) as read:
                self.assertEqual((await client.get('/api/media/images/unavailable.png')).status_code, 500)
                self.assertEqual(read.call_count, 2)
            self.app.dependency_overrides.clear()
            self.assertEqual((await client.post('/api/media/upload-video', files={'file': ('f', b'x')})).status_code, 401)
        self.run_asgi(exercise)

    def test_local_upload_read_and_failed_metadata_removes_file(self):
        def media_file(folder, filename):
            self.assertEqual(Path(filename).name, filename)
            path = self.root / folder / filename
            path.parent.mkdir(exist_ok=True)
            return path
        async def exercise(client):
            with patch.object(media, 'is_local', return_value=True), patch.object(media, 'media_file', side_effect=media_file):
                for kind in ('audio', 'video', 'background'):
                    response = await client.post(f'/api/media/upload-{kind}', files={'file': ('f', b'local synthetic')})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual((await client.get(response.json()['url'])).content, b'local synthetic')
                with patch.object(models.TMAMedia, 'create', side_effect=RuntimeError('metadata failed')):
                    before = set(self.root.rglob('*.mp3'))
                    response = await client.post('/api/media/upload-audio', files={'file': ('f', b'synthetic')})
                    self.assertEqual(response.status_code, 500)
                    self.assertEqual(set(self.root.rglob('*.mp3')), before)
                self.assertEqual((await client.get('/api/media/audio/missing.mp3')).status_code, 404)
        self.run_asgi(exercise)


if __name__ == '__main__':
    unittest.main()
