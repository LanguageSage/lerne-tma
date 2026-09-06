# AI Harness Architecture & Agent Guidelines (Lerne TMA)

Welcome to the **Lerne TMA (Telegram Mini App)** repository. This project is configured for **AI-Native Engineering** following the Stanford AI Engineering Practices Benchmark (L3/L4 Maturity Level).

## Core Principles

1. **Code is Cheap; Verification is Asset**: Never consider a task completed until it is empirically verified via unit tests, lints (`npm run lint`), or runtime verification logs.
2. **Context Window Efficiency**: Keep prompts and context precise. Focus on minimal relevant code snippets, explicit interfaces, and concrete requirements.
3. **No Superficial Symptom Patches**: Fix root causes; never swallow errors, return dummy fallbacks, or comment out failing assertions.
4. **Deterministic Evaluation**: Every output is treated as a probabilistic candidate until passed through the Verification Layer.
5. **Reuse-First & Pre-Check (Strict DRY)**: Never write duplicate code or reinvent components from scratch. Search existing modules (`app/src/components/common/`, `app/src/store/`, `app/src/services/`, `api/services/`) before creating new logic. If a function or UI element already exists, reuse or extend it. If a pattern appears > 1 time, extract it into a shared module immediately.
6. **Anti-Bloat & YAGNI (Radical Minimalism)**: Write the minimal, cleanest code required to fulfill requirements. Avoid premature abstractions, speculative wrappers, redundant state, and unnecessary boilerplate. If 15 lines do the job cleanly, never write 80.

## Tech Stack Overview

- **Frontend (`/app`)**: React 19, Vite, Zustand (State), Dexie.js (Offline IndexedDB), Framer Motion, Lucide React.
- **Backend (`/api`)**: Python FastAPI, Peewee ORM, Supabase PostgreSQL, edge-tts (Audio), python-telegram-bot.
- **Scripts**: `run_dev.bat`, `run_tma.ps1`, `clean_run.bat`.

## Repository Structure & AI Harness Layers

- **`.agents/ARCHITECTURE.md`**: Architectural map and intent-to-code trace matrix. **Consult first** to immediately locate where to find issues and make changes.
- **`.agents/rules/`**: Declarative engineering constraints, offline mode rules, architecture boundaries, and safety guardrails.
- **`.agents/skills/`**: Operational cheatsheets and reusable workflows (`lean-code`, `fastapi-backend`, `tma-ui`, `db-mgmt`, `ai-harness-eval`).

## Agent Loop Workflow

1. **Context Alignment & Reconnaissance**: Consult `.agents/ARCHITECTURE.md` to locate the target subsystem. Then search the codebase (`grep_search`, `find_by_name`) to verify existing components, hooks, stores, and endpoints before writing new ones. Do not guess variable names or API contracts.
2. **Specification & Plan**: For non-trivial changes, outline an implementation plan with explicit verification steps.
3. **Autonomous Execution**: Make surgical edits using tool declarations. Favor minimal diffs over large file rewrites.
4. **Diff Self-Review**: Review your own changes for duplicate logic, unused imports, redundant state, or unnecessary wrappers before proceeding.
5. **Verification & Evals**: Run linting (`npm --prefix app run lint`), API syntax checks, and test suites. Fix any failures before reporting results directly and concisely to the user.
