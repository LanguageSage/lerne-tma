---
name: db-mgmt
description: Change Lerne TMA PostgreSQL and Peewee schemas, data mutations, or Dexie synchronization with transaction integrity, compatible migrations, and recovery checks.
---

# Data management for Lerne TMA

## Identify storage and ownership

Read `api/database.py`, affected models in `api/models.py`, and migration conventions in `api/migrations.py`. Database proxies may resolve to the same database; verify configuration without exposing credentials.

For offline data, inspect `app/src/services/localDb.js`, `offlineApi.js`, and `syncService.js`. Trace identifiers, ownership, schema versions, and queued operations across client and server.

## Mutations and synchronization

- Use transactions for related writes that must succeed or fail together. Keep connection and transaction handling in the same thread/context.
- Database transactions cannot atomically include browser storage or external services. Define recovery from partial success using existing retry or reconciliation mechanisms.
- Preserve queued local changes. Check duplicates, conflicts, retry behavior, and deletion propagation when those paths change.
- Prefer database constraints for relevant uniqueness and referential invariants; application prechecks can race. Translate constraint failures into expected API errors.
- Check query patterns before adding indexes, including write cost and migration impact.

## Migrations

- Distinguish schema migrations from one-off data repairs. Follow migration tracking conventions; make reruns safe through tracking or idempotence as appropriate.
- Account for existing rows, nulls, duplicates, defaults, and older clients before introducing constraints or removing fields.
- Validate against a disposable database or authorized test copy. Inspect configuration first; an environment file does not establish that data is safe to modify.
- For material data transformations, verify counts and invariants before and after, and define rollback or forward recovery. Do not promise reversibility without a concrete method.
- Destructive live operations need explicit authorization and a verified recovery path. A backup alone does not authorize deletion.

Use [verification guidance](../ai-harness-eval/SKILL.md). Report whether a migration was prepared, tested, or applied, and in which environment.
