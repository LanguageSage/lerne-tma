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
        self.app = FastAPI()
        self.app.include_router(media.router, prefix='/api')
        self.app.dependency_overrides[get_user_id] = lambda: 1
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
    def post(self, data, sha=None):
        return self.client.post('/api/media/upload-audio', files={'file': ('untrusted.html', data, 'text/html')},
                                data={'sha256': sha} if sha is not None else {})

    def test_both_formats_are_detected_from_bytes_and_use_the_same_key_on_retry(self):
        async def upload(content, filename, *_args, **_kwargs):
            return 'https://fixture.invalid/storage/v1/object/public/audio/' + filename

        with patch.dict(os.environ, SUPABASE_URL='https://fixture.invalid', SUPABASE_KEY='synthetic'), \
                patch('api.utils.audio._upload_to_supabase', side_effect=upload) as storage:
            for content, suffix, mime in ((wav_bytes(), '.wav', 'audio/wav'), (mp3_bytes(), '.mp3', 'audio/mpeg')):
                sha = hashlib.sha256(content).hexdigest()
                first = self.post(content, sha)
                self.assertEqual(first.status_code, 200, first.text)
                self.assertEqual(first.json()['sha256'], sha)
                self.assertEqual(first.json()['size'], len(content))
                self.assertEqual(first.json()['media_type'], mime)
                self.assertTrue(first.json()['path'].endswith(f'/audio/audio_{sha}{suffix}'))
                self.assertEqual(self.post(content, sha).json(), first.json())
                self.assertEqual(storage.await_args.args[:2], (content, f'audio_{sha}{suffix}'))
                self.assertEqual(storage.await_args.kwargs['media_type'], mime)

    def test_malformed_empty_oversized_and_digest_mismatch_never_publish(self):
        valid = wav_bytes()
        for value, status in ((b'', 400), (b'x' * (MAX_AUDIO_BYTES + 1), 413), (b'ID3'+b'x'*1000, 422),
                              (valid[:-1], 422), (b'RIFF'+b'x'*400, 422), (b'OggS'+b'x'*400, 422),
                              (mp3_bytes()[:-1], 422), (b'<html>bad</html>', 422)):
            response = self.post(value)
            self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(self.post(valid, '0'*64).status_code, 422)
        self.assertFalse(list(self.root.rglob('audio_*')))

    def test_cloud_failure_and_retry_confirm_hash_without_local_fallback(self):
        content = wav_bytes()
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://fixture.invalid', 'SUPABASE_KEY': 'synthetic'}), \
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
