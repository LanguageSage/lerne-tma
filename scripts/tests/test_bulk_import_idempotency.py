"""Bulk-import regression checks against a disposable SQLite database."""
import importlib
import json
import os
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from peewee import SqliteDatabase


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ['VERCEL'] = '1'
os.environ['RUN_MIGRATIONS'] = 'false'
os.environ['FORCE_LOCAL_DB'] = 'false'
database_path = ROOT / f'.bulk-import-test-{uuid4().hex}.sqlite'
database = SqliteDatabase(str(database_path),
                          pragmas={'foreign_keys': 1, 'journal_mode': 'wal', 'busy_timeout': 10000})
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

models = importlib.import_module('api.models')
cards = importlib.import_module('api.services.cards')
TABLES = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
          models.TMAProgress, models.TMA_Collaborator, models.TMAOfflineBatch]


class BulkImportTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        models.TMAUser.create(user_id=2)
        self.deck = models.TMA_Deck.create(user_id=1, name='Target')

    def tearDown(self):
        database.drop_tables(TABLES)

    def batch(self):
        return [
            {'deck_id': self.deck.id, 'card_type': 'standard', 'front': 'Haus', 'back': 'дом',
             'metadata': {'cefr': {'level': 'A1'}}, 'tags': 'A1'},
            {'deck_id': self.deck.id, 'card_type': 'word_bank', 'front': '@wordbank\n<<1>>',
             'back': '1=ob', 'context': 'exercise'},
            {'deck_id': self.deck.id, 'card_type': 'match', 'front': '@match\na=b', 'back': 'a=b'},
        ]

    def test_timeout_retry_replays_result_and_preserves_special_cards(self):
        import_id = str(uuid4())
        first = cards.bulk_save_cards(self.batch(), 1, import_id)
        # The client loses this response, then retries the exact saved request.
        retry = cards.bulk_save_cards(self.batch(), 1, import_id)
        self.assertEqual(retry, first)
        self.assertEqual(first['requested'], 3)
        self.assertEqual(first['created'], 3)
        self.assertEqual(first['skipped_existing'], 0)
        self.assertEqual(first['skipped_in_batch'], 0)
        self.assertEqual(first['failed'], [])
        saved = list(models.TMA_Card.select().order_by(models.TMA_Card.position))
        self.assertEqual(len(saved), 3)
        self.assertEqual([card.position for card in saved], [1, 2, 3])
        self.assertEqual(json.loads(saved[0].metadata), {'cefr': {'level': 'A1'}})
        self.assertEqual(saved[1].front_text, '@wordbank\n<<1>>')
        self.assertEqual(saved[2].card_type, 'match')

    def test_reused_id_with_different_payload_is_conflict(self):
        import_id = str(uuid4())
        cards.bulk_save_cards(self.batch(), 1, import_id)
        changed = self.batch()
        changed[0]['back'] = 'building'
        with self.assertRaises(HTTPException) as error:
            cards.bulk_save_cards(changed, 1, import_id)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.select().count(), 3)

    def test_start_places_batch_before_existing_cards_without_moving_them(self):
        first = models.TMA_Card.create(deck=self.deck, front_text='Existing first', back_text='x', position=0)
        last = models.TMA_Card.create(deck=self.deck, front_text='Existing last', back_text='y', position=8)
        models.TMA_Card.create(deck=self.deck, front_text='Deleted', back_text='z', position=-20,
                               is_deleted=True)
        result = cards.bulk_save_cards(self.batch(), 1, str(uuid4()), placement='start')
        active = list(models.TMA_Card.select().where(
            (models.TMA_Card.deck == self.deck) & (models.TMA_Card.is_deleted == False))
            .order_by(models.TMA_Card.position, models.TMA_Card.id))
        self.assertEqual(result['created'], 3)
        self.assertEqual([card.front_text for card in active],
                         ['Haus', '@wordbank\n<<1>>', '@match\na=b', 'Existing first', 'Existing last'])
        self.assertEqual([card.position for card in active], [-3, -2, -1, 0, 8])
        self.assertEqual(models.TMA_Card.get_by_id(first.id).position, 0)
        self.assertEqual(models.TMA_Card.get_by_id(last.id).position, 8)

    def test_start_on_empty_deck_and_retry_preserve_positions(self):
        import_id = str(uuid4())
        first = cards.bulk_save_cards(self.batch(), 1, import_id, placement='start')
        self.assertEqual(cards.bulk_save_cards(self.batch(), 1, import_id, placement='start'), first)
        self.assertEqual([card.position for card in models.TMA_Card.select().order_by(models.TMA_Card.position)],
                         [1, 2, 3])
        with self.assertRaises(HTTPException) as error:
            cards.bulk_save_cards(self.batch(), 1, import_id, placement='end')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.select().count(), 3)

    def test_start_requires_new_cards_in_one_deck(self):
        other = models.TMA_Deck.create(user_id=1, name='Other')
        payload = [self.batch()[0], {**self.batch()[1], 'deck_id': other.id}]
        with self.assertRaises(HTTPException) as error:
            cards.bulk_save_cards(payload, 1, str(uuid4()), placement='start')
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_no_duplicate_filtering_and_other_deck_is_allowed(self):
        duplicate = self.batch()[0]
        cards.bulk_save_cards([duplicate, duplicate], 1, str(uuid4()))
        other = models.TMA_Deck.create(user_id=1, name='Other')
        cards.bulk_save_cards([{**duplicate, 'deck_id': other.id}], 1, str(uuid4()))
        self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.deck == self.deck).count(), 2)
        self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.deck == other).count(), 1)

    def test_unauthorized_import_leaves_no_receipt(self):
        forbidden = models.TMA_Deck.create(user_id=2, name='Private')
        with self.assertRaises(HTTPException) as error:
            cards.bulk_save_cards([{'deck_id': forbidden.id, 'front': 'x', 'back': 'y'}], 1, str(uuid4()))
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_large_batch_touches_deck_once_and_keeps_markers(self):
        from api.services import collaborative_service
        payload = [{'deck_id': self.deck.id, 'front': f'word {i}', 'back': f'answer {i}',
                    'card_type': 'quiz'} for i in range(60)]
        payload.append({'deck_id': self.deck.id, 'front': '@puzzle\nслово', 'back': 'Latin',
                        'card_type': 'standard'})
        original_touch = collaborative_service.touch_deck_and_parent_folders
        with patch.object(collaborative_service, 'touch_deck_and_parent_folders', wraps=original_touch) as touch:
            result = cards.bulk_save_cards(payload, 1, str(uuid4()))
        self.assertEqual(result['created'], 61)
        self.assertEqual(touch.call_count, 1)
        saved = list(models.TMA_Card.select().where(models.TMA_Card.deck == self.deck)
                     .order_by(models.TMA_Card.position))
        self.assertEqual([card.position for card in saved], list(range(1, 62)))
        self.assertEqual(saved[-1].front_text, '@puzzle\nслово')

    def test_shared_deck_role_checked_once(self):
        from api.services import collaborative_service
        shared = models.TMA_Deck.create(user_id=2, name='Shared')
        models.TMA_Collaborator.create(target_type='deck', target_id=shared.id, user_id=1, role='editor')
        original_role = collaborative_service.get_effective_user_role
        payload = [{'deck_id': shared.id, 'front': f'front {i}', 'back': 'back'} for i in range(4)]
        with patch.object(collaborative_service, 'get_effective_user_role', wraps=original_role) as role:
            result = cards.bulk_save_cards(payload, 1, str(uuid4()))
        self.assertEqual(result['created'], 4)
        self.assertEqual(role.call_count, 1)

    def test_concurrent_retry_creates_one_batch(self):
        import_id = str(uuid4())
        existing = models.TMA_Card.create(deck=self.deck, front_text='Existing', back_text='x', position=3)
        started = threading.Event()
        original = cards.save_card

        def slow_save(*args, **kwargs):
            if not started.is_set():
                started.set()
                time.sleep(0.25)
            return original(*args, **kwargs)

        def run_batch():
            try:
                return cards.bulk_save_cards(self.batch(), 1, import_id, placement='start')
            finally:
                database.close()

        with patch.object(cards, 'save_card', side_effect=slow_save):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(run_batch)
                self.assertTrue(started.wait(5))
                second = pool.submit(run_batch)
                self.assertEqual(first.result(timeout=10), second.result(timeout=10))
        self.assertEqual(models.TMA_Card.select().count(), 4)
        self.assertEqual(models.TMA_Card.get_by_id(existing.id).position, 3)
        self.assertEqual([card.front_text for card in models.TMA_Card.select().order_by(models.TMA_Card.position)],
                         ['Haus', '@wordbank\n<<1>>', '@match\na=b', 'Existing'])
        self.assertEqual(models.TMAOfflineBatch.select().count(), 1)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        database.close()
        for path in (database_path, Path(f'{database_path}-wal'), Path(f'{database_path}-shm')):
            if path.parent.resolve() == ROOT.resolve():
                path.unlink(missing_ok=True)
