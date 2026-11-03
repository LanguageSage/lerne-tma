"""Fresh proxy bindings and concurrent startup; no configured DB is contacted."""
import concurrent.futures
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from peewee import SqliteDatabase


class InitializationTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('isolated_database', Path(__file__).resolve().parents[2] / 'api/database.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_bound_database_is_never_replaced_on_reinitialization(self):
        db = SqliteDatabase(':memory:')
        self.module.tma_db.initialize(db)
        self.module.lerne_db.initialize(db)
        with patch.dict(os.environ, SUPABASE_DB_URL='postgresql://fixture@fixture.invalid/synthetic'), patch.object(self.module, 'PooledPostgresqlDatabase', return_value=SqliteDatabase(':memory:')):
            self.assertTrue(self.module.initialize_database())
        self.assertIs(self.module.tma_db.obj, db)

    def test_concurrent_initialization_constructs_one_pool(self):
        db = SqliteDatabase(':memory:')
        with patch.dict(os.environ, SUPABASE_DB_URL='postgresql://fixture@fixture.invalid/synthetic'), patch.object(self.module, 'PooledPostgresqlDatabase', return_value=db) as create:
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
                self.assertTrue(all(workers.map(lambda _: self.module.initialize_database(), range(20))))
            self.assertEqual(create.call_count, 1)

    def test_inconsistent_proxies_fail_without_rebinding(self):
        first, second = SqliteDatabase(':memory:'), SqliteDatabase(':memory:')
        self.module.tma_db.initialize(first)
        self.module.lerne_db.initialize(second)
        with self.assertRaisesRegex(RuntimeError, 'inconsistent'):
            self.module.initialize_database()
        self.assertIs(self.module.tma_db.obj, first)
        self.assertIs(self.module.lerne_db.obj, second)

    def test_failed_startup_can_be_retried(self):
        with patch.object(self.module, '_initialize_database', side_effect=[False, True]) as create:
            self.assertFalse(self.module.initialize_database())
            self.assertTrue(self.module.initialize_database())
            self.assertEqual(create.call_count, 2)
