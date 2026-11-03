"""Behavioral and unit tests for the FastAPI load testing framework.

Runs isolated tests verifying percentiles calculations, metrics aggregation,
safety gates, scenario generation, runner execution, and comparison logic.
"""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.load_testing.config import BASE_USER_ID, USERS_CACHE_FILE
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
from scripts.load_testing.seeder import (
    _assert_environment_safety,
    cleanup_synthetic_data,
    get_synthetic_status,
    seed_synthetic_data,
)


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
        # 1 to 100
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

        # Table formatting does not raise
        table = stage.format_table()
        self.assertIn("Throughput", table)
        self.assertIn("GET /decks/{id}/next", table)


class TestSafetyAndSeeder(unittest.TestCase):
    def test_production_safety_check(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}):
            with self.assertRaises(RuntimeError):
                _assert_environment_safety()

    def test_vercel_safety_check(self):
        with patch.dict(os.environ, {"VERCEL": "1"}):
            with self.assertRaises(RuntimeError):
                _assert_environment_safety()

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
        self.assertIn("+60.0%", md)  # RPS delta
        self.assertIn("[IMPROVED]", md)


if __name__ == "__main__":
    unittest.main()
