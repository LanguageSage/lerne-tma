"""Favorites are private references; all fixtures use an isolated in-memory DB."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_offline_sync import database, models, TABLES
from fastapi import HTTPException
from pydantic import ValidationError
from api.services.card_favorites import get_favorite_cards, set_card_favorite
from api.routers.cards import FavoriteWrite


class CardFavoritesTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        models.TMAUser.create(user_id=2)
        self.deck = models.TMA_Deck.create(user_id=1, name='Personal', target_language='de')
        self.card = models.TMA_Card.create(deck=self.deck, front_text='Hallo', back_text='Привет')

    def tearDown(self):
        database.drop_tables(TABLES)

    def test_setting_and_clearing_keep_original_card_and_srs(self):
        progress = models.TMAProgress.create(card_id=self.card.id, user_id=1,
            queue='review', interval=12, ease_factor=2.7, repetitions=5, flag=3)
        before = dict(progress.__data__)
        for selected in (True, True, False):
            self.assertEqual(set_card_favorite(self.card.id, 1, selected)['want_to_learn'], selected)
        after = models.TMAProgress.get_by_id(progress.id).__data__
        for field in before.keys() - {'updated_at', 'want_to_learn'}:
            self.assertEqual(before[field], after[field], field)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        self.assertEqual(models.TMA_Deck.select().count(), 1)
        self.assertEqual(models.TMAReviewHistory.select().count(), 0)
        self.assertEqual(self.card.deck_id, self.deck.id)

    def test_viewer_has_private_favorite_without_editing_shared_content(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')
        set_card_favorite(self.card.id, 2, True)
        with patch('api.services.card_favorites._build_media_exists_map', return_value={}):
            self.assertEqual(get_favorite_cards(1, 'de'), [])
            cards = get_favorite_cards(2, 'de')
        self.assertEqual([card['id'] for card in cards], [self.card.id])
        self.assertEqual(cards[0]['deck_id'], self.deck.id)
        self.assertEqual(cards[0]['front'], 'Hallo')
        self.assertTrue(cards[0]['want_to_learn'])
        self.assertEqual(get_favorite_cards(2, 'uk'), [])
        self.assertFalse(models.TMA_Card.get_by_id(self.card.id).want_to_learn)

    def test_deleted_and_revoked_cards_are_not_listed(self):
        models.TMA_Collaborator.create(target_type='deck', target_id=self.deck.id, user_id=2, role='viewer')
        set_card_favorite(self.card.id, 2, True)
        models.TMA_Collaborator.delete().execute()
        self.assertEqual(get_favorite_cards(2, 'de'), [])
        set_card_favorite(self.card.id, 1, True)
        models.TMA_Card.update(is_deleted=True).where(models.TMA_Card.id == self.card.id).execute()
        self.assertEqual(get_favorite_cards(1, 'de'), [])
        with self.assertRaises(HTTPException):
            set_card_favorite(self.card.id, 1, True)

    def test_denied_and_invalid_requests_do_not_create_progress(self):
        with self.assertRaises(HTTPException):
            set_card_favorite(self.card.id, 3, True)
        self.assertEqual(models.TMAProgress.select().count(), 0)
        for data in ({}, {'want_to_learn': 'yes'}, {'want_to_learn': True, 'deck_id': 10}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                FavoriteWrite(**data)

    def test_legacy_global_bookmark_does_not_become_another_users_favorite(self):
        models.TMA_Card.update(want_to_learn=True).execute()
        self.assertEqual(get_favorite_cards(1, 'de'), [])

    def test_deck_language_default_and_deleted_deck(self):
        set_card_favorite(self.card.id, 1, True)
        models.TMA_Deck.update(target_language=None).execute()
        with patch('api.services.card_favorites._build_media_exists_map', return_value={}):
            self.assertEqual([card['id'] for card in get_favorite_cards(1, 'de')], [self.card.id])
        models.TMA_Deck.update(is_deleted=True).execute()
        self.assertEqual(get_favorite_cards(1, 'de'), [])
        with self.assertRaises(HTTPException):
            set_card_favorite(self.card.id, 1, True)


if __name__ == '__main__':
    unittest.main()
