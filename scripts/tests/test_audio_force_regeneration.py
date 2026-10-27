import os
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from io import BytesIO

from api.utils.audio import generate_audio
from api.services.media import validate_new_audio_path
from api.routers.media import upload_audio_file

TEST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'local', 'test-data', 'audio-storage-regression')
os.makedirs(TEST_DIR, exist_ok=True)


class _FakeCommunicate:
    save_calls = 0

    def __init__(self, text, voice, rate):
        self.text = text
        self.voice = voice
        self.rate = rate

    async def save(self, path):
        type(self).save_calls += 1
        with open(path, "wb") as audio_file:
            audio_file.write(b"ID3" + bytes([type(self).save_calls]) * 128)


class AudioForceRegenerationTest(unittest.IsolatedAsyncioTestCase):
    async def test_force_bypasses_cached_tts_file(self):
        _FakeCommunicate.save_calls = 0
        phrase = 'Hallo ' + uuid4().hex
        with patch(
            "api.utils.audio.edge_tts.Communicate",
            _FakeCommunicate,
        ), patch('api.utils.audio._upload_to_supabase', new=AsyncMock(return_value='https://example.supabase.co/storage/v1/object/public/audio/fixture.mp3')) as upload, patch.dict(
            os.environ,
            {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "fixture"},
        ):
            first_path, _ = await generate_audio(phrase, output_dir=TEST_DIR)
            cached_path, _ = await generate_audio(phrase, output_dir=TEST_DIR)
            forced_path, _ = await generate_audio(phrase, output_dir=TEST_DIR, force=True)

            self.assertEqual(first_path, cached_path)
            self.assertEqual(first_path, forced_path)
            self.assertEqual(_FakeCommunicate.save_calls, 2)
            self.assertEqual(upload.await_count, 3)
            self.addCleanup(lambda: os.remove(upload.call_args.args[0]))
            with open(upload.call_args.args[0], "rb") as audio_file:
                self.assertEqual(audio_file.read(4), b"ID3\x02")

    async def test_storage_failure_never_returns_pending_file(self):
        with patch(
            'api.utils.audio.edge_tts.Communicate', _FakeCommunicate,
        ), patch('api.utils.audio._upload_to_supabase', new=AsyncMock(return_value=None)) as upload, patch.dict(
            os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_KEY': 'fixture', 'VERCEL': '1'},
        ):
            with self.assertRaisesRegex(RuntimeError, 'upload'):
                await generate_audio('Storage failure ' + uuid4().hex, output_dir=TEST_DIR)
            self.addCleanup(lambda: os.remove(upload.call_args.args[0]))

    async def test_upload_failure_has_no_success_path(self):
        with patch('api.routers.media.is_local', return_value=False), patch(
            'api.utils.audio._upload_to_supabase', new=AsyncMock(return_value=None),
        ), patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_KEY': 'fixture', 'VERCEL': '1'}):
            with self.assertRaises(HTTPException) as failure:
                await upload_audio_file(UploadFile(file=BytesIO(b'ID3' + b'x' * 128), filename='test.mp3'), user_id=1)
        self.assertEqual(failure.exception.status_code, 503)


class AudioReferenceTest(unittest.TestCase):
    def test_new_link_fails_closed_without_cloud_configuration(self):
        link = 'https://example.supabase.co/storage/v1/object/public/audio/new.mp3'
        with patch('api.services.media.is_local', return_value=False), patch.dict(
            os.environ, {'SUPABASE_URL': ''}, clear=False,
        ):
            with self.assertRaises(HTTPException) as failure:
                validate_new_audio_path(link)
        self.assertEqual(failure.exception.status_code, 503)

    def test_new_link_requires_storage_record_but_unchanged_link_is_preserved(self):
        link = 'https://example.supabase.co/storage/v1/object/public/audio/new.mp3'
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'VERCEL': '1'}), patch(
            'api.services.media.tma_db',
        ) as database:
            query = database.execute_sql
            query.return_value.fetchone.return_value = None
            with self.assertRaises(HTTPException) as missing:
                validate_new_audio_path(link, 'https://example.supabase.co/storage/v1/object/public/audio/old.mp3')
            self.assertEqual(missing.exception.status_code, 422)
            validate_new_audio_path(link, link)
            self.assertEqual(query.call_count, 1)
            query.return_value.fetchone.return_value = (1,)
            validate_new_audio_path(link)


if __name__ == "__main__":
    unittest.main()
