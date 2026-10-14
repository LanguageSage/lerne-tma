"""Safe isolated test entry: block production DB startup and external sockets."""
import os
import socket
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    # Windows asyncio uses a TCP loopback socketpair internally. Permit only
    # socketpair setup, while keeping ordinary outbound connect/connect_ex blocked.
    context = threading.local()
    original_pair = socket.socketpair
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def socketpair(*args, **kwargs):
        context.socketpair_setup = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            context.socketpair_setup = False

    def guarded_connect(sock, address):
        if not getattr(context, 'socketpair_setup', False):
            raise RuntimeError('Network disabled in isolated tests')
        return original_connect(sock, address)

    def guarded_connect_ex(sock, address):
        if not getattr(context, 'socketpair_setup', False):
            raise RuntimeError('Network disabled in isolated tests')
        return original_connect_ex(sock, address)

    # Patch dotenv before importing api.database: don't load development secrets.
    with patch('dotenv.load_dotenv', return_value=False), patch.dict(
            os.environ, {'VERCEL': '1', 'RUN_MIGRATIONS': 'false', 'FORCE_LOCAL_DB': 'false'}):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False), patch.object(
                socket, 'socketpair', socketpair), patch.object(
                socket.socket, 'connect', guarded_connect), patch.object(
                socket.socket, 'connect_ex', guarded_connect_ex):
            names = sys.argv[1:] or ['tests.test_game_mvp3', 'tests.test_game_mode', 'tests.test_answer_evaluation']
            suite = unittest.defaultTestLoader.loadTestsFromNames(names)
            result = unittest.TextTestRunner(verbosity=1).run(suite)
            return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
