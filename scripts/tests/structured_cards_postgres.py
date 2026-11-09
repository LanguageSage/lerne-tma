"""Exercise native card storage and migration 93 on a new disposable PostgreSQL."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]


def verify(db):
    from peewee import IntegrityError, OperationalError
    from pydantic import ValidationError

    from api import models
    from api.card_core.lerne_card_core.structured_cards_v2 import normalize_card
    from api.migrations import (
        STRUCTURED_CARDS_V2_MIGRATION_ID, MigrationError, run_structured_cards_v2_migration,
    )
    from api.services.structured_card_storage import (
        V2CardNotFound, create_v2_card, read_v2_card, replace_v2_card,
    )

    cards = models.TMA_Card
    linked_models = (models.TMAProgress, models.TMAReviewHistory, models.TMACardNote, models.TMAMedia)
    tables = (models.TMA_Folder, models.TMA_Deck, cards, *linked_models)
    migration_id = STRUCTURED_CARDS_V2_MIGRATION_ID
    quiz = {
        'id': 'author-reference',
        'type': 'quiz',
        'data': {'prompt': 'Wörtlich: [[Beispiel]]', 'back_note': 'Обратная сторона',
                 'options': [{'text': 'Ja', 'correct': True}, {'text': 'Doch', 'correct': True}]},
        'info': [{'type': 'task', 'text': 'Wähle.'}],
        'explanation': 'Erklärung', 'level': 'B1', 'topics': ['Test', 'Fragen'],
        'metadata': {'example': 'ü'},
    }
    theory = {'type': 'theory', 'data': {'text': 'Ein Beispiel mit @match.'}}
    invalid = {'type': 'quiz', 'data': {'prompt': 'Wähle.', 'options': []}}

    class StorageTests(unittest.TestCase):
        def setUp(self):
            db.bind(tables, bind_refs=False, bind_backrefs=False)
            db.create_tables(tables)
            self.addCleanup(db.drop_tables, tables)
            db.execute_sql('''CREATE TABLE tma_migration_history (
                migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            self.addCleanup(db.execute_sql, 'DROP TABLE tma_migration_history')
            db.execute_sql('INSERT INTO tma_migration_history (migration_id) VALUES (92)')
            self.deck = models.TMA_Deck.create(user_id=7, name='Synthetic test deck')

        def history(self):
            return db.execute_sql(
                'SELECT migration_id FROM tma_migration_history ORDER BY migration_id').fetchall()

        def migrate(self, *, applied=True):
            self.assertEqual(run_structured_cards_v2_migration(db),
                             {'applied': applied, 'migration_id': migration_id})

        def create_native(self, value=quiz):
            return create_v2_card(value, deck_id=self.deck.id, creator_id=7, position=31,
                                  image_path='images/synthetic.webp')

        def seed_links(self, card):
            models.TMAProgress.create(card_id=card.id, user_id=7, repetitions=4, interval=8)
            models.TMAReviewHistory.create(card_id=card.id, user_id=7, rating=3)
            models.TMACardNote.create(id=str(uuid4()), card=card, user_id=7, text='Private synthetic note')
            models.TMAMedia.create(folder='images', filename='synthetic.webp', content=b'synthetic')

        def linked_state(self):
            return [list(model.select().order_by(model.id).dicts()) for model in linked_models]

        def restore_old_schema(self):
            db.execute_sql('''ALTER TABLE tma_card DROP COLUMN content_v2 CASCADE,
                ALTER COLUMN front_text SET NOT NULL, ALTER COLUMN back_text SET NOT NULL,
                ALTER COLUMN card_type SET NOT NULL''')

        def test_upgrade_legacy_rows_and_rerun_preserve_full_rows_and_relationships(self):
            legacy = cards.create(deck=self.deck, front_text='Frage', back_text='Antwort',
                                  context='Kontext', topics='Thema', metadata='{"example":"legacy"}',
                                  tags='A2', position=13, history='["retained"]',
                                  image_path='images/synthetic.webp', audio_path='audio/synthetic.ogg')
            self.seed_links(legacy)
            before = cards.select().where(cards.id == legacy.id).dicts().get()
            links = self.linked_state()
            self.restore_old_schema()
            self.migrate()
            db.close()
            self.migrate(applied=False)
            self.assertEqual(self.history(), [(92,), (migration_id,)])
            self.assertEqual(cards.select().where(cards.id == legacy.id).dicts().get(), before)
            self.assertEqual(self.linked_state(), links)
            with self.assertRaises(V2CardNotFound):
                read_v2_card(legacy.id)
            with self.assertRaises(V2CardNotFound):
                replace_v2_card(legacy.id, quiz)
            self.assertEqual(cards.select().where(cards.id == legacy.id).dicts().get(), before)
            new_legacy = cards.create(deck=self.deck, front_text='Frage 2', back_text='Antwort 2')
            self.assertIsNone(cards.get_by_id(new_legacy.id).content_v2)

        def test_native_content_replaces_atomically_and_preserves_non_content(self):
            # Fresh ORM bootstrap has a nullable JSONB column and no migration marker.
            self.assertEqual(self.history(), [(92,)])
            self.assertEqual({column.name: column.data_type for column in db.get_columns('tma_card')}['content_v2'],
                             'jsonb')
            self.migrate()
            card = self.create_native()
            stored = cards.get_by_id(card.id)
            self.assertIsInstance(stored.id, int)
            self.assertEqual(stored.content_v2, {'schema_version': 2, 'card': normalize_card(quiz)})
            for field in ('front_text', 'back_text', 'context', 'topics', 'card_type', 'tags', 'metadata'):
                self.assertIsNone(getattr(stored, field))
            self.assertEqual(read_v2_card(card.id).model_dump(mode='json'), normalize_card(quiz))
            cards.update(audio_path='audio/synthetic.ogg', history='["retained"]').where(cards.id == card.id).execute()
            self.seed_links(card)
            linked = self.linked_state()
            before = cards.select().where(cards.id == card.id).dicts().get()
            self.assertEqual(replace_v2_card(card.id, theory).model_dump(mode='json'), normalize_card(theory))
            after = cards.select().where(cards.id == card.id).dicts().get()
            self.assertEqual(after['content_v2'], {'schema_version': 2, 'card': normalize_card(theory)})
            self.assertEqual({k: v for k, v in after.items() if k not in ('content_v2', 'updated_at')},
                             {k: v for k, v in before.items() if k not in ('content_v2', 'updated_at')})
            self.assertEqual(self.linked_state(), linked)
            self.migrate(applied=False)
            self.assertEqual(read_v2_card(card.id).model_dump(mode='json'), normalize_card(theory))

        def test_validation_missing_and_deleted_rows(self):
            self.migrate()
            with self.assertRaises(ValidationError):
                self.create_native(invalid)
            for value in ({**theory, 'metadata': {'nested': ['before\x00after']}},
                          {**theory, 'metadata': {'bad\x00key': True}}):
                with self.assertRaisesRegex(ValueError, 'U\\+0000'):
                    self.create_native(value)
            self.assertEqual(cards.select().count(), 0)
            card = self.create_native()
            with self.assertRaises(ValidationError):
                replace_v2_card(card.id, invalid)
            self.assertEqual(read_v2_card(card.id).model_dump(mode='json'), normalize_card(quiz))
            cards.update(is_deleted=True).where(cards.id == card.id).execute()
            for card_id in (card.id, card.id + 100):
                with self.subTest(card_id=card_id):
                    with self.assertRaises(V2CardNotFound):
                        read_v2_card(card_id)
                    with self.assertRaises(V2CardNotFound):
                        replace_v2_card(card_id, theory)

        def test_database_rejects_mixed_sources_and_invalid_envelopes(self):
            self.migrate()
            card = self.create_native()
            for field in ('front_text', 'back_text', 'context', 'topics', 'card_type', 'tags', 'metadata'):
                with self.subTest(field=field), self.assertRaises(IntegrityError):
                    cards.update({getattr(cards, field): 'Competing content'}).where(cards.id == card.id).execute()
            for raw in (None, 'null', '[]', '{}', 'true', '"scalar"', '2', '{"schema_version":2}', '{"card":{}}',
                        '{"schema_version":"2","card":{}}', '{"schema_version":1,"card":{}}',
                        '{"schema_version":2,"card":null}'):
                with self.subTest(value=raw), self.assertRaises(IntegrityError):
                    db.execute_sql('UPDATE tma_card SET content_v2=%s::jsonb WHERE id=%s', (raw, card.id))
            self.assertEqual(read_v2_card(card.id).model_dump(mode='json'), normalize_card(quiz))
            legacy = cards.create(deck=self.deck, front_text='Old', back_text='Answer')
            with self.assertRaises(IntegrityError):
                db.execute_sql('UPDATE tma_card SET content_v2=%s::jsonb WHERE id=%s',
                               (json.dumps(card.content_v2), legacy.id))

        def test_read_revalidates_content_even_with_a_valid_database_envelope(self):
            self.migrate()
            card = self.create_native()
            db.execute_sql('UPDATE tma_card SET content_v2=%s::jsonb WHERE id=%s',
                           (json.dumps({'schema_version': 2, 'card': invalid}), card.id))
            with self.assertRaises(ValidationError):
                read_v2_card(card.id)

        def test_native_writes_roll_back_with_caller_transaction(self):
            self.migrate()
            original = self.create_native()
            with self.assertRaisesRegex(RuntimeError, 'synthetic rollback'):
                with db.atomic():
                    replacement = replace_v2_card(original.id, theory)
                    self.assertEqual(replacement.type, 'theory')
                    self.create_native(theory)
                    self.assertEqual(cards.select().count(), 2)
                    raise RuntimeError('synthetic rollback')
            self.assertEqual(cards.select().count(), 1)
            self.assertEqual(read_v2_card(original.id).model_dump(mode='json'), normalize_card(quiz))

        def test_migration_failure_rolls_back_ddl_and_can_be_retried(self):
            self.restore_old_schema()
            execute_sql = db.execute_sql
            def fail_history(sql, *args, **kwargs):
                if 'INSERT INTO TMA_MIGRATION_HISTORY' in sql.upper():
                    raise OperationalError('synthetic history failure')
                return execute_sql(sql, *args, **kwargs)

            with patch.object(db, 'execute_sql', side_effect=fail_history):
                with self.assertRaises((OperationalError, MigrationError)):
                    self.migrate()
            columns = {column.name: column for column in db.get_columns('tma_card')}
            self.assertNotIn('content_v2', columns)
            self.assertFalse(columns['front_text'].null)
            self.assertFalse(columns['back_text'].null)
            self.assertEqual(self.history(), [(92,)])
            self.migrate()

        def test_history_without_its_constraint_fails_closed(self):
            self.migrate()
            db.execute_sql('ALTER TABLE tma_card DROP CONSTRAINT tma_card_single_content_source')
            with self.assertRaisesRegex(MigrationError, 'history/schema mismatch'):
                self.migrate(applied=False)
            self.assertEqual(self.history(), [(92,), (migration_id,)])

        def test_backend_disconnect_rolls_back_native_ddl_and_retry_succeeds(self):
            # The entry point owns a fresh loopback cluster. Terminate only this
            # test connection, never a PID or target taken from app configuration.
            from peewee import InterfaceError, PostgresqlDatabase
            self.assertEqual(db.connect_params['host'], '127.0.0.1')
            self.assertEqual(db.connect_params['user'], 'cards_test')
            self.restore_old_schema()
            pid = db.execute_sql('SELECT pg_backend_pid()').fetchone()[0]
            controller = PostgresqlDatabase(db.database, **db.connect_params)
            execute = db.execute_sql

            def disconnect_before_history(sql, *args, **kwargs):
                if 'INSERT INTO TMA_MIGRATION_HISTORY' in sql.upper():
                    with controller.connection_context():
                        self.assertTrue(controller.execute_sql('SELECT pg_terminate_backend(%s)', (pid,)).fetchone()[0])
                return execute(sql, *args, **kwargs)

            try:
                with patch.object(db, 'execute_sql', side_effect=disconnect_before_history):
                    # A killed backend can also make the driver's ROLLBACK fail.
                    with self.assertRaises((OperationalError, InterfaceError, MigrationError)):
                        self.migrate()
            finally:
                db.close()  # Retry must use a new connection after transport loss.
            self.assertNotIn('content_v2', {c.name for c in db.get_columns('tma_card')})
            self.assertEqual(self.history(), [(92,)])
            self.migrate()
            self.assertEqual(self.history(), [(92,), (migration_id,)])

        def atomic_migration_fixture(self):
            from api.migrations import run_library_cards_v2_migration
            db.bind([models.LibraryCategory, models.Deck, models.Card], bind_refs=False, bind_backrefs=False)
            db.create_tables([models.LibraryCategory, models.Deck, models.Card])
            self.addCleanup(db.drop_tables, [models.Card, models.Deck, models.LibraryCategory])
            self.migrate()
            run_library_cards_v2_migration(db)
            library = models.Deck.create(name='Synthetic atomic library')
            cards.create(deck=self.deck, front_text='Hallo', back_text='Hello', position=7,
                         metadata='{"custom":{"retain":[true,null,3]}}', tags='A1,synthetic')
            models.Card.create(deck=library, front_text='Haus', back_text='House', position=4)
            cards.create(deck=self.deck, front_text='', back_text='', is_deleted=True)
            return {t: list(db.execute_sql(f'SELECT row_to_json(t) FROM {t} t ORDER BY id')) for t in ('tma_card', 'card')}

        def test_atomic_content_prevalidates_both_tables_before_any_write(self):
            from tools.migrate_native_v2_local import migrate_active
            self.atomic_migration_fixture()
            models.Card.update(front_text='', back_text='').execute()
            with patch('tools.migrate_native_v2_local.execute_values') as write:
                with self.assertRaisesRegex(ValueError, 'prevalidation blocked'):
                    migrate_active(db)
                write.assert_not_called()
            self.assertEqual(cards.select().where(cards.content_v2.is_null(False)).count(), 0)

        def test_atomic_content_rolls_back_both_tables_then_preserves_deleted_rows(self):
            from tools import migrate_native_v2_local as migration
            from psycopg2.errors import DivisionByZero
            before = self.atomic_migration_fixture()
            write = migration.execute_values
            calls = []
            def fail_library(cursor, sql, *args, **kwargs):
                calls.append(sql)
                if sql.startswith('UPDATE card t'):
                    cursor.execute('SELECT 1/0')
                return write(cursor, sql, *args, **kwargs)
            with patch.object(migration, 'execute_values', side_effect=fail_library):
                with self.assertRaises(DivisionByZero):
                    migration.migrate_active(db)
            self.assertEqual(len(calls), 2)
            self.assertEqual({t: list(db.execute_sql(f'SELECT row_to_json(t) FROM {t} t ORDER BY id')) for t in before}, before)
            immutable = migration.immutable_cards(db)
            result = migration.migrate_active(db)
            self.assertEqual({t: r['converted'] for t, r in result['tables'].items()}, {'tma_card': 1, 'card': 1})
            self.assertEqual(migration.immutable_cards(db), immutable)
            deleted = cards.get(cards.is_deleted == True)
            self.assertIsNone(deleted.content_v2)
            active = cards.get(cards.is_deleted == False)
            self.assertEqual(active.content_v2['card']['metadata']['custom'], {'retain': [True, None, 3]})
            self.assertEqual(active.content_v2['card']['metadata']['tags'], ['synthetic'])
            self.assertEqual(active.content_v2['card']['level'], 'A1')

    return unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(StorageTests)).wasSuccessful()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--http', action='store_true', help='Run authenticated socket HTTP tests')
    parser.add_argument('--cutover-preflight', action='store_true', help='Read-only preflight, legacy HTTP writers and physical rollback drill; no migrations')
    parser.add_argument('--legacy-drain-browser', action='store_true', help='Guarded V1 queue delivery over Chromium/FastAPI/disposable PostgreSQL; no migrations')
    parser.add_argument('--legacy-drain-baseline', action='store_true', help='Reproduce 7.4 native false-success with its committed sync module')
    parser.add_argument('--offline-create-browser', action='store_true', help='Run Standard and all-type offline creation browser scenarios over socket HTTP')
    parser.add_argument('--offline-edit-browser', action='store_true', help='Run the offline edit and conflict browser scenario over socket HTTP')
    parser.add_argument('--offline-delivery-browser', action='store_true', help='Run the offline delivery failure scenarios over socket HTTP')
    parser.add_argument('--offline-isolation-browser', action='store_true', help='Run the account and tab isolation browser scenario')
    parser.add_argument('--offline-move-browser', action='store_true', help='Run the offline move scenario')
    parser.add_argument('--offline-lifecycle-browser', action='store_true', help='Run the offline delete and restore scenario')
    parser.add_argument('--offline-batch-browser', action='store_true', help='Run durable batch copy/move with Chromium and PostgreSQL')
    parser.add_argument('--offline-list-browser', action='store_true', help='Run V2 list operations and search parity in Chromium')
    parser.add_argument('--recovery-browser', action='store_true', help='Physical PostgreSQL rollback, native auto choices and durable browser quarantine')
    parser.add_argument('--learning-browser', action='store_true', help='Run all-type study and personal-data contracts in Chromium/HTTP/PostgreSQL')
    parser.add_argument('--media-browser', action='store_true', help='Run nine-type native media/TTS/cache in Chromium/HTTP/PostgreSQL')
    parser.add_argument('--layout-browser', action='store_true', help='Run ordered layout, inline media and offline edits in Chromium/HTTP/disposable PostgreSQL')
    args = parser.parse_args()
    if args.legacy_drain_baseline and not args.legacy_drain_browser:
        parser.error('--legacy-drain-baseline requires --legacy-drain-browser')
    binaries = args.bin_dir.resolve()
    suffix = '.exe' if os.name == 'nt' else ''
    for name in ('initdb', 'pg_ctl'):
        if not (binaries / (name + suffix)).is_file():
            parser.error(f'Missing PostgreSQL binary: {name}')
    scratch = ROOT / 'local/test-data' / ('structured-cards-pg-' + uuid4().hex)
    scratch.mkdir(parents=True)
    data = scratch / 'data'
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    clean = {key: value for key, value in os.environ.items()
             if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    clean.update(PYTHON_DOTENV_DISABLED='1', RUN_MIGRATIONS='false', PGCLIENTENCODING='UTF8')
    os.environ.clear()
    os.environ.update(clean)
    sys.path.insert(0, str(ROOT))

    def pg(name, *arguments):
        log = scratch / (name + '.log')
        with log.open('ab') as output:
            result = subprocess.run([str(binaries / (name + suffix)), *map(str, arguments)],
                                    env=clean, stdout=output, stderr=output, timeout=90,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError(f'{name} failed; inspect {log}')

    try:
        pg('initdb', '-D', data, '-U', 'cards_test', '-A', 'trust', '--no-locale', '-E', 'UTF8')
        sockets = '' if os.name == 'nt' else f' -k "{scratch}"'
        pg('pg_ctl', '-D', data, '-l', scratch / 'postgres.log', '-o',
           f'-h 127.0.0.1 -p {port}{sockets}', '-w', 'start')
        from peewee import PostgresqlDatabase
        db = PostgresqlDatabase('postgres', host='127.0.0.1', port=port,
                                user='cards_test', connect_timeout=5)
        try:
            if args.legacy_drain_browser:
                from structured_cards_legacy_drain import verify as verify_drain
                return 0 if verify_drain(db, baseline=args.legacy_drain_baseline) else 1
            if args.cutover_preflight:
                from structured_cards_cutover import verify as verify_cutover
                return 0 if verify_cutover(db, binaries, scratch) else 1
            if (args.http or args.offline_create_browser or args.offline_edit_browser
                    or args.offline_delivery_browser or args.offline_isolation_browser
                    or args.offline_move_browser or args.offline_lifecycle_browser or args.offline_batch_browser or args.offline_list_browser or args.learning_browser or args.media_browser or args.layout_browser or args.recovery_browser):
                from structured_cards_http import verify as verify_http
                return 0 if verify_http(db, offline_create_browser=args.offline_create_browser,
                                        offline_edit_browser=args.offline_edit_browser,
                                        offline_delivery_browser=args.offline_delivery_browser,
                                        offline_isolation_browser=args.offline_isolation_browser,
                                        offline_move_browser=args.offline_move_browser,
                                        offline_lifecycle_browser=args.offline_lifecycle_browser,
                                        offline_batch_browser=args.offline_batch_browser,
                                        offline_list_browser=args.offline_list_browser,
                                        recovery_browser=(binaries, scratch) if args.recovery_browser else None,
                                        learning_browser=args.learning_browser, media_browser=args.media_browser, layout_browser=args.layout_browser) else 1
            return 0 if verify(db) else 1
        finally:
            if not db.is_closed():
                db.close()
    finally:
        # pg_ctl can start PostgreSQL and then fail while waiting for readiness.
        if (data / 'postmaster.pid').is_file():
            pg('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop')
        if data.exists():
            resolved = data.resolve()
            assert resolved.parent == scratch.resolve()
            assert scratch.resolve().parent == (ROOT / 'local/test-data').resolve()
            assert scratch.name.startswith('structured-cards-pg-')
            shutil.rmtree(resolved)


if __name__ == '__main__':
    raise SystemExit(main())
