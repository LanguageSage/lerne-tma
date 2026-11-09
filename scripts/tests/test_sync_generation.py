"""Synthetic recovery-boundary tests; no configured DB or external services."""
import unittest
from unittest.mock import patch
from peewee import SqliteDatabase
from fastapi import HTTPException
from api import models
from api.services import sync_generation as recovery


class SyncGenerationTests(unittest.TestCase):
    def setUp(self):
        self.db = SqliteDatabase(':memory:')
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

    def test_caller_owned_transaction_and_connection_stay_open(self):
        with self.db.atomic():
            recovery.generation_state()
            self.assertFalse(self.db.is_closed())
            self.assertTrue(self.db.in_transaction())
