"""Inspect/apply migration 89 only to explicitly named Game Test PostgreSQL."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.prepare_game_test import PROJECT_ID, verify_target, canonical_models


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    url = os.getenv('GAME_TEST_DATABASE_URL')
    if not url:
        parser.error('Set GAME_TEST_DATABASE_URL explicitly; application env is not used')
    try:
        verify_target(PROJECT_ID, url)
        canonical_models()  # Suppress legacy dotenv/startup before importing models.
        from playhouse.db_url import connect
        from api.auth.sso_migration import migrate_lerne_sso, MIGRATION_ID
        database = connect(url, sslmode='require', connect_timeout=10)
        with database.connection_context():
            applied = bool(database.execute_sql(
                'SELECT 1 FROM tma_migration_history WHERE migration_id = %s', (MIGRATION_ID,)).fetchone())
            report = {'project': PROJECT_ID, 'migration_id': MIGRATION_ID, 'recorded': applied}
            if args.apply:
                report['result'] = migrate_lerne_sso(database)
            print(json.dumps(report))
        return 0
    except Exception:
        print('SSO migration failed. Check the explicit Game Test target and schema; no secrets are printed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
