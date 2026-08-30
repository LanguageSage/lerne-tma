# AI Harness Architecture & Agent Guidelines (Lerne TMA)

Welcome to the **Lerne TMA (Telegram Mini App)** repository. This project is configured for **AI-Native Engineering** following the Stanford AI Engineering Practices Benchmark (L3/L4 Maturity Level).

## Core Principles

1. **Code is Cheap; Verification is Asset**: Never consider a task completed until it is empirically verified via unit tests, lints (`npm run lint`), or runtime verification logs.
2. **Context Window Efficiency**: Keep prompts and context precise. Focus on minimal relevant code snippets, explicit interfaces, and concrete requirements.
3. **No Superficial Symptom Patches**: Fix root causes; never swallow errors, return dummy fallbacks, or comment out failing assertions.
4. **Deterministic Evaluation**: Every output is treated as a probabilistic candidate until passed through the Verification Layer.

## Tech Stack Overview

- **Frontend (`/app`)**: React 19, Vite, Zustand (State), Dexie.js (Offline IndexedDB), Framer Motion, Lucide React.
- **Backend (`/api`)**: Python FastAPI, Peewee ORM, Supabase PostgreSQL, edge-tts (Audio), python-telegram-bot.
- **Scripts**: `run_dev.bat`, `run_tma.ps1`, `clean_run.bat`.

## Repository Structure & AI Harness Layers

- **`.agents/rules/`**: Declarative engineering constraints, offline mode rules, architecture boundaries, and safety guardrails.
- **`.agents/skills/`**: Operational cheatsheets and reusable workflows for code generation, testing, RAG enrichment, and auditing.

## Agent Loop Workflow

1. **Context Alignment**: Inspect project guidelines, API schemas (`/api`), and frontend state (`/app/src`). Do not guess variable names or API contracts.
2. **Specification & Plan**: For non-trivial changes, outline an implementation plan with explicit verification steps.
3. **Autonomous Execution**: Make surgical edits using tool declarations.
4. **Verification & Evals**: Run linting (`npm --prefix app run lint`), API syntax checks, and test suites. Fix any failures before reporting results directly and concisely to the user.
