"""Restore boundary shared by authenticated content reads and writes.

Full restores recreate relations even when a saved marker has the same value.
Explicit restore tools also rotate the marker for cross-cluster/data-only restores.
"""
import hashlib
import json
from uuid import uuid4

from fastapi import HTTPException
from peewee import PostgresqlDatabase

from api import models

RESTORE_KEY = 'SYNC_DATABASE_RESTORE'
HEADER = 'X-Lerne-Generation'


def generation_state():
    database = getattr(models.tma_db, 'obj', models.tma_db)
    owns_connection = database.is_closed()
    try:
        row = models.TMASetting.get_or_none(models.TMASetting.key == RESTORE_KEY)
        marker = row.value if row else 'initial'
        relations = []
        if isinstance(database, PostgresqlDatabase):
            relations = database.execute_sql("""SELECT c.relname, c.oid::bigint
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname IN ('tma_card', 'card', 'tmasetting')
                ORDER BY c.relname""").fetchall()
    finally:
        if owns_connection and not database.is_closed():
            database.close()
    token = hashlib.sha256(json.dumps([marker, relations], sort_keys=True).encode()).hexdigest()
    return {'server_generation': token, 'restored': marker != 'initial'}


def require_generation(expected):
    state = generation_state()
    if expected != state['server_generation'] and (expected is not None or state['restored']):
        raise HTTPException(409, {'code': 'database_generation_conflict', **state,
            'message': 'База данных восстановлена. Локальные данные сохранены; перед синхронизацией нужна сверка.'})


def mark_database_restored(database):
    """Call before reopening an explicitly restored database to clients."""
    marker = str(uuid4())
    database.execute_sql(
        'INSERT INTO tmasetting (key, value, updated_at) VALUES (%s, %s, CURRENT_TIMESTAMP) '
        'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
        (RESTORE_KEY, marker)
    )
    return marker
