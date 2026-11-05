"""The offline import boundary produces the same V2 model from both inputs."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

from pydantic import ValidationError

from api.card_core.lerne_card_core.structured_cards_import import ImportFormatError, import_documents
from api.card_core.lerne_card_core.structured_cards_v2 import load_document


def codex_card(front, back='', context=''):
    return f'<<<LERNE_CARD>>>\nFRONT:\n{front}\nBACK:\n{back}\nCONTEXT:\n{context}\n'


class NativeCardImportTests(unittest.TestCase):
    def test_all_nine_types_from_codex_and_equivalent_json(self):
        examples = [
            ('Was?', 'Das.', 'standard', {'prompt': 'Was?', 'answer': 'Das.'}),
            ('@theory\nEin Beispiel mit [[Lücke]].', '', 'theory',
             {'text': 'Ein Beispiel mit [[Lücke]].', 'summary': ''}),
            ('{*Als|Wenn} ich [[kam|ankam]].', 'Когда я пришёл.', 'trainer',
             {'parts': [{'type': 'choice', 'options': [{'text': 'Als', 'correct': True}, {'text': 'Wenn'}]},
                        {'type': 'text', 'text': ' ich '}, {'type': 'input', 'answers': ['kam', 'ankam']},
                        {'type': 'text', 'text': '.'}], 'back_note': 'Когда я пришёл.'}),
            ('Wann?\n\n1812\n*1789\n1776', 'Когда?', 'quiz',
             {'prompt': 'Wann?', 'options': [{'text': '1812'}, {'text': '1789', 'correct': True},
                                            {'text': '1776'}], 'back_note': 'Когда?'}),
            ('@match\nApfel => apple => fruit\nHaus => house\nHaus => house', 'Слова', 'match',
             {'pairs': [{'left': 'Apfel', 'right': 'apple => fruit'}, {'left': 'Haus', 'right': 'house'},
                        {'left': 'Haus', 'right': 'house'}], 'back_note': 'Слова'}),
            ('@puzzle\nIch sage ja, ja.', 'Я говорю «да».', 'puzzle',
             {'tokens': ['Ich', 'sage', 'ja,', 'ja.'], 'translation': 'Я говорю «да».'}),
            ('@wordbank\n<<x>> und <<y>>\n@options\nja | nein | ja', 'y=ja\nx=ja', 'word_bank',
             {'options': ['ja', 'nein', 'ja'], 'parts': [{'type': 'gap', 'option': 0},
              {'type': 'text', 'text': ' und '}, {'type': 'gap', 'option': 2}]}),
            ('@free\nErzählen Sie.', 'Ich wohne hier.', 'free_text',
             {'prompt': 'Erzählen Sie.', 'sample_answer': 'Ich wohne hier.'}),
            ('@edit\nIch gehen.', 'Ich gehe.', 'editable_text',
             {'source_text': 'Ich gehen.', 'correct_text': 'Ich gehe.'}),
        ]
        codex = '# Deck: Test\n'
        cards = []
        for front, back, kind, data in examples:
            codex += codex_card(front, back, 'Hinweis.\n::level\nB1\n::topic\nVerben, Teil 1')
            cards.append({'type': kind, 'data': data, 'explanation': 'Hinweis.',
                          'level': 'B1', 'topics': ['Verben, Teil 1']})
        json_v2 = json.dumps({'schema_version': 2, 'deck': {'name': 'Test'}, 'cards': cards})
        imported = import_documents(codex.replace('\n', '\r\n'))
        self.assertEqual(imported, import_documents('\ufeff' + json_v2))
        self.assertEqual(imported[0], load_document(imported[0].model_dump_json()))

    def test_folder_metadata_passport_images_and_information_order(self):
        passport = {'schema_version': 1, 'intro': {'level': 'A2', 'topic': 'Verben', 'goal': 'Üben'}}
        first = '''# Folder: Testordner
# Колода: First
::deck_id 22
<<<LERNE_PASSPORT>>>
PASSPORT_JSON
<<<END_LERNE_PASSPORT>>>
<<<LERNE_CARD>>>
::card_id 5
::image pictures/one.webp
FRONT:
::task
Wählen Sie.
::source
Aus dem Beispiel.
::example
Er spielt.
::options
Eins | Zwei
::exercise
[*] Ja
[ ] Nein
BACK: Rückseite
CONTEXT: Erklärung
'''.replace('PASSPORT_JSON', json.dumps(passport))
        documents = import_documents(first + '\n---\n# Deck: Second\n' + codex_card('Hallo', 'Hi'))
        self.assertEqual([doc.deck.name for doc in documents], ['First', 'Second'])
        doc = documents[0]
        self.assertEqual(doc.deck.metadata, {'source_deck_id': 22, 'source_folder_name': 'Testordner'})
        self.assertEqual(doc.deck.passport, passport)
        card = doc.cards[0]
        self.assertEqual((card.id, card.image, card.level, card.topics),
                         ('5', 'pictures/one.webp', 'A2', ['Verben']))
        self.assertEqual([block.type for block in card.info], ['task', 'source', 'example', 'options'])
        self.assertEqual(card.info[-1].items, ['Eins', 'Zwei'])
        self.assertEqual((card.type, card.data.prompt, card.data.back_note, card.explanation),
                         ('quiz', '', 'Rückseite', 'Erklärung'))

    def test_native_json_retains_literals_multiple_correct_answers_and_explicit_empty_topics(self):
        value = {'schema_version': 2, 'deck': {'name': 'Test', 'passport': {'schema_version': 1, 'intro': {'topic': 'Inherited'}}},
                 'cards': [{'type': 'quiz', 'topics': [], 'data': {'prompt': '@puzzle\n[[literal]]',
                            'options': [{'text': 'A', 'correct': True}, {'text': 'B', 'correct': True}]}},
                           {'type': 'standard', 'data': {'prompt': 'FRONT:\n@edit', 'answer': 'Literal'}}]}
        doc, = import_documents(json.dumps(value))
        self.assertEqual(doc.cards[0].data.prompt, '@puzzle\n[[literal]]')
        self.assertEqual([option.correct for option in doc.cards[0].data.options], [True, True])
        self.assertEqual(doc.cards[0].topics, [])
        self.assertEqual(doc.cards[1].topics, ['Inherited'])

    def test_errors_are_positioned_and_abort_the_whole_import(self):
        cases = [
            (codex_card('@match\na => b\nmissing separator'), 'Match line'),
            (codex_card('@puzzle\n@free\ntext'), 'exercise body'),
            (codex_card('Was?\n\n[*] Eins\n[*] Zwei'), 'exactly one'),
            (codex_card('Was?\n\n[ ] Eins\n[ ] Zwei'), 'exactly one'),
            (codex_card('[[ok]] und [[offen'), 'unmatched'),
            (codex_card('@wordbank\n<<x>>\n@options\nJa | ja', 'x=ja'), 'ambiguous bank option'),
            (codex_card('@wordbank\n<<x>>\n@options\nJa | Nein', 'x=Ja\ny=Nein'), 'unknown gaps'),
            (codex_card('Text\n::source\nSpäter', 'answer'), 'information after exercise'),
            (codex_card('Text', 'answer', '::level B1\n::level B2'), 'duplicate'),
            ('<<<LERNE_CARD>>>\nBACK: wrong order\nFRONT: Hallo', 'Expected FRONT'),
            ('<<<LERNE_CARD>>>\n::unknown 12\nFRONT: Hallo\nBACK: Hi', 'invalid Codex header'),
        ]
        for bad_card, message in cases:
            with self.subTest(bad_card=bad_card), self.assertRaisesRegex(
                ImportFormatError, rf'(?s)decks\[1\].*cards\[0\].*{message}'
            ):
                import_documents('# Deck: First\n' + codex_card('Hallo', 'Hi')
                                 + '# Deck: Second\n' + bad_card)
        with self.assertRaisesRegex(ImportFormatError, r'decks\[0\].*cards.0.editable_text'):
            import_documents('# Deck: First\n' + codex_card('@edit\nHallo', 'Hallo'))

    def test_invalid_json_is_not_retried_as_codex(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key: schema_version'):
            import_documents('{"schema_version":2,"schema_version":2}')
        with self.assertRaises(ValidationError):
            import_documents('[]')
        with self.assertRaises(json.JSONDecodeError):
            import_documents(codex_card('Hallo', 'Hi'), json_input=True)

    def test_cli_emits_v2_without_application_startup(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [sys.executable, 'scripts/structured_cards_v2.py', 'import',
             'tests/fixtures/structured_cards_v2/basics.json'],
            cwd=root, capture_output=True, encoding='utf-8', check=True)
        documents = json.loads(result.stdout)
        self.assertEqual(documents[0]['schema_version'], 2)
        self.assertTrue(documents[0]['cards'])
        self.assertNotIn('front', documents[0]['cards'][0])
        self.assertEqual(result.stderr, '')
