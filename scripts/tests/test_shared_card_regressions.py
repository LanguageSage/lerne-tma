"""Synthetic release corpus, also run in TMA; no sibling imports or real data."""
from copy import deepcopy
from contextlib import nullcontext
from importlib import import_module
import json
import unittest
from unittest.mock import patch

from peewee import SqliteDatabase

API = 'api'
parser = import_module(API + '.services.input_parser')
author = import_module(API + '.services.author_service')
models = import_module(API + '.models')
cards = import_module(API + '.services.cards')
v2 = import_module(API + '.services.structured_cards_v2')
legacy = import_module(API + '.services.structured_cards_legacy')

# Deliberately synthetic. Keep this corpus identical in both repositories.
QUIZZES = (
    ('::task\nWähle eine Stadt.\n::source\nWelche Stadt?\n::exercise\n'
     '[ ] Bonn\n[*] Berlin\n[ ] Hamburg', '',
     [(False, 'Bonn'), (True, 'Berlin'), (False, 'Hamburg')]),
    ('::exercise\nVergleiche die Sätze:\n1. Ein Satz.\n2. Noch ein Satz.\n'
     'Welche Antwort passt?\n\n[ ] A\n[*] B\n[ ] C',
     'Vergleiche die Sätze:\n1. Ein Satz.\n2. Noch ein Satz.\nWelche Antwort passt?',
     [(False, 'A'), (True, 'B'), (False, 'C')]),
    ('Wo?\n\nA) **Bonn**\nB) *Berlin\nC) **Hamburg**', 'Wo?',
     [(False, '**Bonn**'), (True, 'Berlin'), (False, '**Hamburg**')]),
    ('Wo?\n\nBonn\n*Berlin\nHamburg', 'Wo?',
     [(False, 'Bonn'), (True, 'Berlin'), (False, 'Hamburg')]),
    ('Wo?\n1) Bonn\n2) *Berlin\n3) Hamburg', 'Wo?',
     [(False, 'Bonn'), (True, 'Berlin'), (False, 'Hamburg')]),
)


class SharedCardRegressionTests(unittest.TestCase):
    def test_quiz_boundaries_bold_and_correct_answer_lf_and_crlf(self):
        for front, question, expected in QUIZZES:
            for newline in ('\n', '\r\n'):
                with self.subTest(front=front, newline=newline):
                    source = front.replace('\n', newline)
                    exercise = parser.parse_exercise_content(source)['exercise']
                    allow_empty = '::exercise' in front
                    self.assertEqual(parser.detect_card_type(source), 'quiz')
                    self.assertEqual(parser.parse_quiz_options(exercise, allow_empty_question=allow_empty), expected)
                    lines = exercise.split('\n')
                    start = parser.find_quiz_option_start(lines, allow_empty_question=allow_empty)
                    self.assertEqual('\n'.join(lines[:start]).strip(), question)
                    self.assertEqual([text for correct, text in expected if correct], ['B' if question.startswith('Vergleiche') else 'Berlin'])
        self.assertEqual(parser.parse_quiz_options('[ ] A\n[*] B'), [])
        for body in ('[*] A', '[ ] A\n[ ] B', '[ ] A\nExplanation\n[*] B'):
            self.assertEqual(parser.detect_card_type('::exercise\n' + body), 'standard')

    def test_json_v2_validation_conversion_and_unsafe_projection(self):
        document = {'schema_version': 2, 'deck': {'name': 'Synthetic'}, 'cards': [
            {'type': 'standard', 'data': {'prompt': 'Haus', 'answer': 'дом'}},
            {'type': 'quiz', 'info': [{'type': 'source', 'text': 'Synthetic source'}],
             'data': {'prompt': 'Wo?', 'options': [
                 {'text': 'Bonn', 'correct': False}, {'text': 'Berlin', 'correct': True}]}}]}
        before = deepcopy(document)
        validated = v2.validate_document(document)
        self.assertEqual(v2.load_document(validated.model_dump_json()), validated)
        projected = legacy.to_legacy_document(validated)
        self.assertEqual(document, before)
        self.assertEqual([c['card_type'] for c in projected['cards']], ['standard', 'quiz'])
        quiz = projected['cards'][1]
        exercise = parser.parse_exercise_content(quiz['front'])['exercise']
        self.assertEqual(parser.parse_quiz_options(exercise), [(False, 'Bonn'), (True, 'Berlin')])
        self.assertEqual(quiz['back'], 'Berlin')
        invalid = deepcopy(document)
        invalid['cards'][1]['data']['options'][0]['correct'] = True
        v2.validate_document(invalid)
        with self.assertRaisesRegex(legacy.LegacyConversionError, 'exactly one correct answer'):
            legacy.to_legacy_document(invalid)
        invalid['cards'][1]['data']['options'][1]['correct'] = False
        invalid['cards'][1]['data']['options'][0]['correct'] = False
        with self.assertRaises(ValueError):
            v2.validate_document(invalid)

    def test_import_save_export_reimport_preserves_quiz_and_existing_material(self):
        database = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1})
        tables = [models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
                  models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator,
                  models.TMAOfflineBatch, models.TMAMedia, models.TMASetting]
        models.tma_db.initialize(database)
        models.lerne_db.initialize(database)
        media = import_module(API + '.services.media')
        media_check = patch.object(media, 'validate_new_audio_path') if hasattr(media, 'validate_new_audio_path') else nullcontext()
        with database.bind_ctx(tables), media_check:
            database.create_tables(tables)
            try:
                models.TMAUser.create(user_id=1)
                deck = models.TMA_Deck.create(user_id=1, name='Synthetic')
                old = models.TMA_Card.create(deck=deck, creator_id=1, front_text='Old **material**',
                                             back_text='Original', card_type='standard')
                before = dict(models.TMA_Card.get_by_id(old.id).__data__)
                sources = [(front, 'Berlin' if not question.startswith('Vergleiche') else 'B')
                           for front, question, _ in QUIZZES]
                sources += [('Haus', 'дом'), ('Ich [[lerne]] Deutsch.', 'Я учу немецкий.')]
                for front, back in sources:
                    with self.subTest(front=front):
                        payload = {'deck_id': deck.id, 'front': front, 'back': back,
                                   'context': 'Synthetic **context**'}
                        saved = cards.save_card(payload, 1)
                        self.assertEqual(saved.card_type, parser.detect_card_type(front))
                        self.assertEqual(saved.front_text, front)
                        exported = author.serialize_card(saved)
                        imported = author.parse_cards_text(exported)
                        self.assertEqual(len(imported), 1)
                        self.assertEqual(imported[0]['front'], front)
                        self.assertEqual(imported[0]['back'], back)
                        self.assertEqual(imported[0]['card_id'], saved.id)
                        updated = cards.save_card(imported[0], 1)
                        self.assertEqual(author.serialize_card(updated), exported)
                        self.assertEqual(updated.card_type, parser.detect_card_type(front))
                self.assertEqual(models.TMA_Card.get_by_id(old.id).__data__, before)
                self.assertEqual(models.TMA_Card.select().count(), len(sources) + 1)
            finally:
                database.close()
