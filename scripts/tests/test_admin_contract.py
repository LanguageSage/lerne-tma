"""A backend change cannot silently retain an older admin contract artifact."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('verify_contract', Path(__file__).parents[1] / 'verify_admin_contract.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ContractTests(unittest.TestCase):
    def test_reviewed_contract_matches_sources(self):
        self.assertEqual(set(module.verify()), {'schema', 'cards', 'permissions', 'import'})


if __name__ == '__main__':
    unittest.main()
