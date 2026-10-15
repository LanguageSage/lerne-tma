"""Fresh Game Test bootstrap from canonical ORM models and existing migrations.

Never loads .env or connects on import. --emit-sql only generates a reviewable
plan; the operator must verify the Supabase MCP project's exact ID before applying.
Direct --apply requires an explicit GAME_TEST_DATABASE_URL for the pinned project.
Refuses an existing public schema; subsequent upgrades use existing migrations.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
PROJECT_ID = 'rkkviifehykdeugovlgp'


def verify_target(project_id, url=None):
    if project_id != PROJECT_ID:
        raise ValueError('Only the pinned lerne-game-test project is authorized')
    if url is None:
        return
    parsed = urlsplit(url)
    direct = parsed.hostname == f'db.{PROJECT_ID}.supabase.co'
    pool = (bool(parsed.hostname) and parsed.hostname.endswith('.pooler.supabase.com')
            and unquote(parsed.username or '') == f'postgres.{PROJECT_ID}')
    if (parsed.scheme not in ('postgres', 'postgresql') or not parsed.password
            or parsed.path != '/postgres' or parsed.query or parsed.fragment
            or not (direct or pool)):
        raise ValueError('Require the exact test project DSN, database postgres, without URL options')


def canonical_models():
    # models.py historically initializes a DB on import. Suppress both dotenv and
    # initialization BEFORE importing it; no local credentials are inspected.
    with patch('dotenv.load_dotenv', return_value=False):
        from api import database
        with patch.object(database, 'initialize_database', return_value=False), patch.dict(
                os.environ, {'VERCEL': '1', 'RUN_MIGRATIONS': 'false'}):
            from api import models
            from api.game_mvp3.models import MODELS
    from peewee import Model, sort_models
    found = [value for value in vars(models).values()
             if isinstance(value, type) and issubclass(value, Model)
             and value not in (Model, models.BaseModel)]
    return sort_models(list(dict.fromkeys([*found, *MODELS])))


def bootstrap_sql(project_id):
    verify_target(project_id)
    from peewee import PostgresqlDatabase
    from api.migrations import MIGRATIONS
    models = canonical_models()
    db = PostgresqlDatabase('sql_generation_only')
    db.safe_create_index = True  # Supabase PG17 supports CREATE INDEX IF NOT EXISTS.
    statements = [
        "SET LOCAL lock_timeout = '5s'",
        "SET LOCAL statement_timeout = '60s'",
        'SELECT pg_advisory_xact_lock(761209880015)',
        "SET LOCAL search_path = public",
        """DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')) THEN
            RAISE EXCEPTION 'Fresh bootstrap refused: public schema is not empty';
          END IF;
        END $$""",
        'CREATE TABLE tma_migration_history (migration_id INT PRIMARY KEY, '
        'applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
    ]
    with db.bind_ctx(models, bind_refs=False, bind_backrefs=False):
        for model in models:
            # Some legacy models declare the same index on a field and in Meta.
            contexts = [model._schema._create_table(safe=False), *model._schema._create_indexes(safe=True)]
            for context in contexts:
                sql, params = context.query()
                if params:
                    raise ValueError('Unexpected parameterized schema SQL')
                statements.append(sql)
    # Models describe today's fields. Replay every legacy migration strictly;
    # IF NOT EXISTS is used only for already represented ADD COLUMN operations.
    # Missing legacy-only columns (e.g. deck.share_id) and indexes are still added.
    for marker, sql, _ in MIGRATIONS:
        statements.extend([re.sub(r'\bADD COLUMN\b', 'ADD COLUMN IF NOT EXISTS', sql),
                           f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})'])
    statements.append("CREATE UNIQUE INDEX idx_tma_card_ki_primary ON tma_card_knowledge_item(card_id) WHERE role = 'primary'")
    # Fresh, empty schema includes the complete canonical auth 76–79, mastery 82,
    # Game 87 and MVP3 88 definitions. No legacy identity backfill is necessary.
    for marker in (76, 77, 78, 79, 82, 87, 88):
        statements.append(f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})')
    tables = [m._meta.table_name for m in models] + ['tma_migration_history']
    for table in tables:
        statements.extend([f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY',
                           f'REVOKE ALL ON "{table}" FROM PUBLIC, anon, authenticated'])
    statements.append('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated')
    # Verify canonical columns before committing; PostgreSQL validates the generated
    # primary/unique and FK DDL during creation. Inspect constraints again remotely.
    for model in models:
        table = model._meta.table_name
        columns = ','.join(f"'{column}'" for column in model._meta.columns)
        statements.append(f"""DO $$ BEGIN IF EXISTS (SELECT unnest(ARRAY[{columns}])
          EXCEPT SELECT column_name::text FROM information_schema.columns
          WHERE table_schema='public' AND table_name='{table}')
          THEN RAISE EXCEPTION 'Missing canonical column in {table}'; END IF; END $$""")
    return ';\n'.join(statements) + ';\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-id', required=True)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--emit-sql', type=Path)
    actions.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        verify_target(args.project_id)
        if args.emit_sql:
            sql = bootstrap_sql(args.project_id)
            args.emit_sql.write_text(sql, encoding='utf-8')
            print(json.dumps({'project_id': PROJECT_ID, 'mode': 'generated only', 'bytes': len(sql)}))
        else:
            # Capture before model imports; never fall back to SUPABASE_DB_URL.
            url = os.environ.get('GAME_TEST_DATABASE_URL', '')
            verify_target(args.project_id, url)
            sql = bootstrap_sql(args.project_id)
            from playhouse.db_url import connect
            db = connect(url, sslmode='require', connect_timeout=10)
            with db.connection_context(), db.atomic():
                verify_target(args.project_id, url)
                db.execute_sql(sql)
            print(json.dumps({'project_id': PROJECT_ID, 'mode': 'applied'}))
        return 0
    except Exception as exc:
        print(f'Game Test preparation refused/failed ({type(exc).__name__}); '
              'check the explicit target and empty schema. Credentials are not printed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
