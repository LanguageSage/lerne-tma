"""Passport contracts and transactions against disposable SQLite, never live data."""
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from api import models
from api.services import author_service as author
from api.services.deck_passport import validate_passport, merge_passport
from scripts.tests import test_author_router as router_tests


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

    def test_merge_partial_preserves_other_keys_and_intro_editor_fields(self):
        metadata = {'resources': ['file'], 'is_learning': True, 'intro': {'level': 'B1', 'title': 'Old'},
                    'pedagogy': {'schema_version': 1, 'lesson_type': 'review', 'custom': True}}
        changed = merge_passport(metadata, {'schema_version': 1, 'intro': {'goal': 'New'}})
        self.assertEqual(changed['intro'], {'level': 'B1', 'title': 'Old', 'goal': 'New'})
        self.assertEqual(changed['pedagogy'], metadata['pedagogy'])
        self.assertEqual(changed['resources'], ['file'])
        self.assertTrue(changed['is_learning'])
        self.assertNotIn('goal', metadata['intro'])


class TestPassportPersistence(unittest.TestCase):
    # Reuse only the isolated DB fixture, not the inherited tests or real startup.
    setUpClass = classmethod(router_tests.TestAuthorRouter.setUpClass.__func__)
    tearDownClass = classmethod(router_tests.TestAuthorRouter.tearDownClass.__func__)
    setUp = router_tests.TestAuthorRouter.setUp
    tearDown = router_tests.TestAuthorRouter.tearDown

    def post(self, path, payload):
        return self.client.post('/api/admin/author/' + path, json=payload)

    def payload(self, passport=None, only=True):
        return {'target_folder_id': self.folder.id, 'user_id': 42, 'passport_only': only,
                'cards': [], 'passports': [{'deck_name': self.deck.name, 'deck_id': self.deck.id,
                                          'passport': passport or sample()}]}

    def test_passport_only_repeated_preserves_cards_srs_and_metadata(self):
        self.deck.metadata = json.dumps({'resources': [{'url': 'https://example.org'}], 'is_learning': True,
                                         'intro': {'custom': 'keep'}})
        self.deck.save()
        progress = models.TMAProgress.create(user_id=42, card_id=self.card.id, interval=15, repetitions=4)
        before = dict(models.TMA_Card.get_by_id(self.card.id).__data__)
        progress_before = dict(models.TMAProgress.get_by_id(progress.id).__data__)
        review = models.TMAReviewHistory.create(user_id=42, card_id=self.card.id, rating=3)
        review_before = dict(models.TMAReviewHistory.get_by_id(review.id).__data__)
        for _ in range(2):
            response = self.post('publish', self.payload())
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['total_saved_cards'], 0)
        stored = json.loads(models.TMA_Deck.get_by_id(self.deck.id).metadata)
        self.assertTrue(stored['is_learning'])
        self.assertEqual(stored['resources'], [{'url': 'https://example.org'}])
        self.assertEqual(stored['intro']['custom'], 'keep')
        self.assertEqual(stored['pedagogy']['schema_version'], 1)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).__data__, before)
        self.assertEqual(models.TMAProgress.get_by_id(progress.id).__data__, progress_before)
        self.assertEqual(models.TMAReviewHistory.select().count(), 1)
        self.assertEqual(models.TMAReviewHistory.get_by_id(review.id).__data__, review_before)

    def test_multi_file_publish_and_folder_roundtrip(self):
        files = [('files', (f'deck_{n}.txt', lesson(f'Колода {n}', sample(n), 6 if n == '09' else 1).encode(), 'text/plain')) for n in ('09', '12', '13')]
        response = self.client.post('/api/admin/author/parse', files=files)
        self.assertEqual(response.status_code, 200, response.text)
        doc = response.json()
        self.assertEqual(doc['passport_errors'], [])
        published = self.post('publish', {'cards': doc['cards'], 'passports': doc['passports'], 'target_folder_id': self.folder.id})
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()['total_saved_cards'], 8)
        exported = author.export_folder_content(self.folder.id)['text']
        again = author.parse_document(exported)
        self.assertEqual(again['errors'], [])
        self.assertEqual(len(again['passports']), 3)
        decks = []
        for deck in models.TMA_Deck.select().order_by(models.TMA_Deck.id):
            cards = list(models.TMA_Card.select().where(models.TMA_Card.deck_id == deck.id).order_by(models.TMA_Card.id))
            decks.append((deck, cards))
        self.assertEqual(author.serialize_folder(self.folder, decks), exported)
        for entry in again['passports']:
            original = sample(entry['deck_name'][-2:])
            original['pedagogy']['schema_version'] = 1
            self.assertEqual(entry['passport'], original)
        response = self.client.get(f"/api/admin/author/export?deck_id={decks[-1][0].id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("filename*=UTF-8''", response.headers['content-disposition'])

    def test_invalid_passport_blocks_all_writes_and_parse_shows_errors(self):
        text = lesson(passport={'schema_version': 1, 'pedagogy': {'stages': []}})
        parsed = self.post('parse', {'text': text})
        self.assertEqual(parsed.status_code, 200)
        self.assertTrue(parsed.json()['passport_errors'])
        result = self.post('publish', {'text': text, 'new_folder_name': 'Never created', 'user_id': 42})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(models.TMA_Folder.select().count(), 1)
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_bulk_failure_rolls_back_folder_cards_and_passport(self):
        real_save = author.services.bulk_save_cards
        def fail_after_write(*args, **kwargs):
            result = real_save(*args, **kwargs)
            return {**result, 'failed_count': 1}
        with patch.object(author.services, 'bulk_save_cards', side_effect=fail_after_write):
            response = self.post('publish', {'text': lesson('09', sample()), 'new_folder_name': 'Rollback', 'user_id': 42})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(models.TMA_Folder.select().count(), 1)
        self.assertEqual(models.TMA_Deck.select().count(), 1)
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_owner_scope_id_mismatch_and_missing_deck(self):
        models.TMAUser.create(user_id=777)
        response = self.post('publish', {**self.payload(), 'user_id': 777})
        self.assertEqual(response.status_code, 403, response.text)
        for edit in ('wrong_id', 'wrong_name'):
            payload = self.payload()
            payload['passports'][0]['deck_id' if edit == 'wrong_id' else 'deck_name'] = 999 if edit == 'wrong_id' else 'Unknown'
            self.assertIn(self.post('publish', payload).status_code, (400, 404))
        self.assertFalse(json.loads(models.TMA_Deck.get_by_id(self.deck.id).metadata or '{}').get('pedagogy'))

    def test_preview_field_changes_and_legacy_publication_keeps_passport(self):
        self.assertEqual(self.post('publish', self.payload()).status_code, 200)
        passport = {'schema_version': 1, 'intro': {'goal': 'Changed'}}
        preview = self.post('publish-preview', self.payload(passport)).json()
        self.assertEqual(preview['passports'][0]['changes'], [{'field': 'intro.goal', 'before': sample()['intro']['goal'], 'after': 'Changed'}])
        before = models.TMA_Deck.get_by_id(self.deck.id).metadata
        result = self.post('publish', {'text': lesson(), 'target_folder_id': self.folder.id})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).metadata, before)

    def test_card_update_plus_passport_atomic_token_and_retry(self):
        text = author.export_deck_content(self.deck.id)['text'].replace('Front 1', 'Updated front')
        text = text.replace('# Deck: Test Deck', lesson(cards=0, passport=sample(), deck_id=self.deck.id).strip())
        payload = {'text': text, 'deck_id': self.deck.id, 'user_id': 42}
        response = self.post('update-preview', payload)
        self.assertEqual(response.status_code, 200, response.text)
        token = response.json()['preview_token']
        changed = {**payload, 'text': text.replace('Самостоятельно выражать мысли', 'Altered')}
        result = self.post('update-apply', {**changed, 'preview_token': token, 'request_id': 'bad'})
        self.assertEqual(result.status_code, 400, result.text)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).front_text, 'Front 1')
        for _ in range(2):
            result = self.post('update-apply', {**payload, 'preview_token': token, 'request_id': 'retry'})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['updated_passports'], 1)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).front_text, 'Updated front')
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_passport_only_empty_export_and_html_is_plain_data(self):
        passport = {'schema_version': 1, 'intro': {'goal': '<script>alert(1)</script>'}}
        self.assertEqual(self.post('publish', self.payload(passport)).status_code, 200)
        text = author.export_deck_content(self.deck.id)['text']
        doc = author.parse_document(text)
        self.assertEqual(doc['passports'][0]['passport'], passport)
        models.TMA_Card.delete().execute()
        doc = author.parse_document(author.export_deck_content(self.deck.id)['text'])
        self.assertEqual(doc['cards'], [])
        self.assertEqual(doc['passports'][0]['deck_id'], self.deck.id)

    def test_batch_passport_update_rolls_back_when_one_target_is_missing(self):
        before = models.TMA_Deck.get_by_id(self.deck.id).metadata
        payload = self.payload()
        payload['passports'].append({'deck_name': 'Missing deck', 'passport': sample('12')})
        result = self.post('publish', payload)
        self.assertEqual(result.status_code, 404, result.text)
        self.assertEqual(models.TMA_Deck.get_by_id(self.deck.id).metadata, before)
        self.assertEqual(models.TMA_Card.select().count(), 1)

    def test_update_blocks_stale_passport_and_foreign_folder(self):
        self.assertEqual(self.post('publish', self.payload()).status_code, 200)
        text = author.export_deck_content(self.deck.id)['text']
        payload = {'text': text, 'deck_id': self.deck.id, 'user_id': 42}
        preview = self.post('update-preview', payload).json()
        altered = models.TMA_Deck.get_by_id(self.deck.id)
        metadata = json.loads(altered.metadata)
        metadata['intro']['goal'] = 'Another editor'
        altered.metadata = json.dumps(metadata)
        altered.save()
        result = self.post('update-apply', {**payload, 'preview_token': preview['preview_token'], 'request_id': 'stale'})
        self.assertEqual(result.status_code, 400, result.text)
        models.TMAUser.create(user_id=777)
        result = self.post('update-preview', {**payload, 'user_id': 777})
        self.assertEqual(result.status_code, 403, result.text)
        other_folder = models.TMA_Folder.create(user_id=42, name='Other')
        result = self.post('update-preview', {'text': text, 'folder_id': other_folder.id, 'user_id': 42})
        self.assertIn(result.status_code, (400, 403), result.text)

    def test_export_respects_authored_card_positions(self):
        models.TMA_Card.create(deck=self.deck, front_text='Before', back_text='B', position=0)
        cards = author.parse_document(author.export_deck_content(self.deck.id)['text'])['cards']
        self.assertEqual([card['front'] for card in cards], ['Before', 'Front 1'])


if __name__ == '__main__':
    unittest.main()
