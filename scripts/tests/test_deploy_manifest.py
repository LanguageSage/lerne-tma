"""Production upload boundary regressions; temporary Git fixtures, no deployment."""
import unittest
import ast
from scripts.verify_deploy_files import ROOT, ignored_paths, inspect


class DeployManifestTests(unittest.TestCase):
    def test_tma_does_not_import_admin_or_removed_admin_fixtures(self):
        for base in ('api', 'local', 'scripts/tests', 'tests'):
            for path in (ROOT / base).rglob('*.py'):
                for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
                    names = [node.module or ''] if isinstance(node, ast.ImportFrom) else [n.name for n in node.names] if isinstance(node, ast.Import) else []
                    self.assertFalse(any(n.startswith(('tools.admin', 'lerne_admin')) for n in names), str(path))
                    if isinstance(node, ast.ImportFrom) and node.module == 'scripts.tests':
                        for alias in node.names:
                            if alias.name.startswith(('test_', 'admin_')):
                                self.assertTrue((ROOT / 'scripts/tests' / (alias.name + '.py')).is_file(), str(path))

    def test_required_dictionaries_and_bundeslaender_survive_upload_filters(self):
        report = inspect()
        self.assertIn('app/src/data/bundeslaender.js', report['source_files'])
        for path in report['required_resources']:
            self.assertIn(path, report['source_files'])

    def test_private_and_runtime_paths_stay_excluded_inside_allowed_roots(self):
        paths = ['api/local.json', 'api/.env', 'api/data/backups/a.json',
                 'app/a.sqlite', 'api/a.db', 'app/node_modules/a.js',
                 'api/__pycache__/a.pyc', 'local/runtime.py', 'tools/admin/server.py']
        self.assertEqual(ignored_paths((ROOT / '.vercelignore').read_text(), paths), set(paths))

    def test_unanchored_data_pattern_reproduces_the_original_failure(self):
        paths = ['app/src/data/bundeslaender.js', 'api/services/classifier/data/vocab_de.json',
                 'app/src/services/classifier/data/vocab_de.json']
        self.assertEqual(ignored_paths('data/\n', paths), set(paths))
