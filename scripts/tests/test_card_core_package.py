"""Pure package identity, provenance and contract tracking; no application startup."""
import ast
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / 'api/card_core'


class CardCorePackageTests(unittest.TestCase):
    def test_sources_match_the_reviewed_release(self):
        from api.card_core import lerne_card_core
        release = json.loads((PACKAGE / 'provenance.json').read_text())
        self.assertEqual(lerne_card_core.__version__, release['version'])
        for name, expected in release['files'].items():
            path = PACKAGE / 'lerne_card_core' / name
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected, name)

    def test_package_never_imports_application_or_storage(self):
        # AST check also catches imports inside functions without executing them.
        allowed = {'copy', 'json', 're', 'typing', 'pydantic', 'pydantic_core'}
        for path in (PACKAGE / 'lerne_card_core').glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(n.name.split('.')[0] in allowed for n in node.names), path.name)
                elif isinstance(node, ast.ImportFrom) and not node.level:
                    self.assertIn(node.module.split('.')[0], allowed, path.name)

    def test_contract_follows_implementation_and_rejects_modified_adapter(self):
        from scripts import verify_admin_contract as verifier
        self.assertTrue(verifier.verify())
        original = Path.read_text

        def changed(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path == PACKAGE / 'lerne_card_core/structured_cards_v2.py':
                text = text.replace('MAX_DOCUMENT_CARDS = 1000', 'MAX_DOCUMENT_CARDS = 999')
            return text

        with patch.object(Path, 'read_text', changed):
            with self.assertRaisesRegex(RuntimeError, 'cards contract changed'):
                verifier.verify()

        def changed_alias(path, *args, **kwargs):
            text = original(path, *args, **kwargs)
            if path == ROOT / 'api/services/structured_cards_v2.py':
                text += '\nMAX_DOCUMENT_CARDS = 999\n'
            return text

        with patch.object(Path, 'read_text', changed_alias):
            with self.assertRaisesRegex(RuntimeError, 'Unexpected card package adapter'):
                verifier.verify()
