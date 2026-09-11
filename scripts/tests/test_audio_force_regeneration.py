import os
import tempfile
import unittest
from unittest.mock import patch

from api.utils.audio import generate_audio


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
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as output_dir, patch(
            "api.utils.audio.edge_tts.Communicate",
            _FakeCommunicate,
        ), patch.dict(
            os.environ,
            {"SUPABASE_URL": "", "SUPABASE_KEY": ""},
        ):
            first_path, _ = await generate_audio("Hallo", output_dir=output_dir)
            cached_path, _ = await generate_audio("Hallo", output_dir=output_dir)
            forced_path, _ = await generate_audio("Hallo", output_dir=output_dir, force=True)

            self.assertEqual(first_path, cached_path)
            self.assertEqual(first_path, forced_path)
            self.assertEqual(_FakeCommunicate.save_calls, 2)
            with open(forced_path, "rb") as audio_file:
                self.assertEqual(audio_file.read(4), b"ID3\x02")


if __name__ == "__main__":
    unittest.main()
