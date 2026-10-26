"""Pure parser corpus: no database, network or AI calls.

The same fixture is checked by app/src/utils/__tests__/exerciseDetectionCorpus.test.js
against exerciseDetector.js. Entries with known_divergence record the CURRENT behaviour
of both parsers; fix a parser, then update the entry to a single "type".
"""
import json
import unittest
from pathlib import Path

from api.services.input_parser import (
    detect_ai_input_type, detect_card_type, find_quiz_option_start, parse_exercise_content, parse_quiz_options,
)

CORPUS = json.loads((Path(__file__).resolve().parents[2] / 'local' / 'test-data' / 'fixtures'
                     / 'exercise_detection_corpus.json').read_text(encoding='utf-8'))


class ExerciseDetectionCorpusTests(unittest.TestCase):
    def test_quiz_boundaries_match_editor_and_study_fixtures(self):
        fixtures = json.loads((Path(__file__).resolve().parents[2] / 'local/test-data/fixtures/quiz_boundaries.json').read_text(encoding='utf-8'))
        formats = {
            'checkboxes': lambda text, i, correct: f"{'[*]' if i == correct else '[ ]'} {text}",
            'letters': lambda text, i, correct: f"{chr(65 + i)}){'*' if i == correct else ''}{text}",
            'numbers': lambda text, i, correct: f"{i + 1}. {'*' if i == correct else ''}{text}",
            'numberedParentheses': lambda text, i, correct: f"{'*' if i == correct else ''}{i + 1}){text}",
            'dottedLetters': lambda text, i, correct: f"{'*' if i == correct else ''}{chr(65 + i)}. {text}",
            'bullets': lambda text, i, correct: f"- {'*' if i == correct else ''}{text}",
            'circles': lambda text, i, correct: f"○ {'*' if i == correct else ''}{text}",
            'dots': lambda text, i, correct: f"• {'*' if i == correct else ''}{text}",
            'star': lambda text, i, correct: f"{'*' if i == correct else ''}{text}",
        }
        for fixture in fixtures['examples']:
            expected = [(i == fixture['correct'], text) for i, text in enumerate(fixture['answers'])]
            for name, render in formats.items():
                for newline in ('\n', '\r\n'):
                    with self.subTest(example=fixture['name'], format=name, newline=newline):
                        options = '\n'.join(render(text, i, fixture['correct']) for i, text in enumerate(fixture['answers']))
                        front = (fixture['preamble'] + fixture['question'] + fixture['gap'] + options).replace('\n', newline)
                        exercise = parse_exercise_content(front)['exercise']
                        self.assertEqual(parse_quiz_options(exercise), expected)
                        lines = exercise.split('\n')
                        self.assertEqual('\n'.join(lines[:find_quiz_option_start(lines)]).strip(), fixture['question'])
                        self.assertEqual(detect_card_type(front), 'quiz')
                        if name != 'star':
                            spaced = exercise.replace(options, options.replace('\n', '\n\n'))
                            self.assertEqual(parse_quiz_options(spaced), expected)
        for front in fixtures['ambiguous']:
            with self.subTest(ambiguous=front):
                self.assertEqual(parse_quiz_options(front), [])
                self.assertEqual(detect_card_type(front), 'standard')

    def test_bold_options_are_not_correct_answer_markers(self):
        for prefix in ('A) ', '- ', '○ ', '• ', '[ ] '):
            with self.subTest(prefix=prefix):
                self.assertEqual(parse_quiz_options(f'Wo?\n\n{prefix}**Bonn**\n*Berlin'),
                                 [(False, '**Bonn**'), (True, 'Berlin')])

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
