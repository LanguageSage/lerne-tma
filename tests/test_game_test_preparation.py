"""Isolated deployment safety checks, loaded through scripts/test_game_mvp3.py."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from api import database, models
from api.dependencies.auth import get_user_id
from scripts.prepare_game_test import PROJECT_ID, bootstrap_sql, verify_target


class TargetTests(unittest.TestCase):
    def test_exact_project_required_before_schema_generation(self):
        for ref in ('wdopyuulhiykrextyvnt', '', 'a' * 20):
            with self.assertRaises(ValueError):
                bootstrap_sql(ref)

    def test_direct_and_pooler_targets_and_encoded_password(self):
        verify_target(PROJECT_ID, f'postgresql://postgres:p%40ss@db.{PROJECT_ID}.supabase.co/postgres')
        verify_target(PROJECT_ID, f'postgresql://postgres.{PROJECT_ID}:test@aws-1-eu-north-1.pooler.supabase.com:6543/postgres')
        parsed = database._parse_db_url(f'postgresql://postgres:p%40ss@db.{PROJECT_ID}.supabase.co/postgres')
        self.assertEqual(parsed['password'], 'p@ss')
        for url in ('postgresql://postgres:test@db.wdopyuulhiykrextyvnt.supabase.co/postgres',
                    f'postgresql://postgres.{PROJECT_ID}:test@evil.invalid/postgres',
                    f'postgresql://postgres:test@db.{PROJECT_ID}.supabase.co/other'):
            with self.assertRaises(ValueError):
                verify_target(PROJECT_ID, url)

    def test_runtime_refuses_production_before_driver_initialization(self):
        # The isolated suite patches the shared initializer; load a fresh module
        # to exercise the real guard without touching the application's proxies.
        spec = importlib.util.spec_from_file_location('isolated_database', database.__file__)
        isolated = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(isolated)
        with patch.dict(os.environ, {'LERNE_DEPLOYMENT': 'game-test', 'RUN_MIGRATIONS': 'false',
                'SUPABASE_DB_URL': 'postgresql://postgres:test@db.wdopyuulhiykrextyvnt.supabase.co/postgres',
                'SUPABASE_URL': f'https://{PROJECT_ID}.supabase.co'}), patch.object(
                isolated, 'PooledPostgresqlDatabase') as driver:
            with self.assertRaises(RuntimeError):
                isolated.initialize_database()
            driver.assert_not_called()

    def test_disabled_startup_does_not_execute_any_schema_queries(self):
        with patch.dict(os.environ, {'RUN_MIGRATIONS': 'false', 'VERCEL': '1'}), patch.object(
                models, 'tma_db') as db:
            models.create_all_tables()
            self.assertEqual(db.mock_calls, [])

    def test_valid_game_test_target_requires_tls(self):
        spec = importlib.util.spec_from_file_location('isolated_tls_database', database.__file__)
        isolated = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(isolated)
        with patch.dict(os.environ, {'LERNE_DEPLOYMENT': 'game-test', 'RUN_MIGRATIONS': 'false',
                'SUPABASE_DB_URL': f'postgresql://postgres:test@db.{PROJECT_ID}.supabase.co/postgres',
                'SUPABASE_URL': f'https://{PROJECT_ID}.supabase.co'}), patch.object(
                isolated, 'PooledPostgresqlDatabase') as driver:
            self.assertTrue(isolated.initialize_database())
            self.assertEqual(driver.call_args.kwargs['sslmode'], 'require')

    def test_game_test_does_not_authenticate_a_user_id_header(self):
        with patch.dict(os.environ, {'LERNE_DEPLOYMENT': 'game-test'}), patch(
                'api.dependencies.auth.get_authenticated_user_id', side_effect=HTTPException(401)) as strict:
            with self.assertRaises(HTTPException):
                get_user_id(None, '642478257')
            strict.assert_called_once_with(None)

    def test_bootstrap_is_secret_free_and_checks_empty_schema(self):
        sql = bootstrap_sql(PROJECT_ID)
        self.assertIn('public schema is not empty', sql)
        self.assertIn('ENABLE ROW LEVEL SECURITY', sql)
        self.assertIn('FROM PUBLIC, anon, authenticated', sql)
        self.assertNotIn('DISABLE ROW LEVEL SECURITY', sql)
        self.assertNotIn('postgresql://', sql)
        self.assertIn('CREATE INDEX IF NOT EXISTS', sql)


class PublicErrorTests(unittest.TestCase):
    def test_startup_error_does_not_expose_secrets(self):
        spec = importlib.util.spec_from_file_location('isolated_startup_index', Path(models.__file__).with_name('index.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'api.main': None}), patch('logging.Logger.error'):
            spec.loader.exec_module(module)
            result = TestClient(module.app).get('/api/health')
            self.assertEqual(result.status_code, 500)
            self.assertEqual(result.json(), {'status': 'startup_error', 'error': 'service_unavailable'})

    def test_runtime_and_http_errors_do_not_expose_secrets(self):
        fake_main = types.ModuleType('api.main')
        fake_main.app = FastAPI()

        @fake_main.app.get('/unexpected')
        def unexpected():
            raise RuntimeError('secret-dsn-password')

        @fake_main.app.get('/expected')
        def expected():
            raise HTTPException(503, 'secret-provider-key')

        spec = importlib.util.spec_from_file_location('isolated_game_index', Path(models.__file__).with_name('index.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'api.main': fake_main}), patch('logging.Logger.exception'), patch('logging.Logger.error'):
            spec.loader.exec_module(module)
            client = TestClient(module.app, raise_server_exceptions=False)
            for route, status in (('/unexpected', 500), ('/expected', 503)):
                result = client.get(route)
                self.assertEqual(result.status_code, status)
                self.assertNotIn('secret', result.text)
                self.assertNotIn('traceback', result.text)


if __name__ == '__main__':
    unittest.main()
