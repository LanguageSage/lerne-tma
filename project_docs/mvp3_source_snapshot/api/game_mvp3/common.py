"""Scoped transactions and ownership, shared only by the independent MVP 3 services."""
import hashlib
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from fastapi import HTTPException
from peewee import PostgresqlDatabase, SqliteDatabase
from api.models import TMAGameAttempt, tma_db


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_naive(value):
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def iso(value):
    return value.isoformat() + 'Z' if value else None


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(dump(value).encode('utf-8')).hexdigest()


def fail(status, code):
    raise HTTPException(status, detail=code)


@contextmanager
def transaction(user_id):
    if type(user_id) is not int or user_id <= 0:
        fail(401, 'authentication_required')
    database = tma_db.obj
    if not isinstance(database, (PostgresqlDatabase, SqliteDatabase)):
        raise RuntimeError('Unsupported MVP 3 database')
    # All service DB work is synchronous in one thread/connection.
    with database.connection_context():
        with database.atomic(**({'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {})):
            if isinstance(database, PostgresqlDatabase):
                lock = int.from_bytes(hashlib.blake2b(
                    f'game-mvp3:{user_id}'.encode(), digest_size=8).digest(), 'big', signed=True)
                database.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock,))
            yield


def owned_attempt(user_id, attempt_id, *, lock=False):
    query = TMAGameAttempt.select().where(
        (TMAGameAttempt.id == attempt_id) & (TMAGameAttempt.user_id == user_id))
    if lock and isinstance(tma_db.obj, PostgresqlDatabase):
        query = query.for_update()
    row = query.first()
    if row is None:
        fail(404, 'attempt_not_found')
    return row
