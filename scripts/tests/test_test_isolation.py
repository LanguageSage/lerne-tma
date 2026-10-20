"""Prove the backend runner refuses configured external infrastructure."""
import asyncio
from contextlib import redirect_stdout
from io import StringIO
import os
import socket
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dotenv import load_dotenv
from peewee import PostgresqlDatabase


class IsolationTests(unittest.TestCase):
    def test_check_reports_failure_and_still_runs_remaining_gates(self):
        from scripts import check
        output = StringIO()
        with redirect_stdout(output), patch.object(check.shutil, 'which', return_value='npm'), patch.object(
                check.subprocess, 'run', side_effect=[SimpleNamespace(returncode=value)
                    for value in (1, 0, 0, 0, 0)]) as run:
            self.assertEqual(check.main(), 1)
        self.assertEqual(run.call_count, 5)
        self.assertIn('Checks failed: frontend', output.getvalue())

    def test_dotenv_and_database_startup_are_disabled(self):
        from api import database
        self.assertFalse(load_dotenv())
        self.assertFalse(database.initialize_database())
        self.assertNotIn('SUPABASE_DB_URL', os.environ)
        self.assertEqual(os.environ['RUN_MIGRATIONS'], 'false')

    def test_external_tcp_udp_and_native_postgres_connections_are_blocked(self):
        with socket.socket() as sock:
            for connect in (sock.connect, sock.connect_ex):
                with self.assertRaisesRegex(RuntimeError, 'External services disabled'):
                    connect(('127.0.0.1', 5432))
        with socket.socket(type=socket.SOCK_DGRAM) as sock:
            with self.assertRaisesRegex(RuntimeError, 'External services disabled'):
                sock.sendto(b'test', ('127.0.0.1', 5432))
        with self.assertRaisesRegex(RuntimeError, 'External services disabled'):
            PostgresqlDatabase('test').connect()

    def test_asyncio_internal_socketpair_remains_usable(self):
        async def run():
            await asyncio.sleep(0)
            return 42
        self.assertEqual(asyncio.run(run()), 42)
