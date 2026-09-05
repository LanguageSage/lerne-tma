---
name: fastapi-backend
description: Development, optimization, and safe refactoring standards for FastAPI, Peewee ORM, and Python services in Lerne TMA backend.
---

# FastAPI Backend Development & Refactoring Skill (Lerne TMA)

Use this skill when developing, refactoring, or optimizing endpoints, models, and services in `/api`.

---

## 1. Architecture & Core Modules
- **FastAPI App (`/api/main.py`)**: Route registration, CORS, middleware, lifecycle events.
- **Database & Models (`/api/models.py`, `/api/database.py`)**: Peewee ORM models (`User`, `Deck`, `Card`, `StudySession`, `Folder`).
- **Routers (`/api/routers/`)**: Modular endpoints separated by domain.
- **Services (`/api/services/`)**: Business logic (AI card generation, SRS intervals, TTS audio).

---

## 2. Safe Refactoring & Backward Compatibility
- **Preserve API Contracts**: Never change existing JSON response schemas or request parameter names without checking frontend consumers in `/app/src/services/api.js`.
- **Deprecation Strategy**: If an endpoint parameter is deprecated, keep it optional (`Optional[type] = None`) to prevent breaking active Telegram Mini App sessions.
- **Surgical Changes**: Keep changes isolated to affected route modules or service helpers. Avoid massive cross-cutting file rewrites.

---

## 3. Performance & Optimization Patterns
- **Audio & TTS Caching**: Cache generated `edge-tts` audio files (`.mp3`) in local/cloud storage. Always check if audio already exists before generating new files.
- **Prevent N+1 Queries**: In Peewee, use `.prefetch()` or `.join()` when fetching related entities (e.g., Decks with their Cards).
- **Index Usage**: Ensure queries filter by indexed columns (`user_id`, `deck_id`, `next_review_at`).
- **Async I/O**: Use non-blocking async calls for external HTTP requests (`aiohttp` / `edge-tts`). Keep route handlers `async def` when performing async I/O.
- **Image Processing**: Compress card images with Pillow before writing to disk or serving to mobile TMA clients.

---

## 4. Verification Checklist
- [ ] Run `python -m py_compile <modified_file>.py` to verify syntax.
- [ ] Ensure all routes use Pydantic models with explicit response status codes and `HTTPException` for errors.
- [ ] Verify that database connections are properly managed and closed.
