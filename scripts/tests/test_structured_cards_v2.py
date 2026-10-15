"""Offline contracts and actual JS parser/evaluator compatibility. No writes/API/AI."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from pydantic import ValidationError
from api.services.structured_cards_v2 import Document, load_document, validate_document
from api.services.structured_cards_legacy import LegacyConversionError, to_legacy_document

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / 'project_docs/examples/structured_cards_v2'


def document(card=None):
    return {'schema_version': 2, 'deck': {'name': 'Test'},
            'cards': [card or {'type': 'standard', 'data': {'prompt': 'Haus', 'answer': 'дом'}}]}


def trainer(parts):
    return {'type': 'trainer', 'data': {'parts': parts}}


def choice():
    return {'type': 'choice', 'options': [{'text': 'weil', 'correct': True},
                                        {'text': 'da', 'correct': True}, {'text': 'denn'}]}


class V2ValidationTests(unittest.TestCase):
    def assertInvalid(self, value):
        with self.assertRaises((ValidationError, ValueError)):
            validate_document(value)

    def test_examples_cover_every_existing_type_and_both_trainer_modes(self):
        types = set()
        for path in EXAMPLES.glob('*.json'):
            value = load_document(path.read_text(encoding='utf-8'))
            types.update(card.type for card in value.cards)
        self.assertEqual(types, {'theory', 'standard', 'trainer', 'quiz', 'match',
                                 'puzzle', 'word_bank', 'free_text'})

    def test_version_and_top_level_shape_are_strict(self):
        for version in (1, 3, '2', 2.0, True, None):
            value = document()
            value['schema_version'] = version
            with self.subTest(version=version):
                self.assertInvalid(value)
        for value in (None, [], {}, {**document(), 'cards': []}, {**document(), 'cards': None}):
            self.assertInvalid(value)

    def test_unknown_type_fields_and_shadow_content_are_rejected(self):
        for extra in ({'type': 'invented'}, {'front': 'other source'}, {'back': 'other answer'},
                      {'metadata': {'front_text': 'shadow'}}, {'data': {'prompt': 'Q', 'answer': 'A', 'typo': 1}}):
            value = document()
            value['cards'][0].update(extra)
            self.assertInvalid(value)
        value = document()
        value['deck']['metadata'] = {'intro': {'title': 'shadow passport'}}
        self.assertInvalid(value)

    def test_content_is_not_inferred_from_text_syntax(self):
        value = document({'type': 'standard', 'data': {'prompt': '@match\n[[literal]]', 'answer': 'A'}})
        self.assertEqual(validate_document(value).cards[0].type, 'standard')
        with self.assertRaises(LegacyConversionError):
            to_legacy_document(value)

    def test_required_text_and_option_booleans_are_strict(self):
        for prompt in ('', '   ', 12, None):
            self.assertInvalid(document({'type': 'standard', 'data': {'prompt': prompt, 'answer': 'A'}}))
        for correct in ('true', 1, None):
            part = choice()
            part['options'][0]['correct'] = correct
            self.assertInvalid(document(trainer([part])))
        self.assertInvalid(document(trainer([{'type': 'input', 'answers': [' ']}])))

    def test_mixed_trainer_requires_gaps_answers_and_unambiguous_options(self):
        bad_parts = [[], [{'type': 'text', 'text': 'No gap'}],
                     [{'type': 'input', 'answers': []}],
                     [{'type': 'input', 'answers': ['hatte', 'hatte']}],
                     [{'type': 'choice', 'options': [{'text': 'a', 'correct': True}]}],
                     [{'type': 'choice', 'options': [{'text': 'a'}, {'text': 'b'}]}],
                     [{'type': 'choice', 'options': [{'text': 'a', 'correct': True}, {'text': 'a'}]}]]
        for parts in bad_parts:
            with self.subTest(parts=parts):
                self.assertInvalid(document(trainer(parts)))
        value = document(trainer([choice(), {'type': 'text', 'text': ' '},
                                   {'type': 'input', 'answers': ['hatte', 'hätte']}]))
        self.assertEqual(len(validate_document(value).cards[0].data.parts), 3)

    def test_quiz_correctness_is_explicit_and_can_have_multiple_answers(self):
        value = document({'type': 'quiz', 'data': {'prompt': 'Q', 'options': choice()['options']}})
        self.assertEqual(sum(option.correct for option in validate_document(value).cards[0].data.options), 2)
        for option in value['cards'][0]['data']['options']:
            option['correct'] = False
        self.assertInvalid(value)

    def test_match_requires_two_complete_pairs_and_preserves_repeated_labels(self):
        for pairs in ([{'left': 'a', 'right': 'b'}],
                      [{'left': 'a', 'right': 'b'}, {'left': 'c', 'right': ''}]):
            self.assertInvalid(document({'type': 'match', 'data': {'pairs': pairs}}))
        pairs = [{'left': 'a', 'right': 'b'}, {'left': 'c', 'right': 'b'}]
        self.assertEqual(len(validate_document(document({'type': 'match', 'data': {'pairs': pairs}})).cards[0].data.pairs), 2)

    def test_puzzle_correct_order_can_contain_repeated_tokens(self):
        value = document({'type': 'puzzle', 'data': {'tokens': ['Wenn', 'Fliegen', 'hinter', 'Fliegen', 'fliegen.']}})
        self.assertEqual(len(validate_document(value).cards[0].data.tokens), 5)
        self.assertInvalid(document({'type': 'puzzle', 'data': {'tokens': [' ']}}))

    def test_word_bank_indices_and_consumable_duplicates(self):
        data = {'options': ['hatte', 'hatte', 'war'], 'parts': [
            {'type': 'gap', 'option': 0}, {'type': 'text', 'text': ' / '}, {'type': 'gap', 'option': 1}]}
        validate_document(document({'type': 'word_bank', 'data': data}))
        for index in (0, 3, -1, '1', True):
            changed = copy.deepcopy(data)
            changed['parts'][2]['option'] = index
            with self.subTest(index=index):
                self.assertInvalid(document({'type': 'word_bank', 'data': changed}))

    def test_free_text_reuses_grading_policy_and_requires_sample(self):
        value = document({'type': 'free_text', 'data': {'prompt': 'Describe a city.', 'sample_answer': 'Berlin is big.'}})
        self.assertEqual(validate_document(value).cards[0].data.grading_policy.mode, 'open_text')
        value['cards'][0]['data']['grading_policy'] = {'mode': 'invented'}
        self.assertInvalid(value)
        value['cards'][0]['data'] = {'prompt': 'Q', 'sample_answer': ''}
        self.assertInvalid(value)

    def test_ids_info_metadata_and_finite_json(self):
        value = document()
        value['cards'][0]['id'] = 'same'
        value['cards'].append(copy.deepcopy(value['cards'][0]))
        self.assertInvalid(value)
        for metadata in ({'score': float('nan')}, {'score': float('inf')}, {'date': object()}):
            value = document()
            value['cards'][0]['metadata'] = metadata
            self.assertInvalid(value)
        value = document()
        value['cards'][0]['info'] = [{'type': 'source', 'text': ''}]
        self.assertInvalid(value)

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_values(self):
        for text in ('{"schema_version":2,"schema_version":2}',
                     '{"x":NaN}', '{"x":Infinity}', '{not JSON}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                load_document(text)

    def test_passport_uses_existing_contract_and_bounds_card_ranges(self):
        for passport in ({'schema_version': 2, 'intro': {}},
                         {'schema_version': 1, 'intro': {'level': 'B9'}},
                         {'schema_version': 1, 'pedagogy': {'lesson_type': 'invented'}},
                         {'schema_version': 1, 'pedagogy': {'lesson_type': 'practice', 'stages': [
                             {'id': 'one', 'title': 'One', 'goal': 'G', 'support': 'high', 'from_card': 1, 'to_card': 2}]}}):
            value = document()
            value['deck']['passport'] = passport
            self.assertInvalid(value)

    def test_schema_is_generated_from_validator(self):
        schema = Document.model_json_schema()
        self.assertEqual(schema['properties']['schema_version']['const'], 2)
        self.assertEqual(set(schema['properties']['cards']['items']['discriminator']['mapping']),
                         {'theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank', 'free_text'})


class V2LegacyTests(unittest.TestCase):
    def test_inheritance_overrides_metadata_and_input_immutability(self):
        value = json.loads((EXAMPLES / 'basics.json').read_text(encoding='utf-8'))
        before = copy.deepcopy(value)
        result = to_legacy_document(value)
        self.assertEqual(value, before)
        self.assertEqual(result['deck']['passport'], value['deck']['passport'])
        self.assertEqual(result['cards'][0]['level'], 'B1')
        self.assertEqual(result['cards'][0]['topics'], 'Vorzeitigkeit')
        self.assertEqual(result['cards'][1]['level'], 'A2')
        self.assertEqual(result['cards'][1]['topics'], 'Ankommen')
        self.assertEqual(result['cards'][-1]['metadata'], value['cards'][-1]['metadata'])
        self.assertEqual(result['cards'][-1]['back'], 'Als, hatte, gegessen')
        self.assertNotIn('card_id', result['cards'][0])
        result['cards'][-1]['metadata']['tags'].append('changed')
        self.assertEqual(value, before)
        # Each override inherits the other field independently; [] explicitly clears topics.
        for overrides, expected in (({'level': 'C1'}, ('C1', 'Vorzeitigkeit')),
                                    ({'topics': ['Other']}, ('B1', 'Other')),
                                    ({'topics': []}, ('B1', ''))):
            value['cards'][0].update(level=None, topics=None)
            value['cards'][0].update(overrides)
            card = to_legacy_document(value)['cards'][0]
            self.assertEqual((card['level'], card['topics']), expected)

    def test_literal_markers_are_valid_v2_but_lossy_legacy_is_rejected(self):
        for text in ('Text\n::source\nChanged block', '@theory\nLiteral', '[[answer]]', '{x}',
                     'Question\nA) *One\nB) Two'):
            with self.subTest(text=text), self.assertRaises(LegacyConversionError):
                to_legacy_document(document({'type': 'standard', 'data': {'prompt': text, 'answer': 'A'}}))
        for text in ('A\n::task\nB', 'A\n\n@theory\nB'):
            value = document()
            value['cards'][0]['info'] = [{'type': 'source', 'text': text}]
            with self.assertRaises(LegacyConversionError):
                to_legacy_document(value)

    def test_unrepresentable_gap_answers_are_not_silently_split(self):
        for answer in ('a/b', 'a|b', 'a;b', 'a,b', '[x]', '{x}', '*bold*', 'two\nlines', ' a ', '.', '!?'):
            value = document(trainer([{'type': 'input', 'answers': [answer]}]))
            validate_document(value)
            with self.subTest(answer=answer), self.assertRaises(LegacyConversionError):
                to_legacy_document(value)
        value = document(trainer([{'type': 'text', 'text': '[literal] '}, choice()]))
        with self.assertRaises(LegacyConversionError):
            to_legacy_document(value)

    def test_legacy_normalization_must_not_accept_declared_distractor(self):
        part = {'type': 'choice', 'options': [{'text': 'war', 'correct': True}, {'text': 'War!'}]}
        with self.assertRaises(LegacyConversionError):
            to_legacy_document(document(trainer([part])))

    def test_info_options_must_not_change_their_item_boundaries(self):
        value = document()
        value['cards'][0]['info'] = [{'type': 'options', 'items': ['a|b', 'c']}]
        with self.assertRaises(LegacyConversionError):
            to_legacy_document(value)

    def test_all_unimplemented_types_fail_without_partial_results(self):
        value = json.loads((EXAMPLES / 'other_types.json').read_text(encoding='utf-8'))
        for card in value['cards']:
            if card['type'] == 'match':
                continue
            combined = document()
            combined['cards'].append(card)
            with self.subTest(type=card['type']), self.assertRaisesRegex(LegacyConversionError, r'cards\[1\].type'):
                to_legacy_document(combined)

    def test_actual_frontend_parsers_and_evaluator_accept_projection(self):
        value = json.loads((EXAMPLES / 'basics.json').read_text(encoding='utf-8'))
        value['cards'].extend([
            trainer([choice(), {'type': 'text', 'text': ' '}, {'type': 'input', 'answers': ['hatte', 'hätte']}]),
            trainer([{'type': 'text', 'text': 'mit gut'}, {'type': 'input', 'answers': ['em']},
                     {'type': 'text', 'text': ' Grund'}]),
            {'type': 'theory', 'data': {'text': 'Form: [[hatte]] {*war|ist} — nur Beispiele.'}},
            {'type': 'standard', 'info': [{'type': 'options', 'items': ['eins', 'zwei']},
                                         {'type': 'source', 'text': 'Mehrere Absätze.\n\nZweiter Absatz.'},
                                         {'type': 'example', 'text': 'A'}, {'type': 'example', 'text': 'B'}],
             'data': {'prompt': 'Zahl', 'answer': 'число'}},
            {'type': 'standard', 'data': {'prompt': '1. Haus\n2. Wohnung', 'answer': 'дом, квартира'}}
        ])
        process = subprocess.run(['node', str(ROOT / 'tools/structured_cards_v2_compat.mjs')],
            input=json.dumps({'legacy': to_legacy_document(value), 'expected': value}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {'cards': 10, 'gaps': 8, 'pairs': 0})

    def test_match_projection_preserves_order_duplicates_and_envelope(self):
        value = json.loads((EXAMPLES / 'match.json').read_text(encoding='utf-8'))
        before = copy.deepcopy(value)
        result = to_legacy_document(value)
        card = result['cards'][0]
        self.assertEqual(card['front'], '::task\nOrdnen Sie die Verben dem passenden Hilfsverb zu.\n\n'
                         '::source\nDie Verben stehen im Infinitiv.\n\n::example\nfahren → sein\n\n'
                         '::exercise\n@match\nkommen => sein\nlesen => haben\ngehen => sein\nlesen => haben')
        self.assertEqual(card['back'], 'kommen => sein\nlesen => haben\ngehen => sein\nlesen => haben')
        self.assertEqual(card['context'], value['cards'][0]['explanation'])
        self.assertEqual((card['card_type'], card['source_id'], card['level'], card['topics']),
                         ('match', 'perfekt-match', 'A2', 'Perfekt'))
        self.assertEqual(card['metadata'], value['cards'][0]['metadata'])
        self.assertEqual(result['deck']['passport'], value['deck']['passport'])
        card['metadata']['tags'].append('changed')
        self.assertEqual(value, before)

    def test_match_rejects_lossy_labels_with_card_pair_and_side_paths(self):
        labels = [' spaced', 'spaced ', '\ufeffBOM', 'BOM\ufeff', 'A\nB', 'A\rB',
                  'A\r\nB', 'A => B', 'A->B', 'A—B', 'A=B', '**bold**', '_italic_',
                  '`code`', '<center>A</center>', '<large>A</large>', 'A\n::task\nB']
        for side in ('left', 'right'):
            for label in labels:
                value = document()
                value['cards'].append({'type': 'match', 'data': {'pairs': [
                    {'left': 'eins', 'right': 'one'}, {'left': 'zwei', 'right': 'two', side: label}]}})
                before = copy.deepcopy(value)
                validate_document(value)  # These remain valid authoring data.
                with self.subTest(side=side, label=label), self.assertRaisesRegex(
                        LegacyConversionError, rf'cards\[1\].data.pairs\[1\].{side}:'):
                    to_legacy_document(value)
                self.assertEqual(value, before)

    def test_match_actual_parser_evaluator_and_interchangeable_right_tiles(self):
        value = json.loads((EXAMPLES / 'match.json').read_text(encoding='utf-8'))
        value['cards'].append({'type': 'match', 'data': {'pairs': [
            {'left': 'Повтор', 'right': 'two  words'},
            {'left': 'Повтор', 'right': 'two\twords'},
            {'left': 'ÄÖÜ ß?! «Wort»', 'right': 'Two words'},
            {'left': '[[literal]] {text} @match', 'right': 'two words'},
            {'left': '<img>', 'right': 'обычный текст'},
            {'left': 'a/b; c,d | x - y – z', 'right': 'обычный текст'}]}})
        process = subprocess.run(['node', str(ROOT / 'tools/structured_cards_v2_compat.mjs')],
            input=json.dumps({'legacy': to_legacy_document(value), 'expected': value}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {'cards': 2, 'gaps': 0, 'pairs': 10})

    def test_cli_validates_previews_and_reports_nonzero_on_failure(self):
        for command, fixture, expected_code in (('validate', 'basics.json', 0),
                                                ('validate', 'other_types.json', 0),
                                                ('to-legacy', 'basics.json', 0),
                                                ('to-legacy', 'match.json', 0),
                                                ('to-legacy', 'other_types.json', 1)):
            with self.subTest(command=command, fixture=fixture):
                process = subprocess.run([sys.executable, str(ROOT / 'scripts/structured_cards_v2.py'),
                                          command, str(EXAMPLES / fixture)], capture_output=True,
                                         text=True, encoding='utf-8', cwd=ROOT, timeout=30)
                self.assertEqual(process.returncode, expected_code, process.stderr)
                result = json.loads(process.stdout if expected_code == 0 else process.stderr)
                if command == 'to-legacy' and expected_code == 0:
                    source = json.loads((EXAMPLES / fixture).read_text(encoding='utf-8'))
                    self.assertEqual(result['deck']['name'], source['deck']['name'])
                    self.assertEqual(len(result['cards']), len(source['cards']))
                else:
                    self.assertEqual(result['valid'], expected_code == 0)

    def test_cli_conversion_does_not_connect_or_execute_sql_even_during_import(self):
        code = '''
import runpy
import sys
from unittest.mock import patch
sys.argv = ['scripts/structured_cards_v2.py', 'to-legacy',
            'project_docs/examples/structured_cards_v2/basics.json']
with patch('peewee.Database.connect', side_effect=AssertionError('No database')) as connection, \\
     patch('peewee.Database.execute_sql', side_effect=AssertionError('No SQL')) as sql:
    try:
        runpy.run_path('scripts/structured_cards_v2.py', run_name='__main__')
    except SystemExit as exc:
        assert exc.code == 0
    connection.assert_not_called()
    sql.assert_not_called()
'''
        process = subprocess.run([sys.executable, '-c', code], capture_output=True,
                                 text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(json.loads(process.stdout)['cards']), 5)


if __name__ == '__main__':
    unittest.main()
