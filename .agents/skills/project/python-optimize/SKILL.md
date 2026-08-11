---
name: python-optimize
description: Performance optimization strategies for FastAPI, TTS audio caching, and DB queries in Lerne TMA.
---

# Python Performance Optimization Skill (Lerne TMA)

Guidelines for maintaining fast response times (< 200ms) for TMA API endpoints.

## Instructions
- **Audio & TTS Caching**: Cache generated `edge-tts` audio files (`.mp3`) locally or in storage to prevent redundant API calls and latency.
- **ORM & DB Queries**: Use indexing and Peewee `.select().where()` filters efficiently; avoid fetching unnecessary fields on card lists.
- **Async I/O**: Use non-blocking async calls for external HTTP requests (`aiohttp` / `edge-tts`).
- **Image & Asset Processing**: Optimize card images (via Pillow) before saving or serving to minimize bandwidth on mobile Telegram clients.
