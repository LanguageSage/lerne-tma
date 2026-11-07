"""Automated tests for Stage 7.3 safe LOCAL database V1 -> V2 reader and dry-run."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.update(VERCEL='1', RUN_MIGRATIONS='false', FORCE_LOCAL_DB='false')

from api.services.db_v1_reader import (
    categorize_migration_fixes,
    check_local_db_availability,
    fetch_v1_snapshot_from_db,
    format_db_dry_run_summary,
    main as db_reader_main,
    run_local_db_migration_dry_run,
)


class LocalDbV1ReaderTests(unittest.TestCase):
    def test_check_local_db_availability(self):
        status = check_local_db_availability()
        self.assertIn('available', status)
        self.assertIn('counts', status)
        if status['available']:
            self.assertIn('tma_card', status['tables'])
            self.assertIn('card', status['tables'])
            self.assertGreater(status['counts']['tma_cards'], 0)
            self.assertGreater(status['counts']['library_cards'], 0)

    def test_check_local_db_handles_failure_gracefully(self):
        from api import models
        with patch.object(models.tma_db.obj, 'connection_context', side_effect=Exception('DB offline')):
            status = check_local_db_availability()
            self.assertFalse(status['available'])
            self.assertIn('DB offline', status['error'])

    def test_fetch_v1_snapshot_from_db_tma_and_library_scopes(self):
        status = check_local_db_availability()
        if not status['available']:
            self.skipTest('LOCAL database not reachable')

        # Test TMA scope with limit
        tma_snap = fetch_v1_snapshot_from_db(scope='tma', limit_cards=10)
        self.assertEqual(tma_snap['scope'], 'tma')
        self.assertLessEqual(len(tma_snap['cards']), 10)
        self.assertGreater(len(tma_snap['decks']), 0)
        card0 = tma_snap['cards'][0]
        self.assertEqual(card0['scope'], 'tma')
        self.assertIn('front_text', card0)
        self.assertIn('back_text', card0)
        self.assertIn('image_path', card0)
        self.assertIn('audio_path', card0)
        self.assertIn('position', card0)

        # Test Library scope with limit
        lib_snap = fetch_v1_snapshot_from_db(scope='library', limit_cards=10)
        self.assertEqual(lib_snap['scope'], 'library')
        self.assertLessEqual(len(lib_snap['cards']), 10)
        self.assertGreater(len(lib_snap['decks']), 0)
        lib_card0 = lib_snap['cards'][0]
        self.assertEqual(lib_card0['scope'], 'library')
        self.assertIn('front_text', lib_card0)
        self.assertIn('back_text', lib_card0)

    def test_fetch_invalid_scope_raises(self):
        with self.assertRaises(ValueError):
            fetch_v1_snapshot_from_db(scope='invalid_scope')

    def test_run_local_db_migration_dry_run_handles_db_offline(self):
        with patch('api.services.db_v1_reader.check_local_db_availability', return_value={'available': False, 'error': 'Connection refused'}):
            res = run_local_db_migration_dry_run(scope='all')
            self.assertFalse(res['ok'])
            self.assertFalse(res['db_available'])
            self.assertIn('not reachable', res['message'])
            summary = format_db_dry_run_summary(res)
            self.assertIn('NOT AVAILABLE', summary)

    def test_categorize_migration_fixes_structure(self):
        mock_report = {
            'reasons': {
                'empty_back': {'count': 5, 'card_ids': [10, 11], 'deck_ids': [1], 'sample_message': 'standard card requires non-empty back'},
                'card_type_mismatch': {'count': 2, 'card_ids': [20], 'deck_ids': [1], 'sample_message': 'conflict'},
            },
            'warnings_by_code': {
                'implicit_free_text_policy': {'count': 3, 'card_ids': [30, 31, 32]},
                'legacy_translation_card_type_normalized': {'count': 10, 'card_ids': [40]},
                'shared_card_position': {'count': 8, 'card_ids': [50]},
            },
        }
        fixes = categorize_migration_fixes(mock_report)
        self.assertEqual(len(fixes['automatic']), 3)
        auto_codes = [f['code'] for f in fixes['automatic']]
        self.assertIn('implicit_free_text_policy', auto_codes)
        self.assertIn('legacy_translation_card_type_normalized', auto_codes)
        self.assertIn('shared_card_position', auto_codes)

        self.assertEqual(len(fixes['manual']), 2)
        manual_codes = [f['code'] for f in fixes['manual']]
        self.assertIn('empty_back', manual_codes)
        self.assertIn('card_type_mismatch', manual_codes)
        empty_fix = next(f for f in fixes['manual'] if f['code'] == 'empty_back')
        self.assertIn('обратной стороны', empty_fix['recommendation'])

    def test_run_local_db_migration_dry_run_live(self):
        status = check_local_db_availability()
        if not status['available']:
            self.skipTest('LOCAL database not reachable')

        # Run on a small slice or full tma/library scopes
        res = run_local_db_migration_dry_run(scope='all', allow_shared_positions=True)
        self.assertTrue(res['db_available'])
        self.assertIn('tma', res['scopes'])
        self.assertIn('library', res['scopes'])
        self.assertIn('combined', res)
        self.assertIn('fixes', res)

        combined = res['combined']
        self.assertGreater(combined['total_cards'], 40000)
        self.assertGreater(combined['converted_count'], 35000)
        # Verify invariants
        self.assertTrue(combined['invariants']['source_unmodified'])
        self.assertTrue(combined['invariants']['id_uniqueness_ok'])
        self.assertTrue(combined['invariants']['order_preserved'])
        self.assertTrue(combined['invariants']['metadata_preserved'])
        self.assertTrue(combined['invariants']['media_links_preserved'])
        self.assertTrue(combined['invariants']['v2_valid'])

        summary_text = format_db_dry_run_summary(res)
        self.assertIn('LOCAL Database V1 -> V2 Migration Readiness', summary_text)
        self.assertIn('[TMA]', summary_text)
        self.assertIn('[LIBRARY]', summary_text)
        self.assertIn('Safe Automatic Fixes', summary_text)
        self.assertIn('Blocked Issues Requiring Manual Decision/Fix', summary_text)

    def test_db_reader_cli_summary(self):
        status = check_local_db_availability()
        if not status['available']:
            self.skipTest('LOCAL database not reachable')

        out = io.StringIO()
        with patch('sys.stdout', out):
            # CLI returns 1 when there are blocked cards in the database
            rc = db_reader_main(['--scope', 'library', '--summary'])
        output = out.getvalue()
        self.assertIn('LOCAL Database V1 -> V2 Migration Readiness', output)
        self.assertIn('[LIBRARY]', output)


if __name__ == '__main__':
    unittest.main()
