"""Standalone PostgreSQL observation. No model initialization, DDL or conversion."""
import hashlib
import json
from datetime import datetime, timezone


def _identifier(value):
    return '"' + value.replace('"', '""') + '"'


def inspect_postgres(database):
    """Own the transaction; a failed/incomplete scan must never yield a permit.

    All public tables are included, even unknown ones and soft-deleted rows.
    Row bytes are hashed server-side; no educational/personal content is returned.
    Sequences are not MVCC: comparison is meaningful only with all writers stopped.
    """
    if database.in_transaction():
        raise ValueError('Preflight requires its own read-only transaction')
    with database.atomic():
        database.execute_sql('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        database.execute_sql("SET LOCAL statement_timeout = '60s'")
        database.execute_sql("SET LOCAL lock_timeout = '3s'")
        database.execute_sql("SET LOCAL timezone = 'UTC'")
        database.execute_sql("SET LOCAL search_path = pg_catalog, public")
        relations = database.execute_sql("""SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
            (r.rolsuper OR r.rolbypassrls OR (c.relowner=r.oid AND NOT c.relforcerowsecurity))
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN pg_roles r WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND r.rolname=current_user ORDER BY c.relname""").fetchall()
        blockers = ['writer_fence_not_verified', 'device_coverage_not_verified', 'rollback_not_verified']
        tables = {}
        for name, rls, force_rls, unrestricted in relations:
            if rls and not unrestricted:
                raise ValueError('Preflight role cannot observe all rows')
            quoted = 'public.' + _identifier(name)
            columns = database.execute_sql("""SELECT a.attname, format_type(a.atttypid,a.atttypmod),
                a.attnotnull, pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated
                FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                WHERE a.attrelid=%s::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum""",
                (quoted,)).fetchall()
            constraints = database.execute_sql("""SELECT conname, pg_get_constraintdef(oid), convalidated
                FROM pg_constraint WHERE conrelid=%s::regclass ORDER BY conname""", (quoted,)).fetchall()
            indexes = database.execute_sql("""SELECT indexname,indexdef FROM pg_indexes
                WHERE schemaname='public' AND tablename=%s ORDER BY indexname""", (name,)).fetchall()
            digest = hashlib.sha256()
            count = 0
            cursor = database.execute_sql(f"""SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')
                FROM {quoted} t ORDER BY 1""")
            for (row_hash,) in cursor:
                count += 1
                digest.update(row_hash.encode('ascii'))
            tables[name] = {'rows': count, 'sha256': digest.hexdigest(), 'columns': columns,
                            'constraints': constraints, 'indexes': indexes, 'rls': [rls, force_rls]}
        for required in ('tma_card', 'card', 'tma_deck', 'deck', 'tma_folder', 'tma_user',
                         'tmaprogress', 'tmareviewhistory', 'tma_offline_batch', 'tma_migration_history',
                         'tma_card_note', 'tma_card_rating', 'tma_knowledge_attempt',
                         'tma_knowledge_item', 'tma_card_knowledge_item', 'tma_user_knowledge_state',
                         'tma_user_message', 'tma_collaborator', 'tmamedia', 'tmasetting'):
            if required not in tables:
                blockers.append('missing_table:' + required)
        cards = {}
        for name in ('tma_card', 'card'):
            if name not in tables:
                continue
            fields = {column[0] for column in tables[name]['columns']}
            if not {'content_v2', 'is_deleted'}.issubset(fields):
                blockers.append('missing_v2_schema:' + name)
                continue
            cards[name] = dict(zip(('v1_active', 'v1_deleted', 'v2'), database.execute_sql(f"""
                SELECT count(*) FILTER (WHERE content_v2 IS NULL AND NOT is_deleted),
                count(*) FILTER (WHERE content_v2 IS NULL AND is_deleted),
                count(*) FILTER (WHERE content_v2 IS NOT NULL) FROM public.{_identifier(name)}""").fetchone()))
        sequences = {}
        for (name,) in database.execute_sql("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"):
            sequences[name] = database.execute_sql(f'SELECT last_value,is_called FROM public.{_identifier(name)}').fetchone()
        manifest = {'tables': tables, 'sequences': sequences}
        fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True, default=str).encode()).hexdigest()
        data = {name: {key: table[key] for key in ('rows', 'sha256')} for name, table in tables.items()}
        data_fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        return {'format': 'lerne-card-cutover-postgres-v1', 'observed_at': datetime.now(timezone.utc).isoformat(),
                'scope': 'public', 'manifest': manifest, 'fingerprint': fingerprint, 'cards': cards,
                'data_fingerprint': data_fingerprint,
                'safe_to_stop_v1_writes': False, 'blockers': blockers,
                'not_covered': ['browser_storage', 'external_media_bytes', 'roles_and_grants',
                                'views_functions_triggers_policies', 'non_public_schemas',
                                'in_flight_writers', 'converter_readiness']}
