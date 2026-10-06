#!/usr/bin/env python3
"""
Unit and integration tests for Lerne Author CLI.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.lerne_author_cli import (
    serialize_card,
    serialize_deck,
    serialize_folder,
    parse_cards_text,
    CARD_SEPARATOR
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
    def __init__(self, id, name, folder_id=1):
        self.id = id
        self.name = name
        self.folder_id = folder_id

class MockFolder:
    def __init__(self, id, name):
        self.id = id
        self.name = name

class TestLerneAuthorCLI(unittest.TestCase):

    def test_serialize_single_card(self):
        card = MockCard(
            id=101,
            deck_id=55,
            front_text="::exercise\n{arbeiten/*müde/Arbeit}",
            back_text="müde — уставший",
            context="Важное слово",
            topics="Adjektiv",
            tags="A1"
        )
        serialized = serialize_card(card)
        self.assertIn("::deck_id 55", serialized)
        self.assertIn("::card_id 101", serialized)
        self.assertIn("FRONT:\n::exercise\n{arbeiten/*müde/Arbeit}", serialized)
        self.assertIn("BACK:\nmüde — уставший", serialized)
        self.assertIn("::level A1", serialized)
        self.assertIn("::topic Adjektiv", serialized)
        self.assertIn("Важное слово", serialized)

    def test_parse_single_deck_cards(self):
        text = (
            "# Deck: 01 · Практика\n\n"
            "::deck_id 55\n"
            "::card_id 101\n\n"
            "FRONT:\n"
            "::exercise\n"
            "Выбери Adjektiv.\n\n"
            "arbeiten\n"
            "*müde\n"
            "Arbeit\n\n"
            "BACK:\n"
            "müde — уставший\n\n"
            "CONTEXT:\n"
            "::level A1\n"
            "::topic Adjektiv\n"
            "Контекстная подсказка\n\n"
            "---\n\n"
            "::deck_id 55\n"
            "::card_id 102\n\n"
            "FRONT:\n"
            "der [[bequeme]] Schuh\n\n"
            "BACK:\n"
            "удобный ботинок\n\n"
            "CONTEXT:\n"
            "::level A1\n"
        )
        cards = parse_cards_text(text)
        self.assertEqual(len(cards), 2)
        
        c1 = cards[0]
        self.assertEqual(c1['card_id'], 101)
        self.assertEqual(c1['deck_id'], 55)
        self.assertEqual(c1['deck_name'], "01 · Практика")
        self.assertEqual(c1['level'], "A1")
        self.assertEqual(c1['topics'], "Adjektiv")
        self.assertIn("Выбери Adjektiv.", c1['front'])
        self.assertEqual(c1['back'], "müde — уставший")
        self.assertEqual(c1['context'], "Контекстная подсказка")

        c2 = cards[1]
        self.assertEqual(c2['card_id'], 102)
        self.assertEqual(c2['deck_id'], 55)
        self.assertEqual(c2['front'], "der [[bequeme]] Schuh")
        self.assertEqual(c2['back'], "удобный ботинок")
        self.assertEqual(c2['level'], "A1")

    def test_parse_multi_deck_file(self):
        text = (
            "# Folder: A1 Курс\n\n"
            "# Deck: Колода 1\n\n"
            "FRONT:\n"
            "Карточка 1\n\n"
            "BACK:\n"
            "Ответ 1\n\n"
            "CONTEXT:\n"
            "::level A1\n\n"
            "---\n\n"
            "# Deck: Колода 2\n\n"
            "FRONT:\n"
            "Карточка 2\n\n"
            "BACK:\n"
            "Ответ 2\n\n"
            "CONTEXT:\n"
            "::level A2\n"
        )
        cards = parse_cards_text(text)
        self.assertEqual(len(cards), 2)
        self.assertEqual(cards[0]['deck_name'], "Колода 1")
        self.assertEqual(cards[0]['level'], "A1")
        self.assertEqual(cards[1]['deck_name'], "Колода 2")
        self.assertEqual(cards[1]['level'], "A2")

    def test_roundtrip_serialize_and_parse(self):
        deck = MockDeck(id=77, name="Тестовая колода")
        cards_in = [
            MockCard(id=201, deck_id=77, front_text="Front 1", back_text="Back 1", context="Ctx 1", topics="Top 1", tags="B1"),
            MockCard(id=202, deck_id=77, front_text="Front 2", back_text="Back 2", context="Ctx 2", topics="Top 2", tags="B2"),
        ]
        serialized = serialize_deck(deck, cards_in)
        parsed = parse_cards_text(serialized)

        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]['card_id'], 201)
        self.assertEqual(parsed[0]['deck_id'], 77)
        self.assertEqual(parsed[0]['front'], "Front 1")
        self.assertEqual(parsed[0]['back'], "Back 1")
        self.assertEqual(parsed[0]['context'], "Ctx 1")
        self.assertEqual(parsed[0]['topics'], "Top 1")
        self.assertEqual(parsed[0]['level'], "B1")

        self.assertEqual(parsed[1]['card_id'], 202)
        self.assertEqual(parsed[1]['deck_id'], 77)
        self.assertEqual(parsed[1]['front'], "Front 2")
        self.assertEqual(parsed[1]['back'], "Back 2")
        self.assertEqual(parsed[1]['context'], "Ctx 2")
        self.assertEqual(parsed[1]['topics'], "Top 2")
        self.assertEqual(parsed[1]['level'], "B2")

if __name__ == '__main__':
    unittest.main()
