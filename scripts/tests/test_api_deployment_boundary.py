"""Deployment boundaries without real credentials or database connections."""
import os
from pathlib import Path
import subprocess
import sys
import unittest


class DeploymentBoundaryTests(unittest.TestCase):
    def test_production_does_not_import_development_packages(self):
        code = '''
import importlib.abc, sys
class ExcludeDevelopment(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'local', 'scripts', 'tools'}:
            raise AssertionError('Development package requested: ' + fullname)
sys.meta_path.insert(0, ExcludeDevelopment())
from api import database, main
assert "/api/auth/local/login" not in main.app.openapi()["paths"]
assert "/api/local/transfer-card/{card_id}" not in main.app.openapi()["paths"]
for url in ('postgresql://u:p@127.0.0.1/db', 'postgresql://u:p@[::1]/db',
            'postgresql://u:p@localhost/db', 'postgresql://u:p@cloud.invalid/lerne_tma_local'):
    try:
        database._parse_db_url(url)
    except RuntimeError:
        pass
    else:
        raise AssertionError('LOCAL target accepted')
assert database._parse_db_url('postgresql://u:p@cloud.invalid/cloud')['host'] == 'cloud.invalid'
'''
        env = {key: value for key, value in os.environ.items()
               if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
        env.update(VERCEL='1', PYTHON_DOTENV_DISABLED='1')
        result = subprocess.run([sys.executable, '-c', code], env=env,
                                cwd=Path(__file__).resolve().parents[2],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__':
    unittest.main()
