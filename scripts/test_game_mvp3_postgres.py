"""Explicit local disposable PostgreSQL probe. Never loads .env or a default DB.

Requires GAME_MVP3_TEST_DB_URL with localhost and database name
lerne_game_mvp3_test_*. The database must already exist and have an empty public
schema. All schema/data writes are rolled back. No server/application is started.
"""
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def disposable_database(url):
    """Construct, but do not connect. Shared by the deliberately isolated pilot."""
    if not url:
        raise ValueError('GAME_MVP3_TEST_DB_URL is not configured. No DB was contacted.')
    try:
        parsed = urlparse(url)
        port = parsed.port or 5432
    except ValueError:
        raise ValueError('Invalid disposable database URL.') from None
    name = parsed.path.lstrip('/')
    if (parsed.scheme not in ('postgres', 'postgresql') or
            parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or
            not name.startswith('lerne_game_mvp3_test_') or parsed.query or parsed.fragment):
        raise ValueError('Require a local disposable lerne_game_mvp3_test_* DB, without URL options.')
    from peewee import PostgresqlDatabase
    return PostgresqlDatabase(name, host=parsed.hostname, port=port,
                            user=unquote(parsed.username or ''),
                            password=unquote(parsed.password or ''), connect_timeout=5,
                            options='-c search_path=public')


def main():
    try:
        db = disposable_database(os.getenv('GAME_MVP3_TEST_DB_URL', ''))
    except ValueError as exc:
        print(f'BLOCKED/REFUSED: {exc}')
        return 2
    name = db.database
    from peewee import IntegrityError, PostgresqlDatabase
    # Suppress legacy import-time production initialization before importing models.
    with patch('dotenv.load_dotenv', return_value=False), patch.dict(os.environ, {
            'VERCEL': '1', 'RUN_MIGRATIONS': 'false', 'FORCE_LOCAL_DB': 'false'}):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False):
            from api.models import TMAGameAttempt, tma_db
            from api.game_mvp3.migration import run_migration
            from api.game_mvp3.models import MODELS, NPCMemory, GameInteraction
            from api.game_mvp3.memory import NPCMemoryService
            from api.game_mvp3.schemas import MemoryEvent, MemoryFact
    previous = tma_db.obj
    tma_db.initialize(db)
    other = PostgresqlDatabase(name, **db.connect_params)
    lock = 761209880012
    try:
        with db.connection_context():
            if db.get_tables():
                print('REFUSED: public schema is not empty. No schema/data writes performed.')
                return 2
            with db.atomic() as probe:
                db.execute_sql("SET LOCAL lock_timeout='5s'")
                db.execute_sql("SET LOCAL statement_timeout='30s'")
                db.create_tables([TMAGameAttempt])
                now = datetime(2026, 10, 12)
                a = TMAGameAttempt.create(id=str(uuid4()), user_id=101, npc_id='frau_mueller',
                    situation_id='library_balcony_book_v1', scene_state='{}', history='[]',
                    created_at=now, updated_at=now)
                assert run_migration(db) == {'migration_id': 88, 'applied': True}
                assert run_migration(db) == {'migration_id': 88, 'applied': False}
                assert TMAGameAttempt.get_by_id(a.id).version == 0
                assert db.execute_sql(
                    'SELECT COUNT(*) FROM tma_migration_history WHERE migration_id=88').fetchone()[0] == 1
                for model in MODELS:
                    table = model._meta.table_name
                    assert db.execute_sql(
                        'SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass', (table,)).fetchone()[0]
                    assert not db.execute_sql(
                        'SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename=%s',
                        (table,)).fetchall()
                    assert db.execute_sql(
                        "SELECT COUNT(*) FROM pg_class c, LATERAL aclexplode("
                        "COALESCE(c.relacl, acldefault('r', c.relowner))) x "
                        'WHERE c.oid=%s::regclass AND x.grantee=0', (table,)).fetchone()[0] == 0
                    for role in ('anon', 'authenticated'):
                        if db.execute_sql('SELECT 1 FROM pg_roles WHERE rolname=%s', (role,)).fetchone():
                            for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                                assert not db.execute_sql('SELECT has_table_privilege(%s,%s,%s)',
                                                          (role, table, privilege)).fetchone()[0]
                        else:
                            print(f'LIMITATION: role {role} absent; its privileges were not exercised.')
                memory = NPCMemoryService()
                event = MemoryEvent(event_id=f'{a.id}:encounter', attempt_id=a.id,
                    source='engine', fact=MemoryFact(kind='encounter', key='meeting', value='visited'))
                saved = memory.record(101, a.npc_id, event)
                assert memory.record(101, a.npc_id, event)['id'] == saved['id']
                assert memory.relevant(202, a.npc_id) == []
                try:
                    with db.atomic():
                        values = dict(NPCMemory.get_by_id(saved['id']).__data__)
                        values['id'] = str(uuid4())
                        NPCMemory.create(**values)
                    raise AssertionError('Unique constraint failed')
                except IntegrityError:
                    pass
                try:
                    with db.atomic():
                        GameInteraction.create(id=str(uuid4()), user_id=101, source_attempt=str(uuid4()),
                            source_version=1, request_id=str(uuid4()), task_id=a.situation_id,
                            kind='chat', facts='{}', created_at=now)
                    raise AssertionError('Foreign key failed')
                except IntegrityError:
                    pass
                TMAGameAttempt.delete().where(TMAGameAttempt.id == a.id).execute()
                assert NPCMemory.select().count() == 0
                db.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock,))
                with other.connection_context(), other.atomic():
                    assert not other.execute_sql('SELECT pg_try_advisory_xact_lock(%s)', (lock,)).fetchone()[0]
                probe.rollback()
            assert db.get_tables() == []
            with other.connection_context(), other.atomic():
                assert other.execute_sql('SELECT pg_try_advisory_xact_lock(%s)', (lock,)).fetchone()[0]
        print('PASS: migration 88 rerun, rows, RLS/grants, uniqueness, FK/CASCADE, '
              'ownership, replay, advisory lock and complete rollback in disposable PostgreSQL.')
        return 0
    except Exception as exc:
        # Do not leak DSN/password/driver messages.
        print(f'FAILED/BLOCKED: PostgreSQL probe ({type(exc).__name__}). No production DB used.')
        return 1
    finally:
        db.close()
        other.close()
        tma_db.initialize(previous)


if __name__ == '__main__':
    raise SystemExit(main())
