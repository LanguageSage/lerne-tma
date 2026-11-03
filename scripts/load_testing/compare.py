"""Compare two load test result JSON files (e.g. Baseline vs Codex).

Generates markdown tables and delta analysis for throughput (RPS), p50/p95/p99 latency,
error rates, and connection stability.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from scripts.load_testing.safety import sanitize_text, sanitize_url


def _delta_pct(val_new: float, val_old: float) -> str:
    """Calculates percentage change."""
    if val_old == 0:
        return "+inf%" if val_new > 0 else "0.0%"
    pct = ((val_new - val_old) / val_old) * 100.0
    sign = "+" if pct > 0 else ""
    return f"{sign}{pct:.1f}%"


def _diff_ms(val_new: float, val_old: float) -> str:
    """Calculates difference in milliseconds with sign."""
    diff = val_new - val_old
    sign = "+" if diff > 0 else ""
    return f"{sign}{diff:.1f}ms"


def format_comparison_markdown(base_data: Dict[str, Any], test_data: Dict[str, Any]) -> str:
    base_meta = base_data.get("metadata", {})
    test_meta = test_data.get("metadata", {})

    base_branch = sanitize_text(str(base_meta.get("git_branch", "unknown")))
    base_commit = sanitize_text(str(base_meta.get("git_commit", "unknown")))
    cand_branch = sanitize_text(str(test_meta.get("git_branch", "unknown")))
    cand_commit = sanitize_text(str(test_meta.get("git_commit", "unknown")))
    cand_target = sanitize_url(str(test_meta.get("target_url", "unknown")))

    lines = [
        "# Load Test Comparison Report",
        "",
        "## Run Metadata",
        "",
        f"- **Baseline Run:** Branch `{base_branch}` (commit `{base_commit}`) at {base_meta.get('timestamp')}",
        f"- **Candidate Run:** Branch `{cand_branch}` (commit `{cand_commit}`) at {test_meta.get('timestamp')}",
        f"- **Target URL:** `{cand_target}` | In-Process: `{test_meta.get('in_process')}`",
        "",
        "## Concurrency & Scenario Summary",
        "",
        "| VUs | Scenario | Baseline RPS | Candidate RPS | RPS Delta | Base p50 | Cand p50 | Base p95 | Cand p95 | Base p99 | Cand p99 | Err% (Base/Cand) | Verdict |",
        "|:---:|:--------:|:------------:|:-------------:|:---------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:----------------:|:-------:|",
    ]

    base_stages = {(s["concurrency"], s["scenario"]): s for s in base_data.get("stages", [])}
    test_stages = {(s["concurrency"], s["scenario"]): s for s in test_data.get("stages", [])}

    all_keys = sorted(set(base_stages.keys()) | set(test_stages.keys()), key=lambda k: (k[0], k[1]))

    for key in all_keys:
        b = base_stages.get(key)
        t = test_stages.get(key)

        if not b or not t:
            continue

        b_rps = b.get("throughput_rps", 0.0)
        t_rps = t.get("throughput_rps", 0.0)
        rps_change = _delta_pct(t_rps, b_rps)

        b_lat = b.get("latency_ms", {})
        t_lat = t.get("latency_ms", {})

        b_p50 = b_lat.get("p50", 0.0)
        t_p50 = t_lat.get("p50", 0.0)

        b_p95 = b_lat.get("p95", 0.0)
        t_p95 = t_lat.get("p95", 0.0)

        b_p99 = b_lat.get("p99", 0.0)
        t_p99 = t_lat.get("p99", 0.0)

        b_err = b.get("error_rate_pct", 0.0)
        t_err = t.get("error_rate_pct", 0.0)

        # Verdict logic
        # Improvement if RPS increases significantly or p95 drops with no added errors
        if t_err < b_err or (t_err == b_err and t_rps > b_rps * 1.05 and t_p95 <= b_p95):
            verdict = "[IMPROVED]"
        elif t_err > b_err or t_rps < b_rps * 0.90 or t_p95 > b_p95 * 1.25:
            verdict = "[DEGRADED]"
        else:
            verdict = "[SIMILAR]"

        lines.append(
            f"| {key[0]} | {key[1]} | {b_rps:.1f} | {t_rps:.1f} | **{rps_change}** | "
            f"{b_p50:.1f}ms | {t_p50:.1f}ms ({_diff_ms(t_p50, b_p50)}) | "
            f"{b_p95:.1f}ms | {t_p95:.1f}ms ({_diff_ms(t_p95, b_p95)}) | "
            f"{b_p99:.1f}ms | {t_p99:.1f}ms ({_diff_ms(t_p99, b_p99)}) | "
            f"{b_err:.1f}% / {t_err:.1f}% | {verdict} |"
        )

    # Detailed Endpoint Breakdown
    lines.extend([
        "",
        "## Detailed Endpoint Breakdown",
        "",
        "| VUs | Endpoint | Base RPS | Cand RPS | Delta RPS | Base p95 | Cand p95 | Delta p95 | Base Err% | Cand Err% |",
        "|:---:|:---------|:--------:|:--------:|:---------:|:--------:|:--------:|:---------:|:---------:|:---------:|",
    ])

    for key in all_keys:
        b = base_stages.get(key)
        t = test_stages.get(key)
        if not b or not t:
            continue

        b_eps = b.get("endpoints", {})
        t_eps = t.get("endpoints", {})
        shared_eps = sorted(set(b_eps.keys()) | set(t_eps.keys()))

        for ep in shared_eps:
            b_ep = b_eps.get(ep, {})
            t_ep = t_eps.get(ep, {})
            b_ep_rps = b_ep.get("throughput_rps", 0.0)
            t_ep_rps = t_ep.get("throughput_rps", 0.0)
            b_ep_p95 = b_ep.get("latency_ms", {}).get("p95", 0.0)
            t_ep_p95 = t_ep.get("latency_ms", {}).get("p95", 0.0)
            b_ep_err = b_ep.get("error_rate_pct", 0.0)
            t_ep_err = t_ep.get("error_rate_pct", 0.0)

            lines.append(
                f"| {key[0]} | `{ep}` | {b_ep_rps:.1f} | {t_ep_rps:.1f} | {_delta_pct(t_ep_rps, b_ep_rps)} | "
                f"{b_ep_p95:.1f}ms | {t_ep_p95:.1f}ms | {_diff_ms(t_ep_p95, b_ep_p95)} | "
                f"{b_ep_err:.1f}% | {t_ep_err:.1f}% |"
            )

    return "\n".join(lines)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description="Compare two load test results JSON files")
    parser.add_argument("baseline", help="Path to baseline result JSON file")
    parser.add_argument("candidate", help="Path to candidate result JSON file (e.g. Codex)")
    parser.add_argument("--output", "-o", help="Optional output markdown file path")
    args = parser.parse_args()

    base_path = Path(args.baseline)
    cand_path = Path(args.candidate)

    if not base_path.exists():
        print(f"Error: Baseline file '{base_path}' not found.")
        sys.exit(1)
    if not cand_path.exists():
        print(f"Error: Candidate file '{cand_path}' not found.")
        sys.exit(1)

    with open(base_path, "r", encoding="utf-8") as f:
        base_data = json.load(f)
    with open(cand_path, "r", encoding="utf-8") as f:
        cand_data = json.load(f)

    report = format_comparison_markdown(base_data, cand_data)
    print("\n" + report)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report, encoding="utf-8")
        print(f"\n[+] Markdown comparison saved to: {out_path}")


if __name__ == "__main__":
    main()
