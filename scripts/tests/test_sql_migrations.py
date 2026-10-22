"""Migration runner regressions, synthetic data only; no API/config imports.

SQLite: python scripts/tests/test_sql_migrations.py
Disposable PostgreSQL: python scripts/tests/test_sql_migrations.py --disposable --postgres-port 55449
The PostgreSQL mode creates and drops only uniquely named test databases on loopback.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4

from peewee import OperationalError, PostgresqlDatabase, Proxy, SqliteDatabase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api import migrations

POSTGRES_PORT = None


class SqlMigrationTests(unittest.TestCase):
    def setUp(self):
        self.name = 'lerne_migration_test_' + uuid4().hex
        if POSTGRES_PORT is not None:
            import psycopg2
            from psycopg2 import sql
            self.admin = psycopg2.connect(dbname='postgres', host='127.0.0.1',
                                         port=POSTGRES_PORT, user='migration_test', connect_timeout=5)
            self.admin.autocommit = True
            with self.admin.cursor() as cursor:
                cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(self.name)))
            self.addCleanup(self.drop_postgres)
            self.db = PostgresqlDatabase(self.name, host='127.0.0.1', port=POSTGRES_PORT,
                                         user='migration_test', connect_timeout=5)
        else:
            scratch = ROOT / 'scratch'
            scratch.mkdir(exist_ok=True)
            self.path = scratch / (self.name + '.sqlite3')
            self.addCleanup(lambda: self.path.unlink(missing_ok=True))
            self.db = SqliteDatabase(str(self.path), timeout=10)
        self.addCleanup(self.db.close)
        self.db.execute_sql('CREATE TABLE migration_probe (value INTEGER NOT NULL)')
        self.db.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY)')
        self.proxy = Proxy()
        self.proxy.initialize(self.db)
        # The legacy SQLite view/trigger refresh is outside the migration catalog.
        self.logs = self.enterContext(patch.object(migrations, 'logger'))

    def drop_postgres(self):
        from psycopg2 import sql
        try:
            with self.admin.cursor() as cursor:
                cursor.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(self.name)))
        finally:
            self.admin.close()

    def run_migrations(self, statements, runner=None):
        with patch.object(migrations, 'MIGRATIONS', statements):
            (runner or migrations.run_migrations)(self.proxy, self.proxy)

    def history(self):
        return self.db.execute_sql('SELECT migration_id FROM tma_migration_history ORDER BY migration_id').fetchall()

    def values(self):
        return self.db.execute_sql('SELECT value FROM migration_probe ORDER BY value').fetchall()

    def test_success_records_both_database_keys(self):
        self.run_migrations([(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma'),
                             (9002, 'INSERT INTO migration_probe VALUES (2)', 'lerne')])
        self.assertEqual(self.values(), [(1,), (2,)])
        self.assertEqual(self.history(), [(9001,), (9002,)])

    def test_local_bootstrap_skips_model_columns_but_runs_other_migrations(self):
        statements = [
            (9001, 'ALTER TABLE migration_probe ADD COLUMN value INTEGER', 'tma'),
            (9002, 'CREATE INDEX IF NOT EXISTS idx_migration_probe_value ON migration_probe(value)', 'lerne'),
        ]
        with patch.object(migrations, 'MIGRATIONS', statements):
            migrations.run_local_bootstrap_migrations(self.proxy, self.proxy)
        self.assertEqual(self.history(), [(9001,), (9002,)])
        self.assertIn('idx_migration_probe_value',
                      {index.name for index in self.db.get_indexes('migration_probe')})

    def test_sql_error_is_not_success_and_stops_later_sql(self):
        with self.assertRaises(RuntimeError):
            self.run_migrations([(9001, 'INSRT INTO migration_probe VALUES (1)', 'tma'),
                                 (9002, 'INSERT INTO migration_probe VALUES (2)', 'tma')])
        self.assertEqual(self.values(), [])
        self.assertEqual(self.history(), [])
        self.assertTrue(self.logs.error.called or self.logs.exception.called)

    def test_missing_column_and_duplicate_are_errors_not_success(self):
        for query in ('SELECT is_deleted FROM migration_probe',
                      'ALTER TABLE migration_probe ADD COLUMN value INTEGER'):
            with self.subTest(query=query), self.assertRaises(RuntimeError):
                self.run_migrations([(9001, query, 'tma')])
            self.assertEqual(self.history(), [])

    def test_rerun_does_not_repeat_committed_data_or_ddl(self):
        statements = [(9001, 'ALTER TABLE migration_probe ADD COLUMN added INTEGER', 'tma'),
                      (9002, 'INSERT INTO migration_probe VALUES (1, 7)', 'lerne')]
        self.run_migrations(statements)
        self.db.close()
        self.run_migrations(statements)
        self.assertEqual(self.values(), [(1,)])
        self.assertEqual(self.history(), [(9001,), (9002,)])

    def test_failure_rolls_back_pending_ddl_data_and_history_then_can_retry(self):
        self.run_migrations([(9000, 'INSERT INTO migration_probe VALUES (0)', 'tma')])
        statements = [(9000, 'INSERT INTO migration_probe VALUES (0)', 'tma'),
                      (9001, 'ALTER TABLE migration_probe ADD COLUMN added INTEGER', 'tma'),
                      (9002, 'INSERT INTO migration_probe VALUES (1, 7)', 'lerne'),
                      (9003, 'INVALID SQL', 'tma')]
        with self.assertRaises(RuntimeError):
            self.run_migrations(statements)
        self.db.close()
        self.assertEqual(self.values(), [(0,)])
        self.assertEqual(self.history(), [(9000,)])
        self.assertEqual([column.name for column in self.db.get_columns('migration_probe')], ['value'])
        statements[-1] = (9003, 'INSERT INTO migration_probe VALUES (2, 8)', 'tma')
        self.run_migrations(statements)
        self.run_migrations(statements)
        self.assertEqual(self.values(), [(0,), (1,), (2,)])
        self.assertEqual(self.history(), [(9000,), (9001,), (9002,), (9003,)])

    def test_history_insert_failure_rolls_back_sql(self):
        execute = self.db.execute_sql

        def fail_history(query, *args, **kwargs):
            if query.startswith('INSERT INTO tma_migration_history'):
                raise OperationalError('synthetic history write failure')
            return execute(query, *args, **kwargs)

        with patch.object(self.db, 'execute_sql', side_effect=fail_history), self.assertRaises(RuntimeError):
            self.run_migrations([(9001, 'ALTER TABLE migration_probe ADD COLUMN added INTEGER', 'tma')])
        self.assertEqual(self.history(), [])
        self.assertEqual([column.name for column in self.db.get_columns('migration_probe')], ['value'])

    def test_history_setup_or_read_failure_never_runs_untracked_sql(self):
        execute = self.db.execute_sql
        for prefix in ('CREATE TABLE IF NOT EXISTS tma_migration_history', 'SELECT migration_id'):
            def fail_history(query, *args, **kwargs):
                if query.strip().startswith(prefix):
                    raise OperationalError('synthetic history unavailable')
                return execute(query, *args, **kwargs)

            with self.subTest(prefix=prefix), patch.object(self.db, 'execute_sql', side_effect=fail_history):
                with self.assertRaises(RuntimeError):
                    self.run_migrations([(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')])
            self.assertEqual(self.values(), [])
            self.assertEqual(self.history(), [])

    def test_fallback_entrypoint_obeys_same_failure_rules(self):
        with self.assertRaises(RuntimeError):
            self.run_migrations([(9001, 'INVALID SQL', 'tma')], migrations.run_migrations_fallback)
        self.assertEqual(self.history(), [])

    def test_separate_database_is_rejected_before_any_sql(self):
        other = SqliteDatabase(':memory:')
        with self.assertRaises(RuntimeError):
            migrations.run_migrations(self.proxy, other)
        self.assertEqual(self.values(), [])
        self.assertEqual(self.history(), [])
        self.assertTrue(other.is_closed())

    def test_nested_transaction_is_rejected(self):
        with self.db.atomic(), self.assertRaises(RuntimeError):
            self.run_migrations([(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')])
        self.assertEqual(self.values(), [])
        self.assertEqual(self.history(), [])

    def test_commit_failure_rolls_back_sql_and_history(self):
        with patch.object(self.db, 'commit', side_effect=OperationalError('synthetic commit failure')):
            with self.assertRaises(RuntimeError):
                self.run_migrations([(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')])
        self.db.close()
        self.assertEqual(self.values(), [])
        self.assertEqual(self.history(), [])

    def test_lost_commit_acknowledgement_does_not_repeat_durable_sql(self):
        commit = self.db.commit

        def lost_acknowledgement():
            commit()
            raise OperationalError('synthetic lost commit acknowledgement')

        statements = [(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')]
        with patch.object(self.db, 'commit', side_effect=lost_acknowledgement):
            with self.assertRaisesRegex(RuntimeError, 'commit was not confirmed'):
                self.run_migrations(statements)
        self.db.close()
        self.assertEqual(self.values(), [(1,)])
        self.assertEqual(self.history(), [(9001,)])
        self.run_migrations(statements)
        self.assertEqual(self.values(), [(1,)])
        self.assertEqual(self.history(), [(9001,)])

    def test_parallel_runners_apply_once_even_without_initial_history(self):
        self.db.execute_sql('DROP TABLE tma_migration_history')
        barrier = threading.Barrier(2)

        def worker():
            barrier.wait(timeout=10)
            try:
                migrations.run_migrations(self.proxy, self.proxy)
            finally:
                self.db.close()

        with patch.object(migrations, 'MIGRATIONS', [(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')]):
            with ThreadPoolExecutor(max_workers=2) as workers:
                futures = [workers.submit(worker) for _ in range(2)]
                for future in futures:
                    future.result(timeout=20)
        self.assertEqual(self.values(), [(1,)])
        self.assertEqual(self.history(), [(9001,)])

    def child(self, body):
        if POSTGRES_PORT is None:
            connection = f'db = SqliteDatabase({str(self.path)!r})'
        else:
            connection = (f'db = PostgresqlDatabase({self.name!r}, host="127.0.0.1", '
                          f'port={POSTGRES_PORT}, user="migration_test", connect_timeout=5)')
        code = f'''
import os
import sys
from types import ModuleType
from peewee import SqliteDatabase, PostgresqlDatabase, Proxy
from api import migrations
{connection}
proxy = Proxy()
proxy.initialize(db)
migrations.MIGRATIONS = [(9001, "INVALID SQL", "tma")]
{body}
print("Migration completed successfully.")
'''
        safe_env = {key: value for key, value in os.environ.items()
                    if key.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
        return subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=safe_env,
                              capture_output=True, text=True, timeout=20)

    def test_uncaught_migration_error_exits_nonzero(self):
        result = self.child('migrations.run_migrations(proxy, proxy)')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('9001', result.stderr)
        self.assertNotIn('Migration completed successfully.', result.stdout)
        self.assertEqual(self.history(), [])

    def test_process_crash_between_sql_and_history_rolls_back(self):
        result = self.child('''
execute = db.execute_sql
def crash_at_marker(query, *args, **kwargs):
    if query.startswith("INSERT INTO tma_migration_history"):
        os._exit(23)
    return execute(query, *args, **kwargs)
db.execute_sql = crash_at_marker
migrations.MIGRATIONS = [(9001, "ALTER TABLE migration_probe ADD COLUMN added INTEGER", "tma")]
migrations.run_migrations(proxy, proxy)
''')
        self.assertEqual(result.returncode, 23, result.stderr)
        self.db.close()
        self.assertEqual(self.history(), [])
        self.assertEqual([column.name for column in self.db.get_columns('migration_probe')], ['value'])
        self.run_migrations([(9001, 'INSERT INTO migration_probe VALUES (1)', 'tma')])
        self.assertEqual(self.values(), [(1,)])
        self.assertEqual(self.history(), [(9001,)])

    def test_model_callers_do_not_swallow_migration_error(self):
        for during_import in (True, False):
            body = '''
# Replace configuration owner before importing models; no .env or network.
module = ModuleType("api.database")
module.tma_db = module.lerne_db = proxy
module.initialize_database = lambda: True
sys.modules["api.database"] = module
'''
            if not during_import:
                body += 'os.environ["VERCEL"] = "1"\n'
            body += 'from api import models\n'
            if not during_import:
                body += 'models.create_all_tables()\n'
            with self.subTest(during_import=during_import):
                result = self.child(body)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('MigrationError', result.stderr)
                self.assertNotIn('Migration completed successfully.', result.stdout)
                self.assertEqual(self.history(), [])

    def test_api_initialization_does_not_swallow_migration_error(self):
        import ast
        from types import SimpleNamespace
        tree = ast.parse((ROOT / 'api/main.py').read_text(encoding='utf-8'))
        # Execute the real startup try/except without importing routes/providers.
        startup = next(node for node in tree.body if isinstance(node, ast.Try)
                       and 'models.create_all_tables()' in ast.unparse(node))
        def fail():
            raise migrations.MigrationError('synthetic startup failure')
        namespace = dict(MigrationError=migrations.MigrationError, is_local=lambda: False,
                         models=SimpleNamespace(initialize_database=lambda: True, create_all_tables=fail),
                         logger=self.logs)
        with self.assertRaises(migrations.MigrationError):
            exec(compile(ast.Module(body=[startup], type_ignores=[]), 'api/main.py', 'exec'), namespace)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disposable', action='store_true')
    parser.add_argument('--postgres-port', type=int)
    args = parser.parse_args()
    if args.postgres_port is not None and not args.disposable:
        parser.error('PostgreSQL requires --disposable on a disposable loopback cluster')
    POSTGRES_PORT = args.postgres_port
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SqlMigrationTests))
    raise SystemExit(not result.wasSuccessful())
