"""Exercise the current Author CLI commands without a configured database."""
from contextlib import redirect_stdout
from io import StringIO
import json
from types import SimpleNamespace
import unittest
from unittest.mock import mock_open, patch

from scripts import lerne_author_cli as cli


class AuthorCliTests(unittest.TestCase):
    def setUp(self):
        self.output = StringIO()
        self.enterContext(redirect_stdout(self.output))
        self.enterContext(patch.object(cli, 'initialize_database'))

    def test_export_writes_native_json_without_changing_call_flags(self):
        doc = {'schema_version': 2, 'deck': {'name': 'Synthetic'}, 'cards': []}
        result = {'deck_id': 42, 'deck_name': 'Synthetic', 'cards_count': 0, 'text': json.dumps(doc)}
        args = SimpleNamespace(deck_id=42, folder_id=None, user_id=7, out='synthetic.txt')
        with patch.object(cli, 'export_deck_content', return_value=result) as export, \
                patch.object(cli.os, 'makedirs'), patch('builtins.open', mock_open()) as target:
            self.assertEqual(cli.handle_export(args), 0)
        export.assert_called_once_with(42, user_id=7)
        target.assert_called_once_with('synthetic.txt', 'w', encoding='utf-8')
        self.assertEqual(json.loads(target().write.call_args.args[0]), doc)

    def test_update_dry_run_passes_native_card_to_preview_only(self):
        text = '# Deck: Synthetic\nFRONT:\nHaus\nBACK:\nдом'
        args = SimpleNamespace(file='synthetic.txt', deck_id=42, folder_id=None, user_id=7, apply=False)
        with patch.object(cli.os.path, 'exists', return_value=True), patch('builtins.open', mock_open(read_data=text)), \
                patch.object(cli, 'preview_update_content', return_value={'updated': 1}) as preview, \
                patch.object(cli, 'apply_update_content') as apply:
            self.assertEqual(cli.handle_update(args), 0)
        cards = preview.call_args.kwargs['cards']
        self.assertEqual(cards[0]['deck_id'], 42)
        self.assertEqual(cards[0]['content_v2']['card']['data'], {'prompt': 'Haus', 'answer': 'дом'})
        apply.assert_not_called()

    def test_publish_dry_run_validates_native_json_without_writing(self):
        text = json.dumps({'schema_version': 2, 'deck': {'name': 'Synthetic'}, 'cards': [
            {'type': 'standard', 'data': {'prompt': 'Haus', 'answer': 'дом'}}]})
        args = SimpleNamespace(file='synthetic.json', deck_name=None, passport_only=False,
                               folder_id=5, new_folder=None, apply=False)
        with patch.object(cli.os.path, 'exists', return_value=True), patch('builtins.open', mock_open(read_data=text)), \
                patch.object(cli, 'apply_publish_content') as apply:
            self.assertEqual(cli.handle_publish(args), 0)
        self.assertIn('Synthetic', self.output.getvalue())
        apply.assert_not_called()
