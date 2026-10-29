"""A backend change cannot silently retain an older admin contract artifact."""
import importlib.util
import ast
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify_contract', Path(__file__).parents[1] / 'verify_admin_contract.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ContractTests(unittest.TestCase):
    def test_reviewed_contract_matches_sources(self):
        self.assertEqual(set(module.verify()), {'schema', 'cards', 'permissions', 'import'})

    def test_fingerprint_format_is_independent_of_ast_dump_defaults(self):
        source = 'def f(x=None):\n    return x\n'
        expected = ("Module(body=[FunctionDef(name='f', args=arguments(args=[arg(arg='x')], "
                    "defaults=[Constant(value=None)]), body=[Return(value=Name(id='x', ctx=Load()))])])")
        self.assertEqual(module.canonical_dump(ast.parse(source)), expected)

    def test_source_hash_ignores_formatting_but_detects_semantic_changes(self):
        def fingerprint(source):
            with patch.object(Path, 'read_text', return_value=source):
                return module.source_hash(['fixture.py'])
        original = fingerprint('nullable = None\n')
        self.assertEqual(original, fingerprint('# Same model\nnullable=None\n'))
        self.assertNotEqual(original, fingerprint('nullable = False\n'))


    def test_reviewed_schema_changes_cannot_bypass_the_fingerprint(self):
        original = Path.read_text
        for before, after in (
            ('verified_profile = TextField(null=True)', 'verified_profile = TextField(null=False)'),
            ('card_id = BigIntegerField(null=True)', 'card_id = BigIntegerField(null=False)'),
        ):
            with self.subTest(field=before):
                def changed(path, *args, **kwargs):
                    text = original(path, *args, **kwargs)
                    if path == module.ROOT / 'api/models.py':
                        self.assertIn(before, text)
                        return text.replace(before, after)
                    return text
                with patch.object(Path, 'read_text', changed):
                    with self.assertRaisesRegex(RuntimeError, 'schema contract changed'):
                        module.verify()

    def test_audio_guards_and_personal_learning_remain_in_import_contract(self):
        original = Path.read_text
        for relative, before, after in (
            ('api/services/cards.py', 'validate_new_audio_path(card.audio_path, previous_audio)', 'pass'),
            ('api/services/decks.py', 'learning_states.get(d.id, False)', 'learning_states.get(d.id, True)'),
        ):
            with self.subTest(source=relative):
                def changed(path, *args, **kwargs):
                    text = original(path, *args, **kwargs)
                    if path == module.ROOT / relative:
                        self.assertIn(before, text)
                        return text.replace(before, after)
                    return text
                with patch.object(Path, 'read_text', changed):
                    with self.assertRaisesRegex(RuntimeError, 'import contract changed'):
                        module.verify()


if __name__ == '__main__':
    unittest.main()
