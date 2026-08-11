# Rule: Architectural Integrity & Verification Standards (Lerne TMA)

## 1. Zero Verification Tax Policy
- Every generated code block must be validated by running concrete verification commands (e.g., `npm --prefix app run lint`, Vite build checks, FastAPI endpoint checks).
- Agents must inspect execution logs completely before reporting success.
- If a build or test fails, diagnose the root cause instead of suppressing errors.

## 2. Context Engineering
- Limit token bloat by focusing strictly on relevant files and direct dependencies in `/app` or `/api`.
- Read exact symbol definitions (FastAPI routes, Pydantic schemas, Zustand stores) rather than relying on high-level assumptions.

## 3. Offline & Sync Safeguards
- TMA operates both online and offline (backed by Dexie.js in `/app` and `offlineApi.js`).
- Never break offline fallback compatibility when introducing new API endpoints or data sync logic.

## 4. Safety Guardrails & Human-in-the-loop
- Destructive DB operations (altering Supabase tables, dropping indexes) require explicit human confirmation.
