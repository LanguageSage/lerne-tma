"""Generated synthetic inputs only; no configured DB, network or private snapshot."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import subprocess
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from tools import native_v2_dry_run, native_v2_rehearsal, native_v2_snapshot

ROOT = Path(__file__).resolve().parents[2]


class RehearsalToolGuards(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / 'local/test-data' / ('synthetic-rehearsal-' + uuid4().hex)
        self.root.mkdir(parents=True)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        assert self.root.resolve().parent == (ROOT / 'local/test-data').resolve()
        assert self.root.name.startswith('synthetic-rehearsal-')
        shutil.rmtree(self.root)

    def snapshot_args(self, host='selected.example'):
        return ['snapshot', '--source-env-file', 'synthetic.env', '--expected-host', host,
                '--expected-database', 'synthetic', '--bin-dir', str(self.root),
                '--output', str(self.root / 'result')]

    def test_wrong_source_identity_never_connects_or_creates_output(self):
        with patch.object(sys, 'argv', self.snapshot_args(host='different.example')), \
                patch.object(native_v2_snapshot, 'dotenv_values', return_value={'SUPABASE_DB_URL': 'postgresql://u:p@selected.example/synthetic'}), \
                patch.object(native_v2_snapshot.psycopg2, 'connect') as connect, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                native_v2_snapshot.main()
            self.assertEqual(error.exception.code, 2)
        connect.assert_not_called()
        self.assertFalse((self.root / 'result').exists())

    def test_read_failure_is_incomplete_and_does_not_publish_exception_secret(self):
        canary = 'synthetic-secret-must-stay-private'
        stdout = io.StringIO()
        with patch.object(sys, 'argv', self.snapshot_args()), \
                patch.object(native_v2_snapshot, 'dotenv_values', return_value={'SUPABASE_DB_URL': f'postgresql://u:{canary}@selected.example/synthetic'}), \
                patch.object(native_v2_snapshot.psycopg2, 'connect', side_effect=RuntimeError(canary)) as connect, \
                contextlib.redirect_stdout(stdout):
            self.assertEqual(native_v2_snapshot.main(), 1)
        self.assertIn('default_transaction_read_only=on', connect.call_args.kwargs['options'])
        saved = (self.root / 'result/manifest.json').read_text(encoding='utf-8')
        self.assertNotIn(canary, saved + stdout.getvalue())
        report = json.loads(saved)
        self.assertFalse(report['full_backup'])
        self.assertFalse(report['database_observation_complete'])

    def test_changed_dump_is_rejected_before_disposable_runner_import(self):
        source = self.root / 'source'
        source.mkdir()
        (source / 'public.dump').write_bytes(b'changed synthetic archive')
        (source / 'manifest.json').write_text(json.dumps({'database_observation_complete': True,
            'artifacts': {'public.dump': {'sha256': hashlib.sha256(b'original synthetic archive').hexdigest()}}}))
        argv = ['rehearsal', '--snapshot-dir', str(source), '--admin-root', str(self.root),
                '--bin-dir', str(self.root), '--output', str(self.root / 'output')]
        with patch.object(sys, 'argv', argv), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                native_v2_rehearsal.main()
        self.assertEqual(error.exception.code, 2)
        self.assertFalse((self.root / 'output').exists())

    def test_blocked_deleted_row_produces_nonzero_gate_and_keeps_source(self):
        source = self.root / 'source'
        source.mkdir()
        value = json.dumps({'decks': [], 'cards': [{'id': 1, 'front_text': '', 'back_text': '', 'is_deleted': True, 'deck_id': 1}]})
        for scope in ('tma', 'library'):
            (source / (scope + '-snapshot.json')).write_text(value)
        with patch.object(sys, 'argv', ['dry-run', '--snapshot-dir', str(source), '--output', str(self.root / 'output')]), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(native_v2_dry_run.main(), 2)
        self.assertEqual((source / 'tma-snapshot.json').read_text(), value)
        report = json.loads((self.root / 'output/tma-deleted.json').read_text(encoding='utf-8'))
        self.assertFalse(report['ok'])
        self.assertEqual(report['blocked_count'], 1)

    def test_local_migrator_rejects_cloud_role_and_working_local_database_before_transaction(self):
        from tools.migrate_native_v2_local import migrate_active
        for identity in (('postgres', 'postgres', '10.0.0.1/32', 5432, str(self.root)),
                         ('lerne_tma_local', 'cards_test', '127.0.0.1/32', 55432, str(self.root))):
            with self.subTest(database=identity[0]):
                db = Mock()
                db.in_transaction.return_value = False
                db.execute_sql.return_value.fetchone.return_value = identity
                with self.assertRaisesRegex(RuntimeError, 'disposable runner cluster'):
                    migrate_active(db)
                db.atomic.assert_not_called()

    def test_maintenance_imports_never_load_models_dotenv_or_connect(self):
        program = '''
import sys
from unittest.mock import patch
with patch('dotenv.load_dotenv', side_effect=AssertionError('dotenv')), \\
     patch('psycopg2.connect', side_effect=AssertionError('connect')), \\
     patch('peewee.PostgresqlDatabase.connect', side_effect=AssertionError('connect')):
    import tools.native_v2_cutover
    import tools.migrate_native_v2_local
    import tools.backup_supabase_storage
    assert 'api.models' not in sys.modules
'''
        subprocess.run([sys.executable, '-c', program], cwd=ROOT, check=True,
                       capture_output=True, timeout=30)

    def test_nonlocal_server_schema_init_does_not_apply_92_through_97(self):
        from api import models, migrations
        with contextlib.ExitStack() as stack:
            database = Mock()
            stack.enter_context(patch.object(models, 'tma_db', database))
            stack.enter_context(patch.object(models, '_tables_created', False))
            stack.enter_context(patch.object(models, 'is_local', return_value=False))
            stack.enter_context(patch.object(migrations, 'run_migrations'))
            stack.enter_context(patch.object(migrations, 'run_knowledge_mastery_migration'))
            runners = [stack.enter_context(patch.object(migrations, name)) for name in (
                'run_card_rating_migration', 'run_structured_cards_v2_migration',
                'run_library_cards_v2_migration', 'run_card_source_migration',
                'run_unified_cards_migration', 'run_library_cleanup_migration')]
            models.create_all_tables()
            for runner in runners:
                runner.assert_not_called()

    def test_cutover_remote_without_tls_never_connects(self):
        from tools import native_v2_cutover as cli
        argv = ['--expected-host', 'selected.example', '--expected-port', '5432',
                '--expected-database', 'synthetic', '--expected-role', 'operator',
                '--expected-dsn-user', 'operator.projref',
                '--output', str(self.root / 'no-tls.json')]
        with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': 'postgresql://operator.projref:secret@selected.example/synthetic'}, clear=True), \
                patch.object(cli, 'connect') as connect, contextlib.redirect_stderr(io.StringIO()), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(argv), 1)
        connect.assert_not_called()
        report = (self.root / 'no-tls.json').read_text(encoding='utf-8')
        self.assertIn('TLS', report)
        self.assertNotIn('secret', report)

    def test_cutover_pooler_dsn_user_and_role_guards(self):
        from tools import native_v2_cutover as cli
        base_argv = [
            '--expected-host', 'pooler.example', '--expected-port', '5432',
            '--expected-database', 'postgres', '--expected-role', 'postgres',
            '--expected-dsn-user', 'postgres.wdopyuulhiykrextyvnt',
        ]
        valid_dsn = 'postgresql://postgres.wdopyuulhiykrextyvnt:secret@pooler.example:5432/postgres?sslmode=require'

        class FakeCursor:
            def __init__(self, row):
                self._row = row

            def fetchone(self):
                return self._row

            def __iter__(self):
                return iter([])

        class FakeDb:
            def __init__(self, role='postgres'):
                self.role = role
                self.sql_log = []

            def connect(self):
                pass

            def execute_sql(self, sql, *args):
                self.sql_log.append(sql)
                if 'current_database(),current_user' in sql:
                    return FakeCursor(('postgres', self.role))
                if 'pg_try_advisory_lock' in sql:
                    return FakeCursor((True,))
                return FakeCursor((1,))

            def atomic(self):
                return contextlib.nullcontext()

            def is_closed(self):
                return False

            def close(self):
                pass

            def get_binary_type(self):
                return bytes

            def get_tables(self):
                return []

            def get_columns(self, table):
                return []

        # 1. Valid pooler DSN user + DB role -> inspect PASS, and apply accepts matching target
        with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': valid_dsn}, clear=True), \
                patch.object(cli, 'connect', return_value=FakeDb('postgres')), \
                patch.object(cli, 'observe', return_value={'history': [], 'cards_total_active_native': {'tma_card': [1, 1, 0], 'card': [1, 1, 0]}}), \
                contextlib.redirect_stdout(io.StringIO()):
            inspect_out = self.root / 'pooler-inspect.json'
            self.assertEqual(cli.main(base_argv + ['--output', str(inspect_out)]), 0)
            saved = json.loads(inspect_out.read_text(encoding='utf-8'))
            self.assertEqual(saved['target'], ['pooler.example', 5432, 'postgres', 'postgres', 'postgres.wdopyuulhiykrextyvnt'])
            import hashlib
            sha = hashlib.sha256(inspect_out.read_bytes()).hexdigest()
            with patch.object(cli, 'apply', return_value=[]) as apply_mock:
                apply_out = self.root / 'pooler-apply.json'
                rc = cli.main(base_argv + [
                    '--output', str(apply_out), '--apply', '--writers-stopped',
                    '--source-inspect', str(inspect_out), '--confirm-source-sha256', sha,
                ])
                self.assertEqual(rc, 0, apply_out.read_text(encoding='utf-8'))
                apply_mock.assert_called_once()

        # 2. Wrong project ref in DSN username -> FAIL before connect
        wrong_ref_dsn = 'postgresql://postgres.wrongref:secret@pooler.example:5432/postgres?sslmode=require'
        with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': wrong_ref_dsn}, clear=True), \
                patch.object(cli, 'connect') as connect, contextlib.redirect_stderr(io.StringIO()), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(base_argv + ['--output', str(self.root / 'wrong-ref.json')]), 1)
            connect.assert_not_called()

        # 3. Wrong PostgreSQL role -> FAIL after connect
        with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': valid_dsn}, clear=True), \
                patch.object(cli, 'connect', return_value=FakeDb('wrong_role')), \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(base_argv + ['--output', str(self.root / 'wrong-role.json')]), 1)

        # 4. Wrong host / database / port -> FAIL before connect
        for idx, bad_dsn in enumerate([
            'postgresql://postgres.wdopyuulhiykrextyvnt:secret@other.example:5432/postgres?sslmode=require',
            'postgresql://postgres.wdopyuulhiykrextyvnt:secret@pooler.example:5432/otherdb?sslmode=require',
            'postgresql://postgres.wdopyuulhiykrextyvnt:secret@pooler.example:6543/postgres?sslmode=require',
        ]):
            with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': bad_dsn}, clear=True), \
                    patch.object(cli, 'connect') as connect, contextlib.redirect_stderr(io.StringIO()), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(base_argv + ['--output', str(self.root / f'bad-target-{idx}.json')]), 1)
                connect.assert_not_called()

        # 5. LOCAL/disposable guards preserved (lerne_tma_local / port 55432) -> FAIL before connect
        for idx, (local_argv, local_dsn) in enumerate([
            (['--expected-host', '127.0.0.1', '--expected-port', '55432', '--expected-database', 'postgres', '--expected-role', 'postgres'],
             'postgresql://postgres:secret@127.0.0.1:55432/postgres'),
            (['--expected-host', '127.0.0.1', '--expected-port', '5432', '--expected-database', 'lerne_tma_local', '--expected-role', 'postgres'],
             'postgresql://postgres:secret@127.0.0.1:5432/lerne_tma_local'),
        ]):
            with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': local_dsn}, clear=True), \
                    patch.object(cli, 'connect') as connect, contextlib.redirect_stderr(io.StringIO()), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(local_argv + ['--output', str(self.root / f'local-guard-{idx}.json')]), 1)
                connect.assert_not_called()

        # 6. observe() sets extra_float_digits = 3 for fingerprint parity with snapshot
        obs_db = FakeDb('postgres')
        with patch('tools.native_v2_rehearsal.fingerprints', return_value={}):
            cli.observe(obs_db)
        self.assertIn('SET extra_float_digits = 3', obs_db.sql_log)


if __name__ == '__main__':
    unittest.main()
