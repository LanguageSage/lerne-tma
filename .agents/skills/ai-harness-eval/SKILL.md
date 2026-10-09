---
name: ai-harness-eval
description: Verify Lerne TMA changes or review findings using targeted behavioral tests, relevant static checks, visual evidence for UI changes, and explicit limitations.
---

# Verification for Lerne TMA

## Choose evidence for the change

Define an observable expected outcome. For a bug, reproduce the trigger when possible; otherwise state the evidence and reproduction gap. Select checks for changed behavior and material failure modes.

- Frontend code: start with ESLint on explicit changed JS/JSX paths using the existing configuration from `app/` (`npx --no-install eslint` followed by those paths), and relevant behavior tests. Include affected callers when shared behavior changed. Vite bundling is not a TypeScript type check or browser interaction test.
- Backend code: run `python -m py_compile` on changed Python files and targeted behavioral or contract checks. Compilation does not execute imports, routes, queries, or permissions.
- UI behavior: exercise the changed flow and relevant loading/error states. For locale-dependent bugs, use the reported locale and another supported locale; check persistence when selection changes.
- API and data integrity: cover relevant validation, permissions, transaction failure, or repeated requests according to risk.
- Documentation or instruction-only edits: inspect content, links, key paths, and diff; validate changed skill files with the skill validator. Application builds are unnecessary unless application code changed.

Run full `npm --prefix app run lint`, `npm --prefix app run build`, or broader test suites when shared infrastructure, configuration/dependencies, significant cross-subsystem changes, wider failure evidence, or explicit user/CI requirements justify them. Select the relevant full checks for that risk; do not automatically run every suite for a local edit. Do not describe targeted checks as a full-project pass.

## UI visual evidence

Use [tma-ui](../tma-ui/SKILL.md) for UI-specific constraints. A clean lint/build result **does not** verify visual appearance.

- When a browser is available, check the **real UI** at affected breakpoints (normally `320`, `375`, `430px`, tablet, desktop), or narrow to demonstrably relevant viewports for a local change. Use the application's real font and representative long German/Russian content.
- Verify the changed default state and relevant focus, disabled, loading, success, error, retry, empty, completed or offline states. Check overlay clipping, sticky/fixed controls and whether content is reachable without horizontal scrolling.
- For a material redesign, capture before/after screenshots at matching viewport size and state; compare structure, typography, scroll, contrast and regression in adjacent screens. Add Playwright screenshot assertions only with deterministic fixtures and stable baselines. Avoid brittle global snapshots for small changes.
- Existing UI browser specs live under `scripts/tests/browser/`; inspect web server, database setup and external API side effects before running them.
- If a browser, screenshots or Figma are unavailable, say precisely which checks were **not performed**. Do not replace observation with an aesthetic claim based on source inspection.
- Preserve educational truth in UI reporting: session completion, correctness and SRS/knowledge mastery must not be inferred from each other without supporting data.

## Tests with a purpose

Start with relevant tests in the affected [subsystem document](../../AGENT_INDEX.md), then search the relevant test directories if coverage is missing. Tests live in `app/src/utils/__tests__/`, `app/src/services/__tests__/`, `tests/`, `scripts/tests/`, and `tools/`; inspect setup before execution. Scripts may contact a backend, modify data, or call paid services. Prefer isolated fixtures and local test data; names do not establish safety or coverage.

Add focused regression tests for significant logic or repeatable bugs when practical. Assert observable behavior or meaningful invariants, not implementation wording. Do not add a test framework solely for a trivial reversible edit.

When adding a regression test, establish that it detects the old failure when feasible, then verify the fix. Mock external dependencies as appropriate while checking the relevant contract.

## Interpret results honestly

- Separate introduced failures from existing failures through a baseline or focused comparison without discarding user changes. Do not relax rules or remove assertions to get a pass.
- Inspect relevant output and runtime errors when available; sanitize sensitive data. Missing logs are not evidence of success.
- Repeat passing checks only for new edits or unresolved concerns. Review the final diff for unintended changes.
- Report the result, checks actually run and their outcomes, and unverified behavior with concrete reasons. Do not claim a crash is fixed solely because lint or build passed.
