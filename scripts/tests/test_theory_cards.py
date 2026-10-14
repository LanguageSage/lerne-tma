"""Theory round-trip and persistence against disposable SQLite; no live services."""
import runpy
import unittest
from pathlib import Path
from uuid import uuid4

fixture = runpy.run_path(str(Path(__file__).with_name('test_bulk_import_idempotency.py')))
models, cards, database = (fixture[k] for k in ('models', 'cards', 'database'))
from api.services.author_service import parse_cards_text, serialize_card
from api.services.input_parser import detect_ai_input_type, parse_exercise_content, restore_exercise_content
from api.routers.card_text_update_models import TextUpdateCard
from api.utils.audio import _prepare_tts_text


class TheoryCardsTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(fixture['TABLES'])
        models.TMAUser.create(user_id=1)
        self.deck = models.TMA_Deck.create(user_id=1, name='Practice', is_trainer=True)

    def tearDown(self):
        database.drop_tables(fixture['TABLES'])

    def test_type_projection_and_speech(self):
        for body in ('Warum?', 'Grammatik: [[hätte]]', 'Warum?\n*Eins\nZwei', '@puzzle\nIch lerne.'):
            with self.subTest(body=body):
                front = f'  @THEORY  \r\n::task\r\nПравило\r\n::exercise\r\n{body}'
                parsed = parse_exercise_content(front)
                self.assertEqual(detect_ai_input_type(front), 'theory')
                self.assertEqual(parsed['exercise'], body)
                self.assertEqual(parsed['task'], 'Правило')
                self.assertNotIn('@theory', _prepare_tts_text(front).lower())
                self.assertNotIn('Правило', _prepare_tts_text(front))
                self.assertEqual(detect_ai_input_type(restore_exercise_content(parsed, 'Explanation')), 'theory')
                restored = restore_exercise_content(parsed, '@theory\nExplanation')
                self.assertEqual(restored.lower().count('@theory'), 1)
        self.assertEqual(_prepare_tts_text('@theory\nWarum?'), _prepare_tts_text('Warum?'))
        for literal in ('Use @theory here', '@theory_other\nText', '::source\nQuoted:\n@theory\nText'):
            self.assertEqual(detect_ai_input_type(literal), 'standard')

    def test_import_save_export_edit_preserves_theory_and_existing_cards(self):
        existing = models.TMA_Card.create(deck=self.deck, front_text='Haus', back_text='дом', card_type='standard')
        before = models.TMA_Card.get_by_id(existing.id).__data__.copy()
        raw = 'FRONT:\n@theory\nWarum?\nBACK:\nОбъяснение\nCONTEXT:\nПримечание'
        parsed = parse_cards_text(raw, default_deck_id=self.deck.id)[0]
        self.assertEqual(parsed['card_type'], 'theory')
        saved = cards.bulk_save_cards([parsed], 1, str(uuid4()))
        self.assertEqual(saved['created'], 1)
        theory = models.TMA_Card.get(models.TMA_Card.card_type == 'theory')
        exported = serialize_card(theory)
        reimported = parse_cards_text(exported)[0]
        for field in ('front', 'back', 'context', 'card_type'):
            self.assertEqual(reimported[field], parsed[field])
        payload = TextUpdateCard(number=1, card_id=theory.id, deck_id=self.deck.id,
                                 front=reimported['front'], back=reimported['back'],
                                 context=reimported['context'], topics='', card_type='theory')
        self.assertEqual(payload.card_type, 'theory')
        cards.save_card({'card_id': theory.id, 'deck_id': self.deck.id, 'card_type': 'theory',
                         'front': '@theory\nWarum genau?', 'back': 'Новое объяснение', 'context': 'Примечание'}, 1)
        edited = models.TMA_Card.get_by_id(theory.id)
        self.assertEqual(edited.card_type, 'theory')
        self.assertEqual(edited.front_text, '@theory\nWarum genau?')
        self.assertEqual(edited.back_text, 'Новое объяснение')
        self.assertEqual(models.TMA_Card.get_by_id(existing.id).__data__, before)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        database.close()
        path = fixture['database_path']
        for file in (path, Path(f'{path}-wal'), Path(f'{path}-shm')):
            file.unlink(missing_ok=True)
