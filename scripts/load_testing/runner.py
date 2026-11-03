"""Async Load Testing Engine for FastAPI backend.

Executes reproducible concurrency stages (1, 10, 50, 100 VUs) across study, read,
sync, and mixed scenarios against synthetic test environment.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import logging
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.load_testing.config import (
    DEFAULT_CONCURRENCY_TIERS,
    DEFAULT_STAGE_DURATION,
    DEFAULT_TARGET_URL,
    DEFAULT_TIMEOUT,
    DEFAULT_THINK_TIME,
    ALL_SCENARIOS,
    RESULTS_DIR,
    USERS_CACHE_FILE,
)
from scripts.load_testing.metrics import StageMetrics
from scripts.load_testing.scenarios import create_scenario
from scripts.load_testing.seeder import seed_synthetic_data, _assert_environment_safety

logger = logging.getLogger("load_tester.runner")


def _get_git_info() -> Dict[str, str]:
    branch = "unknown"
    commit = "unknown"
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(REPO_ROOT), text=True
        ).strip()
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(REPO_ROOT), text=True
        ).strip()
    except Exception:
        pass
    return {"branch": branch, "commit": commit}


class DbConnectionSampler:
    """Periodically samples PostgreSQL pg_stat_activity connection counts."""

    def __init__(self, interval: float = 0.5):
        self.interval = interval
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._db = None

    def start(self, metrics: StageMetrics):
        try:
            from api import models
            if models.tma_db.obj and "postgres" in type(models.tma_db.obj).__name__.lower():
                self._db = models.tma_db
                self.running = True
                self._task = asyncio.create_task(self._sample_loop(metrics))
        except Exception:
            self._db = None

    async def _sample_loop(self, metrics: StageMetrics):
        while self.running:
            try:
                # Run query in threadpool to avoid blocking async event loop
                snapshot = await asyncio.to_thread(self._query_db)
                if snapshot:
                    metrics.record_db_snapshot(snapshot)
            except Exception:
                pass
            await asyncio.sleep(self.interval)

    def _query_db(self) -> Optional[Dict[str, int]]:
        if not self._db or not self._db.obj:
            return None
        try:
            with self._db.connection_context():
                sql = (
                    "SELECT "
                    "count(*) FILTER (WHERE state = 'active') as active, "
                    "count(*) as total, "
                    "count(*) FILTER (WHERE wait_event_type IS NOT NULL) as waiting "
                    "FROM pg_stat_activity WHERE datname = 'lerne_tma_local'"
                )
                cursor = self._db.execute_sql(sql)
                row = cursor.fetchone()
                if row:
                    return {
                        "active": int(row[0] or 0),
                        "total": int(row[1] or 0),
                        "waiting": int(row[2] or 0),
                    }
        except Exception:
            return None
        return None

    async def stop(self):
        self.running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


async def _check_health(client: httpx.AsyncClient, target_url: str) -> bool:
    """Validates that the target API is responsive before launching the test."""
    try:
        # Check standard config endpoint or root
        resp = await client.get("/api/lerne/config", timeout=3.0)
        return resp.status_code in (200, 401, 404)
    except Exception as exc:
        logger.warning(f"Health check failed against {target_url}: {exc}")
        return False


async def run_worker(
    scenario_obj: Any,
    client: httpx.AsyncClient,
    deadline: float,
):
    """Worker loop for a single virtual user."""
    while time.perf_counter() < deadline:
        try:
            await scenario_obj.run_step(client)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug(f"Worker iteration error: {exc}")


async def execute_stage(
    concurrency: int,
    scenario_name: str,
    duration: float,
    users: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    think_time: float = 0.0,
    sample_db: bool = True,
) -> Dict[str, Any]:
    """Runs a single concurrency stage for a specific scenario."""
    if len(users) < concurrency:
        raise ValueError(f"Insufficient users: requested {concurrency}, but only {len(users)} available.")

    stage_users = users[:concurrency]
    metrics = StageMetrics(concurrency=concurrency, scenario=scenario_name, duration_target=duration)

    # Setup scenario object for each VU
    scenarios = [create_scenario(scenario_name, u, metrics, think_time=think_time) for u in stage_users]

    sampler = DbConnectionSampler(interval=0.5) if sample_db else None

    logger.info(f"Starting stage: {concurrency} VUs, scenario '{scenario_name}', duration {duration}s...")
    metrics.start()
    if sampler:
        sampler.start(metrics)

    deadline = time.perf_counter() + duration
    tasks = [asyncio.create_task(run_worker(sc, client, deadline)) for sc in scenarios]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        if sampler:
            await sampler.stop()
        metrics.stop()

    print(metrics.format_table())
    return metrics.compute()


async def run_load_test(
    target_url: str = DEFAULT_TARGET_URL,
    in_process: bool = False,
    tiers: Optional[List[int]] = None,
    duration: float = DEFAULT_STAGE_DURATION,
    scenarios: Optional[List[str]] = None,
    output_path: Optional[Path] = None,
    think_time: float = DEFAULT_THINK_TIME,
    timeout: float = DEFAULT_TIMEOUT,
    seed_if_missing: bool = True,
    sample_db: bool = True,
) -> Dict[str, Any]:
    """Top-level test orchestrator."""
    tiers = tiers or DEFAULT_CONCURRENCY_TIERS
    scenarios = scenarios or list(ALL_SCENARIOS)

    max_vus = max(tiers)
    _assert_environment_safety()

    # Ensure synthetic accounts
    if not USERS_CACHE_FILE.exists() or len(json.loads(USERS_CACHE_FILE.read_text(encoding="utf-8"))) < max_vus:
        if seed_if_missing:
            logger.info(f"Seeding {max_vus} synthetic users...")
            seed_synthetic_data(user_count=max_vus)
        else:
            raise RuntimeError(f"Cached synthetic users file not found: {USERS_CACHE_FILE}. Run with --seed first.")

    with open(USERS_CACHE_FILE, "r", encoding="utf-8") as f:
        available_users = json.load(f)

    # Initialize HTTP client
    transport = None
    app_title = "Remote FastAPI"
    if in_process:
        from api.main import app
        app_title = app.title
        transport = httpx.ASGITransport(app=app)
        base_url = "http://testserver"
        logger.info("Using in-process ASGITransport for direct FastAPI testing")
    else:
        base_url = target_url.rstrip("/")
        # Connection limits tuned for high concurrency
        limits = httpx.Limits(max_keepalive_connections=max_vus + 20, max_connections=max_vus + 50)
        transport = httpx.AsyncHTTPTransport(limits=limits)
        logger.info(f"Connecting to live target: {base_url}")

    async with httpx.AsyncClient(transport=transport, base_url=base_url, timeout=timeout) as client:
        # Pre-flight health check
        healthy = await _check_health(client, base_url)
        if not healthy and not in_process:
            print("\n" + "=" * 75)
            print("ERROR: Target FastAPI server is NOT responding!")
            print(f"Target URL: {base_url}")
            print("Please ensure the test environment is running:")
            print("  1. $env:LERNE_MODE='LOCAL'")
            print("  2. uvicorn api.main:app --host 127.0.0.1 --port 8000")
            print("Alternatively, pass '--in-process' to test FastAPI in-process without an external server.")
            print("=" * 75 + "\n")
            raise ConnectionError(f"Target {base_url} is unreachable.")

        git_info = _get_git_info()
        run_metadata = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "target_url": base_url,
            "in_process": in_process,
            "app_title": app_title,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "git_branch": git_info["branch"],
            "git_commit": git_info["commit"],
            "parameters": {
                "concurrency_tiers": tiers,
                "duration_per_stage": duration,
                "scenarios": scenarios,
                "think_time": think_time,
                "timeout": timeout,
            },
        }

        all_results = []
        for tier in tiers:
            for sc in scenarios:
                res = await execute_stage(
                    concurrency=tier,
                    scenario_name=sc,
                    duration=duration,
                    users=available_users,
                    client=client,
                    think_time=think_time,
                    sample_db=sample_db,
                )
                all_results.append(res)
                # Short pause between stages to let connection pools settle
                await asyncio.sleep(1.0)

        final_report = {
            "metadata": run_metadata,
            "stages": all_results,
        }

        # Save results
        if not output_path:
            RESULTS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = RESULTS_DIR / f"load_test_{git_info['branch'].replace('/', '_')}_{ts}.json"
        else:
            output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(final_report, f, indent=2)

        print(f"\n[+] Results successfully saved to: {output_path}")
        return final_report


def parse_args():
    parser = argparse.ArgumentParser(description="Lerne TMA FastAPI Load Testing Runner")
    parser.add_argument("--target-url", default=DEFAULT_TARGET_URL, help="Target FastAPI URL")
    parser.add_argument("--in-process", action="store_true", help="Run in-process using ASGITransport")
    parser.add_argument("--users", default="1,10,50,100", help="Comma-separated VU tiers (e.g. 1,10,50,100)")
    parser.add_argument("--duration", type=float, default=DEFAULT_STAGE_DURATION, help="Stage duration in seconds")
    parser.add_argument("--scenarios", default="study,read,sync,mixed", help="Comma-separated scenarios")
    parser.add_argument("--output", type=str, default=None, help="Custom output JSON file path")
    parser.add_argument("--think-time", type=float, default=DEFAULT_THINK_TIME, help="Think time in seconds")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Request timeout in seconds")
    parser.add_argument("--seed", action="store_true", help="Force reseed before running")
    parser.add_argument("--no-db-sample", action="store_true", help="Disable PostgreSQL pg_stat_activity monitoring")
    return parser.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    tiers = [int(x.strip()) for x in args.users.split(",") if x.strip()]
    scenarios = [s.strip().lower() for s in args.scenarios.split(",") if s.strip()]

    if args.seed:
        seed_synthetic_data(user_count=max(tiers), force=True)

    output = Path(args.output) if args.output else None

    try:
        asyncio.run(run_load_test(
            target_url=args.target_url,
            in_process=args.in_process,
            tiers=tiers,
            duration=args.duration,
            scenarios=scenarios,
            output_path=output,
            think_time=args.think_time,
            timeout=args.timeout,
            sample_db=not args.no_db_sample,
        ))
    except KeyboardInterrupt:
        print("\nTest interrupted by user.")
    except Exception as e:
        logger.error(f"Load test execution failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
