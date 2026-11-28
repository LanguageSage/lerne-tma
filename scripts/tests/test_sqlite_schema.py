"""Tests for canonical SQLite schema, migration safety, media contract, and Python<->Node parity."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from threading import Event
from time import sleep
import unittest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "sqlite_schema") not in sys.path:
    sys.path.insert(0, str(ROOT / "sqlite_schema"))

from lerne_sqlite_schema import (  # noqa: E402
    MigrationError,
    canonical_media_rel_path,
    compute_tts_cache_key,
    extract_card_media_refs,
    extract_deck_media_refs,
    load_manifest,
    migrate,
    migration_status,
    normalize_media_rel_path,
    open_sqlite,
    verify_integrity,
)


class SqliteSchemaTests(unittest.TestCase):
    def test_open_sqlite_waits_for_reader_during_initial_wal_transition(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wal.sqlite3"
            with closing(sqlite3.connect(path, isolation_level=None)) as reader:
                reader.execute("CREATE TABLE sample (value INTEGER)")
                reader.execute("BEGIN")
                reader.execute("SELECT * FROM sample").fetchall()
                started = Event()

                def open_in_wal():
                    started.set()
                    with closing(open_sqlite(path)) as connection:
                        return connection.execute("PRAGMA journal_mode").fetchone()[0]

                with ThreadPoolExecutor(max_workers=1) as pool:
                    result = pool.submit(open_in_wal)
                    try:
                        self.assertTrue(started.wait(2))
                        # Keep the reader's shared lock across the first attempt.
                        self.assertFalse(result.done())
                        sleep(0.1)
                    finally:
                        reader.rollback()
                    self.assertEqual(result.result(timeout=6), "wal")

    def test_generated_js_and_manifest_match_canonical_sql(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts/generate_sqlite_schema.py"), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        manifest = load_manifest()
        self.assertGreaterEqual(manifest["schema_version"], 1)

    def test_migrate_idempotent_and_sample_dataset_crud(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "lerne_test.sqlite3"
            conn = open_sqlite(db_path)
            try:
                first = migrate(conn)
                self.assertEqual(first["applied_now"], [1])
                second = migrate(conn)
                self.assertEqual(second["applied_now"], [])
                status = migration_status(conn)
                self.assertEqual(status["current_version"], 1)
                self.assertEqual(status["user_version"], 1)
                self.assertEqual(status["pending_versions"], [])

                now = "2026-11-27T21:00:00Z"
                sha_img = "a" * 64
                sha_aud = "b" * 64
                img_rel = canonical_media_rel_path("images", sha_img, ".webp")
                aud_rel = canonical_media_rel_path("audio", sha_aud, ".mp3")
                self.assertEqual(img_rel, f"images/archive_{sha_img}.webp")
                self.assertEqual(aud_rel, f"audio/archive_{sha_aud}.mp3")

                conn.execute("BEGIN IMMEDIATE")
                conn.execute(
                    "INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)",
                    ("designV2", json.dumps({"schemaVersion": 2, "enabled": True}), now),
                )
                conn.execute(
                    "INSERT INTO library_categories (name, created_at) VALUES (?, ?)",
                    ("A2 Grammatik", now),
                )
                cat_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    "INSERT INTO folders (name, target_language, origin_key, created_at) VALUES (?, ?, ?, ?)",
                    ("Alltag", "de", "archive:LOCAL:test:folder:1", now),
                )
                folder_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                deck_meta = json.dumps({"resources": [{"type": "image", "path": img_rel}]})
                conn.execute(
                    """INSERT INTO decks (folder_id, scope, category_id, name, target_language,
                       metadata_json, origin_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (folder_id, "personal", cat_id, "Lektion 1", "de", deck_meta, "archive:LOCAL:test:deck:1", now),
                )
                deck_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                envelope = {
                    "schema_version": 2,
                    "card": {
                        "type": "standard",
                        "image": img_rel,
                        "data": {"question": "der Tisch", "answer": "стол"},
                        "layout": [{"id": "img-1", "type": "image", "path": img_rel, "visibility": "before_answer"}],
                    },
                }
                conn.execute(
                    """INSERT INTO cards (deck_id, content_v2_json, front_preview, back_preview,
                       image_path, audio_path, origin_key, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (deck_id, json.dumps(envelope), "der Tisch", "стол", img_rel, aud_rel, "archive:LOCAL:test:card:1", now),
                )
                card_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    "INSERT INTO media_assets (sha256, folder, rel_path, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (sha_img, "images", img_rel, "image/webp", 2048, now),
                )
                conn.execute(
                    "INSERT INTO media_assets (sha256, folder, rel_path, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (sha_aud, "audio", aud_rel, "audio/mpeg", 4096, now),
                )
                card_refs = extract_card_media_refs({"image_path": img_rel, "audio_path": aud_rel}, envelope)
                for slot, ref in card_refs:
                    sha = sha_img if ref.folder == "images" else sha_aud
                    conn.execute(
                        "INSERT INTO media_links (owner_type, owner_id, slot, media_sha256) VALUES (?, ?, ?, ?)",
                        ("card", str(card_id), slot, sha),
                    )
                for slot, ref in extract_deck_media_refs(deck_meta):
                    conn.execute(
                        "INSERT INTO media_links (owner_type, owner_id, slot, media_sha256) VALUES (?, ?, ?, ?)",
                        ("deck", str(deck_id), slot, sha_img),
                    )
                cache_key = compute_tts_cache_key(
                    text_norm="der Tisch",
                    lang="de",
                    provider="edge",
                    voice="de-DE-KatjaNeural",
                    rate="+0%",
                )
                conn.execute(
                    """INSERT INTO tts_cache (cache_key, media_sha256, provider, model, voice, lang, rate,
                       options_json, text_norm, created_at, last_used_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (cache_key, sha_aud, "edge", "", "de-DE-KatjaNeural", "de", "+0%", "{}", "der Tisch", now, now),
                )
                conn.execute(
                    "INSERT INTO card_progress (card_id, queue, interval, ease_factor, repetitions, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (card_id, "review", 3, 2.5, 1, now),
                )
                conn.execute(
                    "INSERT INTO review_history (card_id, rating, review_time, scheduled_interval) VALUES (?, ?, ?, ?)",
                    (card_id, 3, now, 3),
                )
                review_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    "INSERT INTO card_notes (id, card_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    ("note-1", card_id, "Артикль мужского рода", now, now),
                )
                conn.execute(
                    "INSERT INTO knowledge_items (rule_code, language, kind, name, created_at) VALUES (?, ?, ?, ?, ?)",
                    ("de.nouns.gender", "de", "skill", "Род существительных", now),
                )
                conn.execute(
                    "INSERT INTO card_knowledge_items (card_id, rule_code, role, complexity) VALUES (?, ?, ?, ?)",
                    (card_id, "de.nouns.gender", "primary", 2),
                )
                conn.execute(
                    "INSERT INTO knowledge_attempts (client_event_id, card_id, rule_code, event_time, evaluation_data_json, review_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("evt-1", card_id, "de.nouns.gender", now, json.dumps({"score": 1.0}), review_id, now),
                )
                conn.execute(
                    "INSERT INTO user_knowledge_state (rule_code, attempts_count, proficiency, confidence, updated_at) VALUES (?, ?, ?, ?, ?)",
                    ("de.nouns.gender", 1, 0.85, 0.33, now),
                )
                conn.commit()

                # ON DELETE RESTRICT blocks deleting media still referenced in media_links
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute("DELETE FROM media_assets WHERE sha256 = ?", (sha_aud,))

                # Partial unique index allows only one primary skill per card
                conn.execute(
                    "INSERT INTO knowledge_items (rule_code, language, kind, name, created_at) VALUES (?, ?, ?, ?, ?)",
                    ("de.nouns.plural", "de", "skill", "Множественное число", now),
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(
                        "INSERT INTO card_knowledge_items (card_id, rule_code, role) VALUES (?, ?, ?)",
                        (card_id, "de.nouns.plural", "primary"),
                    )

                self.assertEqual(verify_integrity(conn)["integrity"], "ok")
            finally:
                conn.close()

    def test_tampered_migration_checksum_and_future_version_fail_closed(self):
        conn = open_sqlite(":memory:")
        try:
            migrate(conn)
            conn.execute("UPDATE schema_migrations SET sha256 = ? WHERE version = 1", ("0" * 64,))
            with self.assertRaisesRegex(MigrationError, "checksum/name mismatch"):
                migrate(conn)

            conn.execute(
                "INSERT INTO schema_migrations (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)",
                (999, "9999_future", "f" * 64, "2026-11-27T00:00:00Z"),
            )
            manifest = load_manifest()
            conn.execute(
                "UPDATE schema_migrations SET sha256 = ? WHERE version = 1",
                (manifest["migrations"][0]["sha256"],),
            )
            with self.assertRaisesRegex(MigrationError, "unknown migration version 999"):
                migrate(conn)
        finally:
            conn.close()

    def test_media_contract_normalization(self):
        ref = normalize_media_rel_path("/api/media/audio/archive_" + "c" * 64 + ".mp3")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.rel_path, f"audio/archive_{'c' * 64}.mp3")
        self.assertIsNone(normalize_media_rel_path("../audio/bad.mp3"))
        self.assertIsNone(normalize_media_rel_path("C:\\media\\a.mp3"))
        self.assertIsNone(normalize_media_rel_path("https://example.com/api/media/images/a.webp?token=1"))

    def test_python_and_node_sqlite_cross_read_write_interoperability(self):
        node_script = r"""
import { DatabaseSync } from 'node:sqlite';
import { migrateSqlite, verifyIntegrity } from './app/src/sqlite/migrator.js';

const dbPath = process.argv[1];
const db = new DatabaseSync(dbPath);
const driver = {
  async execute(sql) { db.exec(sql); },
  async run(sql, params = []) { return db.prepare(sql).run(...params); },
  async query(sql, params = []) { return db.prepare(sql).all(...params); },
  async transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const res = await fn(driver);
      db.exec('COMMIT');
      return res;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
};
await migrateSqlite(driver);
await verifyIntegrity(driver);
const rows = await driver.query('SELECT name FROM decks WHERE id = ?', [1]);
await driver.run('INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)', ['node_wrote', '"ok"', '2026-11-27T21:05:00Z']);
db.close();
console.log(JSON.stringify({ deck: rows[0]?.name || null }));
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "interop.sqlite3"
            conn = open_sqlite(db_path)
            migrate(conn)
            now = "2026-11-27T21:00:00Z"
            conn.execute(
                "INSERT INTO decks (name, target_language, created_at) VALUES (?, ?, ?)",
                ("Interop Deck", "de", now),
            )
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()

            proc = subprocess.run(
                ["node", "--input-type=module", "-e", node_script, str(db_path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(json.loads(proc.stdout.strip())["deck"], "Interop Deck")

            conn2 = open_sqlite(db_path)
            try:
                val = conn2.execute("SELECT value_json FROM app_state WHERE key = 'node_wrote'").fetchone()
                self.assertIsNotNone(val)
                self.assertEqual(val[0], '"ok"')
                self.assertEqual(verify_integrity(conn2)["integrity"], "ok")
            finally:
                conn2.close()


if __name__ == "__main__":
    unittest.main()
