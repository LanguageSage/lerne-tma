#!/usr/bin/env python3
"""
Unit and integration tests for tools.admin.routers.author (Author Content Router).
Runs against an isolated in-memory SQLite database using shared cache.
"""

import os
import sys
import unittest
from pathlib import Path
from peewee import SqliteDatabase
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import models
from tools.admin.server import app, db_session_scope

# Set up isolated in-memory SQLite database with shared cache across threads
test_db = SqliteDatabase('file:test_author_shared?mode=memory&cache=shared', uri=True)
models.tma_db.initialize(test_db)
models.lerne_db.initialize(test_db)

TABLES = [
    models.TMA_Folder,
    models.TMA_Deck,
    models.TMA_Card,
    models.TMAProgress,
    models.TMAUser,
    models.TMA_Collaborator,
    models.TMAOfflineBatch,
    models.TMAReviewHistory
]


class TestAuthorRouter(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Keep an active connection so the shared in-memory database persists
        test_db.connect()
        app.dependency_overrides[db_session_scope] = lambda: None
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        if not test_db.is_closed():
            test_db.close()

    def setUp(self):
        test_db.create_tables(TABLES)
        self.user = models.TMAUser.create(user_id=42, is_guest=False)
        self.folder = models.TMA_Folder.create(user_id=42, name="Test Folder")
        self.deck = models.TMA_Deck.create(user_id=42, folder=self.folder, name="Test Deck")
        self.card = models.TMA_Card.create(
            deck=self.deck,
            front_text="Front 1",
            back_text="Back 1",
            position=1
        )

    def tearDown(self):
        test_db.drop_tables(TABLES)

    # ------------------------------------------------------------------------
    # 1. PARSE: text and file uploads
    # ------------------------------------------------------------------------

    def test_parse_valid_text(self):
        text = (
            "# Deck: Farben\n\n"
            "FRONT:\n::exercise\n{rot/*blau}\n\n"
            "BACK:\nкрасный\n\n"
            "CONTEXT:\n::level A1\n::topic Farben\n"
        )
        resp = self.client.post("/api/admin/author/parse", json={"text": text})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_cards"], 1)
        self.assertEqual(data["decks_count"], 1)
        self.assertEqual(data["decks"][0]["deck_name"], "Farben")
        self.assertEqual(data["levels"], ["A1"])
        self.assertEqual(len(data["cards"]), 1)

    def test_parse_valid_file_upload(self):
        content = (
            "# Deck: Tiere\n\n"
            "FRONT:\nder Hund\n\n"
            "BACK:\nсобака\n"
        ).encode("utf-8")

        files = {"file": ("tiere.txt", content, "text/plain")}
        resp = self.client.post("/api/admin/author/parse", files=files)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_cards"], 1)
        self.assertEqual(data["decks"][0]["deck_name"], "Tiere")

    def test_parse_empty_and_no_cards_error(self):
        # Empty text
        resp = self.client.post("/api/admin/author/parse", json={"text": "   "})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("пуст", resp.json()["detail"])

        # No cards found
        resp2 = self.client.post("/api/admin/author/parse", json={"text": "Just some random notes without front and back"})
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("не найдено ни одной карточки", resp2.json()["detail"])

    # ------------------------------------------------------------------------
    # 2. FILE VALIDATIONS: extension, size, utf-8
    # ------------------------------------------------------------------------

    def test_invalid_file_extension(self):
        files = {"file": ("image.png", b"fake binary data", "image/png")}
        resp = self.client.post("/api/admin/author/parse", files=files)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Недопустимый формат файла", resp.json()["detail"])

    def test_invalid_file_oversized(self):
        # 10 MB + 1 byte
        oversized = b"X" * (10 * 1024 * 1024 + 1)
        files = {"file": ("big.txt", oversized, "text/plain")}
        resp = self.client.post("/api/admin/author/parse", files=files)
        self.assertEqual(resp.status_code, 413)
        self.assertIn("превышает допустимый предел", resp.json()["detail"])

    def test_invalid_file_bad_utf8(self):
        # Invalid UTF-8 sequence
        bad_bytes = b"\xff\xfe\x80\x81\x00\x00"
        files = {"file": ("bad_encoding.txt", bad_bytes, "text/plain")}
        resp = self.client.post("/api/admin/author/parse", files=files)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("UTF-8", resp.json()["detail"])

    # ------------------------------------------------------------------------
    # 3. PUBLISH-PREVIEW
    # ------------------------------------------------------------------------

    def test_publish_preview_success(self):
        text = "# Deck: NewDeck\n\nFRONT:\nF1\n\nBACK:\nB1\n"
        resp = self.client.post("/api/admin/author/publish-preview", json={
            "text": text,
            "target_folder_id": self.folder.id
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["target_folder_id"], self.folder.id)
        self.assertEqual(data["target_folder_name"], self.folder.name)
        self.assertEqual(data["total_cards"], 1)

    def test_publish_preview_nonexistent_folder(self):
        text = "# Deck: NewDeck\n\nFRONT:\nF1\n\nBACK:\nB1\n"
        resp = self.client.post("/api/admin/author/publish-preview", json={
            "text": text,
            "target_folder_id": 999999
        })
        self.assertEqual(resp.status_code, 404)
        self.assertIn("не найдена", resp.json()["detail"])

    # ------------------------------------------------------------------------
    # 4. PUBLISH: apply publish
    # ------------------------------------------------------------------------

    def test_publish_apply_success(self):
        text = "# Deck: PublishedDeck\n\nFRONT:\nPublishedFront\n\nBACK:\nPublishedBack\n"
        resp = self.client.post("/api/admin/author/publish", json={
            "text": text,
            "new_folder_name": "Created Via API",
            "user_id": 42
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["folder_name"], "Created Via API")
        self.assertEqual(data["total_saved_cards"], 1)
        published_names = [d["deck_name"] for d in data["published_decks"]]
        self.assertIn("PublishedDeck", published_names)

        # Check DB
        card = models.TMA_Card.get_or_none(models.TMA_Card.front_text == "PublishedFront")
        self.assertIsNotNone(card)
        self.assertEqual(card.back_text, "PublishedBack")

    # ------------------------------------------------------------------------
    # 5. EXPORT: deck and folder
    # ------------------------------------------------------------------------

    def test_export_deck_as_file_and_json(self):
        # As file attachment
        resp = self.client.get(f"/api/admin/author/export?deck_id={self.deck.id}&as_file=true")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment; filename=", resp.headers.get("Content-Disposition", ""))
        self.assertIn("FRONT:\nFront 1", resp.text)
        self.assertIn("BACK:\nBack 1", resp.text)

        # As JSON
        resp_json = self.client.get(f"/api/admin/author/export?deck_id={self.deck.id}&as_file=false")
        self.assertEqual(resp_json.status_code, 200)
        data = resp_json.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["deck_id"], self.deck.id)
        self.assertIn("FRONT:\nFront 1", data["text"])

    def test_export_folder(self):
        resp = self.client.get(f"/api/admin/author/export?folder_id={self.folder.id}&as_file=true")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(f"# Folder: {self.folder.name}", resp.text)
        self.assertIn(f"# Deck: {self.deck.name}", resp.text)

    # ------------------------------------------------------------------------
    # 6. EXPORT / PUBLISH / UPDATE: invalid IDs
    # ------------------------------------------------------------------------

    def test_export_invalid_parameters(self):
        # Both deck_id and folder_id
        resp = self.client.get(f"/api/admin/author/export?deck_id={self.deck.id}&folder_id={self.folder.id}")
        self.assertEqual(resp.status_code, 400)

        # Neither
        resp = self.client.get("/api/admin/author/export")
        self.assertEqual(resp.status_code, 400)

        # Negative deck_id
        resp = self.client.get("/api/admin/author/export?deck_id=-5")
        self.assertEqual(resp.status_code, 400)

        # Negative folder_id
        resp = self.client.get("/api/admin/author/export?folder_id=-5")
        self.assertEqual(resp.status_code, 400)

        # Non-existent deck_id
        resp = self.client.get("/api/admin/author/export?deck_id=999999")
        self.assertEqual(resp.status_code, 404)

        # Non-existent folder_id
        resp = self.client.get("/api/admin/author/export?folder_id=999999")
        self.assertEqual(resp.status_code, 404)

    def test_invalid_ids_in_publish_and_update(self):
        text = "# Deck: D\nFRONT:\nF\nBACK:\nB\n"

        # Negative target_folder_id in publish-preview
        resp = self.client.post("/api/admin/author/publish-preview", json={"text": text, "target_folder_id": -1})
        self.assertEqual(resp.status_code, 400)

        # Negative target_folder_id in publish
        resp = self.client.post("/api/admin/author/publish", json={"text": text, "target_folder_id": -1, "user_id": 42})
        self.assertEqual(resp.status_code, 400)

        # Negative deck_id in update-preview
        resp = self.client.post("/api/admin/author/update-preview", json={"text": text, "deck_id": -1, "user_id": 42})
        self.assertEqual(resp.status_code, 400)

        # Non-existent deck_id in update-preview
        resp = self.client.post("/api/admin/author/update-preview", json={"text": text, "deck_id": 999999, "user_id": 42})
        self.assertEqual(resp.status_code, 404)

    # ------------------------------------------------------------------------
    # 7. UPDATE-PREVIEW and UPDATE-APPLY
    # ------------------------------------------------------------------------

    def test_update_preview_and_apply_flow(self):
        # 1. Update text for existing card
        update_text = (
            f"# Deck: {self.deck.name}\n\n"
            f"::deck_id {self.deck.id}\n"
            f"::card_id {self.card.id}\n\n"
            f"FRONT:\nFront 1\n\n"
            f"BACK:\nUpdated Back Content\n"
        )

        # Preview update
        prev_resp = self.client.post("/api/admin/author/update-preview", json={
            "text": update_text,
            "deck_id": self.deck.id,
            "user_id": 42
        })
        self.assertEqual(prev_resp.status_code, 200)
        prev_data = prev_resp.json()
        self.assertEqual(prev_data["status"], "success")
        self.assertEqual(prev_data["updated"], 1)
        self.assertEqual(prev_data["unchanged"], 0)
        preview_token = prev_data["preview_token"]
        self.assertTrue(bool(preview_token))

        # Apply update
        apply_resp = self.client.post("/api/admin/author/update-apply", json={
            "text": update_text,
            "preview_token": preview_token,
            "deck_id": self.deck.id,
            "user_id": 42
        })
        self.assertEqual(apply_resp.status_code, 200)
        apply_data = apply_resp.json()
        self.assertEqual(apply_data["status"], "success")
        self.assertEqual(apply_data["updated"], 1)

        # Verify DB card has been updated
        refreshed_card = models.TMA_Card.get_by_id(self.card.id)
        self.assertEqual(refreshed_card.back_text, "Updated Back Content")

    # ------------------------------------------------------------------------
    # 8. MISSING AUTHOR: returns 400 Bad Request
    # ------------------------------------------------------------------------

    def test_missing_author_returns_400(self):
        # Clear env variables that might identify author
        old_auth = os.environ.pop('AUTHOR_USER_ID', None)
        old_admin = os.environ.pop('ADMIN_USER_ID', None)
        try:
            # Publish with new folder and no user_id
            text = "# Deck: NoAuthorDeck\nFRONT:\nF\nBACK:\nB\n"
            resp = self.client.post("/api/admin/author/publish", json={
                "text": text,
                "new_folder_name": "No Author Folder"
            })
            self.assertEqual(resp.status_code, 400)
            self.assertIn("Не удалось определить автора", resp.json()["detail"])
        finally:
            if old_auth is not None:
                os.environ['AUTHOR_USER_ID'] = old_auth
            if old_admin is not None:
                os.environ['ADMIN_USER_ID'] = old_admin


if __name__ == "__main__":
    unittest.main()
