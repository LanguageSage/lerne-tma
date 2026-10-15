"""Inactive storage preparation against disposable SQLite; no configured DB."""
import importlib.util
import os
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch

from peewee import IntegrityError, PostgresqlDatabase, Proxy, SqliteDatabase

from api import migrations


ROOT = Path(__file__).resolve().parents[2]


def load_models(schema_ready=False):
    database = ModuleType('api.database')
    database.tma_db = Proxy()
    database.lerne_db = Proxy()
    database.initialize_database = lambda: None
    spec = importlib.util.spec_from_file_location('_structured_schema_models', ROOT / 'api/models.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'api.database': database}), patch.dict(os.environ, {
        'VERCEL': '1', 'RUN_MIGRATIONS': 'false', 'FORCE_LOCAL_DB': 'false',
        'STRUCTURED_CARDS_V2_SCHEMA_READY': 'true' if schema_ready else 'false',
    }):
        spec.loader.exec_module(module)
    return module


class StructuredSchemaTests(unittest.TestCase):
    def setUp(self):
        self.database = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1})
        self.database.connect()
        self.models = load_models()
        self.tables = [self.models.TMA_Folder, self.models.TMA_Deck, self.models.TMA_Card,
                       self.models.TMAProgress, self.models.TMAReviewHistory]
        self.database.bind(self.tables, bind_refs=False, bind_backrefs=False)
        self.database.create_tables(self.tables)
        deck = self.models.TMA_Deck.create(user_id=1, name='Fixture')
        self.card = self.models.TMA_Card.create(
            id=125, deck=deck, front_text='@quiz\n[[literal]]', back_text='Answer',
            context='Context', metadata='{"author":"unchanged"}', history='[{"front":"old"}]',
            updated_at='2026-10-01 12:00:00', created_at='2026-09-01 12:00:00',
            audio_path='user.mp3', topics='A, A', position=7)
        self.models.TMAProgress.create(user_id=1, card_id=125, interval=17, repetitions=3)
        self.models.TMAReviewHistory.create(user_id=1, card_id=125, rating=3)
        self.database.execute_sql('CREATE INDEX fixture_front ON tma_card(front_text)')
        self.database.execute_sql('CREATE TABLE fixture_audit (value TEXT)')
        self.database.execute_sql('CREATE TRIGGER fixture_update AFTER UPDATE ON tma_card '
                                  'BEGIN INSERT INTO fixture_audit VALUES (NEW.front_text); END')

    def tearDown(self):
        self.database.close()

    def migrate(self):
        return migrations.run_structured_cards_v2_migration(self.database)

    def snapshot(self):
        return {model._meta.table_name: list(model.select().dicts()) for model in self.tables}

    def test_migration_and_rerun_preserve_rows_timestamps_srs_and_indexes(self):
        before = self.snapshot()
        indexes = self.database.get_indexes('tma_card')
        self.assertTrue(self.migrate()['applied'])
        self.assertFalse(self.migrate()['applied'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.database.get_indexes('tma_card'), indexes)
        self.assertEqual(self.database.execute_sql(
            'SELECT content_version, content_v2, card_revision FROM tma_card').fetchall(), [(1, None, 1)])
        self.assertEqual(self.database.execute_sql('SELECT * FROM fixture_audit').fetchall(), [])
        self.assertEqual(self.database.execute_sql(
            'SELECT migration_id FROM tma_migration_history').fetchall(), [(87,)])
        # The original trigger and references are still attached to the same table.
        self.models.TMA_Card.update(front_text='new').where(self.models.TMA_Card.id == 125).execute()
        self.assertEqual(self.database.execute_sql('SELECT value FROM fixture_audit').fetchall(), [('new',)])
        self.assertEqual(self.database.execute_sql('PRAGMA foreign_key_check').fetchall(), [])

    def test_legacy_orm_and_raw_inserts_get_database_defaults(self):
        self.migrate()
        created = self.models.TMA_Card.create(deck=self.card.deck_id, front_text='Q', back_text='A')
        self.assertEqual(self.database.execute_sql(
            'SELECT content_version, content_v2, card_revision FROM tma_card WHERE id = ?',
            (created.id,)).fetchone(), (1, None, 1))
        # Test SQL defaults independently of the Python field defaults.
        self.database.execute_sql(
            'INSERT INTO tma_card (deck_id, front_text, back_text, card_type, is_deleted, '
            'want_to_learn, created_at, history, position, flag) '
            "VALUES (?, 'raw', 'A', 'standard', 0, 0, CURRENT_TIMESTAMP, '[]', 0, 0)",
            (self.card.deck_id,))
        self.assertEqual(self.database.execute_sql(
            "SELECT content_version, content_v2, card_revision FROM tma_card WHERE front_text = 'raw'"
        ).fetchone(), (1, None, 1))

    def test_constraints_reject_invalid_envelopes_and_native_creation(self):
        self.migrate()
        for version, content, revision in [(1, '{}', 1), (2, None, 1), (3, '{}', 1),
                                           (1, None, 0), (1, None, -1), (None, None, 1),
                                           (1, None, None), (2, '{"type":"standard","data":'
                                                               '{"prompt":"Q","answer":"A"}}', 1)]:
            with self.subTest(version=version, content=content, revision=revision):
                with self.assertRaises(IntegrityError), self.database.atomic():
                    self.database.execute_sql(
                        'UPDATE tma_card SET content_version=?, content_v2=?, card_revision=? WHERE id=125',
                        (version, content, revision))
        self.assertEqual(self.database.execute_sql(
            'SELECT content_version, content_v2, card_revision FROM tma_card').fetchone(), (1, None, 1))
        self.assertFalse(migrations.STRUCTURED_CARDS_V2_NATIVE_WRITES_ENABLED)

    def test_failure_rolls_back_ddl_and_history_without_touching_cards(self):
        before = self.snapshot()
        execute = self.database.execute_sql

        def fail_history(sql, *args, **kwargs):
            if sql.startswith('INSERT INTO tma_migration_history'):
                raise RuntimeError('injected history failure')
            return execute(sql, *args, **kwargs)

        with patch.object(self.database, 'execute_sql', side_effect=fail_history):
            with self.assertRaisesRegex(RuntimeError, 'injected'):
                self.migrate()
        self.assertEqual(self.snapshot(), before)
        self.assertNotIn('content_version', [column.name for column in self.database.get_columns('tma_card')])
        self.assertFalse(self.database.table_exists('tma_migration_history'))
        self.assertTrue(self.migrate()['applied'])

    def test_untracked_or_partial_columns_fail_closed(self):
        self.database.execute_sql('ALTER TABLE tma_card ADD COLUMN content_version SMALLINT')
        with self.assertRaisesRegex(RuntimeError, 'Untracked'):
            self.migrate()
        self.assertNotIn('content_v2', [column.name for column in self.database.get_columns('tma_card')])
        self.assertFalse(self.database.table_exists('tma_migration_history'))

    def test_history_schema_mismatch_fails_closed(self):
        self.database.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
        self.database.execute_sql('INSERT INTO tma_migration_history VALUES (87)')
        with self.assertRaisesRegex(RuntimeError, 'schema mismatch'):
            self.migrate()

    def test_missing_constraint_is_detected_on_rerun(self):
        self.database.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
        self.database.execute_sql('INSERT INTO tma_migration_history VALUES (87)')
        for definition in ('content_version SMALLINT NOT NULL DEFAULT 1', 'content_v2 TEXT NULL',
                           'card_revision BIGINT NOT NULL DEFAULT 1'):
            self.database.execute_sql('ALTER TABLE tma_card ADD COLUMN ' + definition)
        with self.assertRaisesRegex(RuntimeError, 'constraint mismatch'):
            self.migrate()

    def test_startup_runners_never_include_explicit_migration(self):
        self.assertNotIn(87, [item[0] for item in migrations.MIGRATIONS])
        self.assertNotIn('content_version', self.models.TMA_Card._meta.fields)
        self.assertNotIn('run_structured_cards_v2_migration',
                         self.models.create_all_tables.__code__.co_names)

    def test_opt_in_model_matches_prepared_database_and_preserves_identity(self):
        self.migrate()
        prepared = load_models(schema_ready=True)
        self.database.bind([prepared.TMA_Card], bind_refs=False, bind_backrefs=False)
        result = prepared.TMA_Card.get_by_id(125)
        self.assertEqual((result.content_version, result.content_v2, result.card_revision), (1, None, 1))
        self.assertEqual(result.front_text, self.card.front_text)
        self.assertNotIn('content_version', prepared.Card._meta.fields)

    def test_fresh_opt_in_model_creates_same_constraints_and_defaults(self):
        prepared = load_models(schema_ready=True)
        fresh = SqliteDatabase(':memory:')
        try:
            fresh.bind([prepared.TMA_Deck, prepared.TMA_Card], bind_refs=False, bind_backrefs=False)
            fresh.create_tables([prepared.TMA_Deck, prepared.TMA_Card])
            migrations._verify_structured_card_schema(fresh)
            deck = prepared.TMA_Deck.create(user_id=1, name='D')
            with self.assertRaises(IntegrityError):
                prepared.TMA_Card.create(deck=deck, front_text='Q', back_text='A',
                                         content_version=2, content_v2='{}')
        finally:
            fresh.close()

    def test_postgres_model_ddl_has_expected_types_defaults_and_gate(self):
        # Compile only; never connect to a configured PostgreSQL instance.
        prepared = load_models(schema_ready=True)
        postgres = PostgresqlDatabase('unconnected_fixture')
        postgres.bind([prepared.TMA_Card], bind_refs=False, bind_backrefs=False)
        sql, _ = prepared.TMA_Card._schema._create_table().query()
        self.assertIn('"content_version" SMALLINT NOT NULL DEFAULT 1', sql)
        self.assertIn('"content_v2" TEXT', sql)
        self.assertIn('"card_revision" BIGINT NOT NULL DEFAULT 1', sql)
        for name, expression in migrations.STRUCTURED_CARDS_V2_CHECKS.items():
            self.assertIn(f'CONSTRAINT {name} CHECK ({expression})', sql)
        self.assertTrue(postgres.is_closed())

    def test_migration_requires_separate_transaction_and_legacy_table(self):
        with self.database.atomic():
            with self.assertRaisesRegex(RuntimeError, 'own transaction'):
                self.migrate()
        empty = SqliteDatabase(':memory:')
        try:
            with self.assertRaisesRegex(RuntimeError, 'Legacy tma_card'):
                migrations.run_structured_cards_v2_migration(empty)
            self.assertTrue(empty.is_closed())
        finally:
            empty.close()


if __name__ == '__main__':
    unittest.main()
