"""Verify card notes and messages in a disposable PostgreSQL cluster."""
import argparse
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import sys
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    scratch = root / 'local' / 'test-data' / ('card-notes-pg-' + uuid4().hex)
    scratch.mkdir(parents=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    safe = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    safe.update(PYTHON_DOTENV_DISABLED='1', RUN_MIGRATIONS='false', VERCEL='1', PGCLIENTENCODING='UTF8')
    os.environ.clear(); os.environ.update(safe)
    def run(name, *params):
        with (scratch / (name + '.log')).open('wb') as output:
            subprocess.run([str(args.bin_dir / name), *map(str, params)], env=safe,
                stdout=output, stderr=output, check=True, timeout=60,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    started = False
    try:
        run('initdb', '-D', scratch / 'data', '-U', 'notes_test', '-A', 'trust', '--no-locale', '-E', 'UTF8')
        run('pg_ctl', '-D', scratch / 'data', '-l', scratch / 'postgres.log', '-o',
            f'-h 127.0.0.1 -p {port}', '-w', 'start')
        started = True
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_card_notes import models, TABLES, router, run_card_notes_migration
        from peewee import PostgresqlDatabase
        db = PostgresqlDatabase('postgres', host='127.0.0.1', port=port, user='notes_test')
        db.bind([*TABLES, models.TMACardNote, models.TMAUserMessage]); db.create_tables(TABLES)
        for role in ('anon', 'authenticated'):
            db.execute_sql(f'CREATE ROLE {role}')
        run_card_notes_migration(db)
        deck = models.TMA_Deck.create(user_id=1, name='Synthetic')
        card = models.TMA_Card.create(deck=deck, front_text='Hallo', back_text='Hello')
        note_id = uuid4()
        first = router.save_note(card.id, note_id, router.NoteWrite(text='Private'), 1)
        run_card_notes_migration(db)
        assert router.list_notes(card.id, 1)[0]['id'] == first['id']
        for table in ('tma_card_note', 'tma_user_message'):
            assert db.execute_sql(
                'SELECT relrowsecurity FROM pg_class WHERE relname=%s', (table,)).fetchone() == (True,)
            for role in ('anon', 'authenticated'):
                assert db.execute_sql(
                    'SELECT has_table_privilege(%s, %s, %s)',
                    (role, table, 'SELECT')).fetchone() == (False,)
        message_id = str(uuid4())
        models.TMAUserMessage.create(id=message_id, user_id=1, sender='user',
            kind='suggestion', text='Typo', card_id=card.id, link=f'/cards/{card.id}')
        models.TMAUserMessage.create(id=str(uuid4()), user_id=1, sender='admin',
            kind='reply', text='Fixed', thread=message_id)
        card.delete_instance()
        assert models.TMACardNote.select().count() == 0
        assert models.TMAUserMessage.select().count() == 2
        catalog = [
            db.execute_sql("SELECT table_name, column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('tma_card_note', 'tma_user_message') ORDER BY table_name, ordinal_position").fetchall(),
            db.execute_sql("SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE c.relname IN ('tma_card_note', 'tma_user_message') ORDER BY c.relname, con.conname").fetchall(),
            db.execute_sql("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('tma_card_note', 'tma_user_message') ORDER BY tablename, indexname").fetchall(),
        ]
        args.catalog.parent.mkdir(parents=True, exist_ok=True)
        args.catalog.write_text(json.dumps(catalog, indent=2), encoding='utf-8')
        print('PASS: disposable PostgreSQL migration/rerun, RLS/grants, note cascade, retained message thread; catalog captured')
        db.close()
    finally:
        if started:
            run('pg_ctl', '-D', scratch / 'data', '-m', 'immediate', '-w', 'stop')
            data = (scratch / 'data').resolve()
            assert data.parent == scratch.resolve() and scratch.parent == root / 'local' / 'test-data'
            assert scratch.name.startswith('card-notes-pg-')
            shutil.rmtree(data)


if __name__ == '__main__':
    main()
