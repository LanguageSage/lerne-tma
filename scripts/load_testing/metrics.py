"""Metrics collection, percentiles calculation, and reporting engine."""
from __future__ import annotations

import math
import statistics
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(slots=True)
class RequestSample:
    endpoint: str
    scenario: str
    status_code: int
    duration_ms: float
    error: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


def calculate_percentiles(values: List[float]) -> Dict[str, float]:
    """Calculates min, max, mean, p50, p90, p95, p99 from a list of durations."""
    if not values:
        return {
            "min": 0.0,
            "max": 0.0,
            "mean": 0.0,
            "p50": 0.0,
            "p90": 0.0,
            "p95": 0.0,
            "p99": 0.0,
        }
    sorted_vals = sorted(values)
    n = len(sorted_vals)

    def percentile(p: float) -> float:
        if n == 1:
            return round(sorted_vals[0], 2)
        k = (n - 1) * p
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return round(sorted_vals[int(k)], 2)
        d0 = sorted_vals[int(f)] * (c - k)
        d1 = sorted_vals[int(c)] * (k - f)
        return round(d0 + d1, 2)

    return {
        "min": round(sorted_vals[0], 2),
        "max": round(sorted_vals[-1], 2),
        "mean": round(statistics.mean(sorted_vals), 2),
        "p50": percentile(0.50),
        "p90": percentile(0.90),
        "p95": percentile(0.95),
        "p99": percentile(0.99),
    }


class StageMetrics:
    """Aggregates metrics for a single concurrency stage (e.g. 50 VUs, study scenario)."""

    def __init__(self, concurrency: int, scenario: str, duration_target: float):
        self.concurrency = concurrency
        self.scenario = scenario
        self.duration_target = duration_target
        self.start_time: float = 0.0
        self.end_time: float = 0.0
        self.samples: List[RequestSample] = []
        self.active_connections: int = 0
        self.peak_active_connections: int = 0
        self.db_stats_snapshots: List[Dict[str, int]] = []

    def start(self):
        self.start_time = time.perf_counter()

    def stop(self):
        self.end_time = time.perf_counter()

    def record_connection_start(self):
        self.active_connections += 1
        if self.active_connections > self.peak_active_connections:
            self.peak_active_connections = self.active_connections

    def record_connection_end(self):
        if self.active_connections > 0:
            self.active_connections -= 1

    def record(self, sample: RequestSample):
        self.samples.append(sample)

    def record_db_snapshot(self, snapshot: Dict[str, int]):
        if snapshot:
            self.db_stats_snapshots.append(snapshot)

    @property
    def elapsed_seconds(self) -> float:
        if self.end_time and self.start_time:
            return max(0.001, self.end_time - self.start_time)
        return 0.001

    def compute(self) -> Dict[str, Any]:
        total = len(self.samples)
        successful = sum(1 for s in self.samples if 200 <= s.status_code < 300)
        failed = total - successful
        error_rate = (failed / total * 100.0) if total > 0 else 0.0
        elapsed = self.elapsed_seconds
        throughput = round(total / elapsed, 2) if elapsed > 0 else 0.0

        all_latencies = [s.duration_ms for s in self.samples]
        overall_latency = calculate_percentiles(all_latencies)

        # Status code and error breakdown
        status_codes: Dict[str, int] = {}
        error_types: Dict[str, int] = {}
        for s in self.samples:
            code_key = str(s.status_code) if s.status_code > 0 else "network_error"
            status_codes[code_key] = status_codes.get(code_key, 0) + 1
            if s.error:
                error_types[s.error] = error_types.get(s.error, 0) + 1

        # Per-endpoint breakdown
        endpoints: Dict[str, List[RequestSample]] = {}
        for s in self.samples:
            endpoints.setdefault(s.endpoint, []).append(s)

        endpoint_breakdown: Dict[str, Any] = {}
        for ep_name, ep_samples in sorted(endpoints.items()):
            ep_total = len(ep_samples)
            ep_success = sum(1 for s in ep_samples if 200 <= s.status_code < 300)
            ep_failed = ep_total - ep_success
            ep_latencies = [s.duration_ms for s in ep_samples]
            endpoint_breakdown[ep_name] = {
                "total": ep_total,
                "successful": ep_success,
                "failed": ep_failed,
                "error_rate_pct": round(ep_failed / ep_total * 100.0, 2) if ep_total > 0 else 0.0,
                "throughput_rps": round(ep_total / elapsed, 2) if elapsed > 0 else 0.0,
                "latency_ms": calculate_percentiles(ep_latencies),
            }

        # Connection metrics
        conn_errors = sum(v for k, v in error_types.items() if any(
            err in k.lower() for err in ("conn", "refused", "reset", "timeout", "pool", "socket")
        ))

        db_metrics = {}
        if self.db_stats_snapshots:
            db_metrics = {
                "peak_active_db_connections": max(s.get("active", 0) for s in self.db_stats_snapshots),
                "peak_total_db_connections": max(s.get("total", 0) for s in self.db_stats_snapshots),
                "peak_waiting_queries": max(s.get("waiting", 0) for s in self.db_stats_snapshots),
            }

        return {
            "concurrency": self.concurrency,
            "scenario": self.scenario,
            "duration_seconds": round(elapsed, 2),
            "total_requests": total,
            "successful_requests": successful,
            "failed_requests": failed,
            "error_rate_pct": round(error_rate, 2),
            "throughput_rps": throughput,
            "latency_ms": overall_latency,
            "status_codes": status_codes,
            "error_types": error_types,
            "connection_metrics": {
                "peak_active_http_connections": self.peak_active_connections,
                "connection_errors_count": conn_errors,
                **db_metrics,
            },
            "endpoints": endpoint_breakdown,
        }

    def format_table(self) -> str:
        data = self.compute()
        lat = data["latency_ms"]
        lines = [
            f"=== Concurrency: {self.concurrency} VUs | Scenario: {self.scenario} | Duration: {data['duration_seconds']}s ===",
            f"Throughput: {data['throughput_rps']} req/s | Total: {data['total_requests']} | Errors: {data['failed_requests']} ({data['error_rate_pct']}%)",
            f"Latency (ms) -> p50: {lat['p50']} | p95: {lat['p95']} | p99: {lat['p99']} | Mean: {lat['mean']} | Min: {lat['min']} | Max: {lat['max']}",
        ]
        conn = data["connection_metrics"]
        lines.append(f"Connection Metrics -> Peak Active HTTP: {conn.get('peak_active_http_connections', 0)}, Connection Errors: {conn.get('connection_errors_count', 0)}")
        if "peak_active_db_connections" in conn:
            lines.append(f"DB Connections -> Peak Active: {conn['peak_active_db_connections']}, Peak Total: {conn['peak_total_db_connections']}, Waiting Queries: {conn['peak_waiting_queries']}")

        if data["endpoints"]:
            lines.append("-" * 75)
            lines.append(f"{'Endpoint':<32} {'Reqs':>6} {'RPS':>7} {'Err%':>6} {'p50':>7} {'p95':>7} {'p99':>7}")
            lines.append("-" * 75)
            for ep_name, ep_data in data["endpoints"].items():
                e_lat = ep_data["latency_ms"]
                lines.append(
                    f"{ep_name:<32} {ep_data['total']:>6} {ep_data['throughput_rps']:>7.1f} {ep_data['error_rate_pct']:>5.1f}% "
                    f"{e_lat['p50']:>7.1f} {e_lat['p95']:>7.1f} {e_lat['p99']:>7.1f}"
                )
            lines.append("-" * 75)
        return "\n".join(lines)
