"""Synthetic recovery-boundary tests; no configured DB or external services."""
import unittest
from unittest.mock import patch
from peewee import SqliteDatabase
from fastapi import HTTPException
from api import models
from api.services import sync_generation as recovery


class CompatSqliteDatabase(SqliteDatabase):
    """SQLite test database translating %s to ? for direct SQL compatibility."""
    def execute_sql(self, sql, params=None):
        if params and '%s' in sql:
            sql = sql.replace('%s', '?')
        return super().execute_sql(sql, params)


class SyncGenerationTests(unittest.TestCase):
    def setUp(self):
        self.db = CompatSqliteDatabase(':memory:')
        previous = models.tma_db.obj
        models.tma_db.initialize(self.db)
        self.addCleanup(models.tma_db.initialize, previous)
        self.addCleanup(self.db.close)
        self.db.create_tables([models.TMASetting])

    def test_unrestored_generation_is_stable_and_read_only(self):
        before = self.db.total_changes if hasattr(self.db, 'total_changes') else models.TMASetting.select().count()
        state = recovery.generation_state()
        self.assertFalse(state['restored'])
        self.assertEqual(state, recovery.generation_state())
        recovery.require_generation(None)
        recovery.require_generation(state['server_generation'])
        self.assertEqual(models.TMASetting.select().count(), before)

    def test_restore_blocks_old_and_unversioned_clients_without_mutating_receipts(self):
        old = recovery.generation_state()['server_generation']
        models.TMASetting.create(key=recovery.RESTORE_KEY, value='synthetic-restored-generation')
        new = recovery.generation_state()
        for value in (None, old):
            with self.subTest(value=value), self.assertRaises(HTTPException) as error:
                recovery.require_generation(value)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(error.exception.detail['code'], 'database_generation_conflict')
        recovery.require_generation(new['server_generation'])
        self.assertEqual(models.TMASetting.select().count(), 1)

    def test_mark_database_restored_populates_updated_at_and_marks_restored(self):
        initial_state = recovery.generation_state()
        self.assertFalse(initial_state['restored'])

        marker = recovery.mark_database_restored(self.db)
        state = recovery.generation_state()
        self.assertTrue(state['restored'])
        self.assertNotEqual(initial_state['server_generation'], state['server_generation'])

        row = models.TMASetting.get(models.TMASetting.key == recovery.RESTORE_KEY)
        self.assertEqual(row.value, marker)
        self.assertIsNotNone(row.updated_at)

    def test_repeated_restore_updates_marker_generation_and_updated_at(self):
        marker1 = recovery.mark_database_restored(self.db)
        state1 = recovery.generation_state()
        row1 = models.TMASetting.get(models.TMASetting.key == recovery.RESTORE_KEY)

        marker2 = recovery.mark_database_restored(self.db)
        state2 = recovery.generation_state()
        row2 = models.TMASetting.get(models.TMASetting.key == recovery.RESTORE_KEY)

        self.assertNotEqual(marker1, marker2)
        self.assertEqual(row2.value, marker2)
        self.assertNotEqual(state1['server_generation'], state2['server_generation'])
        self.assertEqual(models.TMASetting.select().count(), 1)
        self.assertIsNotNone(row2.updated_at)

    def test_require_generation_blocks_stale_and_unversioned_after_mark_database_restored(self):
        initial = recovery.generation_state()['server_generation']
        recovery.mark_database_restored(self.db)
        current = recovery.generation_state()['server_generation']

        for stale in (None, initial):
            with self.subTest(value=stale), self.assertRaises(HTTPException) as error:
                recovery.require_generation(stale)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(error.exception.detail['code'], 'database_generation_conflict')

        recovery.require_generation(current)

    def test_mark_database_restored_preserves_unrelated_settings(self):
        models.TMASetting.create(key='UNRELATED_SETTING', value='preserved_payload')
        recovery.mark_database_restored(self.db)
        unrelated = models.TMASetting.get(models.TMASetting.key == 'UNRELATED_SETTING')
        self.assertEqual(unrelated.value, 'preserved_payload')
        self.assertEqual(models.TMASetting.select().count(), 2)

    def test_caller_owned_transaction_and_connection_stay_open(self):
        with self.db.atomic():
            recovery.generation_state()
            self.assertFalse(self.db.is_closed())
            self.assertTrue(self.db.in_transaction())
