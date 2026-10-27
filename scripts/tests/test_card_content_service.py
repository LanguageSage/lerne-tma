"""Behavioral tests for card_content_service and save_card on disposable SQLite."""
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

fixture = runpy.run_path(str(Path(__file__).with_name('test_bulk_import_idempotency.py')))
models, cards, database = (fixture[k] for k in ('models', 'cards', 'database'))
from api.services.cefr_metadata import get_cefr_metadata


class CardContentServiceTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(fixture['TABLES'])
        media_check = patch('api.services.media.validate_new_audio_path')
        media_check.start()
        self.addCleanup(media_check.stop)
        models.TMAUser.create(user_id=1)
        self.deck = models.TMA_Deck.create(user_id=1, name='Deck')

    def tearDown(self):
        database.drop_tables(fixture['TABLES'])

    def test_standard_card_with_cyrillic_front_and_latin_back_is_not_swapped(self):
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Я учу немецкий.',
            'back': 'Ich lerne Deutsch.',
            'audio_path': 'ru.mp3',
        }, 1)
        self.assertEqual(saved.front_text, 'Я учу немецкий.')
        self.assertEqual(saved.back_text, 'Ich lerne Deutsch.')
        self.assertEqual(saved.audio_path, 'ru.mp3')

    def test_context_prose_with_bare_level_or_russian_words_is_not_mangled(self):
        prose = 'Уровень владения языком:\nB1\nТема урока раскрыта полностью.'
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Haus',
            'back': 'дом',
            'context': prose,
        }, 1)
        self.assertEqual(saved.context, prose)
        self.assertIsNone(saved.topics)

    def test_explicit_context_markers_are_extracted_cleanly(self):
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Haus',
            'back': 'дом',
            'context': '::level B2\n::topic Wohnen\nСуществительное среднего рода.',
        }, 1)
        self.assertEqual(saved.context, 'Существительное среднего рода.')
        self.assertEqual(saved.topics, 'Wohnen')
        self.assertEqual(saved.tags, 'B2')
        self.assertEqual(get_cefr_metadata(saved.metadata)['level'], 'B2')

    def test_topics_with_commas_remain_one_topic_string_when_saved(self):
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Sich ausruhen',
            'back': 'rest',
            'topics': 'Erholung, Gesundheit und Alltag',
            'metadata': {'structured_topics': ['Erholung, Gesundheit und Alltag']},
        }, 1)
        self.assertEqual(saved.topics, 'Erholung, Gesundheit und Alltag')
        self.assertEqual(json.loads(saved.metadata)['structured_topics'],
                         ['Erholung, Gesundheit und Alltag'])

    def test_level_syncs_metadata_even_with_empty_context_and_replaces_old_level_tag(self):
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Haus',
            'back': 'дом',
            'context': '',
            'level': 'A1',
            'tags': 'custom,A1',
        }, 1)
        self.assertEqual(get_cefr_metadata(saved.metadata)['level'], 'A1')
        self.assertEqual(saved.tags, 'custom,A1')

        updated = cards.save_card({
            'card_id': saved.id,
            'deck_id': self.deck.id,
            'level': 'B2',
        }, 1)
        self.assertEqual(get_cefr_metadata(updated.metadata)['level'], 'B2')
        self.assertEqual(updated.tags, 'custom,B2')

    def test_card_type_and_audio_invalidation_follow_content_changes(self):
        saved = cards.save_card({
            'deck_id': self.deck.id,
            'front': 'Ich [[lerne]] Deutsch.',
            'back': 'Я учу немецкий.',
            'audio_path': 'front.mp3',
            'audio_back_path': 'back.mp3',
        }, 1)
        self.assertEqual(saved.card_type, 'trainer')
        self.assertEqual(saved.audio_path, 'front.mp3')

        # Changing only cloze brackets without changing spoken text preserves audio_path
        same_spoken = cards.save_card({
            'card_id': saved.id,
            'deck_id': self.deck.id,
            'front': 'Ich lerne Deutsch.',
        }, 1)
        self.assertEqual(same_spoken.card_type, 'standard')
        self.assertEqual(same_spoken.audio_path, 'front.mp3')

        # Changing spoken text invalidates stale audio_path
        changed_spoken = cards.save_card({
            'card_id': saved.id,
            'deck_id': self.deck.id,
            'front': '@match\nHaus => дом\nBaum => дерево',
        }, 1)
        self.assertEqual(changed_spoken.card_type, 'match')
        self.assertIsNone(changed_spoken.audio_path)
        self.assertEqual(changed_spoken.audio_back_path, 'back.mp3')


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        database.close()
        path = fixture['database_path']
        for file in (path, Path(f'{path}-wal'), Path(f'{path}-shm')):
            file.unlink(missing_ok=True)
