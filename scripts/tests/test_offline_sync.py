"""Run against an isolated in-memory database, never the configured cloud database."""
import importlib
import json
import os
from pathlib import Path
import sys
import types
import unittest
from uuid import uuid4

from peewee import SqliteDatabase
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ['VERCEL'] = '1'
os.environ['RUN_MIGRATIONS'] = 'false'
os.environ['FORCE_LOCAL_DB'] = 'false'
database = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1})
db_module = types.ModuleType('api.database')
db_module.tma_db = database
db_module.lerne_db = database
db_module.initialize_database = lambda: None
sys.modules['api.database'] = db_module
services = types.ModuleType('api.services')
services.__path__ = [str(ROOT / 'api/services')]
sys.modules['api.services'] = services
decks_module = types.ModuleType('api.services.decks')
decks_module.ensure_starter_decks = lambda _user_id: None
sys.modules['api.services.decks'] = decks_module
old_sync = types.ModuleType('api.services.sync_service')
for name in ('execute_sync_push', 'execute_sync_pull', 'execute_collab_pull'):
    setattr(old_sync, name, lambda *args: None)
sys.modules['api.services.sync_service'] = old_sync
auth_module = types.ModuleType('api.dependencies.auth')
auth_module.get_user_id = lambda: 1
sys.modules['api.dependencies.auth'] = auth_module

models = importlib.import_module('api.models')
sync = importlib.import_module('api.services.offline_sync')
Request = importlib.import_module('api.routers.sync').OfflinePushRequest
TABLES = [models.TMA_Folder, models.TMA_Deck, models.TMA_Card, models.TMAProgress,
          models.TMAUser, models.TMA_Collaborator, models.TMAOfflineBatch]


class OfflineSyncTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1, default_decks_initialized=True)
        models.TMAUser.create(user_id=2, default_decks_initialized=True)

    def tearDown(self):
        database.drop_tables(TABLES)

    def request(self, **values):
        return Request(request_id=uuid4(), **values)

    def test_retry_returns_same_ids_and_preserves_nested_folders(self):
        request = self.request(
            folders=[{'id': -2, 'name': 'Child', 'parent_id': -1}, {'id': -1, 'name': 'Parent'}],
            decks=[{'id': -3, 'name': 'Deck', 'folder_id': -2, 'target_language': 'uk', 'metadata': '{"is_learning":true}'}],
            cards=[{'id': -4, 'deck_id': -3, 'front_text': 'Hallo', 'back_text': 'Hello',
                    'tags': '["A1"]', 'metadata': '{"cefr":{"level":"A1"}}', 'card_type': 'quiz',
                    'audio_back_path': 'back.mp3', 'flag': 3}],
            progress=[{'card_id': -4, 'queue': 'learning', 'interval': 5, 'ease_factor': 2.5,
                       'repetitions': 1, 'lapses': 0, 'step_index': 1, 'next_review': '2026-09-05T10:00:00Z'}])
        first = sync.push_offline(request, 1)
        self.assertEqual(sync.push_offline(request, 1), first)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        child = models.TMA_Folder.get_by_id(first['mappings']['folders']['-2'])
        self.assertEqual(child.parent_id, first['mappings']['folders']['-1'])
        data = sync.pull_offline(1)
        self.assertEqual(data['cards'][0]['audio_back_path'], 'back.mp3')
        self.assertEqual(data['cards'][0]['card_type'], 'quiz')
        self.assertEqual(json.loads(data['cards'][0]['tags']), ['A1'])
        self.assertEqual(data['decks'][0]['target_language'], 'uk')
        self.assertEqual(data['progress'][0]['step_index'], 1)

    def test_reused_batch_id_with_changed_payload_is_rejected(self):
        request = self.request(decks=[{'id': -1, 'name': 'Original'}])
        sync.push_offline(request, 1)
        request.decks[0].name = 'Different'
        with self.assertRaises(HTTPException) as error:
            sync.push_offline(request, 1)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Deck.get().name, 'Original')

    def test_unauthorized_batch_rolls_back_receipt_and_creates(self):
        other = models.TMA_Deck.create(user_id=2, name='Private')
        request = self.request(decks=[{'id': -1, 'name': 'Should rollback'}],
                               cards=[{'id': -2, 'deck_id': other.id, 'front_text': 'x', 'back_text': 'y'}])
        with self.assertRaises(HTTPException):
            sync.push_offline(request, 1)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        self.assertEqual(models.TMA_Deck.select().count(), 1)

    def test_viewer_can_study_but_cannot_edit(self):
        deck = models.TMA_Deck.create(user_id=2, name='Shared')
        card = models.TMA_Card.create(deck=deck, front_text='x', back_text='y')
        models.TMA_Collaborator.create(target_type='deck', target_id=deck.id, user_id=1, role='viewer')
        with self.assertRaises(HTTPException):
            sync.push_offline(self.request(cards=[{'id': card.id, 'deck_id': deck.id, 'front_text': 'changed', 'back_text': 'y'}]), 1)
        sync.push_offline(self.request(progress=[{'card_id': card.id, 'queue': 'review', 'interval': 1,
            'ease_factor': 2.5, 'repetitions': 1, 'lapses': 0, 'step_index': None}]), 1)
        self.assertEqual(sync.pull_offline(1)['decks'][0]['role'], 'viewer')

    def test_server_time_and_explicit_media_removal(self):
        deck = models.TMA_Deck.create(user_id=1, name='Deck')
        card = models.TMA_Card.create(deck=deck, front_text='x', back_text='y', audio_path='old.mp3')
        sync.push_offline(self.request(cards=[{'id': card.id, 'deck_id': deck.id, 'front_text': 'new',
             'back_text': 'y', 'audio_path': '', 'updated_at': '2000-01-01T00:00:00Z'}]), 1)
        updated = models.TMA_Card.get_by_id(card.id)
        self.assertEqual(updated.front_text, 'new')
        self.assertEqual(updated.audio_path, '')
        self.assertGreater(updated.updated_at.year, 2000)

    def test_deleted_records_are_not_resurrected_and_cycles_rejected(self):
        with self.assertRaises(HTTPException):
            sync.push_offline(self.request(decks=[{'id': 999, 'name': 'Gone'}]), 1)
        with self.assertRaises(HTTPException):
            sync.push_offline(self.request(folders=[{'id': -1, 'name': 'Cycle', 'parent_id': -1}]), 1)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_owner_can_restore_soft_deleted_deck(self):
        deck = models.TMA_Deck.create(user_id=1, name='Trash', is_deleted=True)
        sync.push_offline(self.request(decks=[{'id': deck.id, 'name': 'Restored', 'is_deleted': False}]), 1)
        self.assertFalse(models.TMA_Deck.get_by_id(deck.id).is_deleted)


if __name__ == '__main__':
    unittest.main()
