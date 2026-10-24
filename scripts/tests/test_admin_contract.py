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


if __name__ == '__main__':
    unittest.main()
