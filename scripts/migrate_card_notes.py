"""Inspect or apply additive migration 87 to an explicitly selected PostgreSQL DSN."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit
from peewee import PostgresqlDatabase
from playhouse.db_url import connect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    url = os.environ.get('CARD_NOTES_MIGRATION_DATABASE_URL')
    if not url:
        parser.error('Set CARD_NOTES_MIGRATION_DATABASE_URL explicitly; no app-config fallback')
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
            raise ValueError('Invalid PostgreSQL DSN')
        ssl_modes = parse_qs(parsed.query).get('sslmode', [])
        if parsed.hostname not in ('localhost', '127.0.0.1', '::1') and (
                len(ssl_modes) != 1 or ssl_modes[0] not in ('require', 'verify-ca', 'verify-full')):
            raise ValueError('Remote migration DSN must require TLS')
        # Model imports must never run schema initialization on the app database.
        os.environ.update(PYTHON_DOTENV_DISABLED='1', LERNE_SKIP_SCHEMA_INIT='1', RUN_MIGRATIONS='false')
        from api.migrations import run_card_notes_migration
        database = connect(url, connect_timeout=10)
        if not isinstance(database, PostgresqlDatabase):
            raise ValueError('PostgreSQL required')
        with database.connection_context():
            if not database.table_exists('tma_card'):
                raise RuntimeError('Existing TMA cards schema required')
            if args.apply:
                run_card_notes_migration(database)
            print(json.dumps({'mode': 'apply' if args.apply else 'inspect',
                              'table_present': database.table_exists('tma_card_note')}))
        return 0
    except Exception:
        print('Card notes migration failed. Check the explicit target and database access; '
              'no failed transaction is recorded as successful.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
