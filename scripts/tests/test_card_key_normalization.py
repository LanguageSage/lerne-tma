"""Shared Unicode duplicate-key contract; no external services or stored data."""
import json
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
