"""Run against an isolated in-memory database, never the configured cloud database."""
import importlib
import hashlib
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
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
decks_module._learning_key = lambda user_id, deck_id: f'DECK_LEARNING_{user_id}_{deck_id}'
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
          models.TMAUser, models.TMA_Collaborator, models.TMAOfflineBatch, models.TMAReviewHistory, models.TMASetting]


from native_fixture import content, sqlite_native


class OfflineSyncTests(unittest.TestCase):
    def setUp(self):
        sqlite_native(self, database, writes=True)
        database.create_tables(TABLES)
        for uid in (1, 2):
            models.TMAUser.create(user_id=uid, is_guest=False, default_decks_initialized=True)
        self.deck = models.TMA_Deck.create(user_id=1, name='Native')
        self.card = models.TMA_Card.create(deck=self.deck, content_v2=content(), card_type=None)

    def tearDown(self):
        database.drop_tables(TABLES)

    def request(self, **values):
        return Request(request_id=uuid4(), **values)

    def progress(self, **changes):
        return {'card_id': self.card.id, 'queue': 'review', 'interval': 5, 'ease_factor': 2.5,
                'repetitions': 2, 'lapses': 0, **changes}

    def test_retry_returns_same_entity_ids_and_nested_relationships(self):
        request = self.request(folders=[{'id': -2, 'name': 'Child', 'parent_id': -1},
                                       {'id': -1, 'name': 'Parent'}],
            decks=[{'id': -3, 'name': 'Deck', 'folder_id': -2, 'target_language': 'uk'}])
        first = sync.push_offline(request, 1)
        self.assertEqual(sync.push_offline(request, 1), first)
        child = models.TMA_Folder.get_by_id(first['mappings']['folders']['-2'])
        self.assertEqual(child.parent_id, first['mappings']['folders']['-1'])
        self.assertEqual(models.TMA_Deck.get_by_id(first['mappings']['decks']['-3']).folder_id, child.id)

    def test_changed_uuid_payload_is_rejected(self):
        request = self.request(decks=[{'id': -1, 'name': 'Original'}])
        sync.push_offline(request, 1)
        request.decks[0].name = 'Different'
        with self.assertRaises(HTTPException) as error:
            sync.push_offline(request, 1)
        self.assertEqual(error.exception.status_code, 409)

    def test_v1_card_batches_never_write_even_without_pg_constraints(self):
        request = self.request(decks=[{'id': -1, 'name': 'Must roll back'}],
            cards=[{'id': -2, 'deck_id': -1, 'front_text': 'Old', 'back_text': 'Old'}])
        for drain in (False, True):
            with self.subTest(drain=drain), self.assertRaises(HTTPException) as error:
                sync.push_offline(request, 1, drain_legacy=drain)
            self.assertEqual(error.exception.detail['code'], 'legacy_queue_requires_recovery')
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        self.assertEqual(models.TMA_Deck.select().count(), 1)
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_v2_pull_is_default_scoped_and_contains_no_v1_projection(self):
        old = models.TMA_Card.create(deck=self.deck, front_text='Retain old archive', back_text='Old')
        pulled = sync.pull_offline(1)
        self.assertEqual(pulled['card_schema'], 2)
        self.assertEqual([card['id'] for card in pulled['cards']], [self.card.id])
        self.assertEqual(pulled['cards'][0]['content_v2'], self.card.content_v2)
        self.assertFalse({'front_text', 'back_text', 'front', 'back', 'context', 'tags'} & pulled['cards'][0].keys())
        self.assertEqual(sync.pull_offline(2)['cards'], [])
        self.assertEqual(models.TMA_Card.get_by_id(old.id).front_text, 'Retain old archive')

    def test_personal_flag_explicit_clear_and_retry_preserve_content(self):
        request = self.request(progress=[self.progress(flag=3)])
        result = sync.push_offline(request, 1)
        self.assertEqual(sync.push_offline(request, 1), result)
        sync.push_offline(self.request(progress=[self.progress()]), 1)
        self.assertEqual(models.TMAProgress.get().flag, 3)
        sync.push_offline(self.request(progress=[self.progress(flag=0)]), 1)
        self.assertEqual(models.TMAProgress.get().flag, 0)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).content_v2, self.card.content_v2)

    def test_flag_only_does_not_replace_authoritative_srs_or_bookmark(self):
        models.TMAProgress.create(user_id=1, card_id=self.card.id, queue='review', repetitions=9,
                                  interval=99, want_to_learn=True)
        sync.push_offline(self.request(progress=[self.progress(flag=4, flag_only=True)]), 1)
        state = models.TMAProgress.get()
        self.assertEqual((state.flag, state.repetitions, state.interval, state.want_to_learn), (4, 9, 99, True))

    def test_unauthorized_progress_rolls_back_entities_and_receipt(self):
        request = self.request(decks=[{'id': -1, 'name': 'No partial create'}], progress=[self.progress()])
        with self.assertRaises(HTTPException):
            sync.push_offline(request, 2)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        self.assertEqual(models.TMA_Deck.select().count(), 1)
        self.assertEqual(models.TMAProgress.select().count(), 0)

    def test_viewer_can_study_but_not_write_content_or_entities(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')
        sync.push_offline(self.request(progress=[self.progress()]), 2)
        with self.assertRaises(HTTPException):
            sync.push_offline(self.request(decks=[{'id': self.deck.id, 'name': 'Forbidden'}]), 2)
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).name, 'Native')

    def test_owner_restore_and_cycles(self):
        models.TMA_Deck.update(is_deleted=True).execute()
        sync.push_offline(self.request(decks=[{'id': self.deck.id, 'name': 'Restored', 'is_deleted': False}]), 1)
        self.assertFalse(models.TMA_Deck.get_by_id(self.deck.id).is_deleted)
        request = self.request(folders=[{'id': -1, 'name': 'A', 'parent_id': -2}, {'id': -2, 'name': 'B', 'parent_id': -1}])
        before = models.TMAOfflineBatch.select().count()
        with self.assertRaises(HTTPException):
            sync.push_offline(request, 1)
        self.assertEqual(models.TMAOfflineBatch.select().count(), before)

    def test_review_progress_receipt_are_atomic_and_replay_once(self):
        request = self.request(progress=[self.progress()], reviews=[{
            'card_id': self.card.id, 'rating': 2, 'review_context': 'forced',
            'review_time': '2026-10-01T10:00:00Z', 'scheduled_interval': 5}])
        original = models.TMAReviewHistory.create
        with patch.object(models.TMAReviewHistory, 'create', side_effect=RuntimeError('history failure')):
            with self.assertRaises(RuntimeError):
                sync.push_offline(request, 1)
        self.assertEqual(models.TMAProgress.select().count(), 0)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)
        first = sync.push_offline(request, 1)
        self.assertEqual(sync.push_offline(request, 1), first)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
