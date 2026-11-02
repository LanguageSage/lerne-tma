"""Shared Unicode duplicate-key contract; no external services or stored data."""
import json
from pathlib import Path
import unittest

from peewee import SqliteDatabase

from api import models
from api.services import cards
from api.services.cards import normalize_card_key


CORPUS = json.loads((Path(__file__).resolve().parents[2]
                    / 'tests/fixtures/card_key_normalization.json').read_text(encoding='utf-8'))


class CardKeyNormalizationTests(unittest.TestCase):
    def test_shared_keys_and_idempotence(self):
        for case in CORPUS['cases']:
            with self.subTest(case=case['name']):
                key = normalize_card_key(case['text'])
                self.assertEqual(key, case['key'])
                self.assertEqual(normalize_card_key(key), key)

    def test_equivalent_texts(self):
        for left, right in CORPUS['equivalent_pairs']:
            with self.subTest(left=left, right=right):
                self.assertTrue(normalize_card_key(left))
                self.assertEqual(normalize_card_key(left), normalize_card_key(right))

    def test_different_words_remain_distinct(self):
        for left, right in CORPUS['distinct_pairs']:
            with self.subTest(left=left, right=right):
                self.assertNotEqual(normalize_card_key(left), normalize_card_key(right))


class CardKeyBatchTests(unittest.TestCase):
    def setUp(self):
        self.db = SqliteDatabase(':memory:')
        previous = models.tma_db.obj
        models.tma_db.initialize(self.db)
        self.addCleanup(models.tma_db.initialize, previous)
        self.addCleanup(self.db.close)
        self.db.create_tables([models.TMAUser, models.TMA_Folder, models.TMA_Deck,
                               models.TMA_Card, models.TMA_Collaborator])
        models.TMAUser.create(user_id=1)

    def test_copy_and_move_duplicate_modes_preserve_raw_content(self):
        batch = CORPUS['batch']
        for operation in ('copy', 'move'):
            for mode in ('skip', 'overwrite', 'keep'):
                with self.subTest(operation=operation, mode=mode):
                    source = models.TMA_Deck.create(user_id=1, name='Source')
                    target = models.TMA_Deck.create(user_id=1, name='Target')
                    existing = models.TMA_Card.create(deck=target, front_text=batch['target_front'],
                                                     back_text='Original back', context='Original context')
                    sources = [models.TMA_Card.create(deck=source, front_text=front,
                               back_text=f'Back {i}', context=f'Context {i}')
                               for i, front in enumerate(batch['source_fronts'])]
                    originals = [dict(models.TMA_Card.get_by_id(card.id).__data__) for card in sources]
                    result = getattr(cards, f'batch_{operation}_cards')(
                        [card.id for card in sources], target.id, 1, mode)
                    changed = len(sources) - (mode != 'keep')
                    self.assertEqual(result['created' if operation == 'copy' else 'moved'], changed)
                    self.assertEqual(result['updated'], int(mode == 'overwrite'))
                    self.assertEqual(result['skipped'], int(mode == 'skip'))
                    self.assertEqual(result['count'], changed + int(mode == 'overwrite'))
                    target_front = batch['source_fronts'][0] if mode == 'overwrite' else batch['target_front']
                    added_fronts = batch['source_fronts'] if mode == 'keep' else batch['source_fronts'][1:]
                    active = list(models.TMA_Card.select().where(
                        (models.TMA_Card.deck == target) & (models.TMA_Card.is_deleted == False)))
                    self.assertCountEqual([card.front_text for card in active], [target_front, *added_fronts])
                    # Only explicit overwrite changes the existing target's content.
                    existing = models.TMA_Card.get_by_id(existing.id)
                    self.assertEqual(existing.back_text, 'Back 0' if mode == 'overwrite' else 'Original back')
                    self.assertEqual(existing.context, 'Context 0' if mode == 'overwrite' else 'Original context')
                    for original in originals:
                        saved = models.TMA_Card.get_by_id(original['id'])
                        for field in ('front_text', 'back_text', 'context'):
                            self.assertEqual(getattr(saved, field), original[field])
                        if operation == 'copy':
                            self.assertEqual(saved.__data__, original)


if __name__ == '__main__':
    unittest.main()
