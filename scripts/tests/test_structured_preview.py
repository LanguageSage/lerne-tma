"""Read-only admin preview contracts. No database, network or AI calls."""
import copy
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.structured_cards_v2 import load_document
from tools.admin.services.structured_preview import preview_document

EXAMPLES = Path(__file__).resolve().parents[2] / 'project_docs/examples/structured_cards_v2'


def mixed_document():
    base = json.loads((EXAMPLES / 'basics.json').read_text(encoding='utf-8'))
    base['cards'] += json.loads((EXAMPLES / 'other_types.json').read_text(encoding='utf-8'))['cards']
    return base


class StructuredPreviewTest(unittest.TestCase):
    def test_mixed_document_keeps_v2_and_independent_projections(self):
        source = mixed_document()
        before = copy.deepcopy(source)
        result = preview_document(json.dumps(source))
        self.assertTrue(result['valid'])
        self.assertEqual(source, before)
        self.assertEqual(result['document'], load_document(json.dumps(source)).model_dump(mode='json'))
        self.assertEqual(len(result['types']), 8)
        self.assertEqual(result['document']['cards'][0]['id'], source['cards'][0]['id'])
        self.assertNotIn('front', result['document']['cards'][0])
        self.assertEqual(result['legacy_projections'][0]['card']['source_id'], source['cards'][0]['id'])
        self.assertEqual([p['status'] for p in result['legacy_projections'][-5:]],
                         ['unrepresentable', 'converted', 'converted', 'converted', 'converted'])

    def test_word_bank_free_text_compatibility_checked_for_every_card(self):
        source = json.loads((EXAMPLES / 'word_bank_free_text.json').read_text(encoding='utf-8'))
        lossy = copy.deepcopy(source['cards'][0])
        lossy['id'] = 'lossy-bank'
        lossy['data']['options'][-1] = 'HABE'
        source['cards'].append(lossy)
        lossy = copy.deepcopy(source['cards'][1])
        lossy['id'] = 'lossy-free'
        lossy['data']['prompt'] = '**Schreiben Sie.**'
        source['cards'].append(lossy)
        result = preview_document(json.dumps(source))
        self.assertTrue(result['valid'])
        self.assertEqual([p['status'] for p in result['legacy_projections']],
                         ['converted'] * 4 + ['unrepresentable'] * 2)
        self.assertIn('cards[4].data.options[4]:', result['legacy_projections'][4]['message'])
        self.assertIn('cards[5].data.prompt:', result['legacy_projections'][5]['message'])
        self.assertEqual(result['document'], load_document(json.dumps(source)).model_dump(mode='json'))

    def test_puzzle_quiz_preview_separates_multi_answer_and_lossy_tokens_from_validation(self):
        source = json.loads((EXAMPLES / 'puzzle_quiz.json').read_text(encoding='utf-8'))
        source['cards'].append({'type': 'puzzle', 'data': {'tokens': ['two words']}})
        multi = copy.deepcopy(source['cards'][1])
        multi['id'] = 'multi'
        multi['data']['options'][0]['correct'] = True
        source['cards'].append(multi)
        result = preview_document(json.dumps(source))
        self.assertTrue(result['valid'])
        self.assertEqual(result['errors'], [])
        self.assertEqual([p['status'] for p in result['legacy_projections']],
                         ['converted', 'converted', 'unrepresentable', 'unrepresentable'])
        self.assertEqual(result['document'], load_document(json.dumps(source)).model_dump(mode='json'))
        self.assertIn('cards[2].data.tokens[0]:', result['legacy_projections'][2]['message'])
        self.assertIn('exactly one correct answer', result['legacy_projections'][3]['message'])

    def test_match_preview_converts_safe_labels_and_keeps_lossy_data_reviewable(self):
        source = json.loads((EXAMPLES / 'match.json').read_text(encoding='utf-8'))
        source['cards'].append({'type': 'match', 'data': {'pairs': [
            {'left': 'A = B', 'right': 'C'}, {'left': 'D', 'right': 'E'}]}})
        result = preview_document(json.dumps(source))
        self.assertTrue(result['valid'])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['legacy_projections'][0]['status'], 'converted')
        self.assertIn('@match\nkommen => sein', result['legacy_projections'][0]['card']['front'])
        self.assertEqual(result['legacy_projections'][1]['status'], 'unrepresentable')
        self.assertIn('cards[1].data.pairs[0].left:', result['legacy_projections'][1]['message'])
        self.assertEqual(result['document']['cards'][1]['data'], source['cards'][1]['data'])

    def test_lossy_conversion_is_not_a_v2_error_and_does_not_hide_neighbors(self):
        source = mixed_document()
        source['cards'][1]['data']['prompt'] = '@quiz\n[*] Collision'
        result = preview_document(json.dumps(source))
        self.assertTrue(result['valid'])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['legacy_projections'][1]['status'], 'unrepresentable')
        self.assertIn('cards[1]', result['legacy_projections'][1]['message'])
        self.assertEqual(result['legacy_projections'][2]['status'], 'converted')

    def test_validation_reports_card_and_field_without_projecting_invalid_document(self):
        source = mixed_document()
        source['cards'][1]['data']['answer'] = ''
        source['cards'][2]['data']['parts'][1]['answers'] = []
        result = preview_document(json.dumps(source))
        self.assertFalse(result['valid'])
        self.assertEqual([e['card_number'] for e in result['errors']], [2, 3])
        self.assertEqual(result['errors'][0]['path'], 'cards[1].data.answer')
        self.assertEqual(result['errors'][1]['path'], 'cards[2].data.parts[1].answers')
        self.assertNotIn('legacy_projections', result)

    def test_document_passport_and_strict_json_errors(self):
        source = mixed_document()
        source['deck']['passport']['intro']['level'] = 'A9'
        invalid = [json.dumps(source), '{"schema_version":2,"schema_version":2}',
                   '{"number":NaN}', '{', '[]']
        for text in invalid:
            with self.subTest(text=text[:60]):
                result = preview_document(text)
                self.assertFalse(result['valid'])
                self.assertTrue(result['errors'][0]['path'])
        self.assertIn('passport', preview_document(json.dumps(source))['errors'][0]['path'])
        self.assertEqual(preview_document('{')['errors'][0]['line'], 1)


class StructuredPreviewUploadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Importing the existing admin router must not initialize real storage.
        with patch('api.database.initialize_database'), patch('api.database.create_all_tables', create=True):
            from tools.admin.routers.author import router
        cls.app = FastAPI()
        cls.app.include_router(router)
        cls.client = TestClient(cls.app)

    def upload(self, name, content):
        return self.client.post('/api/admin/author/v2-preview', files={'file': (name, content, 'application/json')})

    def test_upload_uses_existing_loader_and_never_calls_publish_or_database(self):
        with (patch('api.services.author_service.apply_publish_content', side_effect=AssertionError('write')),
              patch('api.services.author_service.apply_update_content', side_effect=AssertionError('write'))):
            response = self.upload('lesson.JSON', b'\xef\xbb\xbf' + json.dumps(mixed_document()).encode())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['valid'])

    def test_upload_boundaries_and_retry(self):
        self.assertEqual(self.upload('lesson.txt', b'{}').status_code, 400)
        self.assertEqual(self.upload('lesson.json', b'\xff').status_code, 400)
        self.assertEqual(self.upload('lesson.json', b'x' * (10 * 1024 * 1024 + 1)).status_code, 413)
        self.assertFalse(self.upload('lesson.json', b'{}').json()['valid'])
        self.assertTrue(self.upload('lesson.json', json.dumps(mixed_document()).encode()).json()['valid'])

    def parse_uploads(self, *uploads):
        return self.client.post('/api/admin/author/parse', files=[
            ('files', (name, text.encode('utf-8'), 'application/octet-stream'))
            for name, text in uploads])

    def lesson_json(self, name='Plan', topic='Planung'):
        return json.dumps({'schema_version': 2, 'deck': {'name': name, 'passport': {
            'schema_version': 1, 'intro': {'level': 'B1', 'topic': topic}}},
            'cards': [{'type': 'standard', 'data': {'prompt': 'Wann?', 'answer': 'Am Samstag.'}}]})

    def test_publish_parse_accepts_json_and_json_in_old_text_extensions(self):
        for extension in ('json', 'JSON', 'md', 'txt', 'text'):
            with self.subTest(extension=extension):
                response = self.parse_uploads((f'filename.{extension}', '\ufeff' + self.lesson_json()))
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()
                self.assertEqual(data['total_cards'], 1)
                self.assertEqual(data['decks'][0]['deck_name'], 'Plan')
                self.assertEqual(data['cards'][0]['level'], 'B1')
                self.assertEqual(data['cards'][0]['topics'], 'Planung')
                self.assertEqual(len(data['passports']), 1)
                self.assertEqual(data['document_errors'], [])

    def test_publish_parse_multiple_json_files_and_mixed_legacy_files(self):
        response = self.parse_uploads(
            ('first.json', self.lesson_json()),
            ('old.md', 'FRONT:\nHaus\nBACK:\nдом'),
            ('second.json', self.lesson_json('Budget', 'Geld')))
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['total_cards'], 3)
        self.assertEqual(data['decks_count'], 3)
        self.assertEqual(data['files'], ['first.json', 'old.md', 'second.json'])
        self.assertEqual([c['number'] for c in data['cards']], [1, 2, 3])
        self.assertEqual([c['deck_name'] for c in data['cards']], ['Plan', 'old', 'Budget'])
        self.assertEqual([c['topics'] for c in data['cards']], ['Planung', None, 'Geld'])
        self.assertEqual(len(data['passports']), 2)
        self.assertEqual(data['passport_errors'], [])

    def test_publish_parse_legacy_files_keep_headers_and_do_not_leak_deck_ids(self):
        response = self.parse_uploads(
            ('one.txt', '# Deck: Explicit\n::deck_id 12\nFRONT:\nA\nBACK:\na'),
            ('two.txt', 'FRONT:\nB\nBACK:\nb'))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([c['deck_name'] for c in response.json()['cards']], ['Explicit', 'two'])
        self.assertEqual([c['deck_id'] for c in response.json()['cards']], [12, None])

    def test_publish_parse_invalid_json_is_reviewable_and_identifies_the_file(self):
        for invalid in ('{', '[]', 'FRONT:\nA\nBACK:\nB'):
            with self.subTest(invalid=invalid):
                response = self.parse_uploads(('good.json', self.lesson_json()), ('broken.json', invalid))
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()
                self.assertEqual(data['total_cards'], 1)
                self.assertTrue(data['document_errors'])
                self.assertIn('broken.json:', data['document_errors'][0])

    def test_publish_parse_rejects_duplicate_passports_across_files(self):
        response = self.parse_uploads(
            ('first.json', self.lesson_json()), ('second.json', self.lesson_json()))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['document_errors'])
        self.assertIn('second.json:', response.json()['document_errors'][0])

    def test_publish_parse_cannot_silently_skip_an_empty_or_unrecognized_file(self):
        for text in ('', 'notes without cards'):
            with self.subTest(text=text):
                response = self.parse_uploads(('good.json', self.lesson_json()), ('empty.md', text))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['total_cards'], 1)
                self.assertIn('empty.md:', response.json()['document_errors'][0])

    def test_publish_parse_json_boundaries(self):
        self.assertEqual(self.parse_uploads(('lesson.json', 'x' * (10 * 1024 * 1024 + 1))).status_code, 413)
        response = self.client.post('/api/admin/author/parse', files={'file': ('lesson.json', b'\xff')})
        self.assertEqual(response.status_code, 400)
        self.assertIn('UTF-8', response.json()['detail'])
        self.assertEqual(self.parse_uploads(('image.png', '{}')).status_code, 400)

    def test_publish_parse_manual_json_with_bom(self):
        response = self.client.post('/api/admin/author/parse', json={'text': '\ufeff' + self.lesson_json()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total_cards'], 1)
        self.assertEqual(response.json()['document_errors'], [])


if __name__ == '__main__':
    unittest.main()
