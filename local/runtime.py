"""Fail-closed configuration for the opt-in, loopback-only development runtime."""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = PROJECT_ROOT.parent / 'data'
LOOPBACK = {'127.0.0.1', 'localhost', '::1'}
LOCAL_DATABASE = 'lerne_tma_local'
LOCAL_USER_ID = 900000001
_configured = False


from api.local_runtime import is_local


def external_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise RuntimeError('LOCAL paths must be absolute and outside the Git repository')
    path = path.resolve()
    if path == PROJECT_ROOT or PROJECT_ROOT in path.parents:
        raise RuntimeError('LOCAL persistent data must be outside the Git repository')
    return path


def validate_database_url(value):
    try:
        url = urlsplit(value)
        if (url.scheme not in ('postgres', 'postgresql') or url.hostname not in LOOPBACK
                or url.path != '/' + LOCAL_DATABASE or url.query or url.fragment
                or not url.username or not url.password or not 1 <= (url.port or 5432) <= 65535):
            raise ValueError()
    except (ValueError, TypeError):
        raise RuntimeError('LOCAL requires a PostgreSQL URL on localhost/127.0.0.1/::1, '
                           'database lerne_tma_local, credentials, and no URL options') from None
    return url


def local_config(*, create_dirs=True):
    root = external_path(os.environ.get('LERNE_DATA_ROOT', str(DEFAULT_DATA_ROOT)))
    config_path = external_path(os.environ.get('LERNE_LOCAL_CONFIG', str(root / 'config/local.json')))
    config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    config['config_path'] = config_path
    config['data_root'] = root
    for key, default in (('media', 'media'), ('backups', 'backups'),
                         ('test_data', 'test-data'), ('postgres', 'postgres')):
        config[key] = external_path(os.environ.get('LERNE_LOCAL_' + key.upper() + '_DIR',
                                                   config.get(key, str(root / default))))
    config['database_url'] = os.environ.get('LERNE_LOCAL_DATABASE_URL', config.get('database_url', ''))
    validate_database_url(config['database_url'])
    if config.get('driver', 'docker') not in ('docker', 'native'):
        raise RuntimeError('LOCAL driver must be docker or native')
    config.setdefault('driver', 'docker')
    if config['driver'] == 'docker' and validate_database_url(config['database_url']).hostname == '::1':
        raise RuntimeError('Docker LOCAL publishes PostgreSQL on 127.0.0.1; use that host in database_url')
    if not isinstance(config.get('login_secret'), str) or len(config['login_secret']) < 32:
        raise RuntimeError('LOCAL login_secret is missing/invalid; run local_dev.py init or repair the external config')
    if create_dirs:
        for key in ('data_root', 'media', 'backups', 'test_data', 'postgres'):
            config[key].mkdir(parents=True, exist_ok=True)
        for folder in ('images', 'audio', 'videos', 'backgrounds'):
            (config['media'] / folder).mkdir(exist_ok=True)
    return config


def _network_audit(event, args):
    # Run before DNS resolution or a connection, including requests/aiohttp/TTS.
    if event == 'socket.getaddrinfo':
        host = args[0]
    elif event in ('socket.connect', 'socket.sendto'):
        address = args[-1]
        if not isinstance(address, tuple):
            raise RuntimeError('External services disabled in LOCAL')
        host = address[0]
    else:
        return
    if host not in LOOPBACK:
        raise RuntimeError('External services disabled in LOCAL')


def configure_local():
    global _configured
    if not is_local() or _configured:
        return
    if (os.environ.get('VERCEL') or os.environ.get('VERCEL_ENV')
            or os.environ.get('ENVIRONMENT', '').lower() == 'production'
            or os.environ.get('NODE_ENV', '').lower() == 'production'):
        raise RuntimeError('LOCAL cannot run on Vercel or in Production')
    config = local_config()
    # No ordinary .env or inherited cloud credentials participate in LOCAL.
    os.environ['PYTHON_DOTENV_DISABLED'] = '1'
    for key in list(os.environ):
        if key.startswith(('SUPABASE_', 'GOOGLE_', 'TELEGRAM_', 'OPENAI_', 'GROQ_', 'OPENROUTER_')) or key in ('BOT_TOKEN', 'DATABASE_URL'):
            os.environ.pop(key, None)
    # Native libpq does not use Python sockets: the URL is validated independently.
    os.environ['LERNE_LOCAL_DATABASE_URL'] = config['database_url']
    os.environ['ADMIN_USER_ID'] = str(LOCAL_USER_ID)
    sys.addaudithook(_network_audit)
    _configured = True


def media_file(folder, filename):
    root = local_config()['media']
    if folder not in ('images', 'audio', 'videos', 'backgrounds') or Path(filename).name != filename or '\\' in filename:
        raise ValueError('Invalid local media path')
    path = (root / folder / filename).resolve()
    if root not in path.parents:
        raise ValueError('Invalid local media path')
    return path
