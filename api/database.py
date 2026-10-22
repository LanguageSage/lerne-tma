import os
import logging
from urllib.parse import urlparse, parse_qs, unquote
from peewee import Proxy, OperationalError, ImproperlyConfigured, PostgresqlDatabase
from dotenv import load_dotenv
from api.local_runtime import configure_local, is_local, local_config, validate_database_url

configure_local()
if not is_local():
    load_dotenv()
    if is_local():
        raise RuntimeError('Enable LERNE_MODE=LOCAL explicitly in the process environment, not in the repository .env')
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


def _parse_db_url(url: str) -> dict:
    """Parses SUPABASE_DB_URL into connection parameters."""
    parsed = urlparse(url)
    if (os.environ.get('VERCEL') or os.environ.get('VERCEL_ENV')
            or os.environ.get('ENVIRONMENT', '').lower() == 'production'):
        import ipaddress
        host = (parsed.hostname or '').lower().rstrip('.')
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = host == 'localhost' or host.endswith('.localhost')
        if not host or loopback or parsed.path == '/lerne_tma_local':
            raise RuntimeError('Production cannot connect to the LOCAL database')
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


def initialize_database() -> bool:
    """Initializes the tma_db and lerne_db proxies with the best available PostgreSQL driver."""
    global tma_db, lerne_db
    if is_local():
        url = validate_database_url(local_config()['database_url'])
        actual_db = PostgresqlDatabase(
            url.path.lstrip('/'), user=unquote(url.username), password=unquote(url.password),
            host='127.0.0.1' if url.hostname == 'localhost' else url.hostname,
            port=url.port or 5432, connect_timeout=5, sslmode='disable')
        tma_db.initialize(actual_db)
        lerne_db.initialize(actual_db)
        return True
    supabase_url = os.environ.get("SUPABASE_DB_URL")
    if not supabase_url:
        logger.error("FATAL: SUPABASE_DB_URL is not set.")
        return False

    db_params = _parse_db_url(supabase_url)
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
            actual_db = db_connect(supabase_url)
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
