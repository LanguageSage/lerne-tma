"""Published permissions and per-user annotations on disposable SQLite."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from peewee import SqliteDatabase

from api import models
from native_fixture import content, sqlite_native
from api.services import structured_card_api as native
from api.services import cards, collaborative_service, decks, folders
from api.services.offline_sync import push_offline
from api.routers.sync import OfflinePushRequest


class GlobalReadonlyTests(unittest.TestCase):
    def setUp(self):
        self.admin_env = patch.dict(os.environ, {'ADMIN_USER_ID': '3'})
        self.admin_env.start()
        self.db = SqliteDatabase(':memory:')
        models.tma_db.initialize(self.db)
        self.db.connect()
        sqlite_native(self, self.db, writes=True)
        self.tables = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
                       models.TMA_Collaborator, models.TMAProgress, models.TMAOfflineBatch, models.TMASetting]
        self.db.create_tables(self.tables)
        for user in (1, 2, 3, 4):
            models.TMAUser.create(user_id=user, is_guest=False)
        self.root = models.TMA_Folder.create(user_id=1, name='Official', access_scope='global_readonly')
        self.child = models.TMA_Folder.create(user_id=1, name='Child', parent_id=self.root.id)
        self.deck = models.TMA_Deck.create(user_id=1, folder_id=self.child.id, name='Lesson')
        self.card = models.TMA_Card.create(deck_id=self.deck.id, content_v2=content('one', 'eins'), card_type=None, flag=5, want_to_learn=True)
        self.private = models.TMA_Folder.create(user_id=1, name='Private')
        models.TMA_Collaborator.create(target_type='folder', target_id=self.root.id, user_id=2, role='editor')

    def tearDown(self):
        self.db.drop_tables(self.tables)
        self.db.close()
        self.admin_env.stop()

    def test_visibility_inheritance_and_role_precedence(self):
        service = collaborative_service
        self.assertTrue({self.root.id, self.child.id} <= service.get_user_accessible_folder_ids(4))
        self.assertIn(self.deck.id, service.get_user_accessible_deck_ids(4))
        self.assertEqual(service.get_effective_user_role(2, 'folder', self.root.id), 'viewer')
        self.assertEqual(service.get_effective_user_role(2, 'deck', self.deck.id), 'viewer')
        self.assertEqual(service.get_effective_user_role(1, 'deck', self.deck.id), 'owner')
        self.assertEqual(service.get_effective_user_role(3, 'deck', self.deck.id), 'editor')
        self.assertIsNone(service.get_effective_user_role(4, 'folder', self.private.id))
        info = service.get_batch_collaborative_info(2, decks=[self.deck], folders=[self.root, self.child])
        self.assertEqual(info['decks'][self.deck.id]['role'], 'viewer')
        self.assertEqual(info['folders'][self.child.id]['role'], 'viewer')
        self.assertEqual(models.TMA_Collaborator.select().count(), 1)
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_content_mutations_denied_to_viewer_and_allowed_to_owner(self):
        for operation in (
            lambda: folders.rename_folder(self.child.id, 'Changed', 2),
            lambda: folders.create_folder('Injected', 2, parent_id=self.child.id),
            lambda: decks.create_deck('Injected', 2, folder_id=self.root.id),
            lambda: native.update_card(self.card.id, native.UpdateCard(content_v2=content('hacked', 'eins'), revision=native.content_response(models.TMA_Card.get_by_id(self.card.id))['revision'], request_id=uuid4()), 2),
            lambda: collaborative_service._require_can_mutate(2, 'deck', self.deck.id),
        ):
            with self.assertRaises(HTTPException) as raised:
                operation()
            self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(folders.rename_folder(self.child.id, 'Updated', 1).name, 'Updated')
        self.assertEqual(folders.create_folder('New child', 1, parent_id=self.root.id).parent_id, self.root.id)
        self.assertEqual(decks.rename_deck(self.deck.id, 'Maintained', 3).name, 'Maintained')

    def test_personal_flag_and_unpublish(self):
        self.assertEqual(cards.set_card_flag(self.card.id, 2, 3)['flag'], 3)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).flag, 5)
        self.assertEqual(cards.get_cards_for_study(self.deck.id, 2)[0]['flag'], 3)
        other = cards.get_cards_for_study(self.deck.id, 4)[0]
        self.assertEqual(other['flag'], 0)
        self.assertFalse(other['want_to_learn'])
        self.root.access_scope = 'private'
        self.root.save()
        self.assertIsNone(collaborative_service.get_effective_user_role(4, 'deck', self.deck.id))
        self.assertEqual(collaborative_service.get_effective_user_role(2, 'deck', self.deck.id), 'editor')

    def test_offline_content_denied_but_personal_progress_syncs(self):
        card_edit = OfflinePushRequest(request_id=uuid4(), cards=[{
            'id': self.card.id, 'deck_id': self.deck.id,
            'front_text': 'hacked', 'back_text': 'eins', 'flag': 4,
        }])
        with self.assertRaises(HTTPException) as raised:
            push_offline(card_edit, 2)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).content_v2, content('one', 'eins'))
        progress_only = OfflinePushRequest(request_id=uuid4(), progress=[{
            'card_id': self.card.id, 'queue': 'learning', 'interval': 1,
            'ease_factor': 2.5, 'repetitions': 1, 'lapses': 0,
            'flag': 4, 'want_to_learn': True,
        }])
        self.assertEqual(push_offline(progress_only, 2)['status'], 'success')
        personal = models.TMAProgress.get(card_id=self.card.id, user_id=2)
        self.assertEqual(personal.flag, 4)
        self.assertTrue(personal.want_to_learn)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).flag, 5)
        self.assertIsNone(models.TMAProgress.get_or_none(card_id=self.card.id, user_id=4))

    def test_canonical_update_keeps_card_id_and_progress(self):
        cards.set_card_flag(self.card.id, 2, 3)
        cards.set_card_flag(self.card.id, 4, 1)
        revision = native.content_response(models.TMA_Card.get_by_id(self.card.id))['revision']
        native.update_card(self.card.id, native.UpdateCard(content_v2=content('two', 'zwei'),
                          revision=revision, request_id=uuid4()), 1)
        canonical = models.TMA_Card.get_by_id(self.card.id)
        self.assertEqual(canonical.id, self.card.id)
        self.assertEqual(canonical.content_v2['card']['data']['prompt'], 'two')
        self.assertEqual(canonical.flag, 5)
        self.assertEqual(cards.get_cards_for_study(self.deck.id, 2)[0]['content_v2']['card']['data']['prompt'], 'two')
        self.assertEqual(cards.get_cards_for_study(self.deck.id, 4)[0]['content_v2']['card']['data']['prompt'], 'two')
        self.assertEqual(models.TMAProgress.get(card_id=self.card.id, user_id=2).flag, 3)
        self.assertEqual(models.TMAProgress.get(card_id=self.card.id, user_id=4).flag, 1)

    def test_trainer_stats_read_the_native_type(self):
        value = content()
        value['card'].update(type='trainer', data={'parts': [{'type': 'input', 'answers': ['spricht']}], 'back_note': ''})
        models.TMA_Card.update(content_v2=value).where(models.TMA_Card.id == self.card.id).execute()
        with patch.object(decks, 'ensure_starter_decks'), patch.object(decks, 'deduplicate_lid_folders'), \
             patch.object(decks, '_get_cached_library_info', return_value=({}, {})):
            snapshot = next(row for row in decks.get_active_decks(2) if row['id'] == self.deck.id)
        self.assertEqual(snapshot['stats']['trainer_count'], 1)
        self.assertTrue(snapshot['is_trainer'])

    def test_learning_preference_does_not_change_deck(self):
        before = self.deck.metadata
        self.assertTrue(decks.toggle_deck_learning(self.deck.id, 2, True))
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).metadata, before)
        self.assertEqual(models.TMASetting.get(key=f'DECK_LEARNING_2_{self.deck.id}').value, '1')
        self.assertIsNone(models.TMASetting.get_or_none(key=f'DECK_LEARNING_4_{self.deck.id}'))

    def test_learning_preference_reloads_and_stays_personal(self):
        before = models.TMA_Deck.get_by_id(self.deck.id)
        with patch.object(decks, 'ensure_starter_decks'), \
                patch.object(decks, 'deduplicate_lid_folders'), \
                patch.object(decks, '_get_cached_library_info', return_value=({}, {})):
            def learning_state(user_id):
                return next(d['is_learning'] for d in decks.get_active_decks(user_id)
                            if d['id'] == self.deck.id)

            self.assertFalse(learning_state(2))
            self.assertTrue(decks.toggle_deck_learning(self.deck.id, 2, True))
            self.assertTrue(learning_state(2))
            self.assertTrue(learning_state(2))  # Fresh query, without an in-memory deck.
            self.assertFalse(learning_state(4))
            self.assertTrue(decks.toggle_deck_learning(self.deck.id, 4, True))
            self.assertFalse(decks.toggle_deck_learning(self.deck.id, 2, False))
            self.assertFalse(learning_state(2))
            self.assertTrue(learning_state(4))
            self.assertEqual(models.TMASetting.get(key=f'DECK_LEARNING_2_{self.deck.id}').value, '0')
            after = models.TMA_Deck.get_by_id(self.deck.id)
            self.assertEqual(after.metadata, before.metadata)
            self.assertEqual(after.updated_at, before.updated_at)


if __name__ == '__main__':
    unittest.main()
