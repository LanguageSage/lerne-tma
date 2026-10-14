"""Additive Game Mode schema with transactional history and private Data API access."""
from peewee import PostgresqlDatabase, SqliteDatabase

MIGRATION_ID = 87


def run_game_migration(database):
    from api.models import TMAGameAttempt

    database = getattr(database, 'obj', database)
    if not isinstance(database, (PostgresqlDatabase, SqliteDatabase)):
        raise RuntimeError('Unsupported Game Mode database')
    with database.connection_context():
        options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '30s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120987)')
            database.execute_sql('CREATE TABLE IF NOT EXISTS tma_migration_history '
                                 '(migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
            with database.bind_ctx([TMAGameAttempt], bind_refs=False, bind_backrefs=False):
                database.create_tables([TMAGameAttempt], safe=True)
            required = set(TMAGameAttempt._meta.columns)
            columns = {c.name for c in database.get_columns('tma_game_attempt')}
            if not required <= columns:
                raise RuntimeError('Game Mode schema/history mismatch')
            if isinstance(database, PostgresqlDatabase):
                # Lerne authenticates in FastAPI, not via Supabase Auth JWTs.
                # No public policy: only the backend's privileged DB connection accesses rows.
                database.execute_sql('ALTER TABLE tma_game_attempt ENABLE ROW LEVEL SECURITY')
                database.execute_sql('REVOKE ALL ON tma_game_attempt FROM PUBLIC')
                database.execute_sql("""DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                        REVOKE ALL ON tma_game_attempt FROM anon;
                    END IF;
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                        REVOKE ALL ON tma_game_attempt FROM authenticated;
                    END IF;
                END $$""")
            database.execute_sql(
                f'INSERT INTO tma_migration_history (migration_id) VALUES ({database.param}) '
                'ON CONFLICT (migration_id) DO NOTHING', (MIGRATION_ID,))
    return {'migration_id': MIGRATION_ID}


if __name__ == '__main__':
    from api.database import initialize_database, tma_db
    if not initialize_database():
        raise SystemExit('Database is not configured')
    print(run_game_migration(tma_db))
