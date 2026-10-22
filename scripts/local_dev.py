"""Local PostgreSQL lifecycle. Never reads repository .env files or cloud secrets."""
import argparse
from datetime import datetime, timezone
import json
import importlib.util
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import unquote
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from api.local_runtime import (DEFAULT_DATA_ROOT, LOCAL_DATABASE, LOCAL_USER_ID,
                               external_path, local_config, validate_database_url)

VOLUME = 'lerne_tma_local_pgdata'


def initialize_config():
    root = external_path(os.environ.get('LERNE_DATA_ROOT', str(DEFAULT_DATA_ROOT)))
    path = external_path(os.environ.get('LERNE_LOCAL_CONFIG', str(root / 'config/local.json')))
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        config = {'driver': 'docker',
                  'database_url': f'postgresql://lerne_local:{secrets.token_urlsafe(32)}@127.0.0.1:55432/{LOCAL_DATABASE}',
                  'login_secret': secrets.token_urlsafe(32), 'pg_bin': ''}
        with path.open('x', encoding='utf-8') as stream:
            json.dump(config, stream, indent=2)
        print(f'Created private configuration: {path}')
    return local_config()


def environment(config):
    # Subprocesses inherit OS runtime variables, never application credentials.
    allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE',
               'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
               'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(LERNE_MODE='LOCAL', LERNE_DATA_ROOT=str(config['data_root']),
               LERNE_LOCAL_CONFIG=str(config['config_path']),
               LERNE_LOCAL_DATABASE_URL=config['database_url'], PYTHON_DOTENV_DISABLED='1',
               LERNE_SKIP_SCHEMA_INIT='1', ENVIRONMENT='development',
               VITE_LERNE_LOCAL='1', VITE_API_URL='/api', VITE_DEV_API_TARGET='http://127.0.0.1:8001')
    for key in ('media', 'backups', 'test_data', 'postgres'):
        env['LERNE_LOCAL_' + key.upper() + '_DIR'] = str(config[key])
    url = validate_database_url(config['database_url'])
    env.update(PGHOST='127.0.0.1' if url.hostname == 'localhost' else url.hostname,
               PGPORT=str(url.port or 5432), PGUSER=unquote(url.username),
               PGPASSWORD=unquote(url.password), PGDATABASE=LOCAL_DATABASE,
               PGCONNECT_TIMEOUT='5', PGSSLMODE='disable',
               LERNE_PG_PASSWORD=unquote(url.password), LERNE_PG_PORT=str(url.port or 5432))
    return env


def run(command, config, **kwargs):
    # Do not echo commands or exception reprs containing credentials.
    result = subprocess.run(command, cwd=ROOT, env=environment(config), **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(command[0]).name} failed (exit {result.returncode})')
    return result


def compose(config, *args, **kwargs):
    url = validate_database_url(config['database_url'])
    if unquote(url.username) != 'lerne_local':
        raise RuntimeError('Docker requires database user lerne_local')
    if not shutil.which('docker'):
        raise RuntimeError('Docker Desktop not found. Install/start it, or set driver=native in the external config; see docs/LOCAL_DEVELOPMENT.md')
    return run(['docker', 'compose', '--env-file', os.devnull, '-f', str(ROOT / 'compose.local.yaml'), *args], config, **kwargs)


def pg_tool(config, name):
    configured = config.get('pg_bin')
    path = str(Path(configured) / (name + ('.exe' if os.name == 'nt' else ''))) if configured else shutil.which(name)
    if not path or not Path(path).is_file():
        raise RuntimeError(f'{name} not found. Set pg_bin in {config["config_path"]} to your PostgreSQL bin directory.')
    return path


def pg_command(config, name, *args):
    if config['driver'] == 'docker':
        return ['docker', 'compose', '--env-file', os.devnull, '-f', str(ROOT / 'compose.local.yaml'),
                'exec', '-T', 'postgres', name, '-U', 'lerne_local', '-d', LOCAL_DATABASE, *args]
    return [pg_tool(config, name), '-d', LOCAL_DATABASE, *args]


def native_init(config):
    pgdata = config['postgres']
    if any(pgdata.iterdir()):
        raise RuntimeError('PGDATA is not empty; refusing initdb')
    # initdb reads a password file; it is temporary and outside the repository.
    password_file = config['data_root'] / ('initdb-' + secrets.token_hex(8) + '.txt')
    password_file.write_text(unquote(validate_database_url(config['database_url']).password), encoding='utf-8')
    try:
        run([pg_tool(config, 'initdb'), '-D', str(pgdata), '-U', environment(config)['PGUSER'],
             '--auth=scram-sha-256', '--encoding=UTF8', '--pwfile=' + str(password_file)], config)
    finally:
        password_file.unlink(missing_ok=True)
    with (pgdata / 'postgresql.conf').open('a', encoding='utf-8') as stream:
        stream.write(f"\nlisten_addresses = '127.0.0.1'\nport = {environment(config)['PGPORT']}\n")
    native_start(config)
    env = environment(config)
    env['PGDATABASE'] = 'postgres'
    result = subprocess.run([pg_tool(config, 'createdb'), LOCAL_DATABASE], cwd=ROOT, env=env)
    if result.returncode:
        raise RuntimeError('createdb failed')


def native_start(config):
    if not (config['postgres'] / 'PG_VERSION').exists():
        raise RuntimeError('Native PGDATA is not initialized. Run local_dev.py init-native first.')
    status = subprocess.run([pg_tool(config, 'pg_ctl'), '-D', str(config['postgres']), 'status'],
                            env=environment(config), capture_output=True)
    if status.returncode:
        run([pg_tool(config, 'pg_ctl'), '-D', str(config['postgres']),
             '-l', str(config['data_root'] / 'postgres.log'), '-w', 'start'], config)


def database(config):
    os.environ.update(environment(config))
    from api.local_runtime import configure_local
    configure_local()
    from api import models
    models.initialize_database()
    if config['driver'] == 'native':
        actual = models.tma_db.execute_sql('SHOW data_directory').fetchone()[0]
        if external_path(actual) != config['postgres']:
            raise RuntimeError('Native PostgreSQL data_directory differs from configured external PGDATA; operation blocked')
    return models


def verify_database(models, *, allow_empty=False):
    db = models.tma_db
    if db.execute_sql('SELECT current_database()').fetchone()[0] != LOCAL_DATABASE:
        raise RuntimeError('Unexpected database; operation blocked')
    tables = set(db.get_tables())
    if not tables and allow_empty:
        return
    marker = models.TMASetting.get_or_none(models.TMASetting.key == 'LOCAL_DATABASE_MARKER') if models.TMASetting._meta.table_name in tables else None
    if not marker or marker.value != 'lerne-local-v1':
        raise RuntimeError('Unmarked database; operation blocked. Use a new empty local database.')


def prepare(config):
    models = database(config)
    verify_database(models, allow_empty=True)
    # Establish ownership before migrations, so interrupted fresh bootstrap can resume.
    models.tma_db.create_tables([models.TMASetting], safe=True)
    models.TMASetting.get_or_create(key='LOCAL_DATABASE_MARKER', defaults={'value': 'lerne-local-v1'})
    models.create_all_tables()
    with models.tma_db.atomic():
        if not models.TMASetting.get_or_none(models.TMASetting.key == 'LOCAL_SEED_V1'):
            user, _ = models.TMAUser.get_or_create(user_id=LOCAL_USER_ID, defaults={
                'first_name': 'Local Test', 'username': 'local_test', 'is_guest': False,
                'default_decks_initialized': True, 'has_selected_language': True,
                'active_language': 'de', 'native_language': 'ru'})
            models.TMAAuthAccount.get_or_create(user=user.user_id)
            for name in ('Немецкий — LOCAL', 'Импорт — LOCAL'):
                folder = models.TMA_Folder.create(user_id=user.user_id, name=name)
                deck = models.TMA_Deck.create(user_id=user.user_id, folder=folder, name=name)
                for position, (front, back, card_type) in enumerate([
                    ('Guten Morgen', '**Доброе утро**\n\n- Пример Markdown', 'translation'),
                    ('Was passt?\n@quiz\n* das Haus\n  die Haus', 'das Haus', 'quiz'),
                    ('@theory\n## Artikel\n**das Haus**', 'Теория', 'theory')]):
                    models.TMA_Card.create(deck=deck, front_text=front, back_text=back,
                        context='## Контекст\n\nEin **Beispiel**.', card_type=card_type, position=position)
            models.TMASetting.create(key='LOCAL_SEED_V1', value='1')
    models.tma_db.close()
    print('Local schema/auth migrations ready. Synthetic seed preserved on restart.')


def backup(config):
    models = database(config)
    verify_database(models)
    models.tma_db.close()
    name = 'lerne-local-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.dump'
    path = config['backups'] / name
    temporary = path.with_suffix('.partial')
    try:
        with temporary.open('xb') as stream:
            run(pg_command(config, 'pg_dump', '--format=custom', '--no-owner', '--no-acl'), config, stdout=stream)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Backup: {path}')
    return path


def confirm(action):
    if input(f'{action} replaces ONLY the local test database. Type {LOCAL_DATABASE}: ').strip() != LOCAL_DATABASE:
        raise RuntimeError('Cancelled; no data changed')


def restore(config, source):
    path = external_path(source)
    if not path.is_file():
        raise RuntimeError('Backup file not found')
    # Validate archive before asking and before changing the target.
    with path.open('rb') as stream:
        run(pg_command(config, 'pg_restore', '--list'), config, stdin=stream, stdout=subprocess.DEVNULL)
    confirm('Restore (stop API and frontend first)')
    backup(config)
    with path.open('rb') as stream:
        run(pg_command(config, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl',
                       '--exit-on-error', '--single-transaction'), config, stdin=stream)
    models = database(config)
    verify_database(models)
    models.tma_db.close()
    print('Database restored. Restart browser with ?reset=1 and clear LOCAL IndexedDB before syncing.')


def reset(config):
    confirm('Reset (stop API and frontend first)')
    backup(config)
    models = database(config)
    verify_database(models)
    with models.tma_db.atomic():
        models.tma_db.execute_sql('DROP SCHEMA public CASCADE')
        models.tma_db.execute_sql('CREATE SCHEMA public')
    models._tables_created = False
    models.tma_db.close()
    prepare(config)
    print('Only local test schema reset. Clear LOCAL browser IndexedDB before reconnecting.')


def paths(config):
    if config['driver'] == 'docker':
        print(f'PostgreSQL: Docker-managed volume {VOLUME}, container /var/lib/postgresql/data')
        if shutil.which('docker'):
            run(['docker', 'volume', 'inspect', VOLUME, '--format', '{{.Mountpoint}}'], config)
        print('Windows physical disk: Docker Desktop Linux VM disk; see Settings > Resources > Advanced > Disk image location.')
    else:
        print(f'PostgreSQL PGDATA: {config["postgres"]}')
    for key in ('media', 'backups', 'test_data', 'config_path'):
        print(f'{key}: {config[key]}')


def start(config):
    missing = [name for name in ('fastapi', 'uvicorn', 'peewee', 'psycopg2', 'dotenv', 'multipart')
               if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError('Missing Python packages: ' + ', '.join(missing) + '; install requirements-test.txt in venv')
    for port in (8001, 5173):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError(f'Port {port} is occupied. Stop its owner or use another session; no process was killed.') from None
    if not shutil.which('node') or not shutil.which('npm') or not (ROOT / 'app/node_modules').exists():
        raise RuntimeError('Node/npm and app/node_modules required. Run npm --prefix app ci first.')
    if config['driver'] == 'docker':
        compose(config, 'up', '-d', '--wait', '--wait-timeout', '90')
    else:
        native_start(config)
    prepare(config)
    env = environment(config)
    processes = []
    try:
        processes.append(subprocess.Popen([sys.executable, '-m', 'uvicorn', 'api.main:app',
            '--host', '127.0.0.1', '--port', '8001'], cwd=ROOT, env=env))
        # Run Vite through Node directly; no shell interpolation of local paths.
        processes.append(subprocess.Popen(['node', str(ROOT / 'app/node_modules/vite/bin/vite.js'),
            '--mode', 'local', '--host', '127.0.0.1', '--strictPort'], cwd=ROOT / 'app', env=env))
        for _ in range(100):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError('A local server stopped; inspect the output above')
            try:
                with socket.create_connection(('127.0.0.1', 5173), timeout=.2), socket.create_connection(('127.0.0.1', 8001), timeout=.2):
                    break
            except OSError:
                time.sleep(.2)
        else:
            raise RuntimeError('Local servers did not become ready')
        paths(config)
        webbrowser.open('http://127.0.0.1:5173')
        print('LOCAL running. Ctrl+C stops these API/frontend processes; PostgreSQL data remains.')
        while all(p.poll() is None for p in processes):
            time.sleep(.5)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def main():
    if os.environ.get('VERCEL') or os.environ.get('VERCEL_ENV') or os.environ.get('ENVIRONMENT', '').lower() == 'production':
        raise RuntimeError('Local commands cannot run on Vercel or in Production')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'init-native', 'start', 'prepare', 'backup', 'restore', 'reset', 'stop-db', 'paths'])
    parser.add_argument('file', nargs='?')
    args = parser.parse_args()
    config = initialize_config()
    if args.command == 'init':
        paths(config)
    elif args.command == 'init-native':
        if config['driver'] != 'native':
            raise RuntimeError('Set driver=native in external config before init-native')
        native_init(config)
    elif args.command == 'stop-db':
        if config['driver'] == 'docker':
            compose(config, 'stop')
        else:
            run([pg_tool(config, 'pg_ctl'), '-D', str(config['postgres']), '-m', 'fast', '-w', 'stop'], config)
    elif args.command == 'restore':
        if not args.file:
            raise RuntimeError('Provide an absolute path to a trusted local .dump file')
        restore(config, args.file)
    else:
        globals()[args.command](config)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nLocal servers stopped.')
    except Exception as exc:
        # Database exceptions can include credentials; only our explicit errors are printable.
        print(f'LOCAL ERROR: {exc}' if type(exc) is RuntimeError else f'LOCAL ERROR: {type(exc).__name__}; check local prerequisites/configuration (credentials hidden).', file=sys.stderr)
        raise SystemExit(1)
