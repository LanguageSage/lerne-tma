"""Stage 3B.4: Media service redesign and safe card audio attachment.

Tests isolated on in-memory SQLite:
- Elimination of stale whole-row save in ensure_card_audio and generate-card-audio.
- Pre/post verification of legacy version (blocking V2 and unknown versions).
- Protection of user-attached audio (aud_* and valid audio).
- Concurrent text modification, user audio attachment, V2 conversion, deletion, and role revocation during TTS.
- Preservation of concurrent field edits without stale whole-row overwrite.
- Admin TTS protection of user audio.
"""
import asyncio
import importlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from scripts.tests import test_structured_cards_v2_guards as fixtures

models, database = fixtures.models, fixtures.database
import api.services.media as media_service
import api.routers.media as media_router
import tools.admin.routers.cards as admin_cards
import api.utils.audio as audio_utils


class MediaGuardTests(unittest.TestCase):
    make_native = fixtures.StructuredWriteGuardTests.make_native
    blocked = fixtures.StructuredWriteGuardTests.blocked

    def setUp(self):
        fixtures.StructuredWriteGuardTests.setUp(self)
        self.app = FastAPI()
        self.app.include_router(media_router.router, prefix="/api")
        self.app.include_router(admin_cards.router)
        self.media_client = TestClient(self.app)

        self.tts_calls = []

        async def mock_generate_audio(text, voice=None, rate="+0%", with_boundaries=False, force=False):
            self.assertFalse(database.in_transaction(), "TTS must not be called inside transaction")
            self.tts_calls.append(dict(text=text, voice=voice, rate=rate))
            if with_boundaries:
                return "https://example.invalid/tts_audio.mp3", []
            return "https://example.invalid/tts_audio.mp3"

        self.tts_patch = patch.object(audio_utils, "generate_audio", side_effect=mock_generate_audio)
        self.tts_patch.start()
        self.addCleanup(self.tts_patch.stop)

    def tearDown(self):
        self.media_client.close()
        fixtures.StructuredWriteGuardTests.tearDown(self)

    def snapshot(self):
        return {model._meta.table_name: database.execute_sql(
            f'SELECT * FROM "{model._meta.table_name}" ORDER BY 1').fetchall()
            for model in fixtures.TABLES}

    def no_dml_blocked(self, operation):
        statements = []
        database.connection().set_trace_callback(statements.append)
        try:
            self.blocked(operation)
        finally:
            database.connection().set_trace_callback(None)
        self.assertFalse([s for s in statements if re.match(r'\s*(INSERT|UPDATE|DELETE)\b', s, re.I)])

    def test_ensure_card_audio_legacy_happy_path(self):
        self.assertIsNone(self.legacy.audio_path)
        asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))
        updated = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(updated.audio_path, "https://example.invalid/tts_audio.mp3")
        self.assertEqual(self.legacy.audio_path, "https://example.invalid/tts_audio.mp3")
        self.assertEqual(len(self.tts_calls), 1)

    def test_ensure_card_audio_v2_and_unknown_skipped_without_dml_or_tts(self):
        for version in (2, 99):
            self.make_native(self.native.id, version)
            before = self.snapshot()
            asyncio.run(media_service.ensure_card_audio(self.native, user_id=1))
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(len(self.tts_calls), 0)

    def test_ensure_card_audio_preserves_existing_user_audio_without_tts(self):
        models.TMA_Card.update(audio_path="aud_1_recorded.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
        self.legacy = models.TMA_Card.get_by_id(self.legacy.id)
        before = self.snapshot()

        asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(self.tts_calls), 0)

    def test_ensure_card_audio_preserves_existing_http_audio_without_tts(self):
        models.TMA_Card.update(audio_path="https://storage.example.com/audio.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
        self.legacy = models.TMA_Card.get_by_id(self.legacy.id)
        before = self.snapshot()

        asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(self.tts_calls), 0)

    def test_ensure_card_audio_concurrent_front_text_change_aborts_attachment(self):
        async def tts_with_text_mutation(*args, **kwargs):
            models.TMA_Card.update(front_text="New text changed concurrently").where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/tts_stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_text_mutation):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(current.front_text, "New text changed concurrently")
        self.assertIsNone(current.audio_path, "Stale audio must not be attached when text changed")

    def test_ensure_card_audio_concurrent_user_audio_attached_aborts_overwrite(self):
        async def tts_with_user_audio_mutation(*args, **kwargs):
            models.TMA_Card.update(audio_path="aud_1_concurrent_upload.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/tts_stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_user_audio_mutation):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(current.audio_path, "aud_1_concurrent_upload.mp3")

    def test_ensure_card_audio_concurrent_v2_conversion_aborts_without_dml(self):
        after_v2 = []

        async def tts_with_v2_conversion(*args, **kwargs):
            self.make_native(self.legacy.id, version=2)
            after_v2.append(self.snapshot())
            return "https://example.invalid/tts_stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_v2_conversion):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        self.assertEqual(self.snapshot(), after_v2[0])

    def test_ensure_card_audio_concurrent_field_update_preserved_no_whole_row_save(self):
        async def tts_with_field_edits(*args, **kwargs):
            models.TMA_Card.update(
                back_text="Concurrent answer",
                metadata='{"custom": 999}',
                tags="topic,A2"
            ).where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/tts_audio.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_field_edits):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(current.audio_path, "https://example.invalid/tts_audio.mp3")
        self.assertEqual(current.back_text, "Concurrent answer")
        self.assertEqual(current.metadata, '{"custom": 999}')
        self.assertEqual(current.tags, "topic,A2")

    def test_ensure_card_audio_concurrent_deletion_aborts(self):
        async def tts_with_deletion(*args, **kwargs):
            models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/tts_audio.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_deletion):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertTrue(current.is_deleted)
        self.assertIsNone(current.audio_path)

    def test_ensure_card_audio_permission_revoked_aborts(self):
        async def tts_with_permission_revocation(*args, **kwargs):
            models.TMA_Deck.update(user_id=999, folder=None).where(models.TMA_Deck.id == self.deck.id).execute()
            return "https://example.invalid/tts_audio.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_permission_revocation):
            asyncio.run(media_service.ensure_card_audio(self.legacy, user_id=1))

        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertIsNone(current.audio_path)

    def test_generate_card_audio_endpoint_legacy_happy_path(self):
        for side, field in (('front', 'audio_path'), ('back', 'audio_back_path')):
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.legacy.id,
                "side": side
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['path'], "https://example.invalid/tts_audio.mp3")
            current = models.TMA_Card.get_by_id(self.legacy.id)
            self.assertEqual(getattr(current, field), "https://example.invalid/tts_audio.mp3")

    def test_generate_card_audio_endpoint_v2_unknown_returns_409(self):
        for version in (2, 99):
            self.make_native(self.native.id, version)
            before = self.snapshot()
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.native.id,
                "side": "front"
            })
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
            self.assertEqual(self.snapshot(), before)
            self.assertEqual(len(self.tts_calls), 0)

    def test_generate_card_audio_endpoint_cannot_overwrite_user_audio(self):
        models.TMA_Card.update(audio_path="aud_1_custom.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
        before = self.snapshot()
        response = self.media_client.post("/api/media/generate-card-audio", json={
            "card_id": self.legacy.id,
            "side": "front"
        })
        self.assertEqual(response.status_code, 409)
        self.assertIn("user-attached audio", response.json()['detail'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(self.tts_calls), 0)

    def test_generate_card_audio_endpoint_concurrent_text_change_returns_409(self):
        async def tts_with_text_edit(*args, **kwargs):
            models.TMA_Card.update(front_text="Changed during TTS").where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_text_edit):
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.legacy.id,
                "side": "front"
            })
        self.assertEqual(response.status_code, 409)
        self.assertIn("text was modified", response.json()['detail'])
        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertIsNone(current.audio_path)

    def test_generate_card_audio_endpoint_concurrent_audio_change_returns_409(self):
        async def tts_with_audio_change(*args, **kwargs):
            models.TMA_Card.update(audio_path="concurrent_other.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_audio_change):
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.legacy.id,
                "side": "front"
            })
        self.assertEqual(response.status_code, 409)
        self.assertIn("audio was modified concurrently", response.json()['detail'])
        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(current.audio_path, "concurrent_other.mp3")

    def test_generate_card_audio_endpoint_concurrent_v2_conversion_returns_409(self):
        after_v2 = []

        async def tts_with_v2(*args, **kwargs):
            self.make_native(self.legacy.id, version=2)
            after_v2.append(self.snapshot())
            return "https://example.invalid/stale.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_v2):
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.legacy.id,
                "side": "front"
            })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), after_v2[0])

    def test_generate_card_audio_preserves_concurrent_field_updates_no_whole_row(self):
        async def tts_with_concurrent_edits(*args, **kwargs):
            models.TMA_Card.update(
                back_text="Preserved back text",
                metadata='{"note": 42}'
            ).where(models.TMA_Card.id == self.legacy.id).execute()
            return "https://example.invalid/tts_audio.mp3"

        with patch.object(audio_utils, "generate_audio", side_effect=tts_with_concurrent_edits):
            response = self.media_client.post("/api/media/generate-card-audio", json={
                "card_id": self.legacy.id,
                "side": "front"
            })
        self.assertEqual(response.status_code, 200)
        current = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual(current.audio_path, "https://example.invalid/tts_audio.mp3")
        self.assertEqual(current.back_text, "Preserved back text")
        self.assertEqual(current.metadata, '{"note": 42}')

    def test_admin_synthesize_audio_cannot_overwrite_user_audio(self):
        models.TMA_Card.update(audio_path="aud_1_rec.mp3").where(models.TMA_Card.id == self.legacy.id).execute()
        before = self.snapshot()
        response = self.media_client.post(f"/api/admin/cards/{self.legacy.id}/synthesize-audio")
        self.assertEqual(response.status_code, 409)
        self.assertIn("user-attached audio", response.json()['detail'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(self.tts_calls), 0)


if __name__ == "__main__":
    unittest.main()
