---
name: ai-harness-eval
description: Verify Lerne TMA code changes or review findings with targeted behavioral checks, relevant static checks, and explicit evidence and limitations.
---

# Verification for Lerne TMA

## Choose evidence for the change

Define an observable expected outcome. For a bug, reproduce the trigger when possible; otherwise state the evidence and reproduction gap. Select checks for changed behavior and material failure modes.

- Frontend code: run `npm --prefix app run lint` and `npm --prefix app run build`. Vite bundling is not a TypeScript type check or browser interaction test.
- Backend code: run `python -m py_compile` on changed Python files and targeted behavioral or contract checks. Compilation does not execute imports, routes, queries, or permissions.
- UI behavior: exercise the changed flow and relevant loading/error states. For locale-dependent bugs, use the reported locale and another supported locale; check persistence when selection changes.
- API and data integrity: cover relevant validation, permissions, transaction failure, or repeated requests according to risk.
- Documentation or instruction-only edits: inspect content, links, and diff; validate skill files with the skill validator. Application builds are unnecessary unless application code changed.

## Tests with a purpose

Look for relevant checks in `scripts/tests/` and `tools/`; inspect setup before execution. Scripts may contact a backend, modify data, or call paid services. Prefer isolated fixtures and local test data; names do not establish safety or coverage.

Add focused regression tests for significant logic or repeatable bugs when practical. Assert observable behavior or meaningful invariants, not implementation wording. Do not add a test framework solely for a trivial reversible edit.

When adding a regression test, establish that it detects the old failure when feasible, then verify the fix. Mock external dependencies as appropriate while checking the relevant contract.

## Interpret results honestly

- Separate introduced failures from existing failures through a baseline or focused comparison without discarding user changes. Do not relax rules or remove assertions to get a pass.
- Inspect relevant output and runtime errors when available; sanitize sensitive data. Missing logs are not evidence of success.
- Repeat passing checks only for new edits or unresolved concerns. Review the final diff for unintended changes.
- Report the result, checks actually run and their outcomes, and unverified behavior with concrete reasons. Do not claim a crash is fixed solely because lint or build passed.
