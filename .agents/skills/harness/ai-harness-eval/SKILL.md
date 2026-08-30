---
name: ai-harness-eval
description: Standardized evaluation and verification loop for Lerne TMA to eliminate Verification Tax and ensure architectural integrity.
---

# AI Harness Evaluation & Verification Skill (Lerne TMA)

Use this skill whenever generating or modifying codebase features, running refactoring, or verifying PRs in Lerne TMA.

## Verification Checklist

1. **Frontend Verification (`/app`)**:
   - Run `npm --prefix app run lint` to catch ESLint and React hooks issues.
   - Run `npm --prefix app run build` to verify TypeScript/Vite bundling integrity.

2. **Backend Verification (`/api`)**:
   - Verify Python syntax via `python -m py_compile` on modified backend files.
   - Verify FastAPI route schema contracts and Peewee ORM models.

3. **Runtime & Log Inspection**:
   - Inspect `api.log`, `api-dev.log`, or test execution outputs.
   - Ensure no unhandled promise rejections, CORS errors, or unhandled exceptions.

