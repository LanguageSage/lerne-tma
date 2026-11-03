"""Behavioral and security tests for the FastAPI load testing framework.

Covers:
- Production URL rejection and blacklist guards
- Misconfiguration and remote isolation checks
- Database safety and current_database() validation
- Confirmed synthetic markers and cleanup refusal for non-synthetic data
- Valid LOCAL development and isolated test execution
- Secret and token redaction in reports and URLs
- Percentiles and metrics aggregation
"""
from __future__ import annotations

import json
import os
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from scripts.load_testing.config import BASE_USER_ID, USERS_CACHE_FILE, LOCAL_TEST_DATA
from scripts.load_testing.metrics import (
    RequestSample,
    StageMetrics,
    calculate_percentiles,
)
from scripts.load_testing.scenarios import (
    MixedScenario,
    ReadCardsScenario,
    StudyScenario,
    SyncScenario,
    create_scenario,
)
from scripts.load_testing.compare import format_comparison_markdown
from scripts.load_testing.safety import (
    SecurityError,
    is_production_environment,
    is_safe_sqlite_path,
    validate_pre_connection_safety,
    sanitize_text,
    sanitize_url,
    validate_database_safety,
    validate_target_url,
    verify_remote_isolation,
)
from scripts.load_testing.seeder import (
    _assert_environment_safety,
    cleanup_synthetic_data,
    get_synthetic_status,
    seed_synthetic_data,
)


class TestSecurityValidation(unittest.TestCase):
    """Tests for requirement 8: production URL, misconfiguration, incorrect DB, and redaction."""

    def setUp(self):
        self.env_patcher = patch.dict(os.environ, {
            "SUPABASE_DB_URL": "",
            "ENVIRONMENT": "development",
            "LERNE_MODE": "LOCAL",
            "VERCEL": "",
            "VERCEL_ENV": "",
            "NODE_ENV": "",
        })
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_production_urls_strictly_forbidden(self):
        forbidden_urls = [
            "https://lerne.app",
            "https://api.lerne.app",
            "https://lerne-tma.vercel.app",
            "https://my-app.vercel.app/api",
            "https://xyz.supabase.co",
            "https://production-server.example.com",
            "http://prod-api.internal:8000",
        ]
        for url in forbidden_urls:
            with self.subTest(url=url):
                with self.assertRaises(SecurityError):
                    validate_target_url(url)

    def test_production_environment_flag_blocks_all_urls(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}):
            with self.assertRaises(SecurityError):
                validate_target_url("http://127.0.0.1:8000")

        with patch.dict(os.environ, {"VERCEL_ENV": "production"}):
            with self.assertRaises(SecurityError):
                validate_target_url("http://127.0.0.1:8000")

        with patch.dict(os.environ, {"NODE_ENV": "production"}):
            with self.assertRaises(SecurityError):
                validate_target_url("http://127.0.0.1:8000")

    def test_misconfiguration_handling(self):
        # 1. Invalid schemes
        with self.assertRaises(SecurityError):
            validate_target_url("ftp://127.0.0.1:8000")
        with self.assertRaises(SecurityError):
            validate_target_url("file:///etc/passwd")

        # 2. Empty or invalid URLs
        with self.assertRaises(SecurityError):
            validate_target_url("")
        with self.assertRaises(SecurityError):
            validate_target_url("not_a_valid_url")

        # 3. Remote host without allowed list
        with self.assertRaises(SecurityError):
            validate_target_url("http://192.168.1.100:8000")

        # 4. Remote host in allowed list but WITHOUT confirmation of isolation
        with self.assertRaises(SecurityError):
            validate_target_url(
                "http://staging.internal:8000",
                allowed_remote_hosts=["staging.internal"],
                confirm_isolated_remote=False,
            )

    def test_correct_local_urls_permitted(self):
        self.assertEqual(validate_target_url("http://127.0.0.1:8000"), "http://127.0.0.1:8000")
        self.assertEqual(validate_target_url("http://localhost:8000/"), "http://localhost:8000")
        self.assertEqual(validate_target_url("http://[::1]:8000"), "http://[::1]:8000")

    def test_isolated_test_and_whitelisted_remote_permitted(self):
        # In-process testserver
        self.assertEqual(validate_target_url("any_url", in_process=True), "http://testserver")

        # Whitelisted remote host WITH affirmative isolation confirmation
        url = validate_target_url(
            "http://staging-vm.internal:8080/api",
            allowed_remote_hosts=["staging-vm.internal"],
            confirm_isolated_remote=True,
        )
        self.assertEqual(url, "http://staging-vm.internal:8080/api")

    def test_incorrect_database_rejected(self):
        # 1. Mock postgres DB returning non-test database name
        mock_db = MagicMock()
        mock_db._driver_name = "PostgresqlDatabase"
        mock_db.connect_params = {"host": "127.0.0.1"}
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ["production_db"]
        mock_db.execute_sql.return_value = mock_cursor
        mock_db.connection_context.return_value.__enter__.return_value = None

        with self.assertRaises(SecurityError) as ctx:
            validate_database_safety(mock_db)
        self.assertIn("NOT an approved test database", str(ctx.exception))

        # 2. Mock postgres DB connected to non-whitelisted remote host
        mock_db.connect_params = {"host": "remote-cluster.cloud.com"}
        mock_cursor.fetchone.return_value = ["lerne_tma_local"]
        with self.assertRaises(SecurityError) as ctx:
            validate_database_safety(mock_db)
        self.assertIn("neither loopback nor an allowed test host", str(ctx.exception))

        # 3. Supabase URL pointing to cloud supabase
        with patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://user:pass@db.xyz.supabase.co:5432/postgres"}):
            with self.assertRaises(SecurityError):
                validate_database_safety(mock_db)

        # 4. SQLite DB in unsafe path (not in test directory)
        mock_sqlite = MagicMock()
        mock_sqlite._driver_name = "SqliteDatabase"
        mock_sqlite.database = "C:/Windows/System32/database.db"
        with self.assertRaises(SecurityError):
            validate_database_safety(mock_sqlite)

    def test_correct_local_and_isolated_databases_accepted(self):
        # 1. SQLite in-memory
        mock_sqlite_mem = MagicMock()
        mock_sqlite_mem._driver_name = "SqliteDatabase"
        mock_sqlite_mem.database = ":memory:"
        res_mem = validate_database_safety(mock_sqlite_mem)
        self.assertEqual(res_mem["driver"], "sqlite")

        # 2. SQLite in test-data
        mock_sqlite_file = MagicMock()
        mock_sqlite_file._driver_name = "SqliteDatabase"
        mock_sqlite_file.database = str(LOCAL_TEST_DATA / "scratch.sqlite3")
        res_file = validate_database_safety(mock_sqlite_file)
        self.assertEqual(res_file["driver"], "sqlite")

        # 3. Postgres on loopback with lerne_tma_local
        mock_pg = MagicMock()
        mock_pg._driver_name = "PostgresqlDatabase"
        mock_pg.connect_params = {"host": "127.0.0.1"}
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = ["lerne_tma_local"]
        mock_pg.execute_sql.return_value = mock_cursor
        mock_pg.connection_context.return_value.__enter__.return_value = None

        res_pg = validate_database_safety(mock_pg)
        self.assertEqual(res_pg["driver"], "postgresql")
        self.assertEqual(res_pg["database"], "lerne_tma_local")

    def test_sqlite_canonical_validation_rejects_traversal_and_deceptions(self):
        # 1. Relative traversal with ..
        traversal_paths = [
            "local/test-data/../outside.sqlite3",
            "local/test-data/../../etc/passwd",
            "local/test-data/subdir/../../outside.db",
            f"{LOCAL_TEST_DATA}/../escape.db",
        ]
        for bad_path in traversal_paths:
            with self.subTest(path=bad_path):
                mock_sqlite = MagicMock(_driver_name="SqliteDatabase", database=bad_path)
                with self.assertRaises(SecurityError):
                    validate_database_safety(mock_sqlite)

        # 2. Deceptive substring spoofing (contains "local" or "test" but outside allowed dirs)
        deceptive_paths = [
            "C:/fake_local_dir/db.sqlite",
            "C:/test_folder/database.db",
            "local/test-data-evil/test.db",
            "C:/Windows/temp/local/test.db",
        ]
        for bad_path in deceptive_paths:
            with self.subTest(path=bad_path):
                mock_sqlite = MagicMock(_driver_name="SqliteDatabase", database=bad_path)
                with self.assertRaises(SecurityError):
                    validate_database_safety(mock_sqlite)

        # 3. Directory itself rather than file
        mock_dir = MagicMock(_driver_name="SqliteDatabase", database=str(LOCAL_TEST_DATA))
        with self.assertRaises(SecurityError):
            validate_database_safety(mock_dir)

        # 4. Valid canonical paths accepted
        valid_paths = [
            ":memory:",
            "",
            str(LOCAL_TEST_DATA / "test_run.sqlite3"),
            str(LOCAL_TEST_DATA / "subfolder" / "nested.sqlite3"),
        ]
        for good_path in valid_paths:
            with self.subTest(path=good_path):
                mock_good = MagicMock(_driver_name="SqliteDatabase", database=good_path)
                res = validate_database_safety(mock_good)
                self.assertEqual(res["driver"], "sqlite")

    def test_pre_connection_safety_and_check_order(self):
        # 1. Environment indicates production
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}):
            with self.assertRaises(SecurityError):
                validate_pre_connection_safety()

        # 2. SUPABASE_DB_URL points to forbidden host
        with patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://u:p@db.xyz.supabase.co:5432/postgres"}):
            with self.assertRaises(SecurityError):
                validate_pre_connection_safety()

        # 3. SUPABASE_DB_URL has unapproved database name
        with patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://u:p@127.0.0.1:5432/real_customer_db"}):
            with self.assertRaises(SecurityError):
                validate_pre_connection_safety()

        # 4. LERNE_LOCAL_DB_PATH has traversal
        with patch.dict(os.environ, {"LERNE_LOCAL_DB_PATH": "local/test-data/../outside.db"}):
            with self.assertRaises(SecurityError):
                validate_pre_connection_safety()

        # 5. seeder.get_db refuses before database initialization
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}), \
             patch("api.database.initialize_database") as mock_init:
            from scripts.load_testing.seeder import get_db
            with self.assertRaises(SecurityError):
                get_db()
            mock_init.assert_not_called()

    def test_fail_closed_runner_on_db_validation_error(self):
        import asyncio
        from scripts.load_testing.runner import run_load_test

        with patch("scripts.load_testing.runner.validate_database_safety", side_effect=SecurityError("DB check failed")):
            with self.assertRaises(SecurityError) as ctx:
                asyncio.run(run_load_test(
                    target_url="http://127.0.0.1:8000",
                    sample_db=True,
                    seed_if_missing=False,
                ))
            self.assertIn("Database safety validation failed", str(ctx.exception))

    def test_remote_api_isolation_checks(self):
        import asyncio

        # Case 1: /api/debug returns 404 (production gate failure: debug route not mounted)
        mock_client = MagicMock()
        mock_resp_404 = MagicMock(status_code=404, headers={})
        mock_client.get = AsyncMock(return_value=mock_resp_404)

        with self.assertRaises(SecurityError) as ctx:
            asyncio.run(verify_remote_isolation(mock_client, "http://staging.internal:8000"))
        self.assertIn("returned 404 Not Found", str(ctx.exception))

        # Case 2: returns production headers
        mock_resp_prod = MagicMock(status_code=401, headers={"x-vercel-id": "fra1::123"})
        mock_client.get = AsyncMock(return_value=mock_resp_prod)

        with self.assertRaises(SecurityError) as ctx:
            asyncio.run(verify_remote_isolation(mock_client, "http://staging.internal:8000"))
        self.assertIn("production platform header", str(ctx.exception))

        # Case 3: debug is 401, but synthetic user /api/init returns 401 (database unverified)
        mock_resp_debug = MagicMock(status_code=401, headers={})
        mock_resp_unauth = MagicMock(status_code=401, headers={})
        async def mock_get(url, **kwargs):
            if "/api/debug" in url:
                return mock_resp_debug
            if "/api/init" in url:
                return mock_resp_unauth
            return MagicMock(status_code=200, headers={})
        mock_client.get = AsyncMock(side_effect=mock_get)

        synthetic_vu = {"username": "load_vu_1", "access_token": "la_validtesttoken123"}
        with self.assertRaises(SecurityError) as ctx:
            asyncio.run(verify_remote_isolation(
                mock_client, "http://staging.internal:8000", synthetic_user=synthetic_vu
            ))
        self.assertIn("failed to authenticate against", str(ctx.exception))

        # Case 4: debug is 401, synthetic user returns 200 with synthetic markers
        mock_resp_init = MagicMock(
            status_code=200,
            headers={},
            json=lambda: {"decks": [{"name": "[SYNTHETIC_LOAD_TEST] Shared Test Deck"}], "user": "load_vu_1"},
        )
        async def mock_get_ok(url, **kwargs):
            if "/api/debug" in url:
                return mock_resp_debug
            if "/api/init" in url:
                return mock_resp_init
            return MagicMock(status_code=200, headers={})
        mock_client.get = AsyncMock(side_effect=mock_get_ok)

        res = asyncio.run(verify_remote_isolation(
            mock_client, "http://staging.internal:8000", synthetic_user=synthetic_vu
        ))
        self.assertEqual(res["status"], "verified_isolated")

    def test_secret_redaction(self):
        # 1. Bearer token in text
        text_with_token = "Request with Bearer la_32charactersOfUrlSafeTokenValueHere12345678"
        sanitized = sanitize_text(text_with_token)
        self.assertNotIn("32charactersOfUrlSafeTokenValueHere", sanitized)
        self.assertIn("[REDACTED]", sanitized)

        # 2. Password in DSN URL
        dsn = "postgresql://myuser:supersecretpass@127.0.0.1:5432/lerne_tma_local"
        sanitized_dsn = sanitize_text(dsn)
        self.assertNotIn("supersecretpass", sanitized_dsn)
        self.assertIn("myuser:[REDACTED]@127.0.0.1", sanitized_dsn)

        # 3. URL credentials stripping
        url_with_creds = "http://admin:topsecret123@127.0.0.1:8000/api/study"
        clean_url = sanitize_url(url_with_creds)
        self.assertNotIn("topsecret123", clean_url)
        self.assertEqual(clean_url, "http://127.0.0.1:8000/api/study")


class TestCleanupConfirmedMarkers(unittest.TestCase):
    """Tests requirement 5: cleanup deletes ONLY confirmed synthetic data."""

    def setUp(self):
        self.env_patcher = patch.dict(os.environ, {
            "SUPABASE_DB_URL": "",
            "ENVIRONMENT": "development",
            "LERNE_MODE": "LOCAL",
            "VERCEL": "",
            "VERCEL_ENV": "",
            "NODE_ENV": "",
        })
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_cleanup_refusal_when_safety_fails(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}):
            with self.assertRaises(SecurityError):
                cleanup_synthetic_data()

    def test_cleanup_preserves_non_synthetic_records_in_id_range(self):
        """Even if records share the high ID range, non-synthetic records are never deleted."""
        from api import models
        from peewee import SqliteDatabase

        scratch_dir = Path(__file__).resolve().parents[2] / "local" / "test-data" / "test-scratch"
        scratch_dir.mkdir(parents=True, exist_ok=True)
        db_path = scratch_dir / f"test_cleanup_{uuid.uuid4().hex}.sqlite3"

        orig_tma_obj = models.tma_db.obj
        orig_lerne_obj = models.lerne_db.obj
        test_db = SqliteDatabase(str(db_path), pragmas={"journal_mode": "wal"})
        tables = [
            models.TMAUser, models.TMA_Deck, models.TMA_Card,
            models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator,
            models.TMAAuthAccount, models.TMAAuthSession, models.TMAAuthToken,
            models.TMAOfflineBatch,
        ]
        test_db.bind(tables, bind_refs=False, bind_backrefs=False)
        models.tma_db.initialize(test_db)
        models.lerne_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(tables)

        try:
            # 1. Create a "real" user that happens to have an ID in the high range
            real_uid = BASE_USER_ID + 50
            models.TMAUser.create(user_id=real_uid, username="real_admin_user", first_name="RealAdmin")
            models.TMAAuthAccount.create(user=real_uid)
            real_session = models.TMAAuthSession.create(
                id="real-session-uuid-123",
                account=real_uid,
                authenticated_at=models.auth_utcnow(),
                created_at=models.auth_utcnow(),
                expires_at=models.auth_utcnow(),
                authentication_method="telegram",  # NOT 'load_test'
            )
            real_deck = models.TMA_Deck.create(user_id=real_uid, name="Production Course Material")  # NOT [SYNTHETIC_LOAD_TEST]

            # 2. Create confirmed synthetic entity
            synth_uid = BASE_USER_ID + 1
            models.TMAUser.create(user_id=synth_uid, username="load_vu_1", first_name="VU_1")
            models.TMAAuthAccount.create(user=synth_uid)
            synth_session = models.TMAAuthSession.create(
                id="synth-session-uuid-456",
                account=synth_uid,
                authenticated_at=models.auth_utcnow(),
                created_at=models.auth_utcnow(),
                expires_at=models.auth_utcnow(),
                authentication_method="load_test",  # CONFIRMED
            )
            synth_deck = models.TMA_Deck.create(user_id=synth_uid, name="[SYNTHETIC_LOAD_TEST] VU 1 Deck")  # CONFIRMED

            cleaned = cleanup_synthetic_data()

            # Verify synthetic records were deleted
            self.assertIsNone(models.TMAUser.get_or_none(models.TMAUser.user_id == synth_uid))
            self.assertIsNone(models.TMA_Deck.get_or_none(models.TMA_Deck.id == synth_deck.id))
            self.assertIsNone(models.TMAAuthSession.get_or_none(models.TMAAuthSession.id == synth_session.id))

            # Verify real records were completely PRESERVED
            self.assertIsNotNone(models.TMAUser.get_or_none(models.TMAUser.user_id == real_uid))
            self.assertIsNotNone(models.TMA_Deck.get_or_none(models.TMA_Deck.id == real_deck.id))
            self.assertIsNotNone(models.TMAAuthSession.get_or_none(models.TMAAuthSession.id == real_session.id))
        finally:
            test_db.close()
            models.tma_db.initialize(orig_tma_obj)
            models.lerne_db.initialize(orig_lerne_obj)
            if db_path.exists():
                try:
                    db_path.unlink()
                except OSError:
                    pass


class TestMetricsCalculation(unittest.TestCase):
    def test_empty_percentiles(self):
        res = calculate_percentiles([])
        self.assertEqual(res["p50"], 0.0)
        self.assertEqual(res["p95"], 0.0)
        self.assertEqual(res["p99"], 0.0)
        self.assertEqual(res["mean"], 0.0)

    def test_single_value_percentiles(self):
        res = calculate_percentiles([42.5])
        self.assertEqual(res["min"], 42.5)
        self.assertEqual(res["max"], 42.5)
        self.assertEqual(res["p50"], 42.5)
        self.assertEqual(res["p95"], 42.5)
        self.assertEqual(res["p99"], 42.5)

    def test_hundred_values_percentiles(self):
        vals = [float(i) for i in range(1, 101)]
        res = calculate_percentiles(vals)
        self.assertEqual(res["min"], 1.0)
        self.assertEqual(res["max"], 100.0)
        self.assertAlmostEqual(res["p50"], 50.5, delta=0.5)
        self.assertAlmostEqual(res["p90"], 90.1, delta=0.5)
        self.assertAlmostEqual(res["p95"], 95.05, delta=0.5)
        self.assertAlmostEqual(res["p99"], 99.01, delta=0.5)


class TestStageMetrics(unittest.TestCase):
    def test_aggregation(self):
        stage = StageMetrics(concurrency=2, scenario="study", duration_target=1.0)
        stage.start_time = 100.0
        stage.end_time = 102.0  # 2.0s elapsed

        stage.record(RequestSample(
            endpoint="GET /decks/{id}/next",
            scenario="study",
            status_code=200,
            duration_ms=10.0,
        ))
        stage.record(RequestSample(
            endpoint="POST /study/grade",
            scenario="study",
            status_code=200,
            duration_ms=20.0,
        ))
        stage.record(RequestSample(
            endpoint="GET /decks/{id}/next",
            scenario="study",
            status_code=500,
            duration_ms=15.0,
            error="HTTP_500",
        ))

        data = stage.compute()
        self.assertEqual(data["concurrency"], 2)
        self.assertEqual(data["total_requests"], 3)
        self.assertEqual(data["successful_requests"], 2)
        self.assertEqual(data["failed_requests"], 1)
        self.assertAlmostEqual(data["error_rate_pct"], 33.33, delta=0.1)
        self.assertEqual(data["throughput_rps"], 1.5)  # 3 reqs / 2.0s
        self.assertIn("GET /decks/{id}/next", data["endpoints"])
        self.assertIn("POST /study/grade", data["endpoints"])

        table = stage.format_table()
        self.assertIn("Throughput", table)
        self.assertIn("GET /decks/{id}/next", table)


class TestScenarios(unittest.TestCase):
    def test_scenario_factory(self):
        user_info = {
            "user_id": 980000001,
            "token": "la_dummy",
            "deck_id": 1,
            "card_ids": [10, 11],
        }
        stage = StageMetrics(concurrency=1, scenario="study", duration_target=1.0)

        s_study = create_scenario("study", user_info, stage)
        self.assertIsInstance(s_study, StudyScenario)

        s_read = create_scenario("read", user_info, stage)
        self.assertIsInstance(s_read, ReadCardsScenario)

        s_sync = create_scenario("sync", user_info, stage)
        self.assertIsInstance(s_sync, SyncScenario)

        s_mixed = create_scenario("mixed", user_info, stage)
        self.assertIsInstance(s_mixed, MixedScenario)

        with self.assertRaises(ValueError):
            create_scenario("invalid_scenario", user_info, stage)


class TestComparisonFormatting(unittest.TestCase):
    def test_markdown_comparison(self):
        base = {
            "metadata": {"git_branch": "main", "git_commit": "abc1234", "timestamp": "2026-11-03T10:00:00Z"},
            "stages": [
                {
                    "concurrency": 10,
                    "scenario": "study",
                    "throughput_rps": 50.0,
                    "error_rate_pct": 0.0,
                    "latency_ms": {"p50": 20.0, "p95": 40.0, "p99": 60.0},
                    "endpoints": {
                        "GET /decks/{id}/next": {
                            "throughput_rps": 25.0,
                            "error_rate_pct": 0.0,
                            "latency_ms": {"p95": 30.0},
                        }
                    },
                }
            ],
        }
        cand = {
            "metadata": {"git_branch": "codex/c1", "git_commit": "def5678", "timestamp": "2026-11-03T11:00:00Z"},
            "stages": [
                {
                    "concurrency": 10,
                    "scenario": "study",
                    "throughput_rps": 80.0,
                    "error_rate_pct": 0.0,
                    "latency_ms": {"p50": 12.0, "p95": 25.0, "p99": 35.0},
                    "endpoints": {
                        "GET /decks/{id}/next": {
                            "throughput_rps": 40.0,
                            "error_rate_pct": 0.0,
                            "latency_ms": {"p95": 20.0},
                        }
                    },
                }
            ],
        }

        md = format_comparison_markdown(base, cand)
        self.assertIn("# Load Test Comparison Report", md)
        self.assertIn("main", md)
        self.assertIn("codex/c1", md)
        self.assertIn("+60.0%", md)
        self.assertIn("[IMPROVED]", md)


if __name__ == "__main__":
    unittest.main()
