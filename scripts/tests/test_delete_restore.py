"""Comprehensive tests for Native V2 delete & restore semantics (Audit A-01)."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from native_fixture import content, sqlite_native
from api import models
from api.dependencies.auth import get_user_id
from api.routers import cards, decks, folders, share, study, sync, trash
from api.services.structured_card_api import content_response, lifecycle_state


class DeleteRestoreSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ADMIN_USER_ID='999')
        self.env.start()
        self.addCleanup(self.env.stop)
        scratch = Path(__file__).resolve().parents[2] / 'local/test-data/delete-restore'
        scratch.mkdir(parents=True, exist_ok=True)
        self.path = scratch / f'delete-restore-{uuid4().hex}.sqlite3'
        self.db = SqliteDatabase(str(self.path), thread_safe=False, check_same_thread=False)
        self.previous = (models.tma_db.obj, models.lerne_db.obj)
        models.tma_db.initialize(self.db)
        models.lerne_db.initialize(self.db)
        sqlite_native(self, self.db, writes=True)
        self.addCleanup(self.cleanup)
        self.db.create_tables([
            models.TMAUser,
            models.TMA_Folder,
            models.TMA_Deck,
            models.TMA_Card,
            models.TMA_Collaborator,
            models.TMAProgress,
            models.TMAReviewHistory,
            models.TMACardNote,
            models.TMACardRating,
            models.TMAOfflineBatch,
            models.TMASetting,
            models.TMAMedia,
            models.Deck,
            models.Card,
            models.LibraryCategory,
            models.TMAKnowledgeItem,
            models.TMACardKnowledgeItem,
        ])
        for uid in (101, 202, 303):
            models.TMAUser.create(
                user_id=uid,
                username=f'user{uid}',
                is_guest=False,
                default_decks_initialized=True,
            )

        app = FastAPI()

        def fixture_user(x_test_user: int = Header(default='101')):
            return int(x_test_user)

        app.dependency_overrides[get_user_id] = fixture_user
        for module in (cards, decks, folders, share, study, sync, trash):
            app.include_router(module.router, prefix='/api')
        self.client = TestClient(app)

    def cleanup(self):
        if hasattr(self, 'client'):
            self.client.close()
        self.db.close()
        models.tma_db.initialize(self.previous[0])
        models.lerne_db.initialize(self.previous[1])
        self.path.unlink(missing_ok=True)

    def call(self, method, path, user_id=101, **kwargs):
        headers = dict(kwargs.pop('headers', {}))
        headers['x-test-user'] = str(user_id)
        return self.client.request(method, f'/api{path}', headers=headers, **kwargs)

    def make_card(self, deck, idx, *, is_deleted=False, audio_path=None, image_path=None):
        card = models.TMA_Card.create(
            deck=deck,
            position=idx,
            content_v2=content(f'Prompt {idx}', f'Answer {idx}'),
            card_type=None,
            is_deleted=is_deleted,
            audio_path=audio_path,
            image_path=image_path,
        )
        models.TMAProgress.create(
            user_id=101,
            card_id=card.id,
            queue='review',
            interval=idx + 1,
            repetitions=2,
        )
        return card

    def rev(self, card):
        return lifecycle_state(models.TMA_Card.get_by_id(card.id))['revision']

    def test_single_card_delete_and_restore_preserves_siblings_progress_and_media(self):
        deck = models.TMA_Deck.create(user_id=101, name='Media Deck')
        media = models.TMAMedia.create(
            filename='c1.mp3',
            folder='audio',
            mime_type='audio/mpeg',
            data=b'fake-mp3-bytes',
        )
        c1 = self.make_card(deck, 1, audio_path='c1.mp3', image_path='c1.png')
        c2 = self.make_card(deck, 2)

        res = self.call('POST', '/cards/batch-delete', json={
            'request_id': str(uuid4()),
            'card_ids': [c1.id],
            'revisions': {str(c1.id): self.rev(c1)},
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(models.TMA_Card.get_by_id(c1.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(c2.id).is_deleted)
        self.assertEqual(models.TMAProgress.get((models.TMAProgress.card_id == c2.id)).interval, 3)
        self.assertIsNotNone(models.TMAMedia.get_or_none(models.TMAMedia.id == media.id))
        self.assertEqual(models.TMA_Card.get_by_id(c1.id).audio_path, 'c1.mp3')

        active_cards = self.call('GET', f'/decks/{deck.id}/cards').json()
        self.assertEqual([c['id'] for c in active_cards], [c2.id])
        self.assertEqual(self.call('GET', '/study/stats').json()['total_cards'], 1)
        self.assertEqual(self.call('GET', '/cards/search', params={'q': 'Prompt 1'}).json()['cards'], [])

        trash_data = self.call('GET', '/trash').json()
        self.assertEqual([c['id'] for c in trash_data['cards']], [c1.id])
        self.assertFalse(trash_data['cards'][0]['deck_deleted'])

        restored = self.call('POST', f'/trash/card/{c1.id}/restore', json={
            'request_id': str(uuid4()),
            'revision': self.rev(c1),
        })
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertFalse(models.TMA_Card.get_by_id(c1.id).is_deleted)
        self.assertEqual(len(self.call('GET', f'/decks/{deck.id}/cards').json()), 2)

    def test_100_cards_delete_card5_delete_deck_restore_deck_leaves_99_active(self):
        deck = models.TMA_Deck.create(user_id=101, name='Hundred Deck')
        cards_created = [self.make_card(deck, i) for i in range(1, 101)]
        card5 = cards_created[4]

        # 1. Individually delete card #5
        del_c5 = self.call('POST', '/cards/batch-delete', json={
            'request_id': str(uuid4()),
            'card_ids': [card5.id],
            'revisions': {str(card5.id): self.rev(card5)},
        })
        self.assertEqual(del_c5.status_code, 200, del_c5.text)

        # 2. Delete the deck (must not overwrite active cards' is_deleted flags)
        del_deck = self.call('DELETE', f'/decks/{deck.id}')
        self.assertEqual(del_deck.status_code, 200, del_deck.text)
        self.assertTrue(models.TMA_Deck.get_by_id(deck.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(card5.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(cards_created[0].id).is_deleted)

        # Active reads block/hide all cards of deleted deck
        self.assertIn(self.call('GET', f'/decks/{deck.id}/cards').status_code, (403, 404))
        self.assertIn(self.call('GET', f'/study/card/{cards_created[0].id}').status_code, (403, 404))
        self.assertEqual(self.call('GET', '/study/stats').json()['total_cards'], 0)

        # Trash shows 99 active cards in the deleted deck and marks card5 deck_deleted=True
        trash_listing = self.call('GET', '/trash').json()
        self.assertEqual(len(trash_listing['decks']), 1)
        self.assertEqual(trash_listing['decks'][0]['cards_count'], 99)
        self.assertEqual(trash_listing['cards'][0]['id'], card5.id)
        self.assertTrue(trash_listing['cards'][0]['deck_deleted'])

        # Restoring card #5 directly while deck is deleted must be blocked with 409
        blocked = self.call('POST', f'/trash/card/{card5.id}/restore', json={
            'request_id': str(uuid4()),
            'revision': self.rev(card5),
        })
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertTrue(models.TMA_Deck.get_by_id(deck.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(card5.id).is_deleted)

        # 3. Restore deck -> 99 active cards, card #5 stays deleted
        restored = self.call('POST', f'/trash/deck/{deck.id}/restore')
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertFalse(models.TMA_Deck.get_by_id(deck.id).is_deleted)
        active = self.call('GET', f'/decks/{deck.id}/cards').json()
        self.assertEqual(len(active), 99)
        self.assertNotIn(card5.id, {c['id'] for c in active})
        self.assertTrue(models.TMA_Card.get_by_id(card5.id).is_deleted)

    def test_multilevel_folder_delete_and_restore_preserves_hierarchy_order_and_predeleted(self):
        root = models.TMA_Folder.create(user_id=101, name='Root', position=1)
        child_active = models.TMA_Folder.create(user_id=101, parent=root, name='Child A', position=1)
        child_predeleted = models.TMA_Folder.create(
            user_id=101, parent=root, name='Child B Predeleted', position=2, is_deleted=True,
        )
        grandchild = models.TMA_Folder.create(user_id=101, parent=child_active, name='Grandchild', position=1)

        # Grant collaborator access before delete to ensure collaborators are preserved
        models.TMA_Collaborator.create(
            target_type='folder', target_id=root.id, user_id=202, role='editor', added_by=101,
        )

        deck_active = models.TMA_Deck.create(user_id=101, folder=grandchild, name='Deck Active', position=1)
        deck_predeleted = models.TMA_Deck.create(
            user_id=101, folder=child_active, name='Deck Predeleted', position=2, is_deleted=True,
        )
        c_active = self.make_card(deck_active, 1)
        c_predeleted = self.make_card(deck_active, 2, is_deleted=True)

        # Delete root folder
        res = self.call('DELETE', f'/folders/{root.id}')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(models.TMA_Folder.get_by_id(root.id).is_deleted)
        self.assertFalse(models.TMA_Folder.get_by_id(child_active.id).is_deleted)
        self.assertEqual(models.TMA_Folder.get_by_id(child_active.id).parent_id, root.id)
        self.assertEqual(models.TMA_Deck.get_by_id(deck_active.id).folder_id, grandchild.id)
        self.assertFalse(models.TMA_Deck.get_by_id(deck_active.id).is_deleted)
        self.assertFalse(models.TMA_Card.get_by_id(c_active.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(c_predeleted.id).is_deleted)

        # Every active read path must exclude the deleted subtree for both owner and collaborator
        for uid in (101, 202):
            non_inbox_folders = [f for f in self.call('GET', '/folders', user_id=uid).json() if f['name'] != '📥 Входящие']
            self.assertEqual(non_inbox_folders, [])
            non_inbox_decks = [d for d in self.call('GET', '/decks', user_id=uid).json() if not d.get('is_inbox')]
            self.assertEqual(non_inbox_decks, [])
            self.assertIn(self.call('GET', f'/decks/{deck_active.id}/cards', user_id=uid).status_code, (403, 404))
            self.assertIn(self.call('GET', f'/decks/{deck_active.id}/next', user_id=uid).status_code, (403, 404))
            self.assertIn(self.call('GET', f'/study/card/{c_active.id}', user_id=uid).status_code, (403, 404))
            self.assertIn(self.call('GET', f'/cards/{c_active.id}', user_id=uid).status_code, (403, 404))
            self.assertIn(
                self.call('POST', '/study/grade', user_id=uid, json={
                    'card_id': c_active.id, 'deck_id': deck_active.id, 'grade': 2,
                }).status_code,
                (403, 404),
            )
            search = self.call('GET', '/cards/search', user_id=uid, params={'q': 'Prompt'}).json()
            self.assertEqual(search, {'folders': [], 'decks': [], 'cards': []})

        # Trash must show root folder, pre-deleted subfolder/deck/card, and block restoring children while root is deleted
        t = self.call('GET', '/trash').json()
        root_entry = next(f for f in t['folders'] if f['id'] == root.id)
        self.assertFalse(root_entry['parent_deleted'])
        self.assertEqual(root_entry['decks_count'], 1)
        self.assertEqual(root_entry['cards_count'], 1)

        self.assertEqual(self.call('POST', f'/trash/folder/{child_predeleted.id}/restore').status_code, 409)
        self.assertEqual(self.call('POST', f'/trash/deck/{deck_predeleted.id}/restore').status_code, 409)
        self.assertEqual(
            self.call('POST', f'/trash/card/{c_predeleted.id}/restore', json={
                'request_id': str(uuid4()), 'revision': self.rev(c_predeleted),
            }).status_code,
            409,
        )
        # Ensure blocked restores did NOT auto-restore root
        self.assertTrue(models.TMA_Folder.get_by_id(root.id).is_deleted)

        # Restore root folder
        restored = self.call('POST', f'/trash/folder/{root.id}/restore')
        self.assertEqual(restored.status_code, 200, restored.text)

        # Hierarchy, scope, order, collaborator access restored; pre-deleted items remain deleted
        visible_folders = [f for f in self.call('GET', '/folders').json() if f['name'] != '📥 Входящие']
        self.assertEqual([f['id'] for f in visible_folders], [root.id, child_active.id, grandchild.id])
        self.assertEqual(visible_folders[1]['parent_id'], root.id)
        self.assertEqual(visible_folders[2]['parent_id'], child_active.id)
        self.assertEqual(
            [d['id'] for d in self.call('GET', '/decks').json() if not d.get('is_inbox')],
            [deck_active.id],
        )
        self.assertEqual(
            [d['id'] for d in self.call('GET', '/decks', user_id=202).json() if not d.get('is_inbox')],
            [deck_active.id],
        )
        self.assertEqual([c['id'] for c in self.call('GET', f'/decks/{deck_active.id}/cards').json()], [c_active.id])
        self.assertTrue(models.TMA_Folder.get_by_id(child_predeleted.id).is_deleted)
        self.assertTrue(models.TMA_Deck.get_by_id(deck_predeleted.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(c_predeleted.id).is_deleted)
        self.assertEqual(models.TMA_Deck.get_by_id(deck_active.id).scope, 'personal')
        self.assertEqual(models.TMA_Deck.get_by_id(deck_active.id).user_id, 101)

    def test_repeat_operations_and_authorization_and_sync_conflicts(self):
        parent = models.TMA_Folder.create(user_id=101, name='Parent')
        deck = models.TMA_Deck.create(user_id=101, folder=parent, name='Owned')
        c_keep = self.make_card(deck, 1)
        c_del = self.make_card(deck, 2, is_deleted=True)

        # Editor (202) cannot delete owner's folder; unrelated user (303) cannot delete folder or deck
        models.TMA_Collaborator.create(
            target_type='folder', target_id=parent.id, user_id=202, role='editor', added_by=101,
        )
        self.assertEqual(self.call('DELETE', f'/folders/{parent.id}', user_id=202).status_code, 403)
        self.assertEqual(self.call('DELETE', f'/folders/{parent.id}', user_id=303).status_code, 403)
        self.assertEqual(self.call('DELETE', f'/decks/{deck.id}', user_id=303).status_code, 403)
        self.assertEqual(self.call('POST', f'/trash/folder/{parent.id}/restore', user_id=202).status_code, 404)
        self.assertEqual(self.call('POST', f'/trash/deck/{deck.id}/restore', user_id=202).status_code, 404)

        # Idempotent double delete on folder & double restore on folder
        self.assertEqual(self.call('DELETE', f'/folders/{parent.id}').status_code, 200)
        self.assertEqual(self.call('DELETE', f'/folders/{parent.id}').status_code, 200)
        self.assertEqual(self.call('POST', f'/trash/folder/{parent.id}/restore').status_code, 200)
        self.assertEqual(self.call('POST', f'/trash/folder/{parent.id}/restore').status_code, 200)
        self.assertFalse(models.TMA_Card.get_by_id(c_keep.id).is_deleted)
        self.assertTrue(models.TMA_Card.get_by_id(c_del.id).is_deleted)

        # Offline sync push cannot create/restore deck inside deleted folder (returns 409)
        self.assertEqual(self.call('DELETE', f'/folders/{parent.id}').status_code, 200)
        push_create = self.call('POST', '/sync/v2/push', json={
            'request_id': str(uuid4()),
            'folders': [],
            'decks': [{
                'id': -10,
                'name': 'Offline Inside Deleted Parent',
                'folder_id': parent.id,
                'is_deleted': False,
            }],
            'cards': [],
            'progress': [],
            'reviews': [],
        })
        self.assertEqual(push_create.status_code, 409, push_create.text)

        # Repeated offline sync request_id replay after valid folder delete is idempotent
        self.assertEqual(self.call('POST', f'/trash/folder/{parent.id}/restore').status_code, 200)
        req_id = str(uuid4())
        payload = {
            'request_id': req_id,
            'folders': [{
                'id': parent.id,
                'name': parent.name,
                'is_deleted': True,
                'updated_at': '2099-01-01T00:00:00Z',
            }],
            'decks': [],
            'cards': [],
            'progress': [],
            'reviews': [],
        }
        r1 = self.call('POST', '/sync/v2/push', json=payload)
        r2 = self.call('POST', '/sync/v2/push', json=payload)
        self.assertEqual(r1.status_code, 200, r1.text)
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertTrue(models.TMA_Folder.get_by_id(parent.id).is_deleted)
        self.assertFalse(models.TMA_Deck.get_by_id(deck.id).is_deleted)


if __name__ == '__main__':
    unittest.main()
