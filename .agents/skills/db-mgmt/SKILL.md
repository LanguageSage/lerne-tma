---
name: db-mgmt
description: PostgreSQL / Supabase and Peewee ORM migration & data management guidance for Lerne TMA.
---

# Database Management Skill (Lerne TMA)

This skill ensures data integrity, schema consistency, and efficient query execution for Lerne TMA.

---

## 1. Tech Stack
- **Database**: PostgreSQL / Supabase (Cloud & Production)
- **ORM**: Peewee ORM (`/api/models.py`, `/api/database.py`)
- **Scripts**: `apply_indexes.py`, `check_db.py`, `inspect_db_deep.py`

---

## 2. Guidelines & Best Practices

1. **Schema Migrations**:
   - Use idempotent SQL/Python migration scripts (`apply_indexes.py` or explicit Peewee migrations).
   - Never run raw `DROP TABLE` commands in production without prior database snapshot/backup in Supabase.

2. **Connection & Pooling Safety**:
   - Use proper connection lifecycle management for FastAPI endpoints (connect on request, close on response or use pooled connections).
   - Keep `.env` credentials secure (`SUPABASE_URL`, `DATABASE_URL`).

3. **Query Optimization**:
   - Avoid N+1 query problems in Peewee; use `.prefetch()` or `.join()` for nested relations (e.g. User -> Decks -> Cards).
   - Ensure indexing on foreign keys (`user_id`, `deck_id`) and search columns (`word`, `next_review_at`).

4. **Offline & Client Sync Alignment**:
   - Align Peewee model fields with IndexedDB (Dexie.js in `/app/src/services/localDb.js`) schemas to ensure smooth bidirectional synchronization.
