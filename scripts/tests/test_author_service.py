#!/usr/bin/env python3
"""
Unit and integration tests for api.services.author_service.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from api.services.author_service import (
    CARD_SEPARATOR,
    serialize_card,
    serialize_deck,
    serialize_folder,
    parse_cards_text,
    preview_publish_content,
    get_effective_user_id
)

class MockCard:
    def __init__(self, id, deck_id, front_text, back_text, context="", topics="", metadata=None, tags=""):
        self.id = id
        self.deck_id = deck_id
        self.front_text = front_text
        self.back_text = back_text
        self.context = context
        self.topics = topics
        self.metadata = metadata or {}
        self.tags = tags

class MockDeck:
    def __init__(self, id, name, folder_id=1, user_id=42):
        self.id = id
        self.name = name
        self.folder_id = folder_id
        self.user_id = user_id

class MockFolder:
    def __init__(self, id, name, user_id=42):
        self.id = id
        self.name = name
        self.user_id = user_id


class TestAuthorService(unittest.TestCase):

    def test_serialize_card_complete(self):
        card = MockCard(
            id=123,
            deck_id=456,
            front_text="::exercise\n{*der schwarze Rock/der schwarz Rock}",
            back_text="der schwarze Rock — чёрная юбка",
            context="Важный пример",
            topics="Kleidung",
            tags="A1"
        )
        text = serialize_card(card)
        self.assertIn("::deck_id 456", text)
        self.assertIn("::card_id 123", text)
        self.assertIn("FRONT:\n::exercise\n{*der schwarze Rock/der schwarz Rock}", text)
        self.assertIn("BACK:\nder schwarze Rock — чёрная юбка", text)
        self.assertIn("::level A1", text)
        self.assertIn("::topic Kleidung", text)
        self.assertIn("Важный пример", text)

    def test_serialize_deck_and_folder(self):
        deck = MockDeck(id=1, name="Тест Колода")
        cards = [
            MockCard(1, 1, "F1", "B1", "C1", "T1", tags="A1"),
            MockCard(2, 1, "F2", "B2", "C2", "T2", tags="A2"),
        ]
        deck_text = serialize_deck(deck, cards)
        self.assertTrue(deck_text.startswith("# Deck: Тест Колода\n"))
        self.assertIn("FRONT:\nF1", deck_text)
        self.assertIn(CARD_SEPARATOR, deck_text)
        self.assertIn("FRONT:\nF2", deck_text)

        folder = MockFolder(id=10, name="Тест Папка")
        folder_text = serialize_folder(folder, [(deck, cards)])
        self.assertTrue(folder_text.startswith("# Folder: Тест Папка\n"))
        self.assertIn("# Deck: Тест Колода", folder_text)

    def test_parse_cards_text_single_deck(self):
        raw = (
            "# Deck: Цвета\n\n"
            "::deck_id 777\n"
            "::card_id 888\n\n"
            "FRONT:\n"
            "::exercise\n"
            "die [[rote]] Rose\n\n"
            "BACK:\n"
            "красная роза\n\n"
            "CONTEXT:\n"
            "::level A1\n"
            "::topic Farben\n"
            "Контекст про розу\n"
        )
        parsed = parse_cards_text(raw)
        self.assertEqual(len(parsed), 1)
        c = parsed[0]
        self.assertEqual(c['number'], 1)
        self.assertEqual(c['card_id'], 888)
        self.assertEqual(c['deck_id'], 777)
        self.assertEqual(c['deck_name'], "Цвета")
        self.assertEqual(c['card_type'], "trainer")
        self.assertEqual(c['front'], "::exercise\ndie [[rote]] Rose")
        self.assertEqual(c['back'], "красная роза")
        self.assertEqual(c['level'], "A1")
        self.assertEqual(c['topics'], "Farben")
        self.assertEqual(c['context'], "Контекст про розу")

    def test_parse_cards_text_multi_deck(self):
        raw = (
            "# Folder: Мой курс\n\n"
            "# Deck: Колода A\n\n"
            "FRONT:\nCard A1\n\nBACK:\nBack A1\n\n"
            "---\n\n"
            "# Deck: Колода B\n\n"
            "FRONT:\nCard B1\n\nBACK:\nBack B1\n\n"
            "---\n\n"
            "FRONT:\nCard B2\n\nBACK:\nBack B2\n\n"
        )
        parsed = parse_cards_text(raw)
        self.assertEqual(len(parsed), 3)
        self.assertEqual(parsed[0]['deck_name'], "Колода A")
        self.assertEqual(parsed[1]['deck_name'], "Колода B")
        self.assertEqual(parsed[2]['deck_name'], "Колода B")  # Inherits previous deck header

    def test_preview_publish_content(self):
        cards = [
            {'number': 1, 'deck_name': 'D1', 'front': '::exercise\n{A/*B}', 'back': 'B', 'card_type': 'quiz'},
            {'number': 2, 'deck_name': 'D1', 'front': '::exercise\n[[gap]]', 'back': 'gap', 'card_type': 'cloze'},
            {'number': 3, 'deck_name': 'D2', 'front': '::exercise\n@puzzle\nEin Test', 'back': 'Ein Test', 'card_type': 'puzzle'},
            {'number': 4, 'deck_name': 'D2', 'front': '::exercise\n[[незакрытая скобка', 'back': 'X', 'card_type': 'standard'},
        ]
        preview = preview_publish_content(cards)
        self.assertEqual(preview['total_cards'], 4)
        self.assertEqual(preview['decks_count'], 2)
        self.assertEqual(len(preview['decks']), 2)
        self.assertEqual(preview['decks'][0]['deck_name'], 'D1')
        self.assertEqual(preview['decks'][0]['cards_count'], 2)
        self.assertEqual(preview['decks'][1]['deck_name'], 'D2')
        self.assertEqual(preview['decks'][1]['cards_count'], 2)
        
        # Check syntax error detection
        self.assertEqual(len(preview['syntax_issues']), 1)
        self.assertEqual(preview['syntax_issues'][0]['card_number'], 4)
        self.assertIn("Несбалансированные скобки", preview['syntax_issues'][0]['issue'])

    def test_get_effective_user_id(self):
        # 1. Specified
        self.assertEqual(get_effective_user_id(100), 100)

        # 2. Target object owner
        deck = MockDeck(id=1, name="D", user_id=555)
        self.assertEqual(get_effective_user_id(None, deck), 555)

        # 3. Cannot determine author -> raises ValueError
        old_auth = os.environ.pop('AUTHOR_USER_ID', None)
        old_admin = os.environ.pop('ADMIN_USER_ID', None)
        try:
            with self.assertRaises(ValueError) as ctx:
                get_effective_user_id(None, None)
            self.assertIn("Не удалось определить автора", str(ctx.exception))
        finally:
            if old_auth is not None:
                os.environ['AUTHOR_USER_ID'] = old_auth
            if old_admin is not None:
                os.environ['ADMIN_USER_ID'] = old_admin

if __name__ == '__main__':
    unittest.main()
