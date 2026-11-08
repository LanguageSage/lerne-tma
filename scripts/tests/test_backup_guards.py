"""Regressions for legacy backup/restore guards.
Ensure tools/backup_database.py and tools/restore_database.py fail closed outside LOCAL,
refuse execution against cloud/production, and require explicit override.
"""
import os
import unittest
from unittest.mock import patch

from tools import backup_database
from tools import restore_database


class BackupGuardsTests(unittest.TestCase):
    def test_backup_database_fails_closed_outside_local(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                backup_database.check_environment_and_target()
            self.assertIn("ОТКАЗ БЕЗОПАСНОСТИ", str(ctx.exception))
            self.assertIn("LERNE_MODE=LOCAL", str(ctx.exception))
            self.assertIn("scripts/local_dev.py backup", str(ctx.exception))

    def test_backup_database_rejects_production_env(self):
        with patch.dict(os.environ, {"LERNE_MODE": "LOCAL", "ENVIRONMENT": "production"}):
            with self.assertRaises(RuntimeError) as ctx:
                backup_database.check_environment_and_target()
            self.assertIn("LOCAL cannot run on Vercel or in Production", str(ctx.exception))

    def test_restore_database_fails_closed_outside_local(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                restore_database.check_environment_and_target(force=False)
            self.assertIn("ОТКАЗ БЕЗОПАСНОСТИ", str(ctx.exception))
            self.assertIn("LERNE_MODE=LOCAL", str(ctx.exception))

    def test_restore_database_fails_closed_by_default_in_local_without_force(self):
        with patch.dict(os.environ, {"LERNE_MODE": "LOCAL"}), \
             patch("api.local_runtime.is_local", return_value=True):
            with self.assertRaises(RuntimeError) as ctx:
                restore_database.check_environment_and_target(force=False)
            self.assertIn("заблокирован по умолчанию", str(ctx.exception))
            self.assertIn("--force-unsafe-legacy-restore", str(ctx.exception))
            self.assertIn("scripts/local_dev.py restore", str(ctx.exception))

    def test_restore_database_permits_execution_with_force_in_local(self):
        fake_config = {
            "database_url": "postgresql://lerne_local:pass@127.0.0.1:55432/lerne_tma_local"
        }
        with patch.dict(os.environ, {"LERNE_MODE": "LOCAL"}), \
             patch("api.local_runtime.is_local", return_value=True), \
             patch("local.runtime.local_config", return_value=fake_config):
            # Should not raise
            restore_database.check_environment_and_target(force=True)

    def test_backup_database_passes_in_local_with_valid_config(self):
        fake_config = {
            "database_url": "postgresql://lerne_local:pass@127.0.0.1:55432/lerne_tma_local"
        }
        with patch.dict(os.environ, {"LERNE_MODE": "LOCAL"}), \
             patch("api.local_runtime.is_local", return_value=True), \
             patch("local.runtime.local_config", return_value=fake_config):
            # Should not raise
            backup_database.check_environment_and_target()
