"""Admin deletion guards on disposable DBs, testing decks, folders, users and collaborative bulk delete.

Run separately with STRUCTURED_CARDS_V2_SCHEMA_READY=false and true.
Verifies atomic rollback, mixed batches, nested folders, soft-deleted targets,
library deck preservation, old database schema, and absence of wide table locks.
"""
import json
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from scripts.tests import test_structured_cards_v2_guards as fixtures

models, database, guard = fixtures.models, fixtures.database, fixtures.guard
from tools.admin.routers import decks as admin_decks, folders as admin_folders, users as admin_users
from api.routers import collaborative as collab_router

EXTRA_TABLES = [
    models.LibraryCategory, models.Deck, models.Card,
    models.TMAUserPrompt, models.TMACustomPrompt, models.TMAFeedback, models.TMALinkedSession
]


class AdminDeleteGuardTests(unittest.TestCase):
    make_native = fixtures.StructuredWriteGuardTests.make_native
    snapshot = fixtures.StructuredWriteGuardTests.snapshot
    blocked = fixtures.StructuredWriteGuardTests.blocked

    def setUp(self):
        fixtures.StructuredWriteGuardTests.setUp(self)
        database.create_tables(EXTRA_TABLES)
        self.lib = models.Deck.create(name='Library Deck')
        self.lib_card = models.Card.create(id=1001, deck=self.lib, front_text='Lib Front', back_text='Lib Back')

        # Clean folder tree strictly with legacy items
        self.clean_folder = models.TMA_Folder.create(user_id=1, name='CleanRoot')
        self.clean_subfolder = models.TMA_Folder.create(user_id=1, parent=self.clean_folder, name='CleanSub')
        self.clean_deck1 = models.TMA_Deck.create(user_id=1, folder=self.clean_folder, name='CleanDeck1')
        self.clean_card1 = models.TMA_Card.create(deck=self.clean_deck1, front_text='C1 Front', back_text='C1 Back')
        self.clean_deck2 = models.TMA_Deck.create(user_id=1, folder=self.clean_subfolder, name='CleanDeck2')
        self.clean_card2 = models.TMA_Card.create(deck=self.clean_deck2, front_text='C2 Front', back_text='C2 Back')

        # Collaborators on clean items
        models.TMA_Collaborator.create(target_type='deck', target_id=self.clean_deck1.id,
                                       user_id=2, role='editor', added_by=1)
        models.TMA_Collaborator.create(target_type='folder', target_id=self.clean_folder.id,
                                       user_id=2, role='viewer', added_by=1)

        # Collaborators on fixture deck
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id,
                                       user_id=2, role='editor', added_by=1)
        models.TMA_Collaborator.create(target_type='folder', target_id=self.folder.id,
                                       user_id=2, role='viewer', added_by=1)

        os.environ["ADMIN_USER_ID"] = "1"

        app = FastAPI()
        app.include_router(admin_decks.router)
        app.include_router(admin_folders.router)
        app.include_router(admin_users.router)
        app.include_router(collab_router.router, prefix="/api")
        self.client = TestClient(app)

    def tearDown(self):
        try:
            database.drop_tables(EXTRA_TABLES)
        except Exception:
            pass
        fixtures.StructuredWriteGuardTests.tearDown(self)

    # -------------------------------------------------------------------------
    # 1. DELETE /api/admin/decks/{deck_id}
    # -------------------------------------------------------------------------

    def test_admin_delete_legacy_deck_success(self):
        resp = self.client.delete(f'/api/admin/decks/{self.deck.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'ok')

        refreshed_deck = models.TMA_Deck.get_by_id(self.deck.id)
        self.assertTrue(refreshed_deck.is_deleted)
        refreshed_card = models.TMA_Card.get_by_id(self.legacy.id)
        self.assertTrue(refreshed_card.is_deleted)
        # Collaborators cleaned up
        collab_count = models.TMA_Collaborator.select().where(
            (models.TMA_Collaborator.target_type == 'deck') &
            (models.TMA_Collaborator.target_id == self.deck.id)
        ).count()
        self.assertEqual(collab_count, 0)

    def test_admin_delete_v2_deck_blocked(self):
        # self.other has self.native (V2)
        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/decks/{self.other.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_unknown_version_deck_blocked(self):
        # Set card content_version to 99 (unknown)
        self.make_native(self.legacy.id, version=99)
        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/decks/{self.deck.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_soft_deleted_v2_deck_blocked(self):
        # If the deck was already soft-deleted, but contains V2 cards, admin delete still guards it
        self.other.is_deleted = True
        self.other.save()
        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/decks/{self.other.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_library_deck_success(self):
        # Library deck with lib_ prefix
        resp = self.client.delete(f'/api/admin/decks/lib_{self.lib.id}')
        self.assertEqual(resp.status_code, 200)
        refreshed_lib = models.Deck.get_by_id(self.lib.id)
        self.assertTrue(refreshed_lib.is_deleted)
        refreshed_card = models.Card.get_by_id(self.lib_card.id)
        self.assertTrue(refreshed_card.is_deleted)

    def test_admin_delete_deck_not_found(self):
        resp = self.client.delete('/api/admin/decks/999999')
        self.assertEqual(resp.status_code, 404)

    # -------------------------------------------------------------------------
    # 2. POST /api/admin/decks/batch-delete
    # -------------------------------------------------------------------------

    def test_admin_batch_delete_legacy_decks_success(self):
        payload = {'deck_ids': [str(self.deck.id), str(self.clean_deck1.id)]}
        resp = self.client.post('/api/admin/decks/batch-delete', json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['deleted_count'], 2)

        self.assertTrue(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertTrue(models.TMA_Deck.get_by_id(self.clean_deck1.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(self.legacy.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(self.clean_card1.id).is_deleted)

    def test_admin_batch_delete_mixed_decks_blocked_atomic_rollback(self):
        # Batch contains legacy deck AND v2 deck (self.other)
        before = self.snapshot()
        payload = {'deck_ids': [str(self.deck.id), str(self.other.id)]}
        resp = self.client.post('/api/admin/decks/batch-delete', json=payload)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')

        # Atomic rollback: neither deck nor card is touched
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        self.assertFalse(models.TMA_Deck.get_by_id(self.other.id).is_deleted)

    def test_admin_batch_delete_mixed_library_and_v2_blocked(self):
        # Batch contains library deck AND v2 deck
        before = self.snapshot()
        payload = {'deck_ids': [f'lib_{self.lib.id}', str(self.other.id)]}
        resp = self.client.post('/api/admin/decks/batch-delete', json=payload)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')

        # Library deck must NOT be deleted!
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(models.Deck.get_by_id(self.lib.id).is_deleted)

    def test_admin_batch_delete_empty_list(self):
        resp = self.client.post('/api/admin/decks/batch-delete', json={'deck_ids': []})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['deleted_count'], 0)

    # -------------------------------------------------------------------------
    # 3. DELETE /api/admin/folders/{folder_id}
    # -------------------------------------------------------------------------

    def test_admin_delete_legacy_folder_tree_success(self):
        # clean_folder has clean_deck1 and clean_subfolder with clean_deck2
        resp = self.client.delete(f'/api/admin/folders/{self.clean_folder.id}')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['deleted_folders_count'], 2)  # clean_folder + clean_subfolder
        self.assertEqual(data['deleted_decks_count'], 2)    # clean_deck1 + clean_deck2

        self.assertTrue(models.TMA_Folder.get_by_id(self.clean_folder.id).is_deleted)
        self.assertTrue(models.TMA_Folder.get_by_id(self.clean_subfolder.id).is_deleted)
        self.assertTrue(models.TMA_Deck.get_by_id(self.clean_deck1.id).is_deleted)
        self.assertTrue(models.TMA_Deck.get_by_id(self.clean_deck2.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(self.clean_card1.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(self.clean_card2.id).is_deleted)

        # Collaborators deleted
        self.assertEqual(models.TMA_Collaborator.select().where(
            models.TMA_Collaborator.target_id.in_([self.clean_folder.id, self.clean_deck1.id])
        ).count(), 0)

    def test_admin_delete_folder_with_direct_v2_deck_blocked(self):
        # self.folder contains self.other which has self.native (V2)
        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/folders/{self.folder.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_folder_with_nested_subfolder_v2_blocked(self):
        # Create a subfolder under clean_folder and put a V2 deck inside it
        v2_sub = models.TMA_Folder.create(user_id=1, parent=self.clean_subfolder, name='V2Sub')
        v2_deck = models.TMA_Deck.create(user_id=1, folder=v2_sub, name='V2Deck')
        v2_card = models.TMA_Card.create(deck=v2_deck, front_text='V2 Nested', back_text='V2 Back')
        self.make_native(v2_card.id)

        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/folders/{self.clean_folder.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_folder_with_soft_deleted_v2_deck_blocked(self):
        # Put a soft-deleted deck with V2 card in clean_subfolder
        v2_deck = models.TMA_Deck.create(user_id=1, folder=self.clean_subfolder, name='DeletedV2Deck', is_deleted=True)
        v2_card = models.TMA_Card.create(deck=v2_deck, front_text='V2 in deleted deck', back_text='Ans')
        self.make_native(v2_card.id)

        before = self.snapshot()
        resp = self.client.delete(f'/api/admin/folders/{self.clean_folder.id}')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_folder_not_found(self):
        resp = self.client.delete('/api/admin/folders/999999')
        self.assertEqual(resp.status_code, 404)

    # -------------------------------------------------------------------------
    # 4. POST /api/admin/folders/batch-delete
    # -------------------------------------------------------------------------

    def test_admin_batch_delete_legacy_folders_success(self):
        f2 = models.TMA_Folder.create(user_id=1, name='Folder2')
        d2 = models.TMA_Deck.create(user_id=1, folder=f2, name='Deck2')
        c2 = models.TMA_Card.create(deck=d2, front_text='F2 Front', back_text='F2 Back')

        resp = self.client.post('/api/admin/folders/batch-delete', json={'folder_ids': [self.clean_folder.id, f2.id]})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(models.TMA_Folder.get_by_id(self.clean_folder.id).is_deleted)
        self.assertTrue(models.TMA_Folder.get_by_id(self.clean_subfolder.id).is_deleted)
        self.assertTrue(models.TMA_Folder.get_by_id(f2.id).is_deleted)
        self.assertTrue(models.TMA_Deck.get_by_id(d2.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(c2.id).is_deleted)

    def test_admin_batch_delete_mixed_folders_blocked(self):
        # self.clean_folder is legacy, self.folder contains V2 (self.other)
        before = self.snapshot()

        resp = self.client.post('/api/admin/folders/batch-delete', json={'folder_ids': [self.clean_folder.id, self.folder.id]})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')

        # Atomic rollback: clean_folder must NOT be deleted
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(models.TMA_Folder.get_by_id(self.clean_folder.id).is_deleted)

    # -------------------------------------------------------------------------
    # 5. POST /api/collaborative/admin/folders/bulk-delete (Collaborative)
    # -------------------------------------------------------------------------

    def test_collaborative_bulk_delete_legacy_folders_success(self):
        resp = self.client.post('/api/collaborative/admin/folders/bulk-delete',
                                json={'folder_ids': [self.clean_folder.id], 'user_ids': [1]})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['folders_deleted'], 1)
        self.assertTrue(models.TMA_Folder.get_by_id(self.clean_folder.id).is_deleted)

    def test_collaborative_bulk_delete_v2_blocked(self):
        before = self.snapshot()
        resp = self.client.post('/api/collaborative/admin/folders/bulk-delete',
                                json={'folder_ids': [self.folder.id], 'user_ids': [1]})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_collaborative_bulk_delete_forbidden_non_admin(self):
        with patch.dict(os.environ, {"ADMIN_USER_ID": "999"}):
            resp = self.client.post('/api/collaborative/admin/folders/bulk-delete',
                                    json={'folder_ids': [self.folder.id], 'user_ids': [1]})
            self.assertEqual(resp.status_code, 403)

    # -------------------------------------------------------------------------
    # 6. Admin User Deletions & Purge (users.py)
    # -------------------------------------------------------------------------

    def test_admin_delete_single_user_with_v2_blocked(self):
        # User 1 owns self.other which has self.native (V2)
        before = self.snapshot()
        resp = self.client.delete('/api/admin/users/1')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_delete_single_user_legacy_success(self):
        # User 2 owns no cards
        resp = self.client.delete('/api/admin/users/2')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(models.TMAUser.get_or_none(models.TMAUser.user_id == 2))

    def test_admin_batch_delete_users_with_v2_blocked(self):
        before = self.snapshot()
        resp = self.client.post('/api/admin/users/batch-delete', json={'user_ids': ['1', '2']})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_purge_soft_deleted_items_with_v2_blocked(self):
        # Mark V2 card as soft-deleted
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.native.id).execute()

        before = self.snapshot()
        resp = self.client.post('/api/admin/purge-deleted')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    def test_admin_purge_soft_deleted_items_legacy_success(self):
        # Mark clean items as deleted while native is active (is_deleted == False)
        self.clean_card1.is_deleted = True
        self.clean_card1.save()
        self.clean_deck1.is_deleted = True
        self.clean_deck1.save()

        # purge-deleted only purges items where is_deleted == True!
        resp = self.client.post('/api/admin/purge-deleted')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(models.TMA_Card.get_or_none(models.TMA_Card.id == self.clean_card1.id))
        self.assertIsNone(models.TMA_Deck.get_or_none(models.TMA_Deck.id == self.clean_deck1.id))

    def test_admin_cleanup_guests_with_v2_blocked(self):
        u_guest = models.TMAUser.get_by_id(1)
        u_guest.is_guest = True
        u_guest.save()

        before = self.snapshot()
        resp = self.client.post('/api/admin/users/cleanup-guests')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['detail']['code'], 'legacy_card_write_blocked')
        self.assertEqual(self.snapshot(), before)

    # -------------------------------------------------------------------------
    # 7. Old database schema compatibility (no content_version column)
    # -------------------------------------------------------------------------

    def test_old_database_without_content_version_allows_admin_delete(self):
        if 'content_version' in models.TMA_Card._meta.fields:
            self.skipTest('schema-ready model requires its prepared schema')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN content_version')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN content_v2')
        database.execute_sql('ALTER TABLE tma_card DROP COLUMN card_revision')

        res = admin_decks.delete_deck(str(self.clean_deck1.id))
        self.assertEqual(res['status'], 'ok')
        self.assertTrue(models.TMA_Deck.get_by_id(self.clean_deck1.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(self.clean_card1.id).is_deleted)

    # -------------------------------------------------------------------------
    # 8. No Wide Table Locks Policy
    # -------------------------------------------------------------------------

    def test_admin_deletions_do_not_issue_table_locks(self):
        # In contrast to user lifecycle (lock_membership=True), admin uses lock_membership=False
        sql_log = []
        orig_execute = database.execute_sql

        def tracking_execute(sql, *args, **kwargs):
            sql_log.append(str(sql))
            return orig_execute(sql, *args, **kwargs)

        with patch.object(database, 'execute_sql', side_effect=tracking_execute):
            resp = self.client.delete(f'/api/admin/decks/{self.deck.id}')
            self.assertEqual(resp.status_code, 200)

        # Confirm no LOCK TABLE was issued
        table_locks = [s for s in sql_log if 'LOCK TABLE' in s.upper()]
        self.assertEqual(table_locks, [], 'Admin delete must not acquire wide table locks!')


if __name__ == '__main__':
    unittest.main()
