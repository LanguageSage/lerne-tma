"""Authenticated media router on disposable SQLite/files, synthetic Storage only."""
import hashlib
import os
from pathlib import Path
import shutil
from uuid import uuid4
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from peewee import SqliteDatabase
from api import models
from api.dependencies.auth import get_user_id
from api.routers import media
from api.utils.audio import MAX_AUDIO_BYTES, validate_audio_upload
from scripts.tests.audio_fixture import wav_bytes, mp3_bytes


class AudioUploadTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data'
        scratch.mkdir(parents=True, exist_ok=True)
        self.root = scratch / ('audio-upload-' + uuid4().hex)
        self.root.mkdir()
        def cleanup():
            assert self.root.resolve().parent == scratch.resolve() and self.root.name.startswith('audio-upload-')
            shutil.rmtree(self.root)
        self.addCleanup(cleanup)
        self.db = SqliteDatabase(self.root / 'test.sqlite')
        previous = models.tma_db.obj
        models.tma_db.initialize(self.db)
        self.addCleanup(models.tma_db.initialize, previous)
        with self.db.connection_context():
            self.db.create_tables([models.TMAMedia])
        self.app = FastAPI()
        self.app.include_router(media.router, prefix='/api')
        self.app.dependency_overrides[get_user_id] = lambda: 1
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        def path(folder, name):
            result = self.root / folder / name
            result.parent.mkdir(exist_ok=True)
            return result
        for mock in (patch.object(media, 'media_file', side_effect=path), patch.object(media, 'is_local', return_value=True)):
            mock.start(); self.addCleanup(mock.stop)

    def post(self, data, sha=None):
        return self.client.post('/api/media/upload-audio', files={'file': ('untrusted.html', data, 'text/html')},
                                data={'sha256': sha} if sha is not None else {})

    def test_both_formats_are_detected_from_bytes_and_retries_are_immutable(self):
        for content, suffix, mime in ((wav_bytes(), '.wav', 'audio/wav'), (mp3_bytes(), '.mp3', 'audio/mpeg')):
            sha = hashlib.sha256(content).hexdigest()
            first = self.post(content, sha)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(first.json()['sha256'], sha)
            self.assertEqual(first.json()['size'], len(content))
            self.assertEqual(first.json()['media_type'], mime)
            self.assertEqual(first.json()['path'], f'audio/audio_{sha}{suffix}')
            self.assertEqual(self.post(content, sha).json(), first.json())
            self.assertEqual(self.client.get(first.json()['url']).content, content)
        with self.db.connection_context():
            self.assertEqual(models.TMAMedia.select().count(), 2)
        self.assertFalse(list(self.root.rglob('*.partial')))

    def test_malformed_empty_oversized_and_digest_mismatch_never_publish(self):
        valid = wav_bytes()
        for value, status in ((b'', 400), (b'x' * (MAX_AUDIO_BYTES + 1), 413), (b'ID3'+b'x'*1000, 422),
                              (valid[:-1], 422), (b'RIFF'+b'x'*400, 422), (b'OggS'+b'x'*400, 422),
                              (mp3_bytes()[:-1], 422), (b'<html>bad</html>', 422)):
            response = self.post(value)
            self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(self.post(valid, '0'*64).status_code, 422)
        self.assertFalse(list(self.root.rglob('audio_*')))

    def test_conflicting_existing_bytes_are_preserved(self):
        content = wav_bytes()
        first = self.post(content).json()
        destination = self.root / first['path']
        destination.write_bytes(b'conflict')
        self.assertEqual(self.post(content).status_code, 409)
        self.assertEqual(destination.read_bytes(), b'conflict')

    def test_concurrent_duplicate_uploads_publish_one_object_and_catalog_row(self):
        from concurrent.futures import ThreadPoolExecutor
        content = wav_bytes(2)
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.post(content), range(4)))
        self.assertEqual([r.status_code for r in responses], [200]*4)
        self.assertEqual(len({r.json()['path'] for r in responses}), 1)
        with self.db.connection_context():
            self.assertEqual(models.TMAMedia.select().count(), 1)
        self.assertFalse(list(self.root.rglob('*.partial')))

    def test_cloud_failure_and_retry_confirm_hash_without_local_fallback(self):
        content = wav_bytes()
        with patch.object(media, 'is_local', return_value=False), patch.dict(os.environ, {'SUPABASE_URL': 'https://fixture.invalid', 'SUPABASE_KEY': 'synthetic'}), \
                patch('api.utils.audio._upload_to_supabase', new=AsyncMock(return_value=None)) as upload:
            self.assertEqual(self.post(content).status_code, 503)
            upload.return_value = 'https://fixture.invalid/storage/v1/object/public/audio/confirmed.wav'
            result = self.post(content)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['sha256'], hashlib.sha256(content).hexdigest())
            self.assertEqual(upload.await_args.kwargs['media_type'], 'audio/wav')
        self.assertFalse(list(self.root.rglob('audio_*')))

    def test_mp3_id3_tag_without_frames_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_audio_upload(b'ID3\x04\0\0\0\0\x01\0' + bytes(128))

    def test_local_catalog_failure_can_retry_without_deleting_published_audio(self):
        with patch.object(models.TMAMedia, 'insert', side_effect=RuntimeError('catalog unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'catalog unavailable'):
                self.post(wav_bytes())
        result = self.post(wav_bytes())
        self.assertEqual(result.status_code, 200, result.text)
        self.assertFalse(list(self.root.rglob('*.partial')))
