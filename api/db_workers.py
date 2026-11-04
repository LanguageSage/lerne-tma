"""Connection ownership for blocking route bodies and async DB phases."""
from functools import wraps

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from api import models


async def run_db(function, *args, **kwargs):
    """Open, use and close a connection in the same worker, even on failure."""
    def connected():
        database = getattr(models.tma_db, 'obj', models.tma_db)
        try:
            database.connect(reuse_if_open=True)
        except BaseException:
            # Peewee can set thread-local state before connection initialization
            # fails. connection_context.__exit__ is never entered in that case.
            if not database.is_closed():
                discard = getattr(database, 'manual_close', database.close)
                discard()
            raise
        try:
            return function(*args, **kwargs)
        finally:
            database.close()
    return await run_in_threadpool(connected)


def db_worker(function=None, *, retry_reads=False):
    """Run DB work and serialization in one worker, preserving service transactions."""
    if function is None:
        return lambda function: db_worker(function, retry_reads=retry_reads)

    @wraps(function)
    async def offloaded(*args, **kwargs):
        try:
            return await run_db(function, *args, **kwargs)
        except HTTPException:
            raise
        except Exception as exc:
            # Retry only opted-in read operations with a new worker scope.
            if not retry_reads or not any(key in str(exc).lower() for key in (
                'closed', 'terminated', 'connection', 'socket', 'reset', 'eof',
                'exceeded maximum connections',
            )):
                raise
            return await run_db(function, *args, **kwargs)

    offloaded._db_worker = True
    return offloaded


def db_phases(function):
    """Mark a route whose DB phases use run_db (or which needs no database)."""
    function._db_worker = True
    return function
