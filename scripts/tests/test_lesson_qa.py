"""Lesson QA offline contracts, canonical passports and existing import parser."""
import json
import tempfile
import unittest
from pathlib import Path

from scripts.lesson_qa import run_audit, read_import, ROOT


class LessonQaTests(unittest.TestCase):
    def test_free_answer_settings_follow_the_server_contract(self):
        data = {'decks': [{'id': 1, 'name': 'Fixture'}], 'cards': [{'id': 2, 'deck_id': 1,
            'front_text': '@free\nDescribe a place.', 'back_text': 'An example.',
            'metadata': {'grading_policy': {'mode': 'invented', 'max_retries': 0}, 'accepted_answers': 'not a list'}}]}
        codes = {f['code'] for f in run_audit(data)['findings']}
        self.assertTrue({'answer.invalid_policy', 'answer.invalid_variants'} <= codes)

    def test_import_structure_errors_are_reported_instead_of_silently_dropped(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lesson.txt'
            path.write_text('# Deck: Broken\n<<<LERNE_PASSPORT>>>\n{not json}\n<<<END_LERNE_PASSPORT>>>\nFRONT:\n[[der]]\nBACK:\n\nCONTEXT:\n', encoding='utf-8')
            data = read_import(path)
        self.assertTrue(data['import_errors'])
        self.assertTrue(any(f['code'] == 'syntax.import_structure' and f['severity'] == 'ERROR' for f in run_audit(data)['findings']))

    def test_passport_proposals_are_valid_and_preserve_unrelated_metadata(self):
        from api.services.deck_passport import passport_from_metadata, validate_passport
        proposals = json.loads((ROOT / 'reports/lesson-qa/passport-proposals.json').read_text(encoding='utf-8'))
        self.assertEqual(len(proposals), 6)
        for proposal in proposals:
            self.assertEqual(validate_passport(passport_from_metadata(proposal['proposed'])), [])
            for key in ('intro', 'resources', 'curriculum', 'is_learning'):
                self.assertEqual(proposal['original'].get(key), proposal['proposed'].get(key))

    def test_all_course_passports_use_the_canonical_validator(self):
        snapshot = json.loads((ROOT / 'reports/lesson-qa/relativsaetze.snapshot.json').read_text(encoding='utf-8'))
        report = run_audit(snapshot)
        errors = [f for f in report['findings'] if f['code'] == 'passport.schema']
        self.assertEqual(report['checked'], {'decks': 14, 'cards': 678})
        self.assertEqual({f['deck_id'] for f in errors}, {6985, 6986, 6993, 6994, 6995, 6990})
        self.assertFalse(any(f['code'].startswith('passport.range') for f in report['findings']))

    def test_prepared_import_retains_invalid_passport_for_report(self):
        text = '# Deck: Fixture\n<<<LERNE_PASSPORT>>>\n' + json.dumps({
            'schema_version': 1, 'pedagogy': {'lesson_type': 'production'}}) + '\n<<<END_LERNE_PASSPORT>>>\n<<<LERNE_CARD>>>\nFRONT:\n[[der]]\nBACK:\n\nCONTEXT:\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lesson.txt'
            path.write_text(text, encoding='utf-8')
            data = read_import(path)
        self.assertEqual(len(data['cards']), 1)
        self.assertTrue(any(f['code'] == 'passport.schema' for f in run_audit(data)['findings']))

    def test_plain_import_is_supported_without_a_deck_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lesson.txt'
            path.write_text('FRONT:\n[[der]]\nBACK:\n\nCONTEXT:\n', encoding='utf-8')
            data = read_import(path)
        self.assertEqual(len(data['cards']), 1)
        self.assertEqual(data['decks'][0]['name'], 'Без названия')


if __name__ == '__main__':
    unittest.main()
