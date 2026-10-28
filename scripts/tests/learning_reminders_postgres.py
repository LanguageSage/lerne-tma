"""Run personal-learning regressions in a new disposable LOCAL PostgreSQL cluster."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin-dir', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    scratch = root / 'local/test-data' / ('learning-reminders-pg-' + uuid4().hex)
    scratch.mkdir(parents=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    safe = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    safe.update(PYTHON_DOTENV_DISABLED='1', RUN_MIGRATIONS='false', VERCEL='1', PGCLIENTENCODING='UTF8')
    os.environ.clear()
    os.environ.update(safe)

    def run(name, *params):
        with (scratch / (name + '.log')).open('wb') as output:
            subprocess.run([str(args.bin_dir / name), *map(str, params)], env=safe,
                stdout=output, stderr=output, check=True, timeout=60,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    started = False
    try:
        run('initdb', '-D', scratch / 'data', '-U', 'reminder_test', '-A', 'trust', '--no-locale', '-E', 'UTF8')
        run('pg_ctl', '-D', scratch / 'data', '-l', scratch / 'postgres.log', '-o',
            f'-h 127.0.0.1 -p {port}', '-w', 'start')
        started = True
        sys.path.insert(0, str(root))
        from api import database
        with patch.object(database, 'initialize_database', return_value=False):
            import test_learning_reminders as suite
        from peewee import PostgresqlDatabase

        def fixture_db(*_args, **_kwargs):
            # Each case owns its own schema in this freshly initialized cluster.
            schema = 'case_' + uuid4().hex
            db = PostgresqlDatabase('postgres', host='127.0.0.1', port=port, user='reminder_test',
                                    options=f'-c search_path={schema}')
            db.execute_sql(f'CREATE SCHEMA {schema}')
            return db

        with patch.object(suite, 'SqliteDatabase', fixture_db):
            result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(suite))
        if not result.wasSuccessful():
            return 1
        db = fixture_db()
        suite.models.tma_db.initialize(db)
        db.create_tables([suite.models.TMASetting])
        barrier = threading.Barrier(8)
        def claim(_index):
            with db.connection_context():
                barrier.wait(timeout=10)
                return suite.reminders.claim_reminder_slot(101, '2026-10-28_09:00')
        with ThreadPoolExecutor(max_workers=8) as workers:
            assert sum(workers.map(claim, range(8))) == 1
        assert not suite.reminders.claim_reminder_slot(101, '2026-10-28_08:00')
        assert suite.reminders.claim_reminder_slot(101, '2026-10-28_10:00')
        db.close()
        print('PASS: LOCAL PostgreSQL behavior suite and 8 concurrent workers; one slot winner')
        return 0
    finally:
        if started:
            run('pg_ctl', '-D', scratch / 'data', '-m', 'immediate', '-w', 'stop')
        # Retain this disposable cluster and logs under ignored local/test-data.


if __name__ == '__main__':
    raise SystemExit(main())
