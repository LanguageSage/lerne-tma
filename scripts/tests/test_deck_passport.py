"""Passport contracts and transactions against disposable SQLite, never live data."""
import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from api import models
from api.services import author_service as author
from api.services.deck_passport import validate_passport, merge_passport


def sample(number='09'):
    kind = {'09': 'practice', '12': 'review', '13': 'assessment'}[number]
    return {
        'schema_version': 1,
        'intro': {'title': f'Колода {number}', 'level': 'B1', 'topic': 'obwohl & trotzdem',
                  'goal': 'Самостоятельно выражать мысли', 'learning_outcomes': ['Строить предложения']},
        'pedagogy': {
            'lesson_type': kind,
            'stages': [{'id': f'stage_{i}', 'title': f'Этап {i}', 'goal': 'Тренировать навык',
                        'support': 'independent' if i == 6 else 'high', 'from_card': i, 'to_card': i}
                       for i in range(1, 7)] if number == '09' else [],
            'expected_result': 'Ученик может выражать противопоставление',
            'competencies': [{'id': 'word_order', 'title': 'Порядок слов'}],
            'assessment_criteria': [{'id': f'section_{i}', 'title': f'Раздел {i}'} for i in range(1, 8)] if number == '13' else [],
            'review_recommendations': [{'id': 'review_12', 'title': 'Восстановление знаний',
                                        'when': 'Если трудно выбирать конструкцию', 'competency_ids': ['word_order']}]
        }
    }


def lesson(name='Test Deck', passport=None, cards=1, deck_id=None):
    header = f'# Deck: {name}\n'
    if deck_id:
        header += f'::deck_id {deck_id}\n'
    if passport is not None:
        header += '<<<LERNE_PASSPORT>>>\n' + json.dumps(passport, ensure_ascii=False) + '\n<<<END_LERNE_PASSPORT>>>\n'
    return header + '\n<<<LERNE_CARD>>>\n'.join(f'FRONT:\nFront {i}\nBACK:\nBack {i}\nCONTEXT:\n::level B1\n' for i in range(cards))


class TestPassportParsing(unittest.TestCase):
    def test_inherited_metadata_and_explicit_overrides_both_first_card_formats(self):
        passport = {'schema_version': 1, 'intro': {'level': 'B2', 'topic': 'Deck topic'}}
        header = lesson(passport=passport, cards=0, deck_id=99)
        bodies = [
            'FRONT:\nOne\nBACK:\n1\nCONTEXT:\nExplanation',
            'FRONT:\nTwo\nBACK:\n2\nCONTEXT:\n::level A2',
            'FRONT:\nThree\nBACK:\n3\nCONTEXT:\n::topic\nCard topic',
            'FRONT:\nFour\nBACK:\n4\nCONTEXT:\n::level\nC1\n::topic Explicit',
        ]
        for separator in ('---', '<<<LERNE_CARD>>>'):
            for leading in ('', separator + '\n'):
                for newline in ('\n', '\r\n'):
                    with self.subTest(separator=separator, leading=leading, newline=newline):
                        text = header + leading + ('\n' + separator + '\n').join(bodies)
                        doc = author.parse_document(text.replace('\n', newline))
                        self.assertEqual(doc['errors'], [])
                        self.assertEqual([(c['level'], c['topics']) for c in doc['cards']],
                                         [('B2', 'Deck topic'), ('A2', 'Deck topic'),
                                          ('B2', 'Card topic'), ('C1', 'Explicit')])
                        self.assertEqual([c['deck_id'] for c in doc['cards']], [99] * 4)
                        self.assertEqual(doc['cards'][0]['context'], 'Explanation')

    def test_inheritance_is_scoped_to_each_deck_and_optional_fields(self):
        text = '\n'.join([
            lesson('A', {'schema_version': 1, 'intro': {'level': 'B2', 'topic': 'A'}}).replace('::level B1', ''),
            lesson('B', {'schema_version': 1, 'intro': {'topic': 'B'}}).replace('::level B1', ''),
            lesson('C', {'schema_version': 1, 'intro': {'level': 'C2'}}).replace('::level B1', ''),
            lesson('Legacy').replace('::level B1', ''),
        ])
        doc = author.parse_document(text)
        self.assertEqual(doc['errors'], [])
        self.assertEqual([(c['level'], c['topics']) for c in doc['cards']],
                         [('B2', 'A'), (None, 'B'), ('C2', None), (None, None)])

    def test_export_uses_separator_before_first_card_and_keeps_ids(self):
        deck = SimpleNamespace(id=99, name='D', metadata=json.dumps({'intro': {'level': 'B2', 'topic': 'T'}}))
        cards = [SimpleNamespace(id=i, deck_id=99, front_text=f'Front {i}', back_text='Back',
                                 context='', tags='', topics='', metadata={}) for i in (1, 2)]
        text = author.serialize_deck(deck, cards)
        self.assertEqual(text.count('<<<LERNE_CARD>>>'), 2)
        self.assertRegex(text, r'<<<END_LERNE_PASSPORT>>>\s*<<<LERNE_CARD>>>\s*::deck_id 99')
        parsed = author.parse_cards_text(text)
        self.assertEqual([c['card_id'] for c in parsed], [1, 2])
        self.assertEqual([c['deck_id'] for c in parsed], [99, 99])

    def test_documented_example_and_cli_keep_passport(self):
        from scripts import lerne_author_cli as cli
        example = Path(__file__).resolve().parents[2] / 'docs/examples/deck_passport_example.txt'
        document = author.parse_document(example.read_text(encoding='utf-8'))
        self.assertEqual(document['errors'], [])
        self.assertEqual(document['warnings'], [])
        self.assertEqual(len(document['cards']), 2)
        args = SimpleNamespace(file=str(example), deck_name=None, folder_id=1, new_folder=None,
                               user_id=42, force_new_deck=False, passport_only=True, apply=True)
        result = {'folder_id': 1, 'folder_name': 'Test', 'published_decks': [], 'total_saved_cards': 0}
        with patch.object(cli, 'initialize_database'), patch.object(cli, 'apply_publish_content', return_value=result) as publish:
            with redirect_stdout(StringIO()):
                self.assertEqual(cli.handle_publish(args), 0)
        self.assertEqual(publish.call_args.kwargs['passports'], document['passports'])
        self.assertTrue(publish.call_args.kwargs['passport_only'])

    def test_legacy_and_single_passport_both_separators(self):
        for sep in ('---', '<<<LERNE_CARD>>>'):
            for passport in (None, sample()):
                text = lesson(passport=passport, cards=6).replace('<<<LERNE_CARD>>>', sep)
                document = author.parse_document(text)
                self.assertEqual(document['errors'], [])
                self.assertEqual(len(document['cards']), 6)
                self.assertEqual(len(document['passports']), int(passport is not None))
                self.assertNotIn('LERNE_PASSPORT', str(document['cards']))

    def test_multi_deck_scoping_resets_ids_and_supports_no_passport(self):
        text = '\n---\n'.join([lesson('09', sample('09'), 6, 99), lesson('12', sample('12')), lesson('13', sample('13')), lesson('Legacy')])
        doc = author.parse_document(text)
        self.assertEqual(doc['errors'], [])
        self.assertEqual([p['deck_name'] for p in doc['passports']], ['09', '12', '13'])
        self.assertEqual([p['deck_id'] for p in doc['passports']], [99, None, None])
        self.assertEqual(doc['cards'][-1]['deck_name'], 'Legacy')
        self.assertIsNone(doc['cards'][-1]['deck_id'])

    def test_malformed_json_unclosed_duplicate_and_missing_fields(self):
        invalid = [
            '# Deck: D\n<<<LERNE_PASSPORT>>>\n{bad}\n<<<END_LERNE_PASSPORT>>>\nFRONT:\nx\nBACK:\ny',
            '# Deck: D\n<<<LERNE_PASSPORT>>>\nFRONT:\nshould never be a card',
            lesson(passport={}),
            lesson(passport=sample()) + '\n<<<LERNE_PASSPORT>>>\n' + json.dumps(sample()) + '\n<<<END_LERNE_PASSPORT>>>',
            lesson(passport=sample()) + '\n' + lesson(passport=sample()),
            '# Deck: D\n<<<LERNE_PASSPORT>>>\n{"schema_version":1,"schema_version":1,"intro":{}}\n<<<END_LERNE_PASSPORT>>>'
        ]
        for text in invalid:
            with self.subTest(text=text[:80]):
                self.assertTrue(author.parse_document(text)['errors'])
                with self.assertRaises(ValueError):
                    author.parse_cards_text(text)
        self.assertEqual(author.parse_document(invalid[1])['cards'], [])

    def test_schema_ids_ranges_types_and_extensibility(self):
        self.assertEqual(validate_passport(sample()), [])
        for field, value in [('lesson_type', []), ('stages', 'not array'), ('competencies', [None])]:
            passport = sample()
            passport['pedagogy'][field] = value
            self.assertTrue(validate_passport(passport))
        passport = sample()
        passport['pedagogy']['stages'][0]['from_card'] = 0
        passport['pedagogy']['stages'][1]['id'] = 'stage_1'
        self.assertTrue(validate_passport(passport))
        passport = sample()
        passport['pedagogy']['future_diagnostics'] = {'custom': True}
        self.assertEqual(validate_passport(passport), [])

    def test_assessment_requires_bounded_complete_nonoverlapping_bands(self):
        source = json.loads((Path(__file__).resolve().parents[2] / 'reports/lesson-qa/corrected.snapshot.json').read_text(encoding='utf-8'))
        passport = json.loads(next(d['metadata'] for d in source['decks'] if d['id'] == 7139))
        passport = {'schema_version': 1, 'intro': passport['intro'], 'pedagogy': passport['pedagogy']}
        self.assertEqual(validate_passport(passport), [])
        for mutate in (
            lambda p: p['pedagogy']['assessment'].update(schema_version=True),
            lambda p: p['pedagogy']['assessment'].update(required_count=10**12),
            lambda p: p['pedagogy']['assessment']['bands'][0].update(min=40),
            lambda p: p['pedagogy']['assessment']['bands'][0].update(min=42),
            lambda p: p['pedagogy'].update(lesson_type='practice'),
        ):
            candidate = json.loads(json.dumps(passport))
            mutate(candidate)
            self.assertTrue(validate_passport(candidate))

    def test_merge_partial_preserves_other_keys_and_intro_editor_fields(self):
        metadata = {'resources': ['file'], 'is_learning': True, 'intro': {'level': 'B1', 'title': 'Old'},
                    'pedagogy': {'schema_version': 1, 'lesson_type': 'review', 'custom': True}}
        changed = merge_passport(metadata, {'schema_version': 1, 'intro': {'goal': 'New'}})
        self.assertEqual(changed['intro'], {'level': 'B1', 'title': 'Old', 'goal': 'New'})
        self.assertEqual(changed['pedagogy'], metadata['pedagogy'])
        self.assertEqual(changed['resources'], ['file'])
        self.assertTrue(changed['is_learning'])
        self.assertNotIn('goal', metadata['intro'])




if __name__ == '__main__':
    unittest.main()
