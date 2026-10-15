"""Stage 1 contracts only: no api.services initializer, ORM, API or legacy parsers."""
import copy
import importlib
import json
from pathlib import Path
import sys
from types import ModuleType
import unittest

from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[2]


def load_pure_contract():
    # The real package __init__ eagerly imports DB services. Load the same source
    # under a temporary package, restoring sys.modules afterwards for other suites.
    package = ModuleType('api.services')
    package.__path__ = [str(ROOT / 'api/services')]
    protected = {'api.services', 'api.models', 'api.database'}
    saved = {key: value for key, value in sys.modules.items()
             if key in protected or key.startswith('api.services.')}
    try:
        sys.modules.update({'api.services': package, 'api.models': None,
                            'api.database': None,
                            'api.services.structured_cards_legacy': None})
        sys.modules.pop('api.services.structured_cards_v2', None)
        return importlib.import_module('api.services.structured_cards_v2')
    finally:
        for key in list(sys.modules):
            if key in protected or key.startswith('api.services.'):
                del sys.modules[key]
        sys.modules.update(saved)


v2 = load_pure_contract()
REQUEST_ID = 'b1c1aab2-c89b-4f4a-9ff2-faa84d0ab7aa'
LITERAL = '  @quiz\n[[literal|*answer]] {a|b}\n::source\nFRONT: **ä**\r\n  '


def fixtures():
    return {
        'theory': {'text': LITERAL, 'summary': ''},
        'standard': {'prompt': LITERAL, 'answer': 'ANSWER'},
        'trainer': {'parts': [{'type': 'text', 'text': LITERAL},
                              {'type': 'input', 'answers': ['SECRET', 'SECRET2']},
                              {'type': 'text', 'text': ' '},
                              {'type': 'choice', 'options': [
                                  {'text': 'YES', 'correct': True}, {'text': 'NO'}]}]},
        'quiz': {'prompt': LITERAL, 'options': [{'text': 'a', 'correct': True},
                                              {'text': 'b', 'correct': True}, {'text': 'c'}]},
        'match': {'pairs': [{'left': 'x', 'right': 'y'}, {'left': 'x', 'right': 'y'}]},
        'puzzle': {'tokens': ['Fliegen', 'Fliegen', 'two words'], 'translation': ''},
        'word_bank': {'options': ['SECRET', 'SECRET', 'other'], 'parts': [
            {'type': 'text', 'text': LITERAL}, {'type': 'gap', 'option': 0},
            {'type': 'text', 'text': ' '}, {'type': 'gap', 'option': 1}]},
        'free_text': {'prompt': LITERAL, 'sample_answer': 'SAMPLE',
                      'accepted_answers': ['same', 'same']},
    }


def card(kind='standard'):
    return {'id': 'author-125', 'type': kind, 'data': fixtures()[kind],
            'info': [{'type': 'source', 'text': 'source'},
                     {'type': 'options', 'items': ['repeat', 'repeat']},
                     {'type': 'task', 'text': 'task'}],
            'explanation': '', 'level': None, 'topics': None,
            'metadata': {'origin': {'empty': '', 'null': None, 'values': [1, True, 0.5]},
                         'tags': ['same', 'same']}}


def request(kind='standard', update=False):
    return {'request_id': REQUEST_ID, 'card_id': 125 if update else None,
            'deck_id': 20, 'base_revision': 7 if update else None,
            'content_version': 2, 'content_v2': card(kind)}


class StorageContractTests(unittest.TestCase):
    def test_every_type_round_trips_without_document_or_legacy(self):
        for kind in fixtures():
            with self.subTest(kind=kind):
                source = card(kind)
                before = copy.deepcopy(source)
                normalized = v2.normalize_card(source)
                self.assertEqual(v2.validate_card(source).type, kind)
                self.assertEqual(v2.load_card(v2.serialize_card(source)).type, kind)
                self.assertEqual(v2.normalize_card(normalized), normalized)
                self.assertEqual(v2.serialize_card(normalized), v2.serialize_card(source))
                self.assertEqual(source, before)
                # Every supplied value survives; defaults may only be added.
                self.assertEqual(normalized['metadata'], source['metadata'])
                self.assertEqual(normalized['info'], source['info'])
                for key, value in source['data'].items():
                    if key != 'options' and kind != 'trainer':
                        self.assertEqual(normalized['data'][key], value)

    def test_multi_correct_quiz_is_native_and_never_converted(self):
        result = v2.load_save_request(json.dumps(request('quiz')))
        self.assertEqual([option.correct for option in result.content_v2.data.options],
                         [True, True, False])
        self.assertEqual(v2.project_card(result.content_v2).back_text, 'a\nb')

    def test_duplicate_items_keep_occurrences_and_order(self):
        for kind in ('puzzle', 'word_bank', 'match', 'free_text'):
            with self.subTest(kind=kind):
                self.assertEqual(v2.normalize_card(card(kind))['data'], fixtures()[kind] if
                                 kind != 'free_text' else
                                 {**fixtures()[kind], 'grading_policy': v2.FreeTextData(
                                     **fixtures()[kind]).grading_policy.model_dump()})

    def test_literal_syntax_whitespace_and_unicode_are_preserved(self):
        source = card()
        self.assertEqual(v2.normalize_card(source)['data']['prompt'], LITERAL)
        display = v2.project_card(source)
        self.assertEqual(display.front_text, 'source\nrepeat\nrepeat\ntask\n' + LITERAL)
        self.assertEqual(display.card_type, 'standard')

    def test_canonical_json_key_order_defaults_and_detached_result(self):
        source = {'type': 'standard', 'data': {'answer': 'ä', 'prompt': 'Q'}}
        reordered = {'data': {'prompt': 'Q', 'answer': 'ä'}, 'type': 'standard'}
        self.assertEqual(v2.serialize_card(source), v2.serialize_card(reordered))
        text = v2.serialize_card(source)
        self.assertIn('ä', text)
        self.assertEqual(text, json.dumps(json.loads(text), sort_keys=True,
                                         ensure_ascii=False, separators=(',', ':')))
        normalized = v2.normalize_card(source)
        self.assertEqual(normalized['explanation'], '')
        self.assertIsNone(normalized['level'])
        self.assertIsNone(normalized['topics'])
        source = card()
        normalized = v2.normalize_card(source)
        normalized['metadata']['tags'].append('detached')
        normalized['info'][1]['items'].append('detached')
        self.assertEqual(source, card())

    def test_passport_inheritance_is_independent_and_never_materialized(self):
        passport = {'schema_version': 1, 'intro': {'level': 'B1', 'topic': 'Verben'}}
        before = copy.deepcopy(passport)
        cases = [(None, None, 'B1', ['Verben']), ('A2', None, 'A2', ['Verben']),
                 (None, [], 'B1', []), (None, ['X', 'X'], 'B1', ['X', 'X'])]
        for level, topics, effective_level, effective_topics in cases:
            source = card()
            source.update(level=level, topics=topics)
            original = copy.deepcopy(source)
            display = v2.project_card(source, passport)
            self.assertEqual(display.effective_level, effective_level)
            self.assertEqual(display.effective_topics, effective_topics)
            display.effective_topics.append('detached')
            self.assertEqual(source, original)
        self.assertEqual(passport, before)
        absent = v2.project_card({'type': 'standard', 'data': {'prompt': 'Q', 'answer': 'A'}})
        self.assertIsNone(absent.effective_level)
        self.assertEqual(absent.effective_topics, [])

    def test_passport_uses_existing_validator(self):
        for passport in ({'schema_version': 2, 'intro': {}},
                         {'schema_version': 1, 'intro': {'level': 'B9'}}):
            with self.subTest(passport=passport), self.assertRaisesRegex(ValueError, 'passport'):
                v2.project_card(card(), passport)

    def test_display_for_all_eight_types_is_exact_and_deterministic(self):
        expected = {
            'theory': (LITERAL, ''), 'standard': (LITERAL, 'ANSWER'),
            'trainer': (LITERAL + '… …', 'SECRET / SECRET2\nYES / NO → YES'),
            'quiz': (LITERAL + '\na\nb\nc', 'a\nb'),
            'match': ('x\nx', 'x → y\nx → y'),
            'puzzle': ('Fliegen Fliegen two words', 'Fliegen Fliegen two words'),
            'word_bank': (LITERAL + '… …\nSECRET\nSECRET\nother', 'SECRET\nSECRET'),
            'free_text': (LITERAL, 'SAMPLE\nsame\nsame'),
        }
        for kind, (front, back) in expected.items():
            with self.subTest(kind=kind):
                source = card(kind)
                source['explanation'] = 'literal ::topic **text**'
                before = copy.deepcopy(source)
                display = v2.project_card(source)
                self.assertEqual(display.front_text, 'source\nrepeat\nrepeat\ntask\n' + front)
                self.assertEqual(display.back_text, back)
                self.assertEqual(display.context, source['explanation'])
                self.assertEqual(display, v2.project_card(source))
                self.assertEqual(source, before)
        self.assertNotIn('SECRET', v2.project_card(card('trainer')).front_text)
        self.assertNotIn('SAMPLE', v2.project_card(card('free_text')).front_text)

    def test_create_update_and_author_id_are_separate(self):
        for update in (False, True):
            value = v2.CardSaveRequest.model_validate(request(update=update))
            self.assertEqual(value.card_id, 125 if update else None)
            self.assertEqual(value.base_revision, 7 if update else None)
            self.assertEqual(value.content_v2.id, 'author-125')
        for card_id, revision in ((None, 1), (125, None), (125, 0), (125, -1), (125, True)):
            source = request()
            source.update(card_id=card_id, base_revision=revision)
            with self.subTest(card_id=card_id, revision=revision), self.assertRaises(ValidationError):
                v2.CardSaveRequest.model_validate(source)

    def test_ids_versions_and_required_fields_are_strict(self):
        for field, invalids in {
            'content_version': [1, 3, '2', 2.0, True, None],
            'card_id': ['125', -1, 0, True, 1.0], 'deck_id': [None, '20', -1, 0, True],
            'request_id': ['bad', 123, 'x' * 36], 'content_v2': [None, {}, 'json'],
        }.items():
            for invalid in invalids:
                source = request()
                source[field] = invalid
                with self.subTest(field=field, invalid=invalid), self.assertRaises(ValidationError):
                    v2.CardSaveRequest.model_validate(source)
        for field in request():
            source = request()
            del source[field]
            with self.subTest(missing=field), self.assertRaises(ValidationError):
                v2.CardSaveRequest.model_validate(source)
        source = card()
        source['id'] = 125
        with self.assertRaises(ValidationError):
            v2.validate_card(source)

    def test_save_forbids_every_independent_legacy_or_service_write(self):
        for field in ('front', 'back', 'FRONT', 'BACK', 'front_text', 'back_text', 'context',
                      'card_type', 'cefr', 'level', 'topics', 'metadata', 'card_revision',
                      'audio_path', 'image_path', 'id', 'unknown'):
            source = request()
            source[field] = 'forbidden'
            with self.subTest(field=field), self.assertRaises(ValidationError) as error:
                v2.CardSaveRequest.model_validate(source)
            self.assertIn((field,), [issue['loc'] for issue in error.exception.errors()])

    def test_invalid_fields_include_precise_nested_locations(self):
        cases = [({'type': 'standard', 'data': {'prompt': 'Q', 'answer': ''}}, ('data', 'answer')),
                 ({'type': 'quiz', 'data': {'prompt': 'Q', 'options': [
                     {'text': 'a', 'correct': 'yes'}, {'text': 'b'}]}},
                  ('data', 'options', 0, 'correct')),
                 ({'type': 'word_bank', 'data': {'options': ['a'], 'parts': [
                     {'type': 'gap', 'option': -1}]}}, ('data', 'parts', 0, 'gap', 'option')),
                 ({'type': 'standard', 'data': {'prompt': 'Q', 'answer': 'A', 'unknown': 1}},
                  ('data', 'unknown'))]
        for content, suffix in cases:
            source = request()
            source['content_v2'] = content
            with self.subTest(suffix=suffix), self.assertRaises(ValidationError) as error:
                v2.CardSaveRequest.model_validate(source)
            locations = [issue['loc'] for issue in error.exception.errors()]
            self.assertTrue(any(loc[0] == 'content_v2' and loc[-len(suffix):] == suffix
                                for loc in locations), locations)

    def test_nested_unknown_fields_and_grading_policy_are_rejected(self):
        for kind in fixtures():
            source = card(kind)
            source['data']['unknown'] = 1
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                v2.validate_card(source)
        for policy in ({'mode': 'invented'}, {'max_retries': 0}, {'unexpected': True}):
            source = card('free_text')
            source['data']['grading_policy'] = policy
            with self.subTest(policy=policy), self.assertRaises(ValidationError):
                v2.validate_card(source)

    def test_word_bank_reference_errors_point_to_specific_gap(self):
        for option in (0, 99):
            source = request('word_bank')
            source['content_v2']['data']['parts'][3]['option'] = option
            with self.subTest(option=option), self.assertRaises(ValidationError) as error:
                v2.CardSaveRequest.model_validate(source)
            self.assertIn(('content_v2', 'word_bank', 'data', 'parts', 3, 'gap', 'option'),
                          [issue['loc'] for issue in error.exception.errors()])

    def test_raw_loaders_reject_duplicate_keys_and_nonfinite_numbers(self):
        for loader, valid in ((v2.load_card, card()), (v2.load_save_request, request()),
                              (v2.load_document, {'schema_version': 2, 'deck': {'name': 'D'},
                                                  'cards': [card()]})):
            for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '{broken',
                        json.dumps(valid)[:-1] + ',"duplicate":{"x":1,"x":2}}'):
                with self.subTest(loader=loader.__name__, raw=raw[:30]), self.assertRaises(ValueError):
                    loader(raw)
        for number in (float('nan'), float('inf'), -float('inf')):
            source = card()
            source['metadata']['number'] = number
            with self.assertRaises(ValidationError):
                v2.validate_card(source)

    def test_raw_bytes_must_be_utf8(self):
        self.assertEqual(v2.load_card(json.dumps(card()).encode('utf-8')).type, 'standard')
        with self.assertRaises(UnicodeDecodeError):
            v2.load_card(json.dumps(card()).encode('utf-16'))

    def test_card_utf8_size_boundary_defaults_and_all_entry_points(self):
        source = card()
        baseline = len(v2.serialize_card(source).encode('utf-8'))
        source['explanation'] = 'a' * (v2.MAX_CARD_BYTES - baseline)
        self.assertEqual(len(v2.serialize_card(source).encode('utf-8')), v2.MAX_CARD_BYTES)
        v2.load_card(v2.serialize_card(source).encode('utf-8'))
        source['explanation'] += 'ä'  # Two UTF-8 bytes.
        document = {'schema_version': 2, 'deck': {'name': 'D'}, 'cards': [source]}
        payload = {**request(), 'content_v2': source}
        for validate, value in ((v2.validate_card, source), (v2.normalize_card, source),
                                (v2.serialize_card, source), (v2.project_card, source),
                                (v2.validate_document, document),
                                (v2.CardSaveRequest.model_validate, payload)):
            with self.subTest(validate=validate), self.assertRaisesRegex(ValueError, '262144'):
                validate(value)
        with self.assertRaisesRegex(ValueError, '262144'):
            v2.load_card(' ' * (v2.MAX_CARD_BYTES + 1))

    def test_document_count_and_raw_and_normalized_document_size(self):
        small = {'type': 'standard', 'data': {'prompt': 'Q', 'answer': 'A'}}
        source = {'schema_version': 2, 'deck': {'name': 'D'},
                  'cards': [small] * v2.MAX_DOCUMENT_CARDS}
        self.assertEqual(len(v2.validate_document(source).cards), 1000)
        source['cards'] = [small] * (v2.MAX_DOCUMENT_CARDS + 1)
        with self.assertRaises(ValidationError):
            v2.validate_document(source)
        large = {**small, 'explanation': 'a' * (v2.MAX_CARD_BYTES - 1024)}
        source['cards'] = [large] * 41
        with self.assertRaisesRegex(ValueError, '10485760'):
            v2.validate_document(source)
        for loader in (v2.load_document, v2.load_save_request):
            with self.subTest(loader=loader), self.assertRaisesRegex(ValueError, '10485760'):
                loader(b' ' * (v2.MAX_DOCUMENT_BYTES + 1))

    def test_model_inputs_are_revalidated_without_mutation(self):
        model = v2.validate_card(card())
        before = model.model_dump(mode='json')
        v2.project_card(model)
        v2.normalize_card(model)
        self.assertEqual(model.model_dump(mode='json'), before)
        model.data.answer = ''
        with self.assertRaises(ValidationError):
            v2.validate_card(model)
        model = v2.validate_card(card('free_text'))
        model.data.grading_policy.max_retries = 0
        with self.assertRaises(ValidationError):
            v2.validate_card(model)

    def test_response_round_trip_and_server_revision_are_strict(self):
        response = {'request_id': REQUEST_ID, 'card': {
            'id': 125, 'deck_id': 20, 'card_revision': 8, 'content_version': 2,
            'content_v2': card('quiz'), 'display': v2.project_card(card('quiz')).model_dump()}}
        validated = v2.CardSaveResponse.model_validate(response)
        self.assertEqual(validated.card.id, 125)
        self.assertEqual(validated.card.content_v2.id, 'author-125')
        self.assertEqual(v2.CardSaveResponse.model_validate(
            json.loads(validated.model_dump_json())), validated)
        for field, value in (('card_revision', 0), ('card_revision', True),
                             ('content_version', 2.0), ('id', 'author-125'), ('base_revision', 7)):
            invalid = copy.deepcopy(response)
            invalid['card'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                v2.CardSaveResponse.model_validate(invalid)

    def test_wire_schemas_reuse_discriminated_union_and_forbid_extras(self):
        for model in (v2.CardSaveRequest, v2.CardResponse):
            schema = model.model_json_schema()
            self.assertFalse(schema['additionalProperties'])
            self.assertEqual(set(schema['properties']['content_v2']['discriminator']['mapping']),
                             set(fixtures()))
            self.assertEqual(schema['properties']['content_version']['const'], 2)


if __name__ == '__main__':
    unittest.main()
