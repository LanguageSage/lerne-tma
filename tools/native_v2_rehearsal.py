"""Independent database-only rehearsal using a private snapshot and a fresh cluster.

By default source data stays V1; --convert-active runs the one-transaction
local migration. Uses the disposable runner, never an application target DSN.
Private inputs are deliberately excluded from CI and from Git.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'scripts/tests')]


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding='utf-8')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def fingerprints(db, original_columns=None):
    result = {}
    db.execute_sql("SET TIME ZONE 'UTC'")
    for table in db.get_tables():
        expression = 'to_jsonb(t)'
        if original_columns and table in original_columns:
            for column in set(c.name for c in db.get_columns(table)) - set(original_columns[table]):
                expression += " - '" + column.replace("'", "''") + "'"
        rows = db.execute_sql(f'''SELECT encode(sha256(convert_to(({expression})::text,'UTF8')),'hex')
                                 FROM public."{table}" t ORDER BY 1''').fetchall()
        result['public.' + table] = {'rows': len(rows), 'sha256': hashlib.sha256(''.join(r[0] for r in rows).encode()).hexdigest()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot-dir', type=Path, required=True)
    parser.add_argument('--admin-root', type=Path, required=True)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--convert-active', action='store_true', help='Migrate active cards in one local transaction; retain V1 tombstones')
    parser.add_argument('--applications', action='store_true', help='Exercise actual TMA and Admin against a separate restored V2 copy')
    args = parser.parse_args()
    if args.applications and not args.convert_active:
        parser.error('--applications requires --convert-active')
    source, out = args.snapshot_dir.resolve(), args.output.resolve()
    if (not source.is_relative_to(ROOT / 'local/test-data') or
            not out.is_relative_to(ROOT / 'local/test-data') or out.exists()):
        parser.error('Use an existing private snapshot and a new ignored output directory')
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    if not manifest.get('database_observation_complete'):
        parser.error('Source database snapshot did not complete')
    for filename, entry in manifest['artifacts'].items():
        if sha(source / filename) != entry['sha256']:
            parser.error('Source checksum mismatch; no database has been started')
    out.mkdir(parents=True)
    sys.path.insert(0, str(args.admin_root.resolve() / 'src'))
    report = {'verdict': 'NOT READY', 'scope': 'database-only; content cutover not implemented', 'full_rehearsal': False,
              'source_manifest_sha256': sha(source / 'manifest.json'), 'checks': {}, 'failures': []}

    def verify(control):
        from peewee import PostgresqlDatabase
        from api.migrations import run_structured_cards_v2_migration, run_library_cards_v2_migration
        from lerne_admin.services import full_database_backup as backup

        # Independent server identity, filesystem ownership and application-mode checks.
        identity = control.execute_sql("SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port(),current_setting('data_directory')").fetchone()
        data = Path(identity[4]).resolve()
        assert tuple(identity[:2]) == ('postgres', 'cards_test'), repr(identity[:4])
        assert ipaddress.ip_interface(identity[2]).ip == ipaddress.ip_address('127.0.0.1')
        assert data.parent.parent == (ROOT / 'local/test-data').resolve()
        assert data.parent.name.startswith('structured-cards-pg-') and data.name == 'data'
        assert (data / 'postmaster.pid').is_file() and identity[3] != 55432
        assert not os.environ.get('LERNE_MODE') and not os.environ.get('SUPABASE_DB_URL')
        report['verified_disposable_target'] = dict(zip(('database', 'role', 'address', 'port', 'pgdata'), identity))
        for role in ('anon', 'authenticated', 'service_role'):
            control.execute_sql(f'CREATE ROLE {role}')
        suffix = '.exe' if os.name == 'nt' else ''
        pg_env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(identity[3]), PGUSER='cards_test', PGDATABASE='postgres', PGSSLMODE='disable')

        def pg(name, *arguments, allow_failure=False):
            result = subprocess.run([str(args.bin_dir / (name + suffix)), *map(str, arguments)], env=pg_env,
                                    capture_output=True, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode and not allow_failure:
                (out / (name + '-failure.log')).write_bytes(result.stderr)
                raise RuntimeError(f'{name} failed ({result.returncode}); see private log')
            return result

        def new_database(name, dump):
            assert name.startswith('rehearsal_') and name != 'lerne_tma_local'
            control.execute_sql(f'CREATE DATABASE {name}')
            listed = pg('pg_restore', '--list', dump).stdout.decode('utf-8')
            selection = out / (name + '.list')
            selection.write_text('\n'.join(line for line in listed.splitlines() if ' SCHEMA - public ' not in line) + '\n', encoding='utf-8')
            result = pg('pg_restore', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl',
                        '--use-list', selection, '--dbname', name, dump, allow_failure=True)
            target = PostgresqlDatabase(name, host='127.0.0.1', port=identity[3], user='cards_test', connect_timeout=5)
            if result.returncode:
                (out / (name + '-restore-error.log')).write_bytes(result.stderr)
                report['checks'][name] = {'restored': False, 'exit_code': result.returncode,
                                          'public_tables_after_failure': target.get_tables()}
                target.close()
                return None
            return target

        original = new_database('rehearsal_original', source / 'public.dump')
        assert original is not None, 'Public archive did not restore'
        expected = {k: v for k, v in manifest['tables'].items() if k.startswith('public.')}
        before = fingerprints(original)
        mismatches = [k for k in expected if before.get(k) != expected[k]]
        assert set(before) == set(expected) and not mismatches, mismatches
        report['checks']['public_restore'] = {'tables': len(before), 'rows': sum(t['rows'] for t in before.values()),
                                              'different_tables': mismatches, 'all_row_sha256_equal': True}
        save(out / 'restored-fingerprints.json', before)
        actual_constraints = original.execute_sql("SELECT conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2").fetchall()
        actual_indexes = original.execute_sql("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2").fetchall()
        constraints_equal = json.loads(json.dumps(actual_constraints)) == manifest['constraints']
        indexes_equal = json.loads(json.dumps(actual_indexes)) == manifest['indexes']
        report['checks']['catalog'] = {'constraint_definitions_equal': constraints_equal, 'index_definitions_equal': indexes_equal}
        if not constraints_equal:
            save(out / 'restored-constraints.json', actual_constraints)
        report['checks']['strict_source_contract'] = backup._unknown_contract_tables(
            f'postgresql://cards_test@127.0.0.1:{identity[3]}/rehearsal_original', cloud=False)
        original_columns = {t: [c.name for c in original.get_columns(t)] for t in original.get_tables()}
        # Use a second independently restored copy; the Before database stays untouched.
        upgraded = new_database('rehearsal_schema', source / 'public.dump')
        assert upgraded is not None
        first = [run_structured_cards_v2_migration(upgraded), run_library_cards_v2_migration(upgraded)]
        after = fingerprints(upgraded, original_columns)
        # The two new history records are the only expected row difference.
        differences = [k for k in expected if after.get(k) != expected[k]]
        assert differences == ['public.tma_migration_history'], differences
        second = [run_structured_cards_v2_migration(upgraded), run_library_cards_v2_migration(upgraded)]
        assert all(r['applied'] for r in first) and not any(r['applied'] for r in second)
        native_counts = {t: upgraded.execute_sql(f'SELECT count(*) FILTER (WHERE content_v2 IS NOT NULL),count(*) FROM {t}').fetchone() for t in ('tma_card', 'card')}
        assert all(r[0] == 0 for r in native_counts.values())
        report['checks']['schema'] = {'first': first, 'rerun': second, 'changed_tables': differences,
                                      'content_counts_native_total': native_counts, 'content_migration_performed': False}
        report['checks']['strict_schema_contract'] = backup._unknown_contract_tables(
            f'postgresql://cards_test@127.0.0.1:{identity[3]}/rehearsal_schema', cloud=False)
        if args.convert_active:
            from tools.migrate_native_v2_local import migrate_active, immutable_cards
            from api.migrations import run_card_rating_migration
            run_card_rating_migration(upgraded)
            baseline = fingerprints(upgraded)
            immutable = immutable_cards(upgraded)
            report['checks']['atomic_migration'] = migrate_active(upgraded)
            if immutable_cards(upgraded) != immutable:
                raise AssertionError('ID, non-content fields or complete deleted rows changed')
            migrated = fingerprints(upgraded)
            changed = [k for k in baseline if baseline[k] != migrated[k]]
            if set(changed) != {'public.tma_card', 'public.card'}:
                raise AssertionError(f'Unexpected changed tables: {changed}')
            # Independently revalidate every stored envelope after commit.
            from api.card_core.lerne_card_core.structured_cards_v2 import validate_card
            from collections import Counter
            types = {}
            for table in ('tma_card', 'card'):
                counts = Counter()
                for envelope, in upgraded.execute_sql(f'SELECT content_v2 FROM {table} WHERE NOT is_deleted'):
                    if set(envelope) != {'schema_version', 'card'} or envelope['schema_version'] != 2:
                        raise AssertionError('Invalid persisted envelope')
                    counts[validate_card(envelope['card']).type] += 1
                types[table] = dict(counts)
            report['checks']['atomic_migration'].update(immutable_rows_equal=True, other_tables_equal=True, types=types)
            pg('pg_dump', '--format=custom', '--no-owner', '--no-acl', '--dbname', 'rehearsal_schema', '--file', out / 'native-v2.dump')
            v2_restored = new_database('rehearsal_v2_restored', out / 'native-v2.dump')
            if v2_restored is None or fingerprints(v2_restored) != migrated:
                raise AssertionError('V2 dump restore differs from migrated database')
            report['checks']['v2_dump_restore'] = {'all_row_hashes_equal': True, 'tables': len(migrated), 'sha256': sha(out / 'native-v2.dump')}
            v2_restored.close()
            if args.applications:
                application_db = new_database('rehearsal_applications', out / 'native-v2.dump')
                if application_db is None:
                    raise AssertionError('Application clone failed to restore')
                from native_v2_migrated_apps import verify as verify_apps
                report['checks']['applications'] = verify_apps(application_db, out, args.admin_root)
                application_db.close()
            app_result = report['checks'].get('applications', {})
            report['verdict'] = ('NOT READY' if app_result.get('failures') or
                app_result.get('browser', {}).get('exit_code', 0) else 'CONDITIONAL')
            report['scope'] = 'active-card DB migration; media and production cutover excluded'
        # A full dump includes provider-managed schemas/extensions; attempt unchanged.
        full = new_database('rehearsal_all_schemas', source / 'database.dump')
        if full is not None:
            report['checks']['all_schemas_restore'] = {'restored': True}
            full.close()
        else:
            report['checks']['all_schemas_restore'] = {'restored': False, 'see': 'rehearsal_all_schemas-restore-error.log'}
        # The real backup service must refuse to publish a full archive with absent bytes.
        media = out / 'isolated-media'
        for folder in backup.MEDIA_DIRS:
            (media / folder).mkdir(parents=True)
        try:
            backup.create_bundle(out, str(uuid4()), 'local',
                                 f'postgresql://cards_test@127.0.0.1:{identity[3]}/rehearsal_schema',
                                 media_root=media, bin_dir=args.bin_dir)
        except ValueError as exc:
            report['checks']['cloud_links_not_accepted_as_local_bundle'] = {'blocked': True, 'reason': str(exc),
                                                         'published_archives': [p.name for p in out.glob('*.zip')]}
        else:
            raise AssertionError('Full archive incorrectly accepted missing external media')
        # Preserve a synthetic post-backup delta in a rescue dump before restoring V1.
        upgraded.execute_sql("INSERT INTO tmasetting (key,value,updated_at) VALUES ('REHEARSAL_SYNTHETIC_POST_BACKUP','preserve in rescue dump',CURRENT_TIMESTAMP)")
        pg('pg_dump', '--format=custom', '--no-owner', '--no-acl', '--dbname', 'rehearsal_schema', '--file', out / 'post-backup-rescue.dump')
        recovered = new_database('rehearsal_v1_recovery', source / 'public.dump')
        assert recovered is not None and fingerprints(recovered) == expected
        assert recovered.execute_sql("SELECT count(*) FROM tmasetting WHERE key='REHEARSAL_SYNTHETIC_POST_BACKUP'").fetchone()[0] == 0
        rescue = new_database('rehearsal_rescue_verification', out / 'post-backup-rescue.dump')
        assert rescue is not None
        assert rescue.execute_sql("SELECT value FROM tmasetting WHERE key='REHEARSAL_SYNTHETIC_POST_BACKUP'").fetchone()[0] == 'preserve in rescue dump'
        from api import models
        from api.services.sync_generation import generation_state, mark_database_restored, require_generation
        models.tma_db.initialize(recovered)
        initial_generation = generation_state()
        try:
            with recovered.atomic():
                mark_database_restored(recovered)
            restored_generation = generation_state()
            rotation = initial_generation['server_generation'] != restored_generation['server_generation'] and restored_generation['restored']
        except Exception as exc:
            rotation = False
            report['checks']['generation_rotation_failure'] = {'type': type(exc).__name__, 'message': str(exc),
                'public_rows_still_equal_to_source': fingerprints(recovered) == expected}
        try:
            require_generation(None)
            unversioned_rejected = False
        except Exception as exc:
            if getattr(exc, 'status_code', None) != 409:
                raise
            unversioned_rejected = True
        report['checks']['v1_recovery'] = {'before_generation_rotation_all_row_sha256_equal': True,
            'post_backup_delta_absent_from_original': True, 'post_backup_delta_verified_in_rescue_dump': True,
            'rescue_sha256': sha(out / 'post-backup-rescue.dump'), 'generation_rotated': rotation,
            'unversioned_client_rejected_by_generation_guard': unversioned_rejected,
            'expected_data_change_if_rotation_succeeds': 'tmasetting.SYNC_DATABASE_RESTORE'}
        for target in (original, upgraded, recovered, rescue):
            target.close()
        save(out / 'database-results.json', report)
        print(json.dumps(report, ensure_ascii=False, default=str), flush=True)
        return True

    import structured_cards_postgres as runner
    runner.verify = verify
    sys.argv = [sys.argv[0], '--bin-dir', str(args.bin_dir)]
    try:
        result = runner.main()
        return result if result else 2  # Completed evidence collection is still a blocked cutover.
    except Exception as exc:
        report['failures'].append({'type': type(exc).__name__, 'message': str(exc)})
        save(out / 'database-results.json', report)
        raise


if __name__ == '__main__':
    raise SystemExit(main())
