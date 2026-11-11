"""Observe an explicitly selected PostgreSQL; never starts the app or migrates it.

Usage: python scripts/structured_cards_preflight.py --dsn-env CUTOVER_DATABASE_URL
Output is an observation, not permission to migrate. Exit 2 means cutover blocked.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn-env', required=True, help='Explicit environment variable holding the target DSN')
    args = parser.parse_args()
    url = os.environ.get(args.dsn_env, '')
    try:
        valid = urlsplit(url).scheme in ('postgres', 'postgresql')
    except ValueError:
        valid = False
    if not valid:
        parser.error('The selected variable must contain a PostgreSQL DSN')
    from playhouse.db_url import connect
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from api.card_cutover_preflight import inspect_postgres
    try:
        database = connect(url, connect_timeout=5)
        with database.connection_context():
            report = inspect_postgres(database)
        print(json.dumps(report, ensure_ascii=False, default=str))
        return 2
    except Exception as error:
        # Drivers may include a DSN or data in their exception text.
        print(json.dumps({'safe_to_stop_v1_writes': False, 'error': type(error).__name__}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
