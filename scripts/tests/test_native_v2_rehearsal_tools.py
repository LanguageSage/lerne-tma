"""Generated synthetic inputs only; no configured DB, network or private snapshot."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch
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


if __name__ == '__main__':
    unittest.main()
