"""Local-only numeric diagnostics. Never retain SQL, params, paths or row values."""
from contextvars import ContextVar
from collections import deque
from threading import RLock
from time import monotonic
from functools import wraps

from fastapi import HTTPException

current = ContextVar('admin_metrics', default=None)
recent = deque(maxlen=100)
lock = RLock()
cache = {}
generation = 0


def invalidate():
    global generation
    with lock:
        generation += 1
        cache.clear()


def cached_summary(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        key = (function.__name__, args, tuple(sorted(kwargs.items())))
        with lock:
            entry = cache.get(key)
            epoch = generation
            if entry and monotonic() - entry[0] < 60:
                return entry[1]
        result = function(*args, **kwargs)
        with lock:
            if epoch == generation:
                if len(cache) >= 32:
                    cache.pop(next(iter(cache)))
                cache[key] = (monotonic(), result)
        return result
    return wrapped


def paginate(items, page, limit):
    if page < 1 or not 1 <= limit <= 200:
        raise HTTPException(422, 'page >= 1; limit between 1 and 200')
    start = (page - 1) * limit
    return {'page': page, 'limit': limit, 'total': len(items), 'has_more': start + limit < len(items)}


def value_size(value):
    if value is None:
        return 0
    if isinstance(value, (bytes, bytearray, memoryview)):
        return len(value)
    if isinstance(value, str):
        return len(value.encode('utf-8'))
    return len(str(value).encode('utf-8'))


class MeasuredCursor:
    def __init__(self, cursor, metrics):
        self.cursor, self.metrics = cursor, metrics

    def __getattr__(self, name):
        return getattr(self.cursor, name)

    def measure(self, row):
        if row is not None:
            self.metrics['read_bytes'] += sum(value_size(v) for v in row)
            self.metrics['rows'] += 1
        return row

    def fetchone(self):
        return self.measure(self.cursor.fetchone())

    def fetchmany(self, *args):
        return [self.measure(row) for row in self.cursor.fetchmany(*args)]

    def fetchall(self):
        return [self.measure(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        return self

    def __next__(self):
        row = self.fetchone()
        if row is None:
            raise StopIteration
        return row


def instrument_database(database):
    if getattr(database, '_admin_measured', False):
        return
    original = database.execute_sql

    def execute(sql, params=None, *args, **kwargs):
        operation = sql.lstrip().split(None, 1)[0].upper()
        mutation = operation in {'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'ALTER', 'DROP'}
        if mutation:
            invalidate()  # Also catches writes made by background workers.
        metrics = current.get()
        start = monotonic()
        try:
            cursor = original(sql, params, *args, **kwargs)
        finally:
            if mutation:
                invalidate()
            if metrics is not None:
                metrics['queries'] += 1
                metrics['sql_ms'] += (monotonic() - start) * 1000
        return MeasuredCursor(cursor, metrics) if metrics is not None else cursor

    database.execute_sql = execute
    for name in ('commit', 'rollback'):
        original_method = getattr(database, name)

        def complete(*args, _method=original_method, **kwargs):
            try:
                return _method(*args, **kwargs)
            finally:
                invalidate()

        setattr(database, name, complete)
    database._admin_measured = True


class DiagnosticsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        metrics = dict(queries=0, rows=0, read_bytes=0, sql_ms=0.0, response_bytes=0)
        token = current.set(metrics)
        start = monotonic()

        async def measured_send(message):
            if message['type'] == 'http.response.body':
                metrics['response_bytes'] += len(message.get('body', b''))
            await send(message)
        try:
            await self.app(scope, receive, measured_send)
        finally:
            # Route template has no card IDs, filenames, search terms or PII.
            route = scope.get('route')
            if route and scope['path'].startswith('/api/'):
                metrics['operation'] = scope['method'] + ' ' + route.path
                metrics['elapsed_ms'] = round((monotonic() - start) * 1000, 2)
                with lock:
                    recent.append(metrics)
            current.reset(token)


def snapshot():
    with lock:
        records = list(recent)
    return {'approximate_read_bytes': True, 'window_requests': len(records),
            'queries': sum(r['queries'] for r in records),
            'read_bytes': sum(r['read_bytes'] for r in records),
            'response_bytes': sum(r['response_bytes'] for r in records),
            'heaviest': sorted(records, key=lambda r: r['read_bytes'], reverse=True)[:10]}
