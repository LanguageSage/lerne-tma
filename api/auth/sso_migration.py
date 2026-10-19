"""Explicit Game Test schema upgrade. Never called by API startup."""
from peewee import PostgresqlDatabase, SqliteDatabase

from api.models import TMAAuthIdentity, TMAAuthChallenge

MIGRATION_ID = 89


def migrate_lerne_sso(database):
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)) or database.in_transaction():
        raise RuntimeError('SSO migration requires its own PostgreSQL/SQLite transaction')
    models = (TMAAuthIdentity, TMAAuthChallenge)
    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    with database.atomic(**options):
        if isinstance(database, PostgresqlDatabase):
            database.execute_sql("SET LOCAL lock_timeout = '5s'")
            database.execute_sql("SET LOCAL statement_timeout = '60s'")
            database.execute_sql('SELECT pg_advisory_xact_lock(76120989)')
        marker = database.param
        applied = database.execute_sql(
            f'SELECT 1 FROM tma_migration_history WHERE migration_id = {marker}', (MIGRATION_ID,)).fetchone()
        definitions = {}
        for model in models:
            table = model._meta.table_name
            if isinstance(database, PostgresqlDatabase):
                checks = database.execute_sql(
                    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = %s::regclass AND contype = 'c' "
                    "AND pg_get_constraintdef(oid) LIKE '%%provider%%'", (table,)).fetchall()
                if len(checks) != 1:
                    raise RuntimeError('Unexpected auth provider constraints')
                definitions[table] = checks[0]
            else:
                row = database.execute_sql("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
                if row is None:
                    raise RuntimeError('Auth schema missing')
                definitions[table] = (None, row[0])
        if applied:
            if any("'lerne'" not in definition for _, definition in definitions.values()):
                raise RuntimeError('SSO migration history/schema mismatch')
            return {'applied': False, 'migration_id': MIGRATION_ID}
        with database.bind_ctx(models, bind_refs=False, bind_backrefs=False):
            for model in models:
                table = model._meta.table_name
                if isinstance(database, PostgresqlDatabase):
                    name = definitions[table][0].replace('"', '""')
                    database.execute_sql(f'ALTER TABLE "{table}" DROP CONSTRAINT "{name}"')
                    database.execute_sql(f'ALTER TABLE "{table}" ADD CONSTRAINT "{table}_provider_check" '
                                         "CHECK (provider IN ('telegram', 'google', 'lerne'))")
                else:
                    # These two leaf tables have no incoming foreign keys.
                    # Rebuild atomically because SQLite cannot alter CHECK clauses.
                    columns = ', '.join('"' + field.column_name + '"' for field in model._meta.sorted_fields)
                    sql, params = model._schema._create_table(safe=False).query()
                    temporary = table + '_sso_new'
                    database.execute_sql(sql.replace(f'"{table}"', f'"{temporary}"', 1), params)
                    database.execute_sql(f'INSERT INTO "{temporary}" ({columns}) SELECT {columns} FROM "{table}"')
                    database.execute_sql(f'DROP TABLE "{table}"')
                    database.execute_sql(f'ALTER TABLE "{temporary}" RENAME TO "{table}"')
                    model._schema.create_indexes(safe=False)
        database.execute_sql(f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})', (MIGRATION_ID,))
        return {'applied': True, 'migration_id': MIGRATION_ID}
