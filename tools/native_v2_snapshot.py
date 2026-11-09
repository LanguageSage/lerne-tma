"""Read-only rehearsal evidence. Private outputs belong in ignored local/test-data.

Never imports the application, initializes models, migrates, or writes PostgreSQL.
The exported MVCC snapshot is shared by fingerprints, JSON input and pg_dump.
Storage bytes are a separate, non-atomic observation; this is not a full backup.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlsplit, quote

from dotenv import dotenv_values
import psycopg2
from psycopg2 import sql
import requests


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding='utf-8')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-env-file', type=Path, required=True)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if not output.is_relative_to(root / 'local/test-data') or output.exists():
        parser.error('Output must be a new directory under this worktree local/test-data')
    config = dotenv_values(args.source_env_file)
    url = config['SUPABASE_DB_URL']
    parsed = urlsplit(url)
    if parsed.hostname != args.expected_host or parsed.path.lstrip('/') != args.expected_database:
        parser.error('Explicit source identity does not match configuration')
    output.mkdir(parents=True)
    manifest = {'observed_at': datetime.now(timezone.utc).isoformat(), 'full_backup': False,
                'source': {'host': parsed.hostname, 'port': parsed.port, 'database': parsed.path.lstrip('/')},
                'tables': {}, 'artifacts': {}, 'storage_probes': [], 'errors': []}
    env = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432), PGDATABASE=parsed.path.lstrip('/'),
               PGUSER=unquote(parsed.username), PGPASSWORD=unquote(parsed.password), PGSSLMODE='require',
               PGCONNECT_TIMEOUT='15', PGCLIENTENCODING='UTF8',
               PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000')
    connection = None
    try:
        connection = psycopg2.connect(url, connect_timeout=15, sslmode='require',
                                      options='-c default_transaction_read_only=on -c statement_timeout=120000')
        connection.set_session(readonly=True, isolation_level='REPEATABLE READ')
        cursor = connection.cursor()
        cursor.execute("SET TIME ZONE 'UTC'")
        cursor.execute('SET extra_float_digits = 3')
        cursor.execute("SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port(),current_setting('transaction_read_only'),version(),pg_export_snapshot()")
        identity = cursor.fetchone()
        assert identity[0] == args.expected_database and identity[4] == 'on'
        manifest['verified_connection'] = dict(zip(('database', 'role', 'server_address', 'server_port', 'read_only', 'version'), identity[:6]))
        snapshot_id = identity[6]
        cursor.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2")
        relations = cursor.fetchall()
        manifest['all_table_names'] = ['.'.join(row) for row in relations]
        for schema, table in relations:
            # A denied SELECT aborts the snapshot. Do not publish partial success.
            query = sql.SQL("SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') FROM {}.{} t ORDER BY 1").format(sql.Identifier(schema), sql.Identifier(table))
            cursor.execute(query)
            hashes = cursor.fetchall()
            manifest['tables'][schema + '.' + table] = {'rows': len(hashes), 'sha256': hashlib.sha256(''.join(r[0] for r in hashes).encode('ascii')).hexdigest()}
        for scope, card, deck in (('tma', 'tma_card', 'tma_deck'), ('library', 'card', 'deck')):
            snapshot = {}
            for key, table in (('cards', card), ('decks', deck)):
                cursor.execute(sql.SQL('SELECT row_to_json(t) FROM public.{} t ORDER BY id').format(sql.Identifier(table)))
                snapshot[key] = [r[0] for r in cursor.fetchall()]
            save(output / (scope + '-snapshot.json'), snapshot)
            manifest[scope] = {'total': len(snapshot['cards']), 'active': sum(not c.get('is_deleted') for c in snapshot['cards']),
                               'deleted': sum(bool(c.get('is_deleted')) for c in snapshot['cards']),
                               'native': sum(c.get('content_v2') is not None for c in snapshot['cards'])}
        cursor.execute('SELECT row_to_json(t) FROM storage.objects t ORDER BY bucket_id,name')
        objects = [r[0] for r in cursor.fetchall()]
        save(output / 'storage-objects.json', objects)
        cursor.execute('SELECT row_to_json(t) FROM storage.buckets t ORDER BY id')
        save(output / 'storage-buckets.json', [r[0] for r in cursor.fetchall()])
        cursor.execute('SELECT row_to_json(t) FROM public.tma_migration_history t ORDER BY migration_id')
        manifest['migration_history'] = [r[0] for r in cursor.fetchall()]
        cursor.execute("SELECT sequencename,last_value,start_value,increment_by,min_value,max_value,cache_size,cycle FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")
        manifest['sequences_observation_non_mvcc'] = cursor.fetchall()
        cursor.execute("SELECT conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2")
        manifest['constraints'] = cursor.fetchall()
        cursor.execute("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2")
        manifest['indexes'] = cursor.fetchall()
        suffix = '.exe' if os.name == 'nt' else ''
        for filename, extra in (('public.dump', ['--schema=public']), ('database.dump', [])):
            result = subprocess.run([str(args.bin_dir / ('pg_dump' + suffix)), '--format=custom', '--no-owner', '--no-acl',
                                     '--snapshot', snapshot_id, *extra, '--file', str(output / filename)],
                                    env=env, capture_output=True, timeout=300,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                manifest['errors'].append({'operation': filename, 'exit_code': result.returncode})
                # stderr may contain connection credentials or user data; keep it local only.
                (output / (filename + '.stderr')).write_bytes(result.stderr)
            else:
                manifest['artifacts'][filename] = {'sha256': digest(output / filename), 'bytes': (output / filename).stat().st_size}
        manifest['database_observation_complete'] = True
        connection.rollback()
        connection.close()
        connection = None
        probes = [('audio', 'user_files/imported/google-3dd8ead6-edbd9899-bd0c8583-5c355eb7-82287d1b.mp3')]
        if objects:
            probes.append((objects[0]['bucket_id'], objects[0]['name']))
        manifest['storage_objects'] = len(objects)
        for bucket, name in dict.fromkeys(probes):
            endpoint = config['SUPABASE_URL'].rstrip('/') + '/storage/v1/object/authenticated/' + quote(bucket, safe='') + '/' + quote(name, safe='/')
            probe = {'bucket': bucket, 'name': name, 'listed': any(o['bucket_id'] == bucket and o['name'] == name for o in objects)}
            try:
                response = requests.get(endpoint, headers={'Authorization': 'Bearer ' + config['SUPABASE_KEY'], 'apikey': config['SUPABASE_KEY']}, timeout=30)
                probe['http_status'] = response.status_code
                if response.ok:
                    payload = output / ('probe-' + hashlib.sha256((bucket + '/' + name).encode()).hexdigest())
                    payload.write_bytes(response.content)
                    probe.update(sha256=digest(payload), bytes=len(response.content))
            except requests.RequestException as exc:
                probe['error'] = type(exc).__name__
            manifest['storage_probes'].append(probe)
        manifest['limitations'] = ['Storage export not complete; probes only', 'Source writers not stopped; sequences are not MVCC',
                                   'Roles and grants not archived (--no-owner --no-acl)', 'No restore or conversion has run']
    except Exception as exc:
        manifest['errors'].append({'operation': 'snapshot', 'type': type(exc).__name__})
        manifest['database_observation_complete'] = False
    finally:
        if connection is not None:
            connection.rollback()
            connection.close()
        save(output / 'manifest.json', manifest)
    print(json.dumps({k: manifest.get(k) for k in ('source', 'database_observation_complete', 'tma', 'library', 'storage_objects', 'storage_probes', 'errors', 'artifacts')}, ensure_ascii=False))
    return 0 if manifest.get('database_observation_complete') else 1


if __name__ == '__main__':
    raise SystemExit(main())
