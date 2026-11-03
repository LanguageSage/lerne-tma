"""Connection ownership for the C1 blocking route bodies."""
from functools import wraps

from fastapi import HTTPException
try:
    # FastAPI >=0.137 stores included routers as a tree, with effective prefixes.
    from fastapi.routing import iter_route_contexts
except ImportError:
    iter_route_contexts = iter
from starlette.concurrency import run_in_threadpool
from starlette.routing import Match

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
            # The old middleware's GET retry must also reconnect in a worker.
            # Re-entering call_next cannot replay its consumed ASGI task.
            if not retry_reads or not any(key in str(exc).lower() for key in (
                'closed', 'terminated', 'connection', 'socket', 'reset', 'eof',
                'exceeded maximum connections',
            )):
                raise
            return await run_db(function, *args, **kwargs)

    offloaded._db_worker = True
    return offloaded


def uses_db_worker(request):
    """Match the same first full route as Starlette, before call_next routes it."""
    for route in iter_route_contexts(request.app.routes):
        if route.matches(request.scope)[0] == Match.FULL:
            return getattr(getattr(route, 'endpoint', None), '_db_worker', False)
    return False
