"""Pure parser corpus: no database, network or AI calls.

The same fixture is checked by app/src/utils/__tests__/exerciseDetectionCorpus.test.js
against exerciseDetector.js. Entries with known_divergence record the CURRENT behaviour
of both parsers; fix a parser, then update the entry to a single "type".
"""
import json
import unittest
from pathlib import Path

from api.services.input_parser import detect_ai_input_type, detect_card_type

CORPUS = json.loads((Path(__file__).resolve().parents[2] / 'tests' / 'fixtures'
                     / 'exercise_detection_corpus.json').read_text(encoding='utf-8'))


class ExerciseDetectionCorpusTests(unittest.TestCase):
    def test_python_detector_matches_recorded_result(self):
        for entry in CORPUS['cards']:
            with self.subTest(card=entry['source_card_id']):
                self.assertEqual(detect_ai_input_type(entry['front']), entry['python'])
                if not entry.get('known_divergence'):
                    self.assertEqual(entry['python'], entry['type'])

    def test_divergences_are_explicitly_marked(self):
        for entry in CORPUS['cards']:
            with self.subTest(card=entry['source_card_id']):
                self.assertEqual(entry['python'] == entry['js'], not entry.get('known_divergence'))

    def test_detect_card_type_has_zero_divergence_with_js(self):
        for entry in CORPUS['cards']:
            with self.subTest(card=entry['source_card_id']):
                self.assertEqual(detect_card_type(entry['front']), entry['js'])


if __name__ == '__main__':
    unittest.main()
