"""Targeted CLI checks on synthetic/restored disposable PostgreSQL only.

Uses the existing cluster lifecycle, without running its large test suites.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / 'scripts/tests')]


def verify(control, binaries, private_dump=None):
    from peewee import PostgresqlDatabase
    os.environ['SUPABASE_DB_URL'] = f'postgresql://cards_test@127.0.0.1:{control.connect_params["port"]}/postgres'
    from api import models
    from tools import native_v2_cutover as cli
    from tools import migrate_native_v2_local as content
    from tools.native_v2_rehearsal import fingerprints

    port = control.connect_params['port']
    out = ROOT / 'local/test-data' / ('cutover-cli-' + uuid4().hex)
    out.mkdir()
    connection = ['-h', '127.0.0.1', '-p', str(port), '-U', 'cards_test']
    suffix = '.exe' if os.name == 'nt' else ''
    checks = []

    def pg(binary, *args):
        result = subprocess.run([str(binaries / (binary + suffix)), *connection, *map(str, args)],
            capture_output=True, timeout=300, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            (out / (binary + '-error.log')).write_bytes(result.stderr)
            raise AssertionError(f'{binary} failed; private log retained')

    def new_db(label, dump=None):
        name = 'cutover_' + label + '_' + uuid4().hex
        control.execute_sql(f'CREATE DATABASE {name}')
        if dump:
            # Existing private archives include CREATE SCHEMA public. Filter only
            # that TOC entry, as in the existing rehearsal; no CASCADE/ignored SQL.
            listed = subprocess.run([str(binaries / ('pg_restore' + suffix)), '--list', str(dump)],
                capture_output=True, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout.decode('utf-8')
            selection = out / (name + '.list')
            selection.write_text('\n'.join(line for line in listed.splitlines() if ' SCHEMA - public ' not in line) + '\n', encoding='utf-8')
            pg('pg_restore', '--single-transaction', '--no-owner', '--no-acl', '--exit-on-error', '--use-list', selection, '-d', name, dump)
        db = PostgresqlDatabase(name, **control.connect_params)
        models.tma_db.initialize(db)
        models.lerne_db.initialize(db)
        return db

    def invoke(db, label, apply=False, source=None, env=None, overrides=None, external=False):
        output = out / (label + '.json')
        argv = ['--expected-host', '127.0.0.1', '--expected-port', str(port),
                '--expected-database', db.database, '--expected-role', 'cards_test', '--output', str(output)]
        if apply:
            argv += ['--apply', '--writers-stopped', '--source-inspect', str(source),
                     '--confirm-source-sha256', cli.file_sha(source)]
        if overrides:
            argv += overrides
        with patch.dict(os.environ, {'NATIVE_V2_DATABASE_URL': f'postgresql://cards_test@127.0.0.1:{port}/{db.database}', **(env or {})}):
            if external:
                result = subprocess.run([sys.executable, str(ROOT / 'tools/native_v2_cutover.py'), *argv],
                    capture_output=True, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).returncode
            else:
                result = cli.main(argv)
        return result, json.loads(output.read_text(encoding='utf-8')), output

    source = new_db('source')
    models.tma_db.initialize(source)
    models.lerne_db.initialize(source)
    source.create_tables([models.LibraryCategory, models.Deck, models.Card, models.TMA_Folder,
        models.TMA_Deck, models.TMA_Card, models.TMAProgress, models.TMACardNote, models.TMASetting])
    source.execute_sql('CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
    source.execute_sql('ALTER TABLE tma_deck DROP COLUMN scope,DROP COLUMN category_id,DROP COLUMN is_default')
    source.execute_sql("""INSERT INTO tma_deck(id,user_id,name,is_deleted,is_inbox,is_pinned,position,created_at,metadata)
        VALUES (10,7,'Synthetic personal',false,false,false,0,now(),'{}')""")
    personal = models.TMA_Card.create(id=101, deck=10, front_text='Hallo', back_text='Hello',
        context='Synthetic context', metadata='{"custom":{"retain":true}}', history='["retain"]',
        audio_path='audio/exists.mp3', image_path='images/exists.webp', image_data=b'synthetic image')
    models.TMA_Card.create(id=102, deck=10, front_text='Deleted', back_text='Keep', is_deleted=True)
    library = models.Deck.create(name='Synthetic library', metadata='{"resources":[]}')
    models.Card.create(deck=library, front_text='Haus', back_text='House', audio_path='audio/missing.mp3')
    models.TMAProgress.create(card_id=101, user_id=7, interval=42, flag=3, want_to_learn=True)
    models.TMACardNote.create(id=str(uuid4()), card=personal, user_id=7, text='Synthetic note')
    models.TMASetting.create(key='USER_SETTINGS_7', value='{"retain":true}')
    for table in ('tma_card', 'card'):
        source.execute_sql(f'ALTER TABLE {table} DROP COLUMN content_v2,ALTER COLUMN front_text SET NOT NULL,ALTER COLUMN back_text SET NOT NULL,ALTER COLUMN card_type SET NOT NULL')
    before = fingerprints(source)
    dump = out / 'v1.dump'
    pg('pg_dump', '--format=custom', '--no-owner', '--no-acl', '-d', source.database, '-f', dump)
    db = new_db('restored', dump)
    assert fingerprints(db) == before
    checks.append('V1 backup restore: all row hashes equal')

    rc, inspection, baseline = invoke(db, 'inspect')
    assert rc == 0 and fingerprints(db) == before
    checks.append('default inspect: zero row/schema changes')
    for label, env, overrides in (
            ('wrong-db', {}, ['--expected-database', 'wrong']),
            ('wrong-role', {}, ['--expected-role', 'wrong']),
            ('wrong-port', {}, ['--expected-port', '55432']),
            ('wrong-environment', {'LERNE_MODE': 'LOCAL'}, None)):
        rc, _, _ = invoke(db, label, True, baseline, env, overrides)
        assert rc == 1 and fingerprints(db) == before
    checks.append('wrong database/role/port/environment: refused with zero writes')
    rc, _, _ = invoke(db, 'wrong-sha', True, baseline, overrides=['--confirm-source-sha256', '0' * 64])
    assert rc == 1 and fingerprints(db) == before
    db.execute_sql("UPDATE tma_card SET front_text='Changed' WHERE id=101")
    drift = fingerprints(db)
    rc, _, _ = invoke(db, 'drift', True, baseline)
    assert rc == 1 and fingerprints(db) == drift
    checks.append('unconfirmed SHA and changed baseline: refused before DDL')
    db.close()

    db = new_db('blocked', dump)
    db.execute_sql("UPDATE card SET front_text='',back_text='' WHERE NOT is_deleted")
    _, _, baseline = invoke(db, 'blocked-inspect')
    with patch.object(content, 'execute_values', wraps=content.execute_values) as write:
        rc, _, _ = invoke(db, 'blocked', True, baseline)
        assert rc == 1 and write.call_count == 0
    assert db.execute_sql('SELECT count(*) FROM tma_card WHERE content_v2 IS NOT NULL').fetchone()[0] == 0
    checks.append('blocked library conversion: no content UPDATE in either table')
    db.close()

    db = new_db('atomic', dump)
    _, _, baseline = invoke(db, 'atomic-inspect')
    write = content.execute_values
    def fail_library(cursor, query, *args, **kwargs):
        if query.startswith('UPDATE card t'):
            cursor.execute('SELECT 1/0')
        return write(cursor, query, *args, **kwargs)
    with patch.object(content, 'execute_values', side_effect=fail_library):
        rc, _, _ = invoke(db, 'atomic-failed', True, baseline)
    assert rc == 1
    for table in ('tma_card', 'card'):
        assert db.execute_sql(f'SELECT count(*) FROM {table} WHERE content_v2 IS NOT NULL').fetchone()[0] == 0
    checks.append('failure during second table UPDATE: both tables content rolled back')
    db.close()

    db = new_db('immutable', dump)
    _, _, baseline = invoke(db, 'immutable-inspect')
    def corrupt_media(cursor, query, *args, **kwargs):
        result = write(cursor, query, *args, **kwargs)
        cursor.execute("UPDATE tma_card SET audio_path='changed' WHERE id=101")
        return result
    with patch.object(content, 'execute_values', side_effect=corrupt_media):
        rc, result, _ = invoke(db, 'immutable-failed', True, baseline)
    assert rc == 1 and 'Non-content fields' in result['error']
    assert db.execute_sql('SELECT audio_path,content_v2 FROM tma_card WHERE id=101').fetchone() == ('audio/exists.mp3', None)
    checks.append('non-content corruption inside conversion: immutable hash gate rolls back both tables')
    db.close()

    db = new_db('unknown', dump)
    _, _, baseline = invoke(db, 'unknown-inspect')
    commit = PostgresqlDatabase.commit
    lost = []
    def lost_ack(target):
        converted = (target.database == db.database and target.table_exists('card') and
            any(c.name == 'content_v2' for c in target.get_columns('card')) and
            target.execute_sql('SELECT count(*) FROM card WHERE content_v2 IS NOT NULL').fetchone()[0] > 0)
        result = commit(target)
        if converted and not lost:
            lost.append(True)
            raise RuntimeError('Synthetic COMMIT acknowledgement loss')
        return result
    with patch.object(PostgresqlDatabase, 'commit', lost_ack):
        rc, _, _ = invoke(db, 'unknown-commit', True, baseline)
    assert rc == 1 and lost
    rc, durable, _ = invoke(db, 'unknown-durable')
    assert rc == 0 and durable['state']['cards_total_active_native']['card'][2] == 1
    durable_hashes = fingerprints(db)
    rc, _, _ = invoke(db, 'unknown-refused-retry', True, baseline)
    assert rc == 1 and fingerprints(db) == durable_hashes
    checks.append('lost COMMIT acknowledgement: durable inspect shows committed content; retry refuses without writes')
    db.close()

    db = new_db('recovered', dump)
    assert fingerprints(db) == before
    _, _, baseline = invoke(db, 'recovered-inspect')
    rc, result, _ = invoke(db, 'complete-92-97', True, baseline, external=True)
    assert rc == 0, result
    assert {r[0] for r in result['state']['history']} == set(range(92, 98))
    assert not {'card', 'deck', 'progress', 'reviewhistory', 'uservoice'} & set(db.get_tables())
    from api.card_core.lerne_card_core.structured_cards_v2 import validate_card
    for envelope, in db.execute_sql('SELECT content_v2 FROM tma_card WHERE NOT is_deleted'):
        validate_card(envelope['card'])
    assert db.execute_sql('SELECT interval,flag,want_to_learn FROM tmaprogress WHERE card_id=101').fetchone() == (42, 3, True)
    image, audio = db.execute_sql('SELECT image_data,audio_path FROM tma_card WHERE id=101').fetchone()
    assert (bytes(image), audio) == (b'synthetic image', 'audio/exists.mp3')
    assert db.execute_sql('SELECT front_text,content_v2 FROM tma_card WHERE id=102').fetchone() == ('Deleted', None)
    for table in ('public.tmaprogress', 'public.tma_card_note'):
        assert fingerprints(db)[table] == before[table]
    checks.append('restored source -> exact CLI 92/content/97: valid V2, personal IDs/media/deleted/progress/notes preserved')
    v2 = out / 'v2.dump'
    upgraded_hashes = fingerprints(db)
    pg('pg_dump', '--format=custom', '--no-owner', '--no-acl', '-d', db.database, '-f', v2)
    restored = new_db('v2_restore', v2)
    assert fingerprints(restored) == upgraded_hashes
    checks.append('post-97 V2 dump restore: all row hashes equal')
    restored.close()
    rc, _, _ = invoke(db, 'completed-refused-retry', True, baseline)
    assert rc == 1 and fingerprints(db) == upgraded_hashes
    checks.append('completed rerun: refused with zero writes')
    rollback = new_db('v1_recovery', dump)
    assert fingerprints(rollback) == before
    checks.append('V1 recovery into independent database: all row hashes equal')
    rollback.close()
    db.close()

    if private_dump:
        private = new_db('private', private_dump)
        _, _, baseline = invoke(private, 'private-inspect')
        rc, result, _ = invoke(private, 'private-92-97', True, baseline)
        if rc:
            assert 'prevalidation blocked' in result['error'], result
            for table in ('tma_card', 'card'):
                assert private.execute_sql(f'SELECT count(*) FROM {table} WHERE content_v2 IS NOT NULL').fetchone()[0] == 0
            checks.append('private archived V1 source: converter blocks unchanged historical input; zero content writes (not a full cutover PASS)')
        else:
            checks.append('explicit private V1 backup -> restored database -> exact CLI 92-97 PASS')
        private.close()
    (out / 'checks.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
    print(json.dumps({'checks': checks, 'output': str(out)}, indent=2), flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--private-dump', type=Path)
    args = parser.parse_args()
    import structured_cards_postgres as runner
    runner.verify = lambda db: verify(db, args.bin_dir.resolve(), args.private_dump)
    sys.argv = [sys.argv[0], '--bin-dir', str(args.bin_dir)]
    return runner.main()


if __name__ == '__main__':
    raise SystemExit(main())
