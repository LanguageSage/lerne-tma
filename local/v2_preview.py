"""Persistent, isolated Native V2 acceptance launcher. Never loads ordinary LOCAL config."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DATA = ROOT.parent / 'data' / 'v2-preview'


def validate_config(config):
    from local.runtime import validate_database_url
    url = validate_database_url(config['database_url'])
    if (config.get('purpose') != 'native-v2-preview' or config['driver'] != 'native'
            or url.hostname != '127.0.0.1' or url.port != 55433 or url.username != 'cards_test'
            or config['data_root'].resolve() != DATA.resolve()
            or config['postgres'].resolve() != (DATA / 'postgres').resolve()):
        raise RuntimeError('Only the separate V2 preview configuration is accepted')


def configure():
    if os.environ.get('VERCEL') or os.environ.get('ENVIRONMENT', '').lower() == 'production':
        raise RuntimeError('Preview is available only locally')
    os.environ.update(LERNE_MODE='LOCAL', LERNE_DATA_ROOT=str(DATA),
                      LERNE_LOCAL_CONFIG=str(DATA / 'config/local.json'), PYTHON_DOTENV_DISABLED='1')
    # Ignore inherited targets, including the ordinary LOCAL database.
    for key in list(os.environ):
        if key.startswith('LERNE_LOCAL_') and key != 'LERNE_LOCAL_CONFIG':
            os.environ.pop(key)


def provision(source):
    from local import dev
    source = source.resolve(strict=True)
    binaries = ROOT.parent / 'tools/pgsql/bin'
    subprocess.run([str(binaries / 'pg_restore.exe'), '--list', str(source)],
                   check=True, stdout=subprocess.DEVNULL)
    if DATA.exists():
        config = dev.local_config()
        validate_config(config)
        models = dev.database(config)
        try:
            if models.tma_db.get_tables():
                raise RuntimeError('Preview database is not empty; refusing to overwrite it')
        finally:
            models.tma_db.close()
    else:
        (DATA / 'config').mkdir(parents=True)
        config = {'driver': 'native', 'purpose': 'native-v2-preview',
                  'pg_bin': str(binaries), 'login_secret': secrets.token_urlsafe(32),
                  'database_url': 'postgresql://cards_test:' + secrets.token_urlsafe(32)
                                  + '@127.0.0.1:55433/lerne_tma_local'}
        (DATA / 'config/local.json').write_text(json.dumps(config, indent=2), encoding='utf8')
        config = dev.local_config()
        validate_config(config)
        dev.native_init(config)
        dev.run(dev.pg_command(config, 'psql', '-c',
                'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE postgres;'), config)
    # This newly created empty cluster is the only restore target.
    dev.run(dev.pg_command(config, 'psql', '-c', 'CREATE SCHEMA IF NOT EXISTS public'), config)
    listed = subprocess.run([str(binaries / 'pg_restore.exe'), '--list', str(source)],
                            check=True, capture_output=True).stdout.decode('utf8')
    selection = DATA / 'restore.list'
    selection.write_text('\n'.join(line for line in listed.splitlines()
                                   if ' SCHEMA - public ' not in line) + '\n', encoding='utf8')
    dev.run(dev.pg_command(config, 'pg_restore', '--no-owner', '--no-acl',
                           '--single-transaction', '--exit-on-error', '--use-list', str(selection), str(source)), config)
    models = dev.database(config)
    try:
        history = {r[0] for r in models.tma_db.execute_sql('SELECT migration_id FROM tma_migration_history')}
        if not set(range(92, 98)) <= history:
            raise RuntimeError('Prepared V2 archive must include migrations 92–97')
        normalize_scope_constraint(models)
        with models.tma_db.atomic():
            for key, value in [('LOCAL_DATABASE_MARKER', 'lerne-local-v1'),
                               ('V2_PREVIEW_COPY', 'native-v2-preview')]:
                models.TMASetting.insert(key=key, value=value).on_conflict(
                    conflict_target=[models.TMASetting.key], update={models.TMASetting.value: value}).execute()
            from api.services.sync_generation import mark_database_restored
            mark_database_restored(models.tma_db)
        restore_media(config, models)
    finally:
        models.tma_db.close()
    print('Preview copy restored. Source SHA256:', hashlib.file_digest(source.open('rb'), 'sha256').hexdigest())


def restore_media(config, models):
    """Resume file restoration without replacing the database or its user changes."""
    from concurrent.futures import ThreadPoolExecutor
    storage = ROOT.parent / 'data/backups/supabase_storage_backup'
    manifest = json.loads((storage / 'manifest.json').read_text(encoding='utf8'))
    selected = {}
    # Match the existing LOCAL audio URL policy: audio takes precedence over tma-audio.
    for item in sorted(manifest['files'], key=lambda item: item['bucket'] == 'tma-audio'):
        bucket, name = item['bucket'], item['name']
        origin = (storage / bucket / name).resolve()
        if bucket not in ('audio', 'tma-audio', 'images') or not origin.is_relative_to((storage / bucket).resolve()):
            raise RuntimeError('Unsupported Storage backup path')
        target = config['media'] / ('audio' if bucket == 'tma-audio' else bucket) / Path(name).name
        selected.setdefault(target, item)

    def verify_source(item):
        with (storage / item['bucket'] / item['name']).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise RuntimeError('Storage backup checksum mismatch')

    def copy_selected(entry):
        target, item = entry
        if not target.exists():
            shutil.copyfile(storage / item['bucket'] / item['name'], target)
        with target.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise RuntimeError('Restored media checksum mismatch')

    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(verify_source, manifest['files']))
        list(workers.map(copy_selected, selected.items()))
    embedded = 0
    for folder, filename, content in models.tma_db.execute_sql(
            'SELECT folder,filename,content FROM tmamedia WHERE octet_length(content)>0'):
        if folder not in ('audio', 'images', 'videos', 'backgrounds', 'previews') or Path(filename).name != filename:
            raise RuntimeError('Unsupported embedded media path')
        (config['media'] / folder).mkdir(exist_ok=True)
        (config['media'] / folder / filename).write_bytes(bytes(content))
        embedded += 1
    print(f'Offline Storage backup validated: {len(manifest["files"])} files; {len(selected)} local files; {embedded} embedded DB files.')


def normalize_scope_constraint(models):
    # pg_dump/restore distributes varchar casts over ARRAY elements. Admin's
    # exact catalog profile expects the original migration96 parse tree.
    db = models.tma_db
    with db.atomic():
        row = db.execute_sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                             "WHERE conrelid='tma_deck'::regclass AND conname='tma_deck_scope_check'").fetchone()
        original = "CHECK (((scope)::text = ANY ((ARRAY['personal'::character varying, 'library'::character varying])::text[])))"
        restored = "CHECK (((scope)::text = ANY (ARRAY[('personal'::character varying)::text, ('library'::character varying)::text])))"
        if not row or row[0] not in (original, restored):
            raise RuntimeError('Unexpected scope constraint; refusing catalog normalization')
        if row[0] == restored:
            db.execute_sql('ALTER TABLE tma_deck DROP CONSTRAINT tma_deck_scope_check')
            db.execute_sql("ALTER TABLE tma_deck ADD CONSTRAINT tma_deck_scope_check CHECK (scope IN ('personal','library'))")
            actual = db.execute_sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                    "WHERE conrelid='tma_deck'::regclass AND conname='tma_deck_scope_check'").fetchone()[0]
            if actual != original:
                raise RuntimeError('Scope constraint normalization differs from migration96')


def resume_media():
    from local import dev
    config = dev.local_config()
    validate_config(config)
    models = dev.database(config)
    try:
        from local.preview import require_preview
        require_preview()
        normalize_scope_constraint(models)
        restore_media(config, models)
    finally:
        models.tma_db.close()


def start():
    from local import dev
    config = dev.local_config()
    validate_config(config)
    for port in (5174, 8002, 8051):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    dev.native_start(config)
    models = dev.database(config)
    from local.preview import require_preview
    try:
        require_preview()
    finally:
        models.tma_db.close()
    env = dev.environment(config)
    env['LERNE_V2_PREVIEW'] = '1'
    admin = ROOT.parent / 'lerne-admin'
    commands = [
        ([sys.executable, '-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '8002'], ROOT),
        (['node', str(ROOT / 'app/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--strictPort'], ROOT / 'app'),
        ([str(admin / '.venv/Scripts/python.exe'), '-m', 'lerne_admin.cli', '--mode', 'local',
          '--data-root', str(DATA), '--state-dir', str(DATA / 'admin'), '--port', '8051', '--no-browser'], admin),
    ]
    processes, logs = [], []
    try:
        for index, (command, cwd) in enumerate(commands):
            log = (DATA / f'server-{index}.log').open('ab')
            logs.append(log)
            processes.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log,
                                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))
        for _ in range(120):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError(f'A preview server exited; inspect {DATA}/server-*.log')
            try:
                for port in (5174, 8002, 8051):
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        pass
                break
            except OSError:
                time.sleep(.5)
        else:
            raise RuntimeError('Preview startup timed out; inspect server logs')
        webbrowser.open('http://127.0.0.1:5174/v2-preview')
        print('TMA: http://127.0.0.1:5174/v2-preview | Admin: http://127.0.0.1:8051')
        print('Ctrl+C stops preview servers. Converted database remains on disk.')
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
        for log in logs:
            log.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--restore-media', action='store_true', help='Resume offline media copy without restoring the database')
    actions.add_argument('--provision', type=Path, help='Restore a prepared archive into a NEW preview directory')
    args = parser.parse_args()
    try:
        configure()
        provision(args.provision) if args.provision else resume_media() if args.restore_media else start()
    except KeyboardInterrupt:
        print('Preview stopped.')
