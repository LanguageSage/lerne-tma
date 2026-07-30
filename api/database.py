import os
import logging
from contextlib import contextmanager
from urllib.parse import urlparse, parse_qs
from peewee import Proxy, OperationalError, ImproperlyConfigured, PostgresqlDatabase

try:
    from playhouse.pool import PooledPostgresqlDatabase
    from playhouse.db_url import connect as db_url_connect
except Exception:
    PooledPostgresqlDatabase = None
    db_url_connect = None

try:
    import pg8000
    _HAS_PG8000 = True
except ImportError:
    _HAS_PG8000 = False

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

tma_db = Proxy()
lerne_db = Proxy()

_pool = None


class Pg8000Database(PostgresqlDatabase):
    def _connect(self):
        if not _HAS_PG8000:
            raise ImproperlyConfigured('pg8000 driver not installed')
        import pg8000
        params = self.connect_params.copy()
        if 'dbname' in params:
            params['database'] = params.pop('dbname')
        if 'port' in params and params['port']:
            params['port'] = int(params['port'])
        if 'sslmode' in params:
            params.pop('sslmode')
        params['ssl_context'] = True
        conn = pg8000.connect(**params)
        conn.autocommit = True
        return conn


def _parse_db_url(url: str):
    parsed = urlparse(url)
    params = {
        'database': parsed.path.lstrip('/'),
        'user': parsed.username,
        'password': parsed.password,
        'host': parsed.hostname,
        'port': parsed.port or 5432,
    }
    qs = parse_qs(parsed.query)
    if 'sslmode' in qs:
        params['sslmode'] = qs['sslmode'][0]
    return params


if PooledPostgresqlDatabase:
    class AutoReconnectPostgresqlDatabase(PooledPostgresqlDatabase):
        def execute_sql(self, sql, params=None, commit=True):
            try:
                return super().execute_sql(sql, params, commit)
            except Exception as exc:
                err_str = str(exc).lower()
                if any(k in err_str for k in ["closed", "terminated", "connection", "socket", "reset", "eof"]):
                    logger.warning(f"DB connection dropped ({exc}). Auto-reconnecting and retrying Peewee query...")
                    try:
                        self.close()
                    except Exception:
                        pass
                    return super().execute_sql(sql, params, commit)
                raise
else:
    class AutoReconnectPostgresqlDatabase(PostgresqlDatabase):
        def execute_sql(self, sql, params=None, commit=True):
            try:
                return super().execute_sql(sql, params, commit)
            except Exception as exc:
                err_str = str(exc).lower()
                if any(k in err_str for k in ["closed", "terminated", "connection", "socket", "reset", "eof"]):
                    logger.warning(f"DB connection dropped ({exc}). Auto-reconnecting and retrying Peewee query...")
                    try:
                        self.close()
                    except Exception:
                        pass
                    return super().execute_sql(sql, params, commit)
                raise


def _create_pool():
    global _pool
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL not set")

    db_params = _parse_db_url(url)

    for driver_name, factory in [
        ("psycopg2_pool", lambda: AutoReconnectPostgresqlDatabase(
            max_connections=8, stale_timeout=300, autorollback=True, **db_params)),
        ("db_url", lambda: db_url_connect(url)) if db_url_connect else None,
        ("pg8000", lambda: Pg8000Database(
            database=db_params['database'],
            user=db_params['user'],
            password=db_params['password'],
            host=db_params['host'],
            port=db_params['port'],
            autorollback=True)),
    ]:
        if factory is None:
            continue
        try:
            _pool = factory()
            _pool.connect()
            logger.info(f"DB pool initialized via {driver_name}")
            return _pool
        except Exception as e:
            logger.warning(f"Driver {driver_name} failed: {e}")

    raise RuntimeError("All DB drivers failed")


def get_db():
    global _pool
    if _pool is None:
        _create_pool()
    elif _pool.is_closed():
        _pool.connect(reuse_if_open=True)
    return _pool


def init_proxies():
    db = get_db()
    tma_db.initialize(db)
    lerne_db.initialize(db)


@contextmanager
def transaction():
    db = get_db()
    with db.atomic() as txn:
        try:
            yield txn
        except OperationalError:
            db.close()
            raise


# MODELS list moved here to avoid circular import
MODELS = [
    'TMAProgress', 'TMAReviewHistory', 'TMASetting', 'TMAUserPrompt',
    'TMAMedia', 'TMAFeedback', 'TMAUser', 'TMALinkedSession',
    'LibraryCategory', 'Deck', 'Card', 'TMA_Folder', 'TMA_Deck', 'TMA_Card', 'TMACustomPrompt'
]


if os.environ.get("VERCEL"):
    try:
        init_proxies()
    except Exception as e:
        logger.error(f"Vercel warm-up failed: {e}")