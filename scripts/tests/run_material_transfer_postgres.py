"""Run the transfer suite in a freshly created, isolated native PostgreSQL cluster.

No existing server/config/database is used. Requires --bin-dir; loopback only,
random free port, temporary PGDATA, synthetic users, no external network.
"""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bin-dir', type=Path, required=True)
    args = parser.parse_args()
    binaries = args.bin_dir.resolve()
    for name in ('initdb', 'pg_ctl'):
        if not (binaries / (name + ('.exe' if os.name == 'nt' else ''))).is_file():
            parser.error('PostgreSQL binaries not found')
    root = Path(tempfile.gettempdir()).resolve() / ('lerne-transfer-pg-' + uuid4().hex)
    root.mkdir()  # Inherit Windows ACLs, unlike Python 3.14 mkdtemp.
    data = root / 'pgdata'
    log = root / 'postgres.log'
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'}}
    env.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', RUN_MIGRATIONS='false',
               PGCONNECT_TIMEOUT='5', PGCLIENTENCODING='UTF8')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    def run(name, *arguments):
        # PostgreSQL's Windows children inherit pipe handles. File redirection
        # avoids communicate() waiting forever after pg_ctl itself has exited.
        output = root / f'{name}.log'
        with output.open('wb') as stream:
            result = subprocess.run([str(binaries / name), *map(str, arguments)], env=env,
                                    stdout=stream, stderr=stream, timeout=60, creationflags=flags)
        if result.returncode:
            raise RuntimeError(f'{name} failed in disposable PostgreSQL cluster: ' + output.read_text(errors='replace'))
    started = False
    try:
        run('initdb', '-D', data, '-U', 'transfer_test', '-A', 'trust', '--no-locale', '-E', 'UTF8')
        run('pg_ctl', '-D', data, '-l', log, '-o', f'-h 127.0.0.1 -p {port} -c max_connections=30', '-w', 'start')
        started = True
        with patch.dict(os.environ, env, clear=True):
            sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
            from peewee import PostgresqlDatabase
            from api import database
            with patch.object(database, 'initialize_database', return_value=False):
                from scripts.tests import test_material_transfer as suite
            admin = PostgresqlDatabase('postgres', user='transfer_test', host='127.0.0.1', port=port)
            def fresh_database(*_args, **_kwargs):
                name = 'transfer_' + uuid4().hex
                # Identifier generated here, never input from config/environment.
                admin.execute_sql(f'CREATE DATABASE "{name}"')
                return PostgresqlDatabase(name, user='transfer_test', host='127.0.0.1', port=port,
                                          options='-c statement_timeout=10000 -c lock_timeout=3000')
            def no_network(*_args, **_kwargs):
                raise AssertionError('External HTTP disabled in PostgreSQL transfer tests')
            with patch.object(suite, 'SqliteDatabase', side_effect=fresh_database), \
                    patch('requests.head', side_effect=no_network), patch('requests.get', side_effect=no_network):
                result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(suite))
            admin.close()
            return int(not result.wasSuccessful())
    finally:
        if started:
            run('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop')
        # Only our verified, newly generated temporary cluster can be removed.
        assert root.parent == Path(tempfile.gettempdir()).resolve() and root.name.startswith('lerne-transfer-pg-')
        shutil.rmtree(root)


if __name__ == '__main__':
    raise SystemExit(main())
