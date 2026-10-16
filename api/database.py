import os
import logging
import re
from urllib.parse import urlparse, parse_qs, unquote
from peewee import Proxy, OperationalError, ImproperlyConfigured, PostgresqlDatabase
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

tma_db = Proxy()
lerne_db = Proxy()

try:
    from playhouse.pool import PooledPostgresqlDatabase
    from playhouse.db_url import connect as db_connect
except Exception:
    PooledPostgresqlDatabase = None
    db_connect = None

try:
    import pg8000
    _HAS_PG8000 = True
except ImportError:
    _HAS_PG8000 = False


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


def _safe_split_db_url(url: str) -> dict:
    """Safely extracts scheme, user, password, host, port, path, query from a database URL,
    handling bracketed passwords or special characters that fail standard urllib.parse."""
    try:
        parsed = urlparse(url)
        return {
            'scheme': parsed.scheme,
            'user': unquote(parsed.username or ''),
            'password': unquote(parsed.password or ''),
            'host': parsed.hostname or '',
            'port': parsed.port or 5432,
            'path': parsed.path,
            'query': parsed.query,
            'fragment': parsed.fragment,
        }
    except ValueError:
        m = re.match(
            r'^(?P<scheme>[a-zA-Z0-9+_-]+)://(?P<user>[^:]+):(?P<password>.+?)@(?P<host>[^:/]+)(?::(?P<port>\d+))?(?P<path>/[^?#]*)?(?:\?(?P<query>[^#]*))?$',
            url or ''
        )
        if not m:
            raise
        pwd = unquote(m.group('password'))
        return {
            'scheme': m.group('scheme'),
            'user': unquote(m.group('user')),
            'password': pwd,
            'host': m.group('host') or '',
            'port': int(m.group('port')) if m.group('port') else 5432,
            'path': m.group('path') or '/',
            'query': m.group('query') or '',
            'fragment': '',
        }


def _parse_db_url(url: str) -> dict:
    """Parses SUPABASE_DB_URL into connection parameters."""
    parsed = _safe_split_db_url(url)
    pwd = parsed['password']
    if pwd.startswith('[') and pwd.endswith(']') and len(pwd) > 2:
        pwd = pwd[1:-1]
    params = {
        'database': parsed['path'].lstrip('/'),
        'user': parsed['user'],
        'password': pwd,
        'host': parsed['host'],
        'port': parsed['port'],
    }
    if parsed['query']:
        qs = parse_qs(parsed['query'])
        if 'sslmode' in qs:
            params['sslmode'] = qs['sslmode'][0]
    return params


def initialize_database() -> bool:
    """Initializes the tma_db and lerne_db proxies with the best available PostgreSQL driver."""
    global tma_db, lerne_db
    supabase_url = os.environ.get("SUPABASE_DB_URL")
    if os.getenv('LERNE_DEPLOYMENT') == 'game-test':
        ref = 'rkkviifehykdeugovlgp'
        try:
            parsed = _safe_split_db_url(supabase_url or '')
        except Exception:
            raise RuntimeError('Game Test blocked: invalid database URL format')
        pwd = parsed['password']
        if pwd.startswith('[') and pwd.endswith(']') and len(pwd) > 2:
            pwd = pwd[1:-1]
        host = parsed['host']
        direct = host == f'db.{ref}.supabase.co'
        pool = host.endswith('.pooler.supabase.com') and parsed['user'] == f'postgres.{ref}'
        if (parsed['scheme'] not in ('postgres', 'postgresql') or not pwd
                or parsed['path'] != '/postgres' or parsed['query'] or parsed['fragment'] or not (direct or pool)
                or os.getenv('SUPABASE_URL', '').rstrip('/') != f'https://{ref}.supabase.co'):
            raise RuntimeError('Game Test blocked: isolated database/storage target is required')
        if pwd.upper() in ('[YOUR-PASSWORD]', 'YOUR-PASSWORD', '[PASSWORD]', 'PASSWORD'):
            raise RuntimeError('Game Test blocked: SUPABASE_DB_URL contains placeholder password; provide actual database password')
        if os.getenv('RUN_MIGRATIONS', '').lower() not in ('false', '0'):
            raise RuntimeError('Game Test blocked: startup migrations must be disabled')
    if not supabase_url:
        logger.error("FATAL: SUPABASE_DB_URL is not set.")
        return False

    db_params = _parse_db_url(supabase_url)
    if os.getenv('LERNE_DEPLOYMENT') == 'game-test':
        db_params['sslmode'] = 'require'
    logger.info("DATABASE: Initializing Postgres connection...")

    # 1. Standard Peewee PooledPostgresqlDatabase (psycopg2)
    if PooledPostgresqlDatabase is not None:
        try:
            actual_db = PooledPostgresqlDatabase(
                autorollback=True, max_connections=20, stale_timeout=300, **db_params
            )
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via PooledPostgresqlDatabase (psycopg2)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE PooledPostgresqlDatabase setup failed: {e}")

    # 2. Standard Peewee db_connect (psycopg2)
    if db_connect is not None:
        try:
            actual_db = (db_connect(supabase_url, sslmode='require')
                         if os.getenv('LERNE_DEPLOYMENT') == 'game-test' else db_connect(supabase_url))
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via db_url (psycopg2)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE db_url setup failed: {e}")

    # 3. Pg8000 pure Python fallback (Vercel serverless compatible)
    if _HAS_PG8000:
        try:
            actual_db = Pg8000Database(
                database=db_params['database'],
                user=db_params['user'],
                password=db_params['password'],
                host=db_params['host'],
                port=db_params['port'],
                autorollback=True
            )
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via Pg8000Database (pg8000)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE Pg8000Database setup failed: {e}")

    logger.error("DATABASE: All PostgreSQL connection attempts failed.")
    return False

# Backward compatibility alias
init_proxies = initialize_database
