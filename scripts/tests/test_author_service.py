"""Synthetic Native V2 coverage of the author service and Codex input."""
import json
from types import SimpleNamespace
import unittest

from api.services import author_service as author


class AuthorServiceTests(unittest.TestCase):
    def test_native_export_preserves_source_ids_and_content(self):
        parsed = author.parse_document(
            '# Deck: Farben\nFRONT:\nRote Rose\nBACK:\nроза\nCONTEXT:\n'
            'Ein Beispiel.\n::level A1\n::topic Farben')
        self.assertEqual(parsed['errors'], [])
        envelope = parsed['cards'][0]['content_v2']
        deck = SimpleNamespace(id=42, name='Farben', metadata='{}')
        folder = SimpleNamespace(id=5, name='Synthetic')
        card = SimpleNamespace(id=101, content_v2=envelope)
        exported = author.serialize_folder(folder, [(deck, [card])])
        self.assertEqual(json.loads(exported), [json.loads(author.serialize_deck(deck, [card]))])
        result = author.parse_document(exported, json_input=True)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['cards'][0]['content_v2'], envelope)
        self.assertEqual((result['cards'][0]['deck_id'], result['cards'][0]['card_id']), (42, 101))

    def test_codex_scopes_cards_to_decks_and_accepts_explicit_separator(self):
        raw = ('# Deck: A\nFRONT:\nA1\nBACK:\nOne\n\n'
               '# Deck: B\nFRONT:\nB1\nBACK:\nTwo\n\n'
               '<<<LERNE_CARD>>>\nFRONT:\nB2\nBACK:\nThree\n'
               'CONTEXT:\nSynthetic context\n::level B1\n::topic Farben')
        cards = author.parse_cards_text(raw)
        self.assertEqual([card['deck_name'] for card in cards], ['A', 'B', 'B'])
        value = cards[2]['content_v2']['card']
        self.assertEqual(value['data'], {'prompt': 'B2', 'answer': 'Three'})
        self.assertEqual(value['level'], 'B1')
        self.assertEqual(value['topics'], ['Farben'])
        self.assertEqual(value['explanation'], 'Synthetic context')

    def test_preview_uses_native_types_and_deck_counts(self):
        document = author.parse_document(
            '# Deck: A\nFRONT:\nHaus\nBACK:\nдом\n\n'
            '# Deck: B\nFRONT:\nWo?\n\n[ ] Bonn\n[*] Berlin\nBACK:\nBerlin')
        self.assertEqual(document['errors'], [])
        preview = author.preview_publish_content(document['cards'])
        self.assertEqual(preview['total_cards'], 2)
        self.assertEqual([(row['deck_name'], row['cards_count']) for row in preview['decks']], [('A', 1), ('B', 1)])
        self.assertEqual({row['content_v2']['card']['type'] for row in document['cards']}, {'standard', 'quiz'})

    def test_effective_author_requires_an_explicit_or_owned_identity(self):
        self.assertEqual(author.get_effective_user_id(100), 100)
        deck = SimpleNamespace(user_id=555)
        self.assertEqual(author.get_effective_user_id(None, deck), 555)
        with self.assertRaisesRegex(ValueError, 'Не удалось определить автора'):
            author.get_effective_user_id()
