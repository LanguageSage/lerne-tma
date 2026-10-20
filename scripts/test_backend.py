"""Curated unittest suites, each in a fresh process with no external services.

Do not discover the repository: some legacy tests are live maintenance scripts.
"""
import importlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SUITES = (
    'scripts/tests/test_test_isolation.py',
    'scripts/tests/test_auth_foundation.py',
    'scripts/tests/test_critical_http.py',
    'scripts/tests/test_api_errors.py',
    'scripts/tests/test_admin_permissions.py',
    'scripts/tests/test_material_permissions.py',
    'scripts/tests/test_bulk_import_idempotency.py',
    'scripts/tests/test_card_text_update.py',
    'scripts/tests/test_folder_text_update.py',
    'scripts/tests/test_offline_sync.py',
    'scripts/tests/test_sync_read_queries.py',
    'scripts/tests/test_forced_study.py',
    'scripts/tests/test_study_latency.py',
    'scripts/tests/test_interactive_markers.py',
    'scripts/tests/test_exercise_detection_corpus.py',
    'tests/test_knowledge_item_schema.py',
    'tests/test_knowledge_sync.py',
    'tests/test_knowledge_mastery.py',
    'tests/test_knowledge_diagnostics.py',
    'tests/test_answer_evaluation.py',
)


def isolated_suite(path):
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str((ROOT / path).parent))
    # Native PostgreSQL drivers can bypass Python sockets. Deny their Peewee
    # connection path too. SQLite fixtures remain available.
    from peewee import PostgresqlDatabase
    context = threading.local()
    original_pair = socket.socketpair
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args, **_kwargs):
        raise RuntimeError('External services disabled in isolated tests')

    def socketpair(*args, **kwargs):
        # Windows asyncio creates its internal loopback socket pair via connect.
        context.socketpair_setup = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            context.socketpair_setup = False

    def connect(sock, address):
        if not getattr(context, 'socketpair_setup', False):
            return blocked()
        return original_connect(sock, address)

    def connect_ex(sock, address):
        if not getattr(context, 'socketpair_setup', False):
            return blocked()
        return original_connect_ex(sock, address)

    # Clear inherited secrets and prevent every load_dotenv() before API imports.
    safe_env = {key: value for key, value in os.environ.items()
                if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    safe_env.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')
    with patch.dict(os.environ, safe_env, clear=True), \
            patch('dotenv.load_dotenv', return_value=False), \
            patch.object(PostgresqlDatabase, 'connect', blocked), \
            patch.object(socket, 'socketpair', socketpair), \
            patch.object(socket.socket, 'connect', connect), \
            patch.object(socket.socket, 'connect_ex', connect_ex), \
            patch.object(socket.socket, 'sendto', blocked):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False):
            module = importlib.import_module(Path(path).stem)
            suite = unittest.defaultTestLoader.loadTestsFromModule(module)
            if suite.countTestCases() == 0:
                raise RuntimeError(f'No unittest cases collected: {path}')
            result = unittest.TextTestRunner(verbosity=1).run(suite)
            return int(not result.wasSuccessful() or bool(result.skipped))


def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
        if path not in SUITES:
            raise SystemExit('Suite is not in the isolated allowlist')
        return isolated_suite(path)
    failed = []
    for path in SUITES:
        print(f'\n=== {path} ===', flush=True)
        # Separate processes prevent legacy sys.modules mocks and model bindings
        # from changing the behavior of another suite.
        result = subprocess.run([sys.executable, __file__, path], cwd=ROOT)
        if result.returncode:
            failed.append(path)
    print('\nBackend failures: ' + ', '.join(failed) if failed else '\nBackend passed.', flush=True)
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
