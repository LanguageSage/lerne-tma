"""Prepared migration 88. No CLI, .env initialization or startup registration."""
from contextlib import nullcontext
from peewee import PostgresqlDatabase, SqliteDatabase
from .models import MODELS

MIGRATION_ID = 88


def _protect(database, table):
    database.execute_sql(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
    # Lerne account IDs are integers from its own auth, not Supabase auth.uid().
    # No Data API grants or policies: only the privileged backend accesses these.
    database.execute_sql(f'REVOKE ALL ON "{table}" FROM PUBLIC')
    for role in ('anon', 'authenticated'):
        database.execute_sql(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE ALL ON "{table}" FROM {role};
            END IF;
        END $$""")
    # Fail closed on reruns if unexpected policies were added out of band.
    policies = database.execute_sql(
        'SELECT policyname FROM pg_policies WHERE schemaname = current_schema() AND tablename = %s',
        (table,)).fetchall()
    if policies:
        raise RuntimeError('Unexpected MVP 3 Data API policies')


def run_migration(database):
    """Caller must explicitly supply an authorized database; never reads credentials."""
    database = getattr(database, 'obj', database)
    if not isinstance(database, (PostgresqlDatabase, SqliteDatabase)):
        raise RuntimeError('Unsupported MVP 3 database')
    with database.connection_context() if database.is_closed() else nullcontext():
        with database.atomic(**({'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {})):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '30s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120988)')
            if 'tma_game_attempt' not in database.get_tables():
                raise RuntimeError('Game Mode migration 87 is required')
            database.execute_sql('CREATE TABLE IF NOT EXISTS tma_migration_history '
                                 '(migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
            previous = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {database.param}',
                (MIGRATION_ID,)).fetchone()
            if previous and not {m._meta.table_name for m in MODELS} <= set(database.get_tables()):
                raise RuntimeError('Migration 88 already used by a different or incomplete schema')
            with database.bind_ctx(MODELS, bind_refs=False, bind_backrefs=False):
                database.create_tables(MODELS, safe=True)
                for model in MODELS:
                    table = model._meta.table_name
                    if not set(model._meta.columns) <= {c.name for c in database.get_columns(table)}:
                        raise RuntimeError('MVP 3 schema/history mismatch')
                    if database.get_primary_keys(table) != [model._meta.primary_key.column_name]:
                        raise RuntimeError('MVP 3 primary key mismatch')
                    expected = {tuple(model._meta.fields[f].column_name for f in fields)
                                for fields, unique in model._meta.indexes if unique}
                    actual = {tuple(index.columns) for index in database.get_indexes(table) if index.unique}
                    if not expected <= actual:
                        raise RuntimeError('MVP 3 unique constraints missing')
                    foreign_keys = database.get_foreign_keys(table)
                    if not any(f.column == 'source_attempt_id' and f.dest_table == 'tma_game_attempt'
                               and f.dest_column == 'id' for f in foreign_keys):
                        raise RuntimeError('MVP 3 source foreign key missing')
                    if isinstance(database, SqliteDatabase):
                        cascades = database.execute_sql(f'PRAGMA foreign_key_list("{table}")').fetchall()
                        valid = any(f[2] == 'tma_game_attempt' and f[3] == 'source_attempt_id'
                                    and f[6] == 'CASCADE' for f in cascades)
                    else:
                        valid = bool(database.execute_sql(
                            'SELECT 1 FROM pg_constraint c '
                            'JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) '
                            "WHERE c.conrelid=%s::regclass AND c.contype='f' "
                            "AND a.attname='source_attempt_id' AND c.confdeltype='c'",
                            (table,)).fetchone())
                    if not valid:
                        raise RuntimeError('MVP 3 source cascade missing')
                    if isinstance(database, PostgresqlDatabase):
                        _protect(database, table)
            database.execute_sql(
                f'INSERT INTO tma_migration_history (migration_id) VALUES ({database.param}) '
                'ON CONFLICT (migration_id) DO NOTHING', (MIGRATION_ID,))
            return {'migration_id': MIGRATION_ID, 'applied': not bool(previous)}
