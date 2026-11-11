"""One transaction on a runner-owned local copy; no production DSN or resume.

Apply schema 92/93/94 first. Deleted rows remain byte-for-byte V1 tombstones.
Both active tables must pass the existing converter before the first UPDATE.
"""
import ipaddress
import json
from pathlib import Path

from psycopg2.extras import Json, execute_values

from api.v1_to_v2_converter import run_v1_migration_dry_run

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ('front_text', 'back_text', 'card_type', 'context', 'topics', 'tags', 'metadata')


def verify_target(database):
    if database.in_transaction():
        raise RuntimeError('Migration requires its own transaction')
    name, role, address, port, directory = database.execute_sql(
        "SELECT current_database(),current_user,inet_server_addr()::text,inet_server_port(),current_setting('data_directory')"
    ).fetchone()
    data = Path(directory).resolve()
    if (name == 'lerne_tma_local' or role != 'cards_test' or port == 55432 or
            ipaddress.ip_interface(address).ip != ipaddress.ip_address('127.0.0.1') or
            data.parent.parent != (ROOT / 'local/test-data').resolve() or
            not data.parent.name.startswith('structured-cards-pg-') or data.name != 'data' or
            not (data / 'postmaster.pid').is_file()):
        raise RuntimeError('Only this worktree disposable runner cluster is authorized')


def migrate_active(database):
    verify_target(database)
    prepared = {}
    report = {'transaction': 'single', 'deleted_policy': 'retain unchanged V1; no restore/conversion', 'tables': {}}
    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout='5s'")
        # Ordinary transaction locks keep the validated source stable. No jobs,
        # progress journal, cross-process coordinator or retry protocol exists.
        database.execute_sql('LOCK TABLE tma_card,card,tma_deck,deck IN SHARE ROW EXCLUSIVE MODE')
        for table, deck in (('tma_card', 'tma_deck'), ('card', 'deck')):
            rows = [r[0] for r in database.execute_sql(
                f'SELECT row_to_json(t) FROM {table} t WHERE NOT is_deleted ORDER BY deck_id,position,id')]
            if any(row.get('content_v2') is not None for row in rows):
                raise ValueError('Expected a fresh V1 copy; restore the original dump before retry')
            decks = [r[0] for r in database.execute_sql(f'SELECT row_to_json(t) FROM {deck} t ORDER BY id')]
            result = run_v1_migration_dry_run({'decks': decks, 'cards': rows},
                                             allow_shared_positions=True, include_converted_payloads=True)
            if not result['ok']:
                raise ValueError(f'{table}: prevalidation blocked {result["blocked_count"]} cards; no content written')
            prepared[table] = [(c['card_id'], c['content_v2']) for c in result['cards']]
            report['tables'][table] = {'converted': len(prepared[table]), 'invariants': result['invariants'],
                                       'warnings': result['warning_counts_by_code']}
        # Both complete plans now passed validation. Transport pages below are
        # SQL sizing only: all pages/tables belong to this single transaction.
        for table, values in prepared.items():
            query = f'''UPDATE {table} t SET content_v2=v.content::jsonb,
                        {','.join(field + '=NULL' for field in LEGACY)}
                        FROM (VALUES %s) v(id,content)
                        WHERE t.id=v.id AND NOT t.is_deleted AND t.content_v2 IS NULL RETURNING t.id'''
            if values:
                with database.cursor() as cursor:
                    written = execute_values(cursor, query, [(i, Json(v)) for i, v in values], page_size=1000, fetch=True)
                if {r[0] for r in written} != {i for i, _ in values} or len(written) != len(values):
                    raise ValueError(f'{table}: write count/ID mismatch; rolling back both tables')
            actual = dict(database.execute_sql(f'SELECT id,content_v2 FROM {table} WHERE NOT is_deleted'))
            if actual != dict(values):
                raise ValueError(f'{table}: persisted JSON differs from validated plan')
    return report


def immutable_cards(database):
    """Independent hashes of all non-content fields and complete deleted rows."""
    result = {}
    removed = "ARRAY['content_v2'," + ','.join("'" + f + "'" for f in LEGACY) + ']::text[]'
    for table in ('tma_card', 'card'):
        result[table] = database.execute_sql(f'''
            SELECT id,is_deleted,encode(sha256(convert_to(
                (CASE WHEN is_deleted THEN to_jsonb(t) ELSE to_jsonb(t)-{removed} END)::text,'UTF8')),'hex')
            FROM {table} t ORDER BY id''').fetchall()
    return result
