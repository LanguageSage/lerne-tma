"""Run media regressions in fresh schemas of the disposable security-test DB."""
import threading
import unittest
from uuid import uuid4

from peewee import PostgresqlDatabase
from playhouse.pool import PooledPostgresqlDatabase


def verify(database_name, connection_args):
    from scripts.tests.test_media_db_workers import MediaDbWorkerTests
    assert database_name.startswith('lerne_security_test_')
    admin = PostgresqlDatabase(database_name, **connection_args)
    schemas = []

    class Pool(PooledPostgresqlDatabase):
        def __init__(self, schema):
            self.events = []
            super().__init__(database_name, max_connections=2, stale_timeout=300,
                             options=f'-c search_path={schema}', **connection_args)

        def _connect(self):
            connection = super()._connect()
            self.events.append(('open', threading.get_ident(), connection))
            return connection

        def _close(self, connection, close_conn=False):
            self.events.append(('close', threading.get_ident(), connection))
            return super()._close(connection, close_conn=close_conn)

        def execute_sql(self, sql, params=None):
            connection = self.connection()
            self.events.append(('sql', threading.get_ident(), connection))
            return super().execute_sql(sql, params)

    def factory():
        schema = 'media_' + uuid4().hex
        with admin.connection_context():
            admin.execute_sql(f'CREATE SCHEMA {schema}')
        schemas.append(schema)
        return Pool(schema)

    class PostgresMediaTests(MediaDbWorkerTests):
        database_factory = staticmethod(factory)

    try:
        result = unittest.TextTestRunner(verbosity=1).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(PostgresMediaTests))
        assert result.wasSuccessful() and not result.skipped, 'PostgreSQL media regressions failed'
        print('PASS: media contracts, concurrent requests, TTS scopes and cleanup with PostgreSQL pool limit 2', flush=True)
    finally:
        with admin.connection_context():
            for schema in schemas:
                admin.execute_sql(f'DROP SCHEMA {schema} CASCADE')
