"""Card lifecycle guards on disposable fixtures; never import a live DB owner.

Run separately with schema-ready=false and true, like the stage 3A suite.
"""
import importlib
import re
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest
from unittest.mock import patch

from peewee import SqliteDatabase

from scripts.tests import test_structured_cards_v2_guards as fixtures

cards, models, database = fixtures.cards, fixtures.models, fixtures.database
trash = importlib.import_module('api.services.trash')
trash_router = importlib.import_module('api.routers.trash')
collaboration = importlib.import_module('api.services.collaborative_service')
for name in ('batch_move_cards', 'batch_copy_cards', 'batch_delete_cards', 'delete_card'):
    setattr(fixtures.services, name, getattr(cards, name))
fixtures.services.trash = trash


class CardOperationGuardTests(unittest.TestCase):
    setUp = fixtures.StructuredWriteGuardTests.setUp
    tearDown = fixtures.StructuredWriteGuardTests.tearDown
    make_native = fixtures.StructuredWriteGuardTests.make_native
    snapshot = fixtures.StructuredWriteGuardTests.snapshot
    blocked = fixtures.StructuredWriteGuardTests.blocked

    def source(self, front='New source', **kwargs):
        return models.TMA_Card.create(deck=self.deck, front_text=front, back_text='Answer',
                                     creator_id=1, **kwargs)

    def no_dml_blocked(self, operation):
        statements = []
        database.connection().set_trace_callback(statements.append)
        try:
            self.blocked(operation)
        finally:
            database.connection().set_trace_callback(None)
        self.assertFalse([sql for sql in statements if re.match(r'\s*(INSERT|UPDATE|DELETE)\b', sql, re.I)])

    def test_copy_and_move_refuse_native_sources_in_every_duplicate_mode(self):
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            for mode in ('skip', 'keep', 'overwrite'):
                with self.subTest(operation=operation.__name__, mode=mode):
                    self.no_dml_blocked(lambda: operation([self.native.id], self.deck.id, 1, mode))

    def test_mixed_multideck_sources_and_repeated_ids_refuse_before_any_write(self):
        third = models.TMA_Deck.create(user_id=1, name='Third')
        extra = models.TMA_Card.create(deck=third, front_text='Third source', back_text='Answer')
        for operation in (cards.batch_copy_cards, cards.batch_move_cards, cards.batch_delete_cards):
            ids = [extra.id, self.legacy.id, self.native.id, self.legacy.id, self.native.id]
            with self.subTest(operation=operation.__name__):
                args = (ids, 1) if operation == cards.batch_delete_cards else (ids, third.id, 1)
                self.no_dml_blocked(lambda: operation(*args))

    def test_overwrite_checks_normalized_native_target_before_creating_or_deleting(self):
        first = self.source('First unrelated')
        source = self.source('PLAIN, projection!')
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            self.no_dml_blocked(lambda: operation([first.id, source.id], self.other.id, 1, 'overwrite'))
            self.assertFalse(models.TMA_Card.get_by_id(source.id).is_deleted)
            self.assertEqual(models.TMA_Card.get_by_id(source.id).deck_id, self.deck.id)

    def test_single_and_batch_delete_refuse_native_without_side_effects(self):
        self.no_dml_blocked(lambda: cards.delete_card(self.native.id, 1))
        self.no_dml_blocked(lambda: cards.batch_delete_cards([self.legacy.id, self.native.id], 1))

    def test_restore_refuses_native_before_restoring_even_its_deleted_deck(self):
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.native.id).execute()
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.other.id).execute()
        self.no_dml_blocked(lambda: trash.restore_card(self.native.id, 1))

    def test_unknown_and_null_versions_fail_closed_for_all_sources(self):
        # Flag-on schema enforces NOT NULL; flag-off fixture also covers a
        # malformed nullable column without relaxing production constraints.
        versions = (99,) if 'content_version' in models.TMA_Card._meta.fields else (99, None)
        for version in versions:
            self.make_native(self.native.id, version)
            for operation in (
                lambda: cards.batch_copy_cards([self.native.id], self.deck.id, 1),
                lambda: cards.batch_move_cards([self.native.id], self.deck.id, 1),
                lambda: cards.batch_delete_cards([self.native.id], 1),
                lambda: cards.delete_card(self.native.id, 1),
                lambda: trash.restore_card(self.native.id, 1),
            ):
                self.no_dml_blocked(operation)

    def test_unknown_overwrite_target_also_fails_closed(self):
        source = self.source('plain projection')
        self.make_native(self.native.id, 47)
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            self.no_dml_blocked(lambda: operation([source.id], self.other.id, 1, 'overwrite'))

    def test_rejection_preserves_media_blobs_paths_srs_and_history(self):
        models.TMAMedia.create(filename='front.mp3', folder='audio', content=b'original audio')
        models.TMAMedia.create(filename='image.png', folder='images', content=b'original image')
        models.TMA_Card.update(image_path='image.png', image_data=b'original image',
            video_front_path='front.mp4', video_back_path='back.mp4').where(
                models.TMA_Card.id == self.native.id).execute()
        self.no_dml_blocked(lambda: cards.batch_copy_cards([self.legacy.id, self.native.id], self.deck.id, 1))
        self.no_dml_blocked(lambda: cards.batch_move_cards([self.legacy.id, self.native.id], self.deck.id, 1))
        self.no_dml_blocked(lambda: cards.batch_delete_cards([self.legacy.id, self.native.id], 1))
        self.no_dml_blocked(lambda: cards.delete_card(self.native.id, 1))
        self.no_dml_blocked(lambda: trash.restore_card(self.native.id, 1))

    def test_unrelated_native_target_does_not_block_legacy_copy_or_move(self):
        original = database.execute_sql('SELECT * FROM tma_card WHERE id=?', (self.native.id,)).fetchone()
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            source = self.source(operation.__name__)
            result = operation([source.id], self.other.id, 1, 'overwrite')
            self.assertEqual(result['count'], 1)
        self.assertEqual(database.execute_sql('SELECT * FROM tma_card WHERE id=?', (self.native.id,)).fetchone(), original)

    def test_skip_and_keep_do_not_write_matching_native_targets(self):
        original = database.execute_sql('SELECT * FROM tma_card WHERE id=?', (self.native.id,)).fetchone()
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            for mode in ('skip', 'keep'):
                source = self.source('plain projection')
                result = operation([source.id], self.other.id, 1, mode)
                self.assertEqual(result['count'], 0 if mode == 'skip' else 1)
                self.assertEqual(database.execute_sql('SELECT * FROM tma_card WHERE id=?', (self.native.id,)).fetchone(), original)

    def test_legacy_copy_preserves_fields_order_and_deduplicates_ids(self):
        source = self.source('Copy me', context='Context', metadata='{"x":1}', tags='B1',
            image_path='image.png', audio_path='front.mp3', audio_back_path='back.mp3',
            video_front_path='front.mp4', video_back_path='back.mp4', position=2)
        before = self.snapshot()
        result = cards.batch_copy_cards([source.id, self.legacy.id, source.id], self.other.id, 1, 'keep')
        self.assertEqual(result['created'], 2)
        copied = list(models.TMA_Card.select().where((models.TMA_Card.deck_id == self.other.id) &
                      (models.TMA_Card.id != self.native.id)).order_by(models.TMA_Card.position))
        self.assertEqual([row.front_text for row in copied], [source.front_text, self.legacy.front_text])
        for field in ('front_text', 'back_text', 'context', 'metadata', 'tags', 'image_path',
                      'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'):
            self.assertEqual(getattr(copied[0], field), getattr(source, field))
        after = self.snapshot()
        for table in ('tmaprogress', 'tmareviewhistory', 'tmamedia'):
            self.assertEqual(after[table], before[table])

    def test_legacy_move_preserves_id_srs_media_and_selection_order(self):
        source = self.source('Move first', audio_path='same.mp3')
        before = self.snapshot()
        result = cards.batch_move_cards([source.id, self.legacy.id, source.id], self.other.id, 1)
        self.assertEqual((result['moved'], result['count']), (2, 2))
        moved = models.TMA_Card.get_by_id(source.id)
        legacy = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertEqual((moved.deck_id, moved.audio_path), (self.other.id, 'same.mp3'))
        self.assertLess(moved.position, legacy.position)
        after = self.snapshot()
        for table in ('tmaprogress', 'tmareviewhistory', 'tmamedia'):
            self.assertEqual(after[table], before[table])

    def test_legacy_overwrite_preserves_target_identity_srs_and_only_move_deletes_source(self):
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            target = models.TMA_Card.create(deck=self.other, front_text=operation.__name__, back_text='Old')
            source = self.source(operation.__name__.upper(), audio_path='new.mp3')
            progress = models.TMAProgress.create(user_id=1, card_id=target.id, queue='review', interval=27)
            history = models.TMAReviewHistory.create(user_id=1, card_id=target.id, rating=4)
            result = operation([source.id, source.id], self.other.id, 1, 'overwrite')
            self.assertEqual((result['updated'], result['count']), (1, 1))
            target_after = models.TMA_Card.get_by_id(target.id)
            self.assertEqual((target_after.back_text, target_after.audio_path), ('Answer', 'new.mp3'))
            self.assertEqual(models.TMAProgress.get_by_id(progress.id).interval, 27)
            self.assertEqual(models.TMAReviewHistory.get_by_id(history.id).card_id, target.id)
            self.assertEqual(models.TMA_Card.get_by_id(source.id).is_deleted, operation == cards.batch_move_cards)

    def test_legacy_delete_and_restore_preserve_content_progress_history_and_media(self):
        before = self.snapshot()
        self.assertTrue(cards.delete_card(self.legacy.id, 1))
        self.assertTrue(trash.restore_card(self.legacy.id, 1))
        self.assertEqual(cards.batch_delete_cards([self.legacy.id, self.legacy.id], 1)['count'], 1)
        self.assertTrue(trash.restore_card(self.legacy.id, 1))
        after = self.snapshot()
        for table in ('tmaprogress', 'tmareviewhistory', 'tmamedia'):
            self.assertEqual(after[table], before[table])
        old = dict(zip([column.name for column in database.get_columns('tma_card')], before['tma_card'][0]))
        current = dict(models.TMA_Card.get_by_id(self.legacy.id).__data__)
        for field in ('front_text', 'back_text', 'history', 'audio_path', 'is_deleted'):
            self.assertEqual(current[field], old[field])

    def test_legacy_restore_of_one_card_does_not_restore_siblings(self):
        sibling = self.source('Deleted sibling', is_deleted=True)
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.legacy.id).execute()
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.deck.id).execute()
        self.assertTrue(trash.restore_card(self.legacy.id, 1))
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(sibling.id).is_deleted)

    def test_card_http_endpoints_preserve_409_contract_and_all_rows(self):
        self.client.app.include_router(trash_router.router)
        requests = [('post', '/cards/batch-copy', {'card_ids': [self.legacy.id, self.native.id], 'target_deck_id': self.deck.id}),
            ('post', '/cards/batch-move', {'card_ids': [self.native.id], 'target_deck_id': self.deck.id}),
            ('post', '/cards/batch-delete', {'card_ids': [self.legacy.id, self.native.id]}),
            ('delete', f'/cards/{self.native.id}', None),
            ('post', f'/trash/card/{self.native.id}/restore', None)]
        for method, path, body in requests:
            before = self.snapshot()
            response = self.client.request(method, path, json=body)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
            self.assertEqual(self.snapshot(), before)

    def test_overwrite_http_refuses_native_target_before_partial_copy_or_move(self):
        source = self.source('plain projection')
        for endpoint in ('batch-copy', 'batch-move'):
            before = self.snapshot()
            response = self.client.post(f'/cards/{endpoint}', json={'card_ids': [self.legacy.id, source.id],
                'target_deck_id': self.other.id, 'on_duplicate': 'overwrite'})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(self.snapshot(), before)

    def test_legacy_http_operations_accept_duplicate_ids(self):
        self.client.app.include_router(trash_router.router)
        ids = [self.legacy.id, self.legacy.id]
        for endpoint, mode, expected in (('batch-copy', 'keep', 'created'), ('batch-move', 'keep', 'moved')):
            response = self.client.post(f'/cards/{endpoint}', json={'card_ids': ids,
                'target_deck_id': self.other.id, 'on_duplicate': mode})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()[expected], 1)
        response = self.client.post('/cards/batch-delete', json={'card_ids': ids})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(self.client.post(f'/trash/card/{self.legacy.id}/restore').status_code, 200)
        self.assertEqual(self.client.delete(f'/cards/{self.legacy.id}').status_code, 200)

    def test_cross_user_ids_and_mixed_unauthorized_http_requests_do_not_mutate(self):
        private = models.TMA_Deck.create(user_id=2, name='Private')
        foreign = models.TMA_Card.create(deck=private, front_text='Foreign', back_text='Answer')
        self.make_native(foreign.id)
        for endpoint in ('batch-copy', 'batch-move', 'batch-delete'):
            before = self.snapshot()
            response = self.client.post(f'/cards/{endpoint}', json={'card_ids': [self.legacy.id, foreign.id],
                                        'target_deck_id': self.other.id})
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(self.snapshot(), before)
        before = self.snapshot()
        self.assertFalse(cards.delete_card(foreign.id, 1))
        self.assertFalse(trash.restore_card(foreign.id, 1))
        self.assertEqual(self.snapshot(), before)

    def test_viewer_creator_cannot_move_or_delete_but_editor_can(self):
        models.TMA_Card.update(creator_id=2).where(models.TMA_Card.id == self.legacy.id).execute()
        grant = models.TMA_Collaborator.create(user_id=2, target_type='deck', target_id=self.deck.id,
                                             role='viewer', added_by=1)
        target = models.TMA_Deck.create(user_id=2, name='Viewer own target')
        before = self.snapshot()
        self.assertEqual(cards.batch_move_cards([self.legacy.id], target.id, 2)['count'], 0)
        self.assertEqual(cards.batch_delete_cards([self.legacy.id], 2)['count'], 0)
        self.assertFalse(cards.delete_card(self.legacy.id, 2))
        # Empty move historically touches deck timestamps, but no card may change.
        self.assertEqual(self.snapshot()['tma_card'], before['tma_card'])
        grant.role = 'editor'
        grant.save()
        self.assertTrue(cards.delete_card(self.legacy.id, 2))

    def test_target_permission_is_rechecked_by_services(self):
        target = models.TMA_Deck.create(user_id=2, name='Forbidden')
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            before = self.snapshot()
            with self.assertRaises(PermissionError):
                operation([self.legacy.id], target.id, 1)
            self.assertEqual(self.snapshot(), before)

    def test_forbidden_and_missing_source_ids_keep_service_filtering_behavior(self):
        private = models.TMA_Deck.create(user_id=2, name='Foreign')
        foreign = models.TMA_Card.create(deck=private, front_text='V2 foreign', back_text='Answer')
        self.make_native(foreign.id)
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            source = self.source(operation.__name__)
            self.assertEqual(operation([source.id, foreign.id, 99999], self.other.id, 1)['count'], 1)
        self.assertEqual(cards.batch_delete_cards([self.legacy.id, foreign.id, 99999], 1)['count'], 1)
        self.assertFalse(models.TMA_Card.get_by_id(foreign.id).is_deleted)

    def test_no_content_version_column_keeps_all_legacy_operations_working(self):
        if 'content_version' in models.TMA_Card._meta.fields:
            self.skipTest('Old schemas use the flag-off ORM')
        for column in ('content_version', 'content_v2', 'card_revision'):
            database.execute_sql(f'ALTER TABLE tma_card DROP COLUMN {column}')
        source = self.source('Plain projection')
        self.assertEqual(cards.batch_copy_cards([source.id], self.other.id, 1, 'overwrite')['updated'], 1)
        self.assertEqual(cards.batch_move_cards([self.legacy.id], self.other.id, 1)['moved'], 1)
        self.assertEqual(cards.batch_delete_cards([self.legacy.id], 1)['count'], 1)
        self.assertTrue(trash.restore_card(self.legacy.id, 1))
        self.assertTrue(cards.delete_card(source.id, 1))

    def test_postgres_lock_sql_precedes_reads_and_guard_runs_inside_transaction(self):
        # Exercise generated FOR UPDATE statements with the fixture executor.
        # This verifies query ordering/transaction scope, not PostgreSQL concurrency.
        execute = database.execute_sql
        statements = []
        def emulate_row_lock(sql, params=None, *args, **kwargs):
            statements.append((sql, database.in_transaction()))
            return execute(sql.replace(' FOR UPDATE', ''), params, *args, **kwargs)
        for operation in (lambda: cards.batch_copy_cards([self.native.id], self.deck.id, 1),
                          lambda: cards.batch_move_cards([self.native.id], self.deck.id, 1),
                          lambda: cards.batch_delete_cards([self.native.id], 1),
                          lambda: cards.delete_card(self.native.id, 1),
                          lambda: trash.restore_card(self.native.id, 1)):
            statements.clear()
            with patch.object(database, 'for_update', True), patch.object(database, 'execute_sql', emulate_row_lock):
                self.blocked(operation)
            locks = [(sql, active) for sql, active in statements if 'FOR UPDATE' in sql]
            self.assertGreaterEqual(len(locks), 2)
            self.assertTrue(all(active for _, active in locks))
            self.assertIn('ORDER BY', locks[0][0])
            self.assertNotIn('front_text', locks[0][0])
            self.assertIn('saved_content_version', locks[-1][0])

    def test_late_write_failure_rolls_back_overwrite_and_source_deletion(self):
        source = self.source('Legacy target')
        models.TMA_Card.create(deck=self.other, front_text='LEGACY target!', back_text='Old')
        for operation in (cards.batch_copy_cards, cards.batch_move_cards):
            before = self.snapshot()
            with patch.object(collaboration, 'touch_deck_and_parent_folders', side_effect=RuntimeError('late failure')):
                with self.assertRaisesRegex(RuntimeError, 'late failure'):
                    operation([source.id], self.other.id, 1, 'overwrite')
            self.assertEqual(self.snapshot(), before)


class CardOperationConcurrencyTests(unittest.TestCase):
    def test_sqlite_reservation_prevents_version_change_between_check_and_write(self):
        # Real independent connections against a disposable file, never live config.
        with tempfile.TemporaryDirectory() as directory:
            db = SqliteDatabase(str(Path(directory) / 'cards.db'), timeout=0.05)
            db.execute_sql('CREATE TABLE tma_card (id INTEGER PRIMARY KEY, content_version INTEGER)')
            db.execute_sql('INSERT INTO tma_card VALUES (1, 1)')
            checked, attempted = threading.Event(), threading.Event()
            def other_writer():
                checked.wait(2)
                try:
                    db.execute_sql('UPDATE tma_card SET content_version=2 WHERE id=1')
                    return 'wrote'
                except Exception as error:
                    return str(error)
                finally:
                    attempted.set()
                    db.close()
            with ThreadPoolExecutor(max_workers=1) as executor:
                competing = executor.submit(other_writer)
                with patch.object(cards, 'tma_db', db), db.bind_ctx([models.TMA_Card]):
                    with cards._card_operation_scope([1]):
                        fixtures.guard.require_legacy_cards([1])
                        checked.set()
                        self.assertTrue(attempted.wait(2))
                        self.assertIn('locked', competing.result())
                        self.assertEqual(db.execute_sql('SELECT content_version FROM tma_card').fetchone()[0], 1)
                # Reservation ends at commit, so the next writer can proceed.
                db.execute_sql('UPDATE tma_card SET content_version=2 WHERE id=1')
                self.assertEqual(db.execute_sql('SELECT content_version FROM tma_card').fetchone()[0], 2)
            db.close()


if __name__ == '__main__':
    unittest.main()
