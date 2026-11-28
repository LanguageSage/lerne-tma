"""Run real Chromium smoke-test for Native V2 on migrated Supabase DB copy."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from threading import Thread
import time
from uuid import uuid4

import httpx
from peewee import PostgresqlDatabase
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
ADMIN_ROOT = (ROOT.parent / 'lerne-admin').resolve()
BIN_DIR = Path(r"C:\121\Lerne_projekt\tools\pgsql\bin").resolve()
DUMP_FILE = ROOT / 'local/test-data/supabase-rehearsal-d3fa29fb450a4326bfb13ab946d44023/migrated_supabase_v2.dump'

sys.path[:0] = [str(ROOT), str(ADMIN_ROOT / 'src')]

def main():
    print("=== STARTING CHROMIUM SMOKE TEST ON MIGRATED V2 DB ===", flush=True)
    if not DUMP_FILE.is_file():
        raise RuntimeError(f"Migrated dump not found: {DUMP_FILE}")

    scratch = ROOT / 'local/test-data' / ('smoke-pg-' + uuid4().hex)
    scratch.mkdir(parents=True, exist_ok=True)
    pgdata = scratch / 'data'
    suffix = '.exe' if os.name == 'nt' else ''

    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        pg_port = probe.getsockname()[1]

    clean_env = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    clean_env.update(PYTHON_DOTENV_DISABLED='1', RUN_MIGRATIONS='false', PGCLIENTENCODING='UTF8',
                     PGHOST='127.0.0.1', PGPORT=str(pg_port), PGUSER='cards_test', PGDATABASE='postgres', PGSSLMODE='disable')

    def pg(name, *args):
        log = scratch / (name + '.log')
        with log.open('ab') as out:
            res = subprocess.run([str(BIN_DIR / (name + suffix)), *map(str, args)],
                                 env=clean_env, stdout=out, stderr=out, timeout=180,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if res.returncode != 0:
            err = log.read_text(errors='replace') if log.exists() else ''
            raise RuntimeError(f"{name} failed ({res.returncode}):\n{err[:600]}")
        return res

    print(f"[1/5] Starting disposable PostgreSQL on 127.0.0.1:{pg_port}...", flush=True)
    pg('initdb', '-D', pgdata, '-U', 'cards_test', '-A', 'trust', '--no-locale', '--no-sync', '-E', 'UTF8')
    pg('pg_ctl', '-D', pgdata, '-l', scratch / 'postgres.log', '-o', f'-h 127.0.0.1 -p {pg_port}', '-w', 'start')

    control_db = PostgresqlDatabase('postgres', host='127.0.0.1', port=pg_port, user='cards_test', connect_timeout=5)
    with control_db.connection_context():
        control_db.execute_sql('CREATE DATABASE smoke_v2')
        for role in ('anon', 'authenticated', 'service_role', 'postgres'):
            try:
                control_db.execute_sql(f'CREATE ROLE {role}')
            except Exception:
                pass

    print("[2/5] Restoring migrated Supabase V2 dump into smoke_v2...", flush=True)
    restore_log = scratch / 'pg_restore.log'
    with restore_log.open('wb') as out:
        subprocess.run([
            str(BIN_DIR / ('pg_restore' + suffix)),
            '--no-owner', '--no-acl',
            '--dbname', 'smoke_v2',
            str(DUMP_FILE)
        ], env=clean_env, stdout=out, stderr=out, check=True)

    db = PostgresqlDatabase('smoke_v2', host='127.0.0.1', port=pg_port, user='cards_test', connect_timeout=5)
    from api.migrations import run_card_source_migration
    res = run_card_source_migration(db)
    print(f"  * Applied versioned migration 95: {res}", flush=True)

    listeners = []
    for _ in range(2):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listeners.append(listener)
    tma_port = listeners[0].getsockname()[1]
    admin_port = listeners[1].getsockname()[1]

    os.environ['LERNE_ADMIN_STATE_DIR'] = str(scratch / 'admin-state')
    os.environ['LERNE_ADMIN_PORT'] = str(admin_port)
    os.environ.pop('SUPABASE_DB_URL', None)

    # Initialize TMA models
    from api import models
    models.tma_db.initialize(db)
    models.lerne_db.initialize(db)
    from api.main import app as tma_app
    from api.auth.service import _create_session, utcnow

    # Initialize Admin models
    from lerne_admin.core.api import models as admin_models
    admin_db = PostgresqlDatabase('smoke_v2', host='127.0.0.1', port=pg_port, user='cards_test', connect_timeout=5)
    admin_models.tma_db.initialize(admin_db)
    admin_models.lerne_db.initialize(admin_db)
    from lerne_admin.server import app as admin_app

    servers, threads = [], []
    try:
        print(f"[3/5] Starting TMA (port {tma_port}) and Admin (port {admin_port}) servers...", flush=True)
        for application, listener in zip((tma_app, admin_app), listeners):
            server = uvicorn.Server(uvicorn.Config(application, lifespan='off', access_log=False, log_level='error'))
            thread = Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            thread.start()
            servers.append(server)
            threads.append(thread)
            for _ in range(100):
                if server.started or not thread.is_alive():
                    break
                time.sleep(0.05)
            if not server.started:
                raise RuntimeError("Server failed to start")

        tma_origin = f'http://127.0.0.1:{tma_port}'
        admin_origin = f'http://127.0.0.1:{admin_port}'

        # Acknowledge Admin compatibility warnings
        with httpx.Client(base_url=admin_origin, headers={'Origin': admin_origin}, timeout=15) as console:
            compatibility = console.get('/api/admin/compatibility').json()
            for operation in ('native_cards', 'native_library'):
                status = compatibility['operations'][operation]
                if status.get('warnings'):
                    console.post('/api/admin/compatibility/acknowledge', json={
                        'target': 'current', 'operation': operation, 'token': compatibility['token'],
                        'actor': 'smoke-test', 'reason': 'Known warnings reviewed; disposable private copy',
                        'confirmed': True
                    })

        # Dedicate deck 6945 to smoke test user so initial sync snapshot is small and fast
        user_id = 777000111
        with db.connection_context():
            db.execute_sql('UPDATE tma_deck SET user_id = %s WHERE id = 6945', (user_id,))
            db.execute_sql('UPDATE tma_card SET creator_id = %s WHERE deck_id = 6945', (user_id,))
        models.TMAUser.get_or_create(user_id=user_id, defaults={'username': 'smoke_tester', 'default_decks_initialized': True})
        account, _ = models.TMAAuthAccount.get_or_create(user=user_id)
        access_token = _create_session(account, utcnow()).access_token

        # Find sample embedded media image
        media_row = db.execute_sql("SELECT filename FROM tmamedia WHERE folder='images' AND octet_length(content)>0 ORDER BY id LIMIT 1").fetchone()
        sample_img = media_row[0] if media_row else None

        smoke_results_path = scratch / 'smoke_results.json'
        fixture = {
            'tma_origin': tma_origin,
            'admin_origin': admin_origin,
            'user_id': user_id,
            'token': access_token,
            'deck_id': 6945,
            'sample_image': sample_img,
            'output_results': str(smoke_results_path)
        }
        fixture_file = scratch / 'smoke_fixture.json'
        fixture_file.write_text(json.dumps(fixture), encoding='utf-8')

        print("\n[4/5] Executing Chromium Playwright smoke test...", flush=True)
        test_env = {
            **os.environ,
            'LERNE_SMOKE_FIXTURE': str(fixture_file)
        }
        playwright_cmd = [
            'node', 'node_modules/@playwright/test/cli.js', 'test',
            'native-smoke-acceptance.spec.cjs',
            '--project=extended', '--workers=1'
        ]
        test_proc = subprocess.run(playwright_cmd, cwd=str(ROOT), env=test_env, timeout=180)
        if test_proc.returncode != 0:
            raise RuntimeError(f"Chromium smoke test failed with exit code {test_proc.returncode}")

        if not smoke_results_path.is_file():
            raise RuntimeError("Smoke test did not write results file")

        results = json.loads(smoke_results_path.read_text(encoding='utf-8'))
        created_id = results['createdId']
        resolved_offline_id = results['resolvedRealId']

        print("\n[5/5] Asserting final PostgreSQL state in smoke_v2...", flush=True)
        with db.connection_context():
            # Check created/edited card
            c1 = db.execute_sql("SELECT id, content_v2->'card'->>'type', content_v2->'card'->'data'->>'prompt', content_v2->'card'->>'explanation' FROM tma_card WHERE id = %s", (created_id,)).fetchone()
            print(f"  * Created card {created_id} in DB: type={c1[1]}, prompt='{c1[2]}', explanation='{c1[3]}'")
            assert c1[1] == 'standard'
            assert c1[2] == 'Smoke Test Front (Admin UI Saved)'
            assert c1[3] == 'Smoke explanation (Admin UI Saved)'

            # Check offline created card
            c2 = db.execute_sql("SELECT id, content_v2->'card'->>'type', content_v2->'card'->'data'->>'prompt' FROM tma_card WHERE id = %s", (resolved_offline_id,)).fetchone()
            print(f"  * Offline synced card {resolved_offline_id} in DB: type={c2[1]}, prompt='{c2[2]}'")
            assert c2[1] == 'quiz'
            assert c2[2] == 'Offline Smoke Quiz?'

            # Check progress and review history
            prog = db.execute_sql("SELECT count(*) FROM tmaprogress WHERE card_id = %s AND user_id = %s", (created_id, user_id)).fetchone()[0]
            rev = db.execute_sql("SELECT rating FROM tmareviewhistory WHERE card_id = %s AND user_id = %s", (created_id, user_id)).fetchall()
            print(f"  * Progress record count: {prog}, Review ratings: {[r[0] for r in rev]}")
            assert prog >= 1, "Expected progress record in DB"
            assert any(r[0] == 3 for r in rev), "Expected grade 3 review in tmareviewhistory"

        print("\n=== CHROMIUM SMOKE TEST COMPLETED SUCCESSFULLY: 100% PASS! ===", flush=True)

    finally:
        print("\nTearing down servers and PostgreSQL...", flush=True)
        for s in servers:
            s.should_exit = True
        for th in threads:
            th.join(timeout=5)
        for l in listeners:
            l.close()
        admin_db.close()
        db.close()
        control_db.close()
        pg('pg_ctl', '-D', pgdata, '-m', 'immediate', 'stop')
        try:
            shutil.rmtree(pgdata)
        except Exception:
            pass

if __name__ == '__main__':
    main()
