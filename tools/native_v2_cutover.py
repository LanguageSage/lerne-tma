"""Explicit Native V2 maintenance CLI. Inspect by default; never resumes writes.

DSN is read only from NATIVE_V2_DATABASE_URL. Stop all writers and retain a
verified V1 dump before apply. After any failure inspect on a new connection;
restore the V1 backup before retrying a partially committed cutover.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, unquote, urlsplit

from playhouse.db_url import connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def file_sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected_dsn_user(args):
    value = getattr(args, 'expected_dsn_user', None)
    return args.expected_role if value is None else value


def target_url(args):
    if (os.environ.get('LERNE_MODE') or os.environ.get('VERCEL') or
            os.environ.get('VERCEL_ENV')):
        raise ValueError('Run in a standalone maintenance process, outside LOCAL/server environment')
    url = os.environ.get('NATIVE_V2_DATABASE_URL', '')
    parsed = urlsplit(url)
    dsn_user = expected_dsn_user(args)
    if (not dsn_user or parsed.scheme not in ('postgres', 'postgresql') or
            (parsed.hostname, parsed.port or 5432, unquote(parsed.path.lstrip('/')),
             unquote(parsed.username or '')) !=
            (args.expected_host, args.expected_port, args.expected_database, dsn_user)):
        raise ValueError('Explicit DSN identity mismatch')
    if parsed.path.lstrip('/') == 'lerne_tma_local' or parsed.port == 55432:
        raise ValueError('Working LOCAL target is forbidden')
    if parsed.hostname not in ('127.0.0.1', '::1', 'localhost') and parse_qs(parsed.query).get('sslmode') not in (
            ['require'], ['verify-ca'], ['verify-full']):
        raise ValueError('Remote DSN must explicitly require TLS')
    if set(parse_qs(parsed.query)) - {'sslmode', 'sslrootcert'}:
        raise ValueError('Unsupported DSN options; use a direct/session connection')
    return url


def observe(database):
    from tools.native_v2_rehearsal import fingerprints
    database.execute_sql('SET extra_float_digits = 3')
    identity = database.execute_sql('SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port()').fetchone()
    tables = database.get_tables()
    columns = {t: [c.name for c in database.get_columns(t)] for t in tables}
    counts = {}
    for table in ('tma_card', 'card'):
        if table in tables:
            native = 'content_v2 IS NOT NULL' if 'content_v2' in columns[table] else 'FALSE'
            counts[table] = database.execute_sql(f'''SELECT count(*),count(*) FILTER (WHERE NOT is_deleted),
                count(*) FILTER (WHERE NOT is_deleted AND {native}) FROM {table}''').fetchone()
    return json.loads(json.dumps({
        'identity': list(identity), 'tables': fingerprints(database), 'columns': columns, 'cards_total_active_native': counts,
        'history': list(database.execute_sql('SELECT migration_id FROM tma_migration_history ORDER BY migration_id')),
        'catalog': list(database.execute_sql("""SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
            a.attnotnull,pg_get_expr(d.adbin,d.adrelid) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
            WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2""")),
        'constraints': list(database.execute_sql("SELECT conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2")),
        'indexes': list(database.execute_sql("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2")),
    }, default=str))


def lock_tables(database):
    # Quoting comes from psycopg2, including unusual restored table names.
    from psycopg2 import sql
    names = database.get_tables()
    query = sql.SQL('LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE').format(
        sql.SQL(',').join(sql.Identifier('public', t) for t in names))
    database.execute_sql(query.as_string(database.connection()))


def apply(database, baseline, results=None):
    from api import migrations
    from tools.migrate_native_v2_local import _migrate_active
    from tools.native_v2_rehearsal import fingerprints

    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout='5s'")
        lock_tables(database)
        if observe(database) != baseline:
            raise ValueError('Frozen source changed; no retry/resume. Inspect and recover first')
        if ({96, 97} & {r[0] for r in baseline['history']} or
                set(baseline['cards_total_active_native']) != {'tma_card', 'card'} or
                any(row[2] for row in baseline['cards_total_active_native'].values())):
            raise ValueError('Fresh V1 source required; no automatic resume')

    if results is None:
        results = []
    for migration_id, runner in enumerate((migrations.run_card_rating_migration, migrations.run_structured_cards_v2_migration,
                   migrations.run_library_cards_v2_migration, migrations.run_card_source_migration), 92):
        results.append({'migration_id': migration_id, 'result': runner(database)})

    def verify_source():
        lock_tables(database)
        database.execute_sql('SET extra_float_digits = 3')
        current = fingerprints(database, baseline['columns'])
        expected = {k: v for k, v in baseline['tables'].items() if k != 'public.tma_migration_history'}
        if any(current.get(k) != v for k, v in expected.items()):
            raise ValueError('Source rows changed during schema preparation')
        added = set(current) - set(baseline['tables'])
        if added - {'public.tma_card_rating'} or any(current[k]['rows'] for k in added):
            raise ValueError('Unexpected tables/data during schema preparation')

    results.append(_migrate_active(database, verify_source=verify_source))
    results.append(migrations.run_unified_cards_migration(database))
    results.append(migrations.run_library_cleanup_migration(database))
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-port', type=int, required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--expected-role', required=True)
    parser.add_argument('--expected-dsn-user', default=None)
    parser.add_argument('--output', required=True, type=Path, help='New private JSON report')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--source-inspect', type=Path)
    parser.add_argument('--confirm-source-sha256')
    parser.add_argument('--writers-stopped', action='store_true')
    args = parser.parse_args(argv)
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / 'local/test-data') or output.exists():
        parser.error('--output must be new and under local/test-data')
    report = {'mode': 'apply' if args.apply else 'inspect', 'ok': False}
    database = None
    stage = 'target'
    try:
        url = target_url(args)
        if args.apply:
            if not args.writers_stopped or not args.source_inspect:
                raise ValueError('Apply requires writers-stopped and confirmed inspect file SHA-256')
            source_bytes = args.source_inspect.read_bytes()
            if hashlib.sha256(source_bytes).hexdigest() != args.confirm_source_sha256:
                raise ValueError('Source inspect SHA-256 mismatch')
            saved = json.loads(source_bytes)
            report['source_inspect_sha256'] = args.confirm_source_sha256
        database = connect(url, connect_timeout=10,
                           options='-c search_path=public -c timezone=UTC -c row_security=off -c statement_timeout=120000')
        database.connect()
        identity = database.execute_sql('SELECT current_database(),current_user').fetchone()
        if tuple(identity) != (args.expected_database, args.expected_role):
            raise ValueError('Connected database/role mismatch')
        # Session lock spans the runners\' independent transactions. No waiting/retry.
        if args.apply and not database.execute_sql('SELECT pg_try_advisory_lock(76120998)').fetchone()[0]:
            raise ValueError('Another cutover CLI holds the maintenance lock')
        if args.apply:
            # Only the verified connection may be bound by imports needed by 97.
            os.environ.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1',
                              RUN_MIGRATIONS='false', SUPABASE_DB_URL=url)
            from api import models
            models.tma_db.initialize(database)
            models.lerne_db.initialize(database)
            expected_target = [args.expected_host, args.expected_port, args.expected_database, args.expected_role, expected_dsn_user(args)]
            if saved.get('target') != expected_target or saved.get('mode') != 'inspect' or not saved.get('ok'):
                raise ValueError('Invalid source inspect report')
            stage = '92-97/content (commit may be unknown on failure)'
            report['steps'] = []
            apply(database, saved['state'], report['steps'])
        stage = 'durable inspection'
        with database.atomic():
            database.execute_sql('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            report['state'] = observe(database)
        report.update(ok=True, target=[args.expected_host, args.expected_port, args.expected_database, args.expected_role, expected_dsn_user(args)])
    except Exception as exc:
        report.update(failed_stage=stage, error_type=type(exc).__name__,
                      error=str(exc),
                      recovery='STOP. New read-only inspect; reconcile durable state. Restore verified V1 backup before retry after partial/unknown commit.')
        # Details stay in the private report, never in stdout/stderr.
        print(f'Native V2 stopped: {stage} / {type(exc).__name__}', file=sys.stderr)
    finally:
        if database is not None and not database.is_closed():
            database.close()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, ensure_ascii=False)
    print(json.dumps({'ok': report['ok'], 'mode': report['mode'], 'report': str(output)}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
