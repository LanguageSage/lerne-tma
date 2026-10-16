"""Deck/folder/trash guards on disposable DBs, with bootstrap replaced before imports.

Run in its own process with schema-ready=false and true. PostgreSQL lock SQL is
checked via a fixture executor; that is not a real PostgreSQL concurrency test.
"""
import importlib
import re
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from peewee import SqliteDatabase

from scripts.tests import test_structured_cards_v2_guards as fixtures

models, database, guard = fixtures.models, fixtures.database, fixtures.guard
# Stage 3A fixtures stub decks to prevent starter creation. Load the real module
# only after api.database and api.models have their isolated owners installed.
del sys.modules['api.services.decks']
decks = importlib.import_module('api.services.decks')
folders = importlib.import_module('api.services.folders')
trash = importlib.import_module('api.services.trash')
decks_router = importlib.import_module('api.routers.decks')
folders_router = importlib.import_module('api.routers.folders')
trash_router = importlib.import_module('api.routers.trash')
fixtures.services.delete_deck = decks.delete_deck
fixtures.services.delete_folder = folders.delete_folder
fixtures.services.trash = trash


class LifecycleGuardTests(unittest.TestCase):
    tearDown = fixtures.StructuredWriteGuardTests.tearDown
    make_native = fixtures.StructuredWriteGuardTests.make_native
    snapshot = fixtures.StructuredWriteGuardTests.snapshot
    blocked = fixtures.StructuredWriteGuardTests.blocked

    def setUp(self):
        fixtures.StructuredWriteGuardTests.setUp(self)
        for router in (decks_router, folders_router, trash_router):
            self.client.app.include_router(router.router)
        self.folder.share_id = 'f_test'
        self.folder.save()
        models.TMAMedia.create(filename='preview_f_test.png', folder='previews', content=b'preview')
        models.TMAMedia.create(filename='front.mp3', folder='audio', content=b'audio')
        models.TMA_Collaborator.create(target_type='folder', target_id=self.folder.id,
                                       user_id=2, role='editor')

    def no_dml_blocked(self, operation):
        statements = []
        database.connection().set_trace_callback(statements.append)
        try:
            self.blocked(operation)
        finally:
            database.connection().set_trace_callback(None)
        self.assertFalse([sql for sql in statements if re.match(r'\s*(INSERT|UPDATE|DELETE)\b', sql, re.I)])

    def nested_native(self):
        child = models.TMA_Folder.create(user_id=1, name='Child', parent=self.folder)
        leaf = models.TMA_Folder.create(user_id=1, name='Leaf', parent=child, is_deleted=True)
        self.other.folder = leaf
        self.other.is_deleted = True
        self.other.save()
        return child, leaf

    def test_delete_legacy_deck_preserves_content_srs_history_media_and_grants(self):
        sibling = models.TMA_Card.create(deck=self.deck, front_text='Already deleted',
                                         back_text='A', is_deleted=True)
        before = self.snapshot()
        self.assertTrue(decks.delete_deck(self.deck.id, 1))
        self.assertTrue(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        for card in (self.legacy, sibling):
            current = models.TMA_Card.get_by_id(card.id)
            self.assertTrue(current.is_deleted)
            self.assertEqual(current.front_text, card.front_text)
        after = self.snapshot()
        for table in ('tmaprogress', 'tmareviewhistory', 'tmamedia', 'tma_collaborator'):
            self.assertEqual(after[table], before[table])
        self.assertEqual(after['tma_card'][1], before['tma_card'][1])

    def test_delete_deck_checks_live_and_deleted_native_cards(self):
        for deleted in (False, True):
            models.TMA_Card.update(is_deleted=deleted).where(models.TMA_Card.id == self.native.id).execute()
            self.no_dml_blocked(lambda: decks.delete_deck(self.other.id, 1))

    def test_delete_folder_checks_deleted_nested_folders_and_decks_before_preview_delete(self):
        self.nested_native()
        self.no_dml_blocked(lambda: folders.delete_folder(self.folder.id, 1))

    def test_legacy_folder_delete_preserves_existing_tombstone_semantics(self):
        child, leaf = self.nested_native()
        database.execute_sql('UPDATE tma_card SET content_version=1, content_v2=NULL WHERE id=?', (self.native.id,))
        outside = models.TMA_Deck.create(user_id=1, name='Outside')
        before = self.snapshot()
        self.assertTrue(folders.delete_folder(self.folder.id, 1))
        for folder in (self.folder, child, leaf):
            self.assertTrue(models.TMA_Folder.get_by_id(folder.id).is_deleted)
        for deck in (self.deck, self.other):
            self.assertTrue(models.TMA_Deck.get_by_id(deck.id).is_deleted)
        self.assertFalse(models.TMA_Deck.get_by_id(outside.id).is_deleted)
        self.assertEqual(self.snapshot()['tma_card'], before['tma_card'])
        self.assertFalse(models.TMAMedia.select().where(models.TMAMedia.folder == 'previews').exists())
        for table in ('tmaprogress', 'tmareviewhistory', 'tma_collaborator'):
            self.assertEqual(self.snapshot()[table], before[table])

    def test_restore_legacy_deck_restores_all_cards_without_srs_reset(self):
        decks.delete_deck(self.deck.id, 1)
        before = self.snapshot()
        self.assertTrue(trash.restore_deck(self.deck.id, 1))
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(self.legacy.id).is_deleted)
        for table in ('tmaprogress', 'tmareviewhistory', 'tmamedia', 'tma_collaborator'):
            self.assertEqual(self.snapshot()[table], before[table])

    def test_restore_deck_checks_every_card_even_live_cards_or_active_deck(self):
        for deleted in (False, True):
            models.TMA_Deck.update(is_deleted=deleted).where(models.TMA_Deck.id == self.other.id).execute()
            self.no_dml_blocked(lambda: trash.restore_deck(self.other.id, 1))

    def test_clear_trash_mixed_versions_refuses_before_srs_or_card_deletion(self):
        decks.delete_deck(self.deck.id, 1)
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.native.id).execute()
        self.no_dml_blocked(lambda: trash.clear_trash(1))

    def test_clear_trash_checks_live_cards_inside_deleted_decks(self):
        decks.delete_deck(self.deck.id, 1)
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.other.id).execute()
        self.assertFalse(models.TMA_Card.get_by_id(self.native.id).is_deleted)
        self.no_dml_blocked(lambda: trash.clear_trash(1))

    def test_legacy_clear_trash_deletes_only_owned_trash_and_its_srs(self):
        decks.delete_deck(self.deck.id, 1)
        active = models.TMA_Deck.create(user_id=1, name='Active')
        deleted_card = models.TMA_Card.create(deck=active, front_text='Deleted', back_text='A', is_deleted=True)
        models.TMAProgress.create(card_id=deleted_card.id, user_id=2, interval=3)
        # Live legacy cards in deleted decks also belong to the trash scope.
        live = models.TMA_Card.create(deck=self.deck, front_text='Live in trash', back_text='A')
        foreign = models.TMA_Deck.create(user_id=2, name='Foreign trash', is_deleted=True)
        private = models.TMA_Card.create(deck=foreign, front_text='Private', back_text='A', is_deleted=True)
        self.make_native(private.id)
        models.TMAProgress.create(card_id=private.id, user_id=2, interval=11)
        before = self.snapshot()
        self.assertTrue(trash.clear_trash(1))
        self.assertIsNone(models.TMA_Deck.get_or_none(self.deck.id))
        for card in (self.legacy, deleted_card, live):
            self.assertIsNone(models.TMA_Card.get_or_none(card.id))
            self.assertFalse(models.TMAProgress.select().where(models.TMAProgress.card_id == card.id).exists())
        self.assertIsNotNone(models.TMA_Deck.get_or_none(active.id))
        self.assertIsNotNone(models.TMA_Deck.get_or_none(foreign.id))
        self.assertIsNotNone(models.TMA_Card.get_or_none(self.native.id))
        self.assertEqual(models.TMAProgress.get(models.TMAProgress.card_id == private.id).interval, 11)
        for table in ('tmareviewhistory', 'tmamedia', 'tma_collaborator'):
            self.assertEqual(self.snapshot()[table], before[table])

    def test_empty_trash_and_empty_decks_and_folders_succeed(self):
        before = self.snapshot()
        self.assertTrue(trash.clear_trash(1))
        self.assertEqual(self.snapshot(), before)
        empty = models.TMA_Deck.create(user_id=1, name='Empty')
        self.assertTrue(decks.delete_deck(empty.id, 1))
        self.assertTrue(trash.restore_deck(empty.id, 1))
        empty_folder = models.TMA_Folder.create(user_id=1, name='Empty')
        self.assertTrue(folders.delete_folder(empty_folder.id, 1))

    def test_unknown_and_null_versions_block_all_lifecycle_operations(self):
        versions = (37,) if 'content_version' in models.TMA_Card._meta.fields else (37, None)
        for version in versions:
            self.make_native(self.native.id, version)
            for operation in (lambda: decks.delete_deck(self.other.id, 1),
                              lambda: folders.delete_folder(self.folder.id, 1),
                              lambda: trash.restore_deck(self.other.id, 1)):
                self.no_dml_blocked(operation)
            models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.other.id).execute()
            self.no_dml_blocked(lambda: trash.clear_trash(1))
            models.TMA_Deck.update(is_deleted=False).where(models.TMA_Deck.id == self.other.id).execute()

    def test_http_conflicts_preserve_all_rows_and_error_contract(self):
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.native.id).execute()
        for method, path in (('delete', f'/decks/{self.other.id}'),
                             ('delete', f'/folders/{self.folder.id}'),
                             ('post', f'/trash/deck/{self.other.id}/restore'),
                             ('delete', '/trash/clear')):
            before = self.snapshot()
            response = self.client.request(method, path)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
            self.assertEqual(self.snapshot(), before)

    def test_http_legacy_delete_restore_folder_delete_and_clear(self):
        for method, path in (('delete', f'/decks/{self.deck.id}'),
                             ('post', f'/trash/deck/{self.deck.id}/restore'),
                             ('delete', f'/decks/{self.deck.id}'),
                             ('delete', '/trash/clear')):
            response = self.client.request(method, path)
            self.assertEqual(response.status_code, 200, response.text)
        folder = models.TMA_Folder.create(user_id=1, name='Empty')
        self.assertEqual(self.client.delete(f'/folders/{folder.id}').status_code, 200)

    def test_unauthorized_or_missing_parents_do_not_reveal_native_versions(self):
        foreign_folder = models.TMA_Folder.create(user_id=2, name='Private')
        foreign = models.TMA_Deck.create(user_id=2, folder=foreign_folder, name='Private')
        card = models.TMA_Card.create(deck=foreign, front_text='Private', back_text='A')
        self.make_native(card.id)
        for folder_id, deck_id in ((foreign_folder.id, foreign.id), (99999, 99999)):
            for method, path, expected in (
                ('delete', f'/decks/{deck_id}', 403),
                ('delete', f'/folders/{folder_id}', 403 if folder_id != 99999 else 404),
                ('post', f'/trash/deck/{deck_id}/restore', 404)):
                before = self.snapshot()
                response = self.client.request(method, path)
                self.assertEqual(response.status_code, expected, response.text)
                self.assertNotIn('legacy_card_write_blocked', response.text)
                self.assertEqual(self.snapshot(), before)

    def test_editor_deck_delete_is_preserved_but_folder_delete_and_restore_are_owner_only(self):
        self.no_dml_blocked(lambda: decks.delete_deck(self.other.id, 2))
        before = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            folders.delete_folder(self.folder.id, 2)
        self.assertEqual(error.exception.status_code, 403)
        self.assertFalse(trash.restore_deck(self.other.id, 2))
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(decks.delete_deck(self.deck.id, 2))

    def test_global_viewer_cannot_delete_native_deck_or_folder(self):
        self.folder.access_scope = 'global_readonly'
        self.folder.save()
        for operation in (lambda: decks.delete_deck(self.other.id, 2),
                          lambda: folders.delete_folder(self.folder.id, 2)):
            before = self.snapshot()
            with self.assertRaises(HTTPException) as error:
                operation()
            self.assertEqual(error.exception.status_code, 403)
            self.assertEqual(self.snapshot(), before)

    def test_folder_scope_excludes_foreign_owned_decks_and_subtrees(self):
        # Preserve the existing owner-filtered cascade; foreign rows are untouched.
        database.execute_sql('UPDATE tma_card SET content_version=1, content_v2=NULL WHERE id=?', (self.native.id,))
        foreign = models.TMA_Deck.create(user_id=2, folder=self.folder, name='Foreign')
        card = models.TMA_Card.create(deck=foreign, front_text='Foreign', back_text='A')
        self.make_native(card.id)
        self.assertTrue(folders.delete_folder(self.folder.id, 1))
        self.assertFalse(models.TMA_Deck.get_by_id(foreign.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(card.id).is_deleted)

    def test_inbox_protection_is_preserved(self):
        inbox = models.TMA_Folder.create(user_id=1, name='📥 Входящие')
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Входящие'):
            folders.delete_folder(inbox.id, 1)
        self.assertEqual(self.snapshot(), before)

    def test_late_database_failures_roll_back_each_lifecycle_operation(self):
        def fail_at(pattern, operation):
            before = self.snapshot()
            execute = database.execute_sql
            def execute_or_fail(sql, *args, **kwargs):
                if re.search(pattern, sql):
                    raise RuntimeError('late write failure')
                return execute(sql, *args, **kwargs)
            with patch.object(database, 'execute_sql', execute_or_fail):
                with self.assertRaisesRegex(RuntimeError, 'late write failure'):
                    operation()
            self.assertEqual(self.snapshot(), before)
        fail_at(r'UPDATE "tma_deck"', lambda: decks.delete_deck(self.deck.id, 1))
        decks.delete_deck(self.deck.id, 1)
        fail_at(r'UPDATE "tma_card"', lambda: trash.restore_deck(self.deck.id, 1))
        fail_at(r'DELETE FROM "tma_deck"', lambda: trash.clear_trash(1))
        empty = models.TMA_Folder.create(user_id=1, name='Preview', share_id='f_empty')
        fail_at(r'DELETE FROM "tmamedia"', lambda: folders.delete_folder(empty.id, 1))

    def sync_request(self, request_type, **kwargs):
        return request_type(request_id=uuid4(), **kwargs)

    def test_both_sync_routes_block_parent_only_tombstones_and_restore_echoes(self):
        for route in ('/sync/push', '/sync/v2/push'):
            for name, item in (('decks', self.other), ('folders', self.folder)):
                for deleted in (True, False):
                    before = self.snapshot()
                    response = self.client.post(route, json={'request_id': str(uuid4()),
                        name: [{'id': item.id, 'name': 'Changed', 'is_deleted': deleted}],
                        'cards': [{'id': -99, 'deck_id': self.deck.id, 'front_text': 'New', 'back_text': 'A'}]})
                    self.assertEqual(response.status_code, 409, response.text)
                    self.assertEqual(response.json()['detail']['code'], 'legacy_card_write_blocked')
                    self.assertEqual(self.snapshot(), before)

    def test_sync_parent_preflight_has_no_dml_even_before_receipt_or_new_parents(self):
        self.nested_native()
        for request_type, operation in ((fixtures.sync_router.PushRequest, fixtures.legacy_sync.execute_sync_push),
                                        (fixtures.sync_router.OfflinePushRequest, fixtures.offline.push_offline)):
            request = self.sync_request(request_type,
                folders=[{'id': -90, 'name': 'New'}, {'id': self.folder.id, 'name': 'Root', 'is_deleted': True}],
                decks=[{'id': -91, 'name': 'New', 'folder_id': -90}])
            self.no_dml_blocked(lambda: operation(request, 1))

    def test_sync_unknown_parent_contents_fail_closed(self):
        self.make_native(self.native.id, 73)
        for request_type, operation in ((fixtures.sync_router.PushRequest, fixtures.legacy_sync.execute_sync_push),
                                        (fixtures.sync_router.OfflinePushRequest, fixtures.offline.push_offline)):
            request = self.sync_request(request_type, decks=[{'id': self.other.id, 'name': 'Deck', 'is_deleted': True}])
            self.no_dml_blocked(lambda: operation(request, 1))

    def test_offline_restore_parent_only_is_blocked_before_receipt(self):
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.other.id).execute()
        request = self.sync_request(fixtures.sync_router.OfflinePushRequest,
            decks=[{'id': self.other.id, 'name': 'Deck', 'is_deleted': False}])
        self.no_dml_blocked(lambda: fixtures.offline.push_offline(request, 1))

    def test_sync_parent_permissions_precede_version_lookup(self):
        foreign = models.TMA_Deck.create(user_id=2, name='Foreign')
        card = models.TMA_Card.create(deck=foreign, front_text='Private', back_text='A')
        self.make_native(card.id)
        for route in ('/sync/push', '/sync/v2/push'):
            before = self.snapshot()
            response = self.client.post(route, json={'request_id': str(uuid4()),
                'decks': [{'id': foreign.id, 'name': 'Private', 'is_deleted': True}]})
            self.assertEqual(response.status_code, 403, response.text)
            self.assertNotIn('legacy_card_write_blocked', response.text)
            self.assertEqual(self.snapshot(), before)

    def test_offline_receipt_replay_rechecks_temp_parent_and_nested_cards(self):
        for kind in ('deck', 'folder'):
            with self.subTest(kind=kind):
                request = self.sync_request(fixtures.sync_router.OfflinePushRequest,
                    **{kind + 's': [{'id': -10, 'name': 'New'}]})
                response = fixtures.offline.push_offline(request, 1)
                parent_id = response['mappings'][kind + 's']['-10']
                deck = (models.TMA_Deck.get_by_id(parent_id) if kind == 'deck' else
                        models.TMA_Deck.create(user_id=1, folder=parent_id, name='Nested'))
                card = models.TMA_Card.create(deck=deck, front_text='Now V2', back_text='A')
                self.make_native(card.id)
                self.no_dml_blocked(lambda: fixtures.offline.push_offline(request, 1))

    def test_receipt_replay_checks_parent_permissions_before_native_contents(self):
        request = self.sync_request(fixtures.sync_router.OfflinePushRequest,
            decks=[{'id': -10, 'name': 'Initially owned'}])
        response = fixtures.offline.push_offline(request, 1)
        parent_id = response['mappings']['decks']['-10']
        card = models.TMA_Card.create(deck=parent_id, front_text='Private now', back_text='A')
        self.make_native(card.id)
        models.TMA_Deck.update(user_id=2).where(models.TMA_Deck.id == parent_id).execute()
        before = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            fixtures.offline.push_offline(request, 1)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.snapshot(), before)

    def test_offline_legacy_parent_delete_restore_and_retry_work(self):
        for deleted in (True, False):
            request = self.sync_request(fixtures.sync_router.OfflinePushRequest,
                decks=[{'id': self.deck.id, 'name': 'Legacy', 'is_deleted': deleted}])
            result = fixtures.offline.push_offline(request, 1)
            self.assertEqual(fixtures.offline.push_offline(request, 1), result)
            self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).is_deleted, deleted)

    def test_old_sync_implicit_is_deleted_is_guarded_but_offline_metadata_only_is_unchanged(self):
        request = fixtures.sync_router.PushRequest(decks=[{'id': self.other.id, 'name': 'Echo'}])
        self.no_dml_blocked(lambda: fixtures.legacy_sync.execute_sync_push(request, 1))
        request = self.sync_request(fixtures.sync_router.OfflinePushRequest,
            decks=[{'id': self.other.id, 'name': 'Metadata only'}])
        self.assertEqual(fixtures.offline.push_offline(request, 1)['status'], 'success')

    def test_old_schema_without_columns_keeps_lifecycle_and_parent_sync_working(self):
        if 'content_version' in models.TMA_Card._meta.fields:
            self.skipTest('Old schemas require flag-off ORM')
        for column in ('content_version', 'content_v2', 'card_revision'):
            database.execute_sql(f'ALTER TABLE tma_card DROP COLUMN {column}')
        self.assertTrue(decks.delete_deck(self.deck.id, 1))
        self.assertTrue(trash.restore_deck(self.deck.id, 1))
        for request_type, operation in ((fixtures.sync_router.PushRequest, fixtures.legacy_sync.execute_sync_push),
                                        (fixtures.sync_router.OfflinePushRequest, fixtures.offline.push_offline)):
            request = self.sync_request(request_type, decks=[{'id': self.deck.id, 'name': 'Legacy', 'is_deleted': False}])
            self.assertEqual(operation(request, 1)['status'], 'success')
        self.assertTrue(folders.delete_folder(self.folder.id, 1))
        self.assertTrue(trash.clear_trash(1))

    def test_postgres_table_locks_precede_permission_and_membership_reads(self):
        execute = database.execute_sql
        statements = []
        def emulate(sql, params=None, *args, **kwargs):
            statements.append((sql, database.in_transaction()))
            if sql.startswith('LOCK TABLE '):
                return execute('SELECT 1')
            return execute(sql.replace(' FOR UPDATE', ''), params, *args, **kwargs)
        models.TMA_Deck.update(is_deleted=True).where(models.TMA_Deck.id == self.other.id).execute()
        for operation in (lambda: decks.delete_deck(self.deck.id, 1),
                          lambda: folders.delete_folder(self.folder.id, 1),
                          lambda: trash.restore_deck(self.other.id, 1),
                          lambda: trash.clear_trash(1),
                          lambda: fixtures.offline.push_offline(self.sync_request(
                              fixtures.sync_router.OfflinePushRequest, decks=[{
                                  'id': self.other.id, 'name': 'Echo', 'is_deleted': False}]), 1),
                          lambda: fixtures.legacy_sync.execute_sync_push(fixtures.sync_router.PushRequest(
                              folders=[{'id': self.folder.id, 'name': 'Root', 'is_deleted': True}]), 1)):
            statements.clear()
            with patch.object(database, 'for_update', True), patch.object(database, 'execute_sql', emulate):
                try:
                    operation()
                except HTTPException as error:
                    self.assertEqual(error.status_code, 409)
            locks = [(i, sql, active) for i, (sql, active) in enumerate(statements) if sql.startswith('LOCK TABLE')]
            self.assertEqual(len(locks), 1)
            index, sql, active = locks[0]
            self.assertTrue(active)
            self.assertEqual(sql, 'LOCK TABLE "tma_folder", "tma_deck", "tma_card" IN SHARE ROW EXCLUSIVE MODE')
            self.assertFalse([sql for sql, _ in statements[:index] if sql.startswith(('SELECT', 'UPDATE', 'DELETE'))])


class LifecycleConcurrencyTests(unittest.TestCase):
    def test_sqlite_scope_blocks_card_insert_move_and_new_deck_or_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            db = SqliteDatabase(str(Path(directory) / 'lifecycle.db'), timeout=0.05)
            with db.bind_ctx(fixtures.TABLES):
                with patch.object(models.TMA_Card._meta, 'constraints', []):
                    db.create_tables(fixtures.TABLES)
                if 'content_version' not in models.TMA_Card._meta.fields:
                    db.execute_sql('ALTER TABLE tma_card ADD COLUMN content_version INTEGER DEFAULT 1')
                folder = models.TMA_Folder.create(user_id=1, name='Root')
                source = models.TMA_Deck.create(user_id=1, name='Source')
                target = models.TMA_Deck.create(user_id=1, name='Target', folder=folder)
                card = models.TMA_Card.create(deck=source, front_text='Move', back_text='A')
                mutations = [
                    lambda: models.TMA_Card.create(deck=target.id, front_text='New', back_text='A'),
                    lambda: models.TMA_Card.update(deck=target.id).where(models.TMA_Card.id == card.id).execute(),
                    lambda: models.TMA_Deck.update(folder=folder.id).where(models.TMA_Deck.id == source.id).execute(),
                    lambda: models.TMA_Deck.create(user_id=1, folder=folder.id, name='New deck'),
                    lambda: models.TMA_Folder.create(user_id=1, parent=folder.id, name='New child'),
                    lambda: db.execute_sql('UPDATE tma_card SET content_version=2 WHERE id=?', (card.id,)),
                ]
                def competing_write(operation):
                    try:
                        operation()
                        return 'wrote'
                    except Exception as error:
                        return str(error)
                    finally:
                        db.close()
                with ThreadPoolExecutor(max_workers=1) as executor:
                    with guard.legacy_lifecycle_scope():
                        self.assertEqual(models.TMA_Card.select().count(), 1)
                        for operation in mutations:
                            result = executor.submit(competing_write, operation).result(timeout=3)
                            self.assertIn('locked', result)
                        self.assertEqual(models.TMA_Card.get_by_id(card.id).deck_id, source.id)
                    # Every competing operation must be valid and succeed once
                    # the reservation ends, rather than fail on fixture defaults.
                    for operation in mutations:
                        self.assertEqual(executor.submit(competing_write, operation).result(timeout=3), 'wrote')
                    self.assertEqual(models.TMA_Card.get_by_id(card.id).deck_id, target.id)
                db.close()


if __name__ == '__main__':
    unittest.main()
