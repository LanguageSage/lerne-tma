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
from api.services.answer_rules import evaluate_deterministic

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
                         {'theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank', 'free_text', 'editable_text'})

    def test_editable_text_requires_a_distinct_correction(self):
        card = {'type': 'editable_text', 'data': {
            'source_text': 'Ich trainiere, um ich stärker zu werden.',
            'correct_text': 'Ich trainiere, um stärker zu werden.'}}
        validated = validate_document(document(card))
        self.assertEqual(validated.cards[0].data.grading_policy.mode, 'controlled_text')
        self.assertFalse(validated.cards[0].data.grading_policy.typo_tolerance)
        data = validated.cards[0].data
        self.assertIsNone(evaluate_deterministic(data.source_text, [data.correct_text], data.grading_policy))
        self.assertTrue(evaluate_deterministic(data.correct_text, [data.correct_text], data.grading_policy).accepted)
        for correction in (card['data']['source_text'], ''):
            bad = copy.deepcopy(card)
            bad['data']['correct_text'] = correction
            self.assertInvalid(document(bad))

    def test_editable_text_legacy_projection_preserves_front_and_back(self):
        card = {'type': 'editable_text', 'data': {
            'source_text': 'Ich trainiere, um ich stärker zu werden.',
            'correct_text': 'Ich trainiere, um stärker zu werden.'}}
        projected = to_legacy_document(document(card))['cards'][0]
        self.assertEqual(projected['front'], '::exercise\n@edit\n' + card['data']['source_text'])
        self.assertEqual(projected['back'], card['data']['correct_text'])
        self.assertEqual(projected['metadata']['grading_policy']['mode'], 'controlled_text')


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

    def test_all_eight_types_project_through_actual_parsers_and_evaluators(self):
        value = json.loads((EXAMPLES / 'basics.json').read_text(encoding='utf-8'))
        for name in ('match.json', 'puzzle_quiz.json', 'word_bank_free_text.json'):
            value['cards'].extend(json.loads((EXAMPLES / name).read_text(encoding='utf-8'))['cards'])
        before = copy.deepcopy(value)
        result = to_legacy_document(value)
        self.assertEqual({card['card_type'] for card in result['cards']},
                         {'theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank', 'free_text'})
        process = subprocess.run(['node', str(ROOT / 'tools/structured_cards_v2_compat.mjs')],
            input=json.dumps({'legacy': result, 'expected': value}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout)['cards'], len(value['cards']))
        self.assertEqual(value, before)

    def test_word_bank_preserves_occurrences_gap_order_and_envelope(self):
        value = json.loads((EXAMPLES / 'word_bank_free_text.json').read_text(encoding='utf-8'))
        before = copy.deepcopy(value)
        result = to_legacy_document(value)
        card = result['cards'][0]
        self.assertIn('@wordbank\nGestern <<2>> ich nach Hause gegangen.\n'
                      'Ich <<3>> gekocht und <<1>> danach Deutsch gelernt.\n'
                      '@options\nhabe | bin | habe | ist | hat', card['front'])
        self.assertEqual(card['back'], '2=bin\n3=habe\n1=habe')
        self.assertEqual((card['source_id'], card['level'], card['topics']), ('perfekt-bank', 'B1', 'Perfekt'))
        self.assertEqual(card['context'], value['cards'][0]['explanation'])
        result['cards'][0]['metadata']['tags'].append('changed')
        result['cards'][2]['metadata']['accepted_answers'].append('changed')
        result['cards'][2]['metadata']['grading_policy']['max_retries'] = 9
        self.assertEqual(value, before)

    def test_word_bank_rejects_lossy_options_text_and_normalization_with_paths(self):
        source = json.loads((EXAMPLES / 'word_bank_free_text.json').read_text(encoding='utf-8'))['cards'][0]
        for option in (' a', 'a ', '\ufeffa', 'a\ufeff', 'a|b', 'a\nb', 'a\rb', 'a\u2028b', '@options', '::task', 'HABE'):
            card = copy.deepcopy(source)
            card['data']['options'][4] = option
            value = document(card)
            validate_document(value)
            with self.subTest(option=option), self.assertRaisesRegex(LegacyConversionError, r'cards\[0\].data.options\[4\]:'):
                to_legacy_document(value)
        for text in (' leading', 'a\rB', 'a\n\nb', 'a\n \nB', 'a\n@options\nB', 'a\n::task\nB',
                     '<<literal>>', '[[literal]]', '___WORD_BANK_GAP_2___', 'a\u2029b'):
            card = copy.deepcopy(source)
            card['data']['parts'][0]['text'] = text
            with self.subTest(text=text), self.assertRaisesRegex(LegacyConversionError, r'cards\[0\].data.parts\[0\].text:'):
                to_legacy_document(document(card))
        for pieces in (['a\n', '\nB'], ['<', '<1>>'], ['[', '[literal]]'], ['a\n@op', 'tions\nB']):
            card = copy.deepcopy(source)
            card['data']['parts'][:1] = [{'type': 'text', 'text': text} for text in pieces]
            with self.subTest(pieces=pieces), self.assertRaisesRegex(LegacyConversionError, r'data.parts\[\d+\].text:'):
                to_legacy_document(document(card))
        card = copy.deepcopy(source)
        card['data']['parts'][-1]['text'] += '\ufeff'
        with self.assertRaisesRegex(LegacyConversionError, r'data.parts\[6\].text:'):
            to_legacy_document(document(card))
        for options in (['two  words', 'two words'], ['two\twords', 'TWO WORDS']):
            with self.assertRaisesRegex(LegacyConversionError, r'data.options\[1\]:'):
                to_legacy_document(document({'type': 'word_bank', 'data': {
                    'options': options, 'parts': [{'type': 'gap', 'option': 0}]}}))

    def test_word_bank_preserves_markup_internal_spacing_and_subword_gaps(self):
        cards = []
        for options, parts in (
            (['two  words', '**literal**', 'a=b; c/d', '<img>'], [
                {'type': 'text', 'text': '**Wort**: '}, {'type': 'gap', 'option': 0},
                {'type': 'text', 'text': '\nA\t B'}]),
            (['em', 'en'], [{'type': 'text', 'text': 'mit gut'}, {'type': 'gap', 'option': 0},
                            {'type': 'text', 'text': ' Grund'}]),
            (['a', 'a'], [{'type': 'gap', 'option': 1}, {'type': 'gap', 'option': 0}])):
            cards.append({'type': 'word_bank', 'data': {'options': options, 'parts': parts}})
        cards.append({'type': 'free_text', 'data': {'prompt': 'Schreiben Sie.\n\nZwei Sätze.',
            'sample_answer': '**Ein Beispiel.**\r\nNoch ein Satz.',
            'accepted_answers': [' Alternative. ', '**literal**\nZweite Zeile.']}})
        value = {**document(), 'cards': cards}
        process = subprocess.run(['node', str(ROOT / 'tools/structured_cards_v2_compat.mjs')],
            input=json.dumps({'legacy': to_legacy_document(value), 'expected': value}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)

    def test_free_text_preserves_all_grading_fields_and_defaults_in_existing_metadata(self):
        value = json.loads((EXAMPLES / 'word_bank_free_text.json').read_text(encoding='utf-8'))
        cards = to_legacy_document(value)['cards']
        for source, card in zip(validate_document(value).cards[1:], cards[1:]):
            self.assertEqual(card['metadata']['grading_policy'], source.data.grading_policy.model_dump())
            self.assertEqual(card['metadata']['accepted_answers'], source.data.accepted_answers)
            self.assertEqual(card['back'], source.data.sample_answer)
            self.assertIn('@free\n' + source.data.prompt, card['front'])
        self.assertEqual(cards[1]['metadata']['grading_policy']['mode'], 'open_text')
        self.assertEqual(cards[2]['metadata']['grading_policy']['mode'], 'controlled_text')
        self.assertEqual(cards[3]['metadata']['grading_policy']['mode'], 'exact')

    def test_free_text_lossy_prompt_and_sample_fail_without_partial_result(self):
        for field, texts in (
                ('prompt', [' Q', 'Q\ufeff', '**bold**', '`code`', 'A\rB', 'A\u2028B', 'Q\n@free', 'Q\n::source\nX']),
                ('sample_answer', [' A', 'A ', '\ufeffA', 'A\ufeff'])):
            for text in texts:
                value = document()
                value['cards'].append({'type': 'free_text', 'data': {
                    'prompt': 'Schreiben Sie.', 'sample_answer': 'Beispiel.', field: text}})
                before = copy.deepcopy(value)
                validate_document(value)
                with self.subTest(field=field, text=text), self.assertRaisesRegex(
                        LegacyConversionError, rf'cards\[1\].data.{field}:'):
                    to_legacy_document(value)
                self.assertEqual(value, before)

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
        self.assertEqual(json.loads(process.stdout), {'cards': 10, 'gaps': 8, 'pairs': 0, 'tokens': 0, 'options': 0})

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
        self.assertEqual(json.loads(process.stdout), {'cards': 2, 'gaps': 0, 'pairs': 10, 'tokens': 0, 'options': 0})

    def test_puzzle_quiz_projection_and_actual_frontend_evaluators(self):
        value = json.loads((EXAMPLES / 'puzzle_quiz.json').read_text(encoding='utf-8'))
        value['cards'].append({'type': 'puzzle', 'data': {'tokens': ['Ja!'], 'translation': '  **Да!**\r\nТочно.  '}})
        # Single correct option at every source position, independent of shuffling.
        for correct in range(3):
            value['cards'].append({'type': 'quiz', 'data': {'prompt': 'ÄÖÜ: Was passt?', 'options': [
                {'text': text, 'correct': i == correct} for i, text in enumerate(['A & B', '«Ja!»', '[x] literal'])]}})
        before = copy.deepcopy(value)
        result = to_legacy_document(value)
        self.assertEqual(value, before)
        self.assertEqual(result['cards'][0]['front'], '::task\nOrdnen Sie die Wörter.\n\n::exercise\n@puzzle\n'
                         + ' '.join(value['cards'][0]['data']['tokens']))
        self.assertEqual(result['cards'][0]['back'], value['cards'][0]['data']['translation'])
        self.assertEqual(result['cards'][1]['front'], '::source\nDeutschland hat sechzehn Bundesländer.\n\n::exercise\n'
                         'Welche Stadt ist die Hauptstadt Deutschlands?\nWählen Sie eine Antwort.\n\n'
                         '[ ] München\n[*] Berlin\n[ ] Hamburg')
        self.assertEqual(result['cards'][1]['back'], 'Berlin')
        for index in (0, 1):
            self.assertEqual(result['cards'][index]['context'], value['cards'][index]['explanation'])
            self.assertEqual(result['cards'][index]['source_id'], value['cards'][index]['id'])
            self.assertEqual((result['cards'][index]['level'], result['cards'][index]['topics']),
                             ('B1', 'Sprache und Alltag'))
        process = subprocess.run(['node', str(ROOT / 'tools/structured_cards_v2_compat.mjs')],
            input=json.dumps({'legacy': result, 'expected': value}, ensure_ascii=False),
            capture_output=True, text=True, encoding='utf-8', cwd=ROOT, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {'cards': 6, 'gaps': 0, 'pairs': 0, 'tokens': 10, 'options': 12})

    def test_puzzle_rejects_unrepresentable_tokens_with_indexed_field_paths(self):
        for token in ('two words', 'a\tb', 'a\nb', 'a\rb', 'a\u00a0b', 'a\ufeffb',
                      ' leading', 'trailing ', '**bold**', '_word_', '`code`', '<large>x</large>',
                      '@theory', '::exercise'):
            value = document({'type': 'puzzle', 'data': {'tokens': ['A', token], 'translation': 'Перевод'}})
            validate_document(value)
            with self.subTest(token=token), self.assertRaisesRegex(LegacyConversionError, r'cards\[0\].data.tokens\[1\]:'):
                to_legacy_document(value)

    def test_quiz_multiple_correct_answers_remain_valid_but_cannot_be_projected(self):
        value = document({'type': 'quiz', 'data': {'prompt': 'Choose', 'options': choice()['options']}})
        before = copy.deepcopy(value)
        validate_document(value)
        with self.assertRaisesRegex(LegacyConversionError, r'cards\[0\].data.options:.*exactly one correct answer'):
            to_legacy_document(value)
        self.assertEqual(value, before)

    def test_quiz_rejects_lossy_question_and_option_content_with_field_paths(self):
        for field, texts in (
            ('prompt', [' spaced ', 'Two\n\nparagraphs', 'Two\n\ufeff\nparagraphs', 'A\rB', 'Q\u2028@match', 'Why ?',
                        'Why\ufeff?', '**bold**', '[[gap]]', '{choice}', 'Q\n@match', 'Q\n\ufeff::task\nX']),
            ('options[1].text', [' spaced ', 'A\nB', 'A\rB', 'A\u2029B', 'Hallo !', '**bold**', '`code`',
                                  '[[gap]]', '{choice}', '- literal', '• literal', 'A) literal', '1. literal'])):
            for text in texts:
                card = {'type': 'quiz', 'data': {'prompt': 'Choose', 'options': [
                    {'text': 'Right', 'correct': True}, {'text': 'Wrong'}]}}
                if field == 'prompt':
                    card['data']['prompt'] = text
                else:
                    card['data']['options'][1]['text'] = text
                value = document(card)
                before = copy.deepcopy(value)
                validate_document(value)
                with self.subTest(field=field, text=text), self.assertRaises(LegacyConversionError) as error:
                    to_legacy_document(value)
                self.assertIn(f'cards[0].data.{field}:', str(error.exception))
                self.assertEqual(value, before)

    def test_cli_validates_previews_and_reports_nonzero_on_failure(self):
        for command, fixture, expected_code in (('validate', 'basics.json', 0),
                                                ('validate', 'other_types.json', 0),
                                                ('to-legacy', 'basics.json', 0),
                                                ('to-legacy', 'match.json', 0),
                                                ('to-legacy', 'puzzle_quiz.json', 0),
                                                ('to-legacy', 'word_bank_free_text.json', 0),
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

    def test_author_service_parse_document_compiles_v2_json_and_preserves_metadata(self):
        from unittest.mock import patch
        with patch('api.database.initialize_database'), patch('api.database.create_all_tables', create=True):
            from api.services.author_service import parse_document
        raw_text = (EXAMPLES / 'word_bank_free_text.json').read_text(encoding='utf-8')
        doc = parse_document(raw_text, default_deck_id=42)
        self.assertEqual(doc['errors'], [])
        self.assertEqual(len(doc['cards']), 4)
        self.assertEqual(doc['decks'], [{'deck_name': 'Perfekt: Wortbank und Schreiben', 'deck_id': 42, 'cards_count': 4}])
        self.assertEqual(len(doc['passports']), 1)
        self.assertEqual(doc['cards'][0]['card_type'], 'word_bank')
        self.assertEqual(doc['cards'][1]['card_type'], 'free_text')
        self.assertEqual(doc['cards'][1]['metadata']['grading_policy']['mode'], 'open_text')
        self.assertEqual(doc['cards'][2]['metadata']['accepted_answers'], ['Ich habe meine Freunde besucht.'])


if __name__ == '__main__':
    unittest.main()
