---
name: python-dev
description: Development standards for Python, FastAPI, and async backend code in Lerne TMA.
---

# Python Development Skill (Lerne TMA)

Guidelines for writing maintainable Python code in the `/api` backend.

## Instructions
- **PEP 8 & Formatting**: Follow PEP 8 style conventions.
- **Type Annotations**: Use Pydantic models for FastAPI request/response payloads and type hints on all route handlers and helper functions.
- **Async Handling**: Use `async`/`await` for I/O operations (`aiohttp`, `edge-tts`, FastAPI route handlers).
- **Environment Config**: Load configuration dynamically via `python-dotenv` from `.env`.
- **Error Handling**: Use `HTTPException` with explicit HTTP status codes and clear error messages instead of generic `try-except` blocks.
