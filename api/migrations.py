"""
Migrations module: все SQL-миграции для существующих баз данных.
При добавлении новой колонки/таблицы — просто добавляй строку в MIGRATIONS.
SQL и история фиксируются атомарно; любая ошибка прерывает запуск.
"""
import logging
import re
from peewee import PostgresqlDatabase, SqliteDatabase

logger = logging.getLogger(__name__)

# Auth migrations have their own explicit transactional runner.
# They are never run on API startup.
AUTH_FOUNDATION_MIGRATION_ID = 76
AUTH_CHALLENGE_MIGRATION_ID = 77
AUTH_PASSWORD_MIGRATION_ID = 78
AUTH_SESSION_METHOD_MIGRATION_ID = 79
AUTH_PROFILE_MIGRATION_ID = 91
KNOWLEDGE_MASTERY_MIGRATION_ID = 82
KNOWLEDGE_MASTERY_LOCK_ID = 76120982
CARD_COMMUNICATION_MIGRATION_ID = 90  # 87-89 are already recorded in deployed histories.
CARD_RATING_MIGRATION_ID = 92  # 91 belongs to the auth profile migration.
CARD_RATING_LOCK_ID = 76120992
STRUCTURED_CARDS_V2_MIGRATION_ID = 93
STRUCTURED_CARDS_V2_LOCK_ID = 76120993
LIBRARY_CARDS_V2_MIGRATION_ID = 94
LIBRARY_CARDS_V2_LOCK_ID = 76120994
CARD_SOURCE_MIGRATION_ID = 95
CARD_SOURCE_LOCK_ID = 76120995
UNIFIED_CARDS_MIGRATION_ID = 96
_LEGACY_CONTENT_FIELDS = ('front_text', 'back_text', 'card_type', 'context', 'topics', 'tags', 'metadata')


def run_library_cleanup_migration(database):
    """Explicit maintenance after 96. Compare complete rows before restricted DROP.

    All writers must be stopped. Keep the pre-cutover dump outside the live DB.
    No source data is inferred from names alone and no unknown FK is removed.
    """
    import hashlib
    import json
    from collections import Counter
    from api.services.sync_generation import ANCHOR_KEY, RESTORE_KEY

    database = getattr(database, 'obj', database)
    if not isinstance(database, PostgresqlDatabase) or database.in_transaction():
        raise MigrationError('Cleanup requires PostgreSQL and its own transaction')
    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout = '5s'")
        database.execute_sql("SET LOCAL statement_timeout = '120s'")
        database.execute_sql('SELECT pg_advisory_xact_lock(76120996)')
        history = {r[0] for r in database.execute_sql('SELECT migration_id FROM tma_migration_history')}
        tables = set(database.get_tables())
        retired = {'card', 'deck', 'progress', 'reviewhistory', 'uservoice'} & tables
        if 97 in history:
            if retired:
                raise MigrationError('Cleanup history/schema mismatch')
            return {'applied': False, 'migration_id': 97}
        if not {93, 94, 95, 96} <= history:
            raise MigrationError('Cleanup requires migrations 93 through 96')
        required = {'tma_deck_scope_check', 'tma_deck_scope_owner_check',
                    'tma_deck_category_id_fkey', 'tma_card_single_content_source'}
        validated = {r[0] for r in database.execute_sql("""SELECT conname FROM pg_constraint
            WHERE conrelid IN ('tma_deck'::regclass,'tma_card'::regclass) AND convalidated""")}
        if not required <= validated:
            raise MigrationError('Unified schema constraints missing')
        database.execute_sql('LOCK TABLE tma_card,tma_deck,tmasetting' +
                             ''.join(',' + t for t in sorted(retired)) + ' IN ACCESS EXCLUSIVE MODE')
        if bool('card' in tables) != bool('deck' in tables):
            raise MigrationError('Incomplete cleanup sources')
        if 'card' in tables:
            def rows(table):
                return [r[0] for r in database.execute_sql(f'SELECT to_jsonb(t) FROM {table} t')]

            old_decks = rows('deck')
            new_decks = [d for d in rows('tma_deck') if d['scope'] == 'library']
            if len(old_decks) != len(new_decks):
                raise MigrationError('Cleanup deck count mismatch')
            mapping = {}
            for old in old_decks:
                if old.get('folder_id') is not None or old.get('share_id') or old.get('is_inbox'):
                    raise MigrationError('Unpreserved legacy deck placement/sharing')
                fields = set(old) - {'id', 'cloud_id', 'author_name', 'folder_id', 'share_id', 'is_inbox'}
                expected = {k: old[k] for k in fields}
                if old.get('author_name') is not None:
                    meta = json.loads(old['metadata'] or '{}')
                    meta['author_name'] = old['author_name']
                    expected['metadata'] = json.dumps(meta, ensure_ascii=False)
                def matches(new):
                    for key, value in expected.items():
                        if key == 'metadata':
                            if json.loads(value or '{}') != json.loads(new[key] or '{}'):
                                return False
                        elif new.get(key) != value:
                            return False
                    return True
                candidates = [d for d in new_decks if d['id'] not in mapping.values() and matches(d)]
                if len(candidates) != 1:
                    raise MigrationError('Cleanup deck content/placement mismatch or ambiguous mapping')
                mapping[old['id']] = candidates[0]['id']
            excluded = {'id', 'deck_id', 'cloud_id', 'reserve', 'reserve_topic', 'collected_at', 'want_to_learn', 'share_id'}
            fields = {c.name for c in database.get_columns('card')} - excluded
            if not fields <= {c.name for c in database.get_columns('tma_card')}:
                raise MigrationError('Unpreserved source columns')
            def fingerprint(row, deck_id):
                return json.dumps([deck_id, {k: row[k] for k in sorted(fields)}], sort_keys=True)
            original = rows('card')
            if any(c.get(k) not in (None, '') for c in original for k in ('reserve', 'reserve_topic')):
                raise MigrationError('Unpreserved reserve content')
            if any(c.get('share_id') for c in original):
                raise MigrationError('Unpreserved legacy card sharing')
            if any(c['deck_id'] not in mapping for c in original):
                raise MigrationError('Orphan library card')
            before = Counter(fingerprint(c, mapping[c['deck_id']]) for c in original)
            after = Counter(fingerprint(c, c['deck_id']) for c in rows('tma_card') if c['deck_id'] in mapping.values())
            if before != after:
                raise MigrationError('Cleanup card content/media/placement mismatch')
        elif database.execute_sql("SELECT 1 FROM tma_deck LIMIT 1").fetchone():
            raise MigrationError('Absent sources without cleanup history on populated database')
        # Only the explicitly retired library progress may contain data.
        for table in ('reviewhistory', 'uservoice'):
            if table in tables and database.execute_sql(f'SELECT 1 FROM {table} LIMIT 1').fetchone():
                raise MigrationError(f'Preserve nonempty {table} before cleanup')
        incoming = database.execute_sql("""SELECT src.relname,dst.relname
            FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid
            JOIN pg_class dst ON dst.oid=c.confrelid JOIN pg_namespace n ON n.oid=dst.relnamespace
            WHERE c.contype='f' AND n.nspname='public' AND dst.relname=ANY(%s)""", (sorted(retired),)).fetchall()
        if any(src not in retired for src, _ in incoming):
            raise MigrationError('Unknown incoming FK; cleanup refused')
        if 'progress' in tables and ('progress', 'card') not in incoming:
            raise MigrationError('Progress is not proven to belong to retired library cards')
        marker_row = database.execute_sql('SELECT value FROM tmasetting WHERE key=%s', (RESTORE_KEY,)).fetchone()
        marker = marker_row[0] if marker_row else 'initial'
        relations = database.execute_sql("""SELECT c.relname,c.oid::bigint FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
            AND c.relname IN ('tma_card','card','tmasetting') ORDER BY c.relname""").fetchall()
        token = hashlib.sha256(json.dumps([marker, relations], sort_keys=True).encode()).hexdigest()
        native_relations = database.execute_sql("""SELECT c.relname,c.oid::bigint FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
            AND c.relname IN ('tma_card','tma_deck','tmasetting') ORDER BY c.relname""").fetchall()
        identity = [marker, native_relations]
        database.execute_sql('INSERT INTO tmasetting(key,value,updated_at) VALUES (%s,%s,CURRENT_TIMESTAMP)',
                             (ANCHOR_KEY, json.dumps({'identity': identity, 'token': token})))
        # One restricted DROP resolves internal FKs, but never cascades to anything else.
        if retired:
            database.execute_sql('DROP TABLE ' + ','.join(sorted(retired)) + ' RESTRICT')
        database.execute_sql('INSERT INTO tma_migration_history(migration_id) VALUES (97)')
        return {'applied': True, 'migration_id': 97}


def run_unified_cards_migration(database):
    """Move the library into TMA storage. Explicit maintenance only; retain sources.

    Run after the existing Native V2 conversion with all application writers
    stopped. Personal IDs, notes, receipts, SRS and client queues stay untouched.
    Recovery is the pre-migration dump; sequence gaps on rollback are harmless.
    """
    import json

    database = getattr(database, 'obj', database)
    if not isinstance(database, PostgresqlDatabase) or database.in_transaction():
        raise MigrationError('Unified storage requires PostgreSQL and its own transaction')
    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout = '5s'")
        database.execute_sql("SET LOCAL statement_timeout = '120s'")
        database.execute_sql('SELECT pg_advisory_xact_lock(76120996)')
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        applied = database.execute_sql('SELECT 1 FROM tma_migration_history WHERE migration_id=96').fetchone()
        columns = {column.name: column for column in database.get_columns('tma_deck')}
        if applied:
            constraints = {row[0] for row in database.execute_sql("""SELECT conname FROM pg_constraint
                WHERE conrelid='tma_deck'::regclass AND convalidated""")}
            if (not {'scope', 'category_id', 'is_default'} <= columns.keys()
                    or not {'tma_deck_scope_check', 'tma_deck_scope_owner_check',
                            'tma_deck_category_id_fkey'} <= constraints):
                raise MigrationError('Migration 96 history/schema mismatch')
            return {'applied': False, 'migration_id': 96}

        sources = {'card', 'deck'} & set(database.get_tables())
        fresh = not sources
        if fresh and any(database.execute_sql(f'SELECT 1 FROM {t} LIMIT 1').fetchone()
                         for t in ('tma_card', 'tma_deck')):
            raise MigrationError('Missing migration sources on populated database')
        if sources and sources != {'card', 'deck'}:
            raise MigrationError('Incomplete migration sources')
        database.execute_sql('LOCK TABLE tma_deck,tma_card' + (',deck,card' if sources else '') + ' IN ACCESS EXCLUSIVE MODE')
        # The content migration has its own validation and recovery workflow.
        for table in (('tma_card', 'card') if sources else ('tma_card',)):
            if not any(c.name == 'content_v2' and c.data_type == 'jsonb' for c in database.get_columns(table)):
                raise MigrationError('Prepare migrations 93/94 and convert active content before 96')
            if database.execute_sql(f'SELECT 1 FROM {table} WHERE NOT is_deleted AND content_v2 IS NULL LIMIT 1').fetchone():
                raise MigrationError('Convert active Native V2 content before migration 96')
        library_columns = {c.name for c in database.get_columns('card')}
        for name in ('reserve', 'reserve_topic'):
            if name in library_columns and database.execute_sql(
                    f'SELECT 1 FROM card WHERE {name} IS NOT NULL AND {name} <> %s LIMIT 1', ('',)).fetchone():
                raise MigrationError(f'Library {name} contains unreviewed data; preserve it before migration')
        if database.execute_sql('SELECT 1 FROM tma_deck WHERE user_id IS NULL LIMIT 1').fetchone():
            raise MigrationError('Existing personal deck has no owner')
        if 'scope' in columns:
            # Fresh LOCAL bootstrap creates these empty ORM columns first.
            if database.execute_sql('SELECT 1 FROM tma_deck LIMIT 1').fetchone():
                raise MigrationError('Untracked unified storage schema; review before migration')
        else:
            database.execute_sql("ALTER TABLE tma_deck ADD COLUMN scope VARCHAR(255) NOT NULL DEFAULT 'personal'")
        if 'category_id' not in columns:
            database.execute_sql('''ALTER TABLE tma_deck ADD COLUMN category_id INTEGER
                REFERENCES library_category(id) ON DELETE SET NULL''')
        if 'is_default' not in columns:
            database.execute_sql('ALTER TABLE tma_deck ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE')
        database.execute_sql('''ALTER TABLE tma_deck ALTER COLUMN user_id DROP NOT NULL,
            ALTER COLUMN scope SET DEFAULT 'personal', ALTER COLUMN scope SET NOT NULL,
            ALTER COLUMN is_default SET DEFAULT FALSE, ALTER COLUMN is_default SET NOT NULL''')
        existing = {r[0] for r in database.execute_sql("SELECT conname FROM pg_constraint WHERE conrelid='tma_deck'::regclass")}
        if 'tma_deck_category_id_fkey' not in existing:
            database.execute_sql('ALTER TABLE tma_deck ADD CONSTRAINT tma_deck_category_id_fkey '
                                 'FOREIGN KEY(category_id) REFERENCES library_category(id) ON DELETE SET NULL')
        if 'tma_deck_scope_check' not in existing:
            database.execute_sql("ALTER TABLE tma_deck ADD CONSTRAINT tma_deck_scope_check CHECK (scope IN ('personal','library'))")
        database.execute_sql('''ALTER TABLE tma_deck ADD CONSTRAINT tma_deck_scope_owner_check CHECK (
            (scope='personal' AND user_id IS NOT NULL AND category_id IS NULL AND NOT is_default)
            OR (scope='library' AND user_id IS NULL AND folder_id IS NULL AND is_inbox IS FALSE AND share_id IS NULL))''')
        database.execute_sql('CREATE INDEX tma_deck_scope_category_idx ON tma_deck(scope,category_id)')
        if fresh:
            database.execute_sql('INSERT INTO tma_migration_history(migration_id) VALUES (96)')
            return {'applied': True, 'migration_id': 96, 'library_decks': 0, 'library_cards': 0}

        # Allocate new library IDs beyond the personal space, even after a
        # data-only restore whose sequences lag behind the rows.
        for table in ('tma_deck', 'tma_card'):
            database.execute_sql(f"""SELECT setval(pg_get_serial_sequence('{table}','id'),
                GREATEST(COALESCE((SELECT MAX(id) FROM {table}),0),
                         nextval(pg_get_serial_sequence('{table}','id'))),true)""")
        database.execute_sql('''CREATE TEMP TABLE native_library_deck_map (
            old_id INTEGER PRIMARY KEY,new_id INTEGER UNIQUE NOT NULL) ON COMMIT DROP''')
        database.execute_sql("""INSERT INTO native_library_deck_map
            SELECT id,nextval(pg_get_serial_sequence('tma_deck','id')) FROM deck ORDER BY id""")
        deck_fields = ('name','level','topic','target_language','is_deleted','category_id','is_default',
                       'is_pinned','position','created_at','updated_at','metadata')
        fields = ','.join(deck_fields)
        values = ','.join('d.' + field for field in deck_fields)
        database.execute_sql(f"""INSERT INTO tma_deck(id,user_id,scope,is_inbox,{fields})
            SELECT m.new_id,NULL,'library',FALSE,{values} FROM deck d
            JOIN native_library_deck_map m ON m.old_id=d.id ORDER BY d.id""")
        if any(c.name == 'author_name' for c in database.get_columns('deck')):
            for identifier, raw, author in database.execute_sql('''SELECT m.new_id,d.metadata,d.author_name
                    FROM deck d JOIN native_library_deck_map m ON m.old_id=d.id WHERE d.author_name IS NOT NULL''').fetchall():
                metadata = json.loads(raw or '{}')
                if not isinstance(metadata, dict) or metadata.get('author_name', author) != author:
                    raise MigrationError('Library author attribution conflicts with deck metadata')
                metadata['author_name'] = author
                database.execute_sql('UPDATE tma_deck SET metadata=%s WHERE id=%s',
                                     (json.dumps(metadata, ensure_ascii=False), identifier))
        card_fields = ('front_text','back_text','content_v2','context','image_path','audio_path','audio_back_path',
                       'video_front_path','video_back_path','tags','topics','source','card_type','difficulty',
                       'metadata','is_deleted','created_at','updated_at','history','position','flag')
        card_fields += tuple(name for name in ('image_data', 'creator_id') if name in library_columns)
        fields = ','.join(card_fields)
        values = ','.join('c.' + field for field in card_fields)
        database.execute_sql(f'''INSERT INTO tma_card(deck_id,want_to_learn,{fields})
            SELECT m.new_id,FALSE,{values} FROM card c JOIN native_library_deck_map m ON m.old_id=c.deck_id
            ORDER BY c.id''')

        mapping = dict(database.execute_sql('SELECT old_id,new_id FROM native_library_deck_map'))
        # Provenance is informational. Copies never share content/progress rows.
        for identifier, raw in database.execute_sql("SELECT id,metadata FROM tma_deck WHERE scope='personal'").fetchall():
            try:
                metadata = json.loads(raw or '{}')
            except (TypeError, ValueError):
                continue
            if isinstance(metadata, dict) and 'source_library_id' in metadata:
                old = metadata['source_library_id']
                if isinstance(old, int) and old in mapping:
                    metadata['source_library_id'] = mapping[old]
                    database.execute_sql('UPDATE tma_deck SET metadata=%s WHERE id=%s',
                                         (json.dumps(metadata, ensure_ascii=False), identifier))
        counts = database.execute_sql("""SELECT
            (SELECT count(*) FROM deck), (SELECT count(*) FROM tma_deck WHERE scope='library'),
            (SELECT count(*) FROM card), (SELECT count(*) FROM tma_card c JOIN tma_deck d ON d.id=c.deck_id WHERE d.scope='library')""").fetchone()
        if counts[0] != counts[1] or counts[2] != counts[3]:
            raise MigrationError('Unified library count mismatch')
        database.execute_sql('INSERT INTO tma_migration_history(migration_id) VALUES (96)')
        return {'applied': True, 'migration_id': 96, 'library_decks': counts[0], 'library_cards': counts[2]}


def run_card_source_migration(database):
    """Allow Native V2 cards to omit the legacy source field on tma_card and card."""
    database = getattr(database, 'obj', database)
    if not isinstance(database, PostgresqlDatabase):
        raise MigrationError('Card source migration requires PostgreSQL')
    if database.in_transaction():
        raise MigrationError('Card source migration requires its own transaction')

    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout = '5s'")
        database.execute_sql("SET LOCAL statement_timeout = '60s'")
        database.execute_sql('SELECT pg_advisory_xact_lock(%s)', (CARD_SOURCE_LOCK_ID,))
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        applied = bool(database.execute_sql(
            'SELECT 1 FROM tma_migration_history WHERE migration_id = %s', (CARD_SOURCE_MIGRATION_ID,)
        ).fetchone())

        tables = [t for t in ('tma_card', 'card') if database.table_exists(t)]
        if applied:
            for table in tables:
                columns = {c.name: c for c in database.get_columns(table)}
                source_col = columns.get('source')
                if source_col and not source_col.null:
                    raise MigrationError(f'Migration {CARD_SOURCE_MIGRATION_ID} history/schema mismatch on {table}')
            return {'applied': False, 'migration_id': CARD_SOURCE_MIGRATION_ID}

        for table in tables:
            columns = {c.name: c for c in database.get_columns(table)}
            source_col = columns.get('source')
            if source_col and not source_col.null:
                database.execute_sql(f'ALTER TABLE {table} ALTER COLUMN source DROP NOT NULL')

        database.execute_sql('INSERT INTO tma_migration_history (migration_id) VALUES (%s)', (CARD_SOURCE_MIGRATION_ID,))
        return {'applied': True, 'migration_id': CARD_SOURCE_MIGRATION_ID}


def run_structured_cards_v2_migration(database):
    """Prepare the study card table without changing existing rows."""
    return _prepare_native_card_table(database, 'tma_card', STRUCTURED_CARDS_V2_MIGRATION_ID, STRUCTURED_CARDS_V2_LOCK_ID)


def run_library_cards_v2_migration(database):
    """Apply the same content invariant to the library card table."""
    database = getattr(database, 'obj', database)
    if not database.table_exists('card'):
        if database.execute_sql('SELECT 1 FROM tma_migration_history WHERE migration_id=97').fetchone():
            return {'applied': False, 'migration_id': 94}
        raise MigrationError('Library source absent without cleanup history')
    return _prepare_native_card_table(database, 'card', LIBRARY_CARDS_V2_MIGRATION_ID, LIBRARY_CARDS_V2_LOCK_ID)


def _prepare_native_card_table(database, table, migration_id, lock_id):
    constraint_name = f'{table}_single_content_source'
    database = getattr(database, 'obj', database)
    if not isinstance(database, PostgresqlDatabase):
        raise MigrationError('Structured Cards V2 requires PostgreSQL')
    if database.in_transaction():
        raise MigrationError('Structured Cards V2 migration requires its own transaction')

    with database.atomic():
        database.execute_sql("SET LOCAL lock_timeout = '5s'")
        database.execute_sql("SET LOCAL statement_timeout = '60s'")
        database.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock_id,))
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        applied = bool(database.execute_sql(
            'SELECT 1 FROM tma_migration_history WHERE migration_id = %s', (migration_id,)
        ).fetchone())
        columns = {column.name: column for column in database.get_columns(table)}
        if not set(_LEGACY_CONTENT_FIELDS) <= columns.keys():
            raise MigrationError(f'Structured Cards V2 migration requires the existing {table} schema')
        content = columns.get('content_v2')
        if content is not None and (content.data_type.lower() != 'jsonb' or not content.null or content.default is not None):
            raise MigrationError('Structured Cards V2 migration requires nullable JSONB with no default')

        constraint = database.execute_sql('''
            SELECT c.convalidated, ARRAY(
                SELECT a.attname::text FROM pg_attribute AS a
                WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                ORDER BY a.attname::text COLLATE "C"
            )
            FROM pg_constraint AS c
            WHERE c.conrelid = %s::regclass AND c.conname = %s AND c.contype = 'c'
        ''', (table, constraint_name)).fetchone()
        if applied:
            expected_fields = sorted((*_LEGACY_CONTENT_FIELDS, 'content_v2'))
            if content is None or constraint != (True, expected_fields) or any(
                not columns[name].null for name in _LEGACY_CONTENT_FIELDS
            ):
                raise MigrationError('Structured Cards V2 migration history/schema mismatch')
            return {'applied': False, 'migration_id': migration_id}

        # Fresh LOCAL bootstrap creates the ORM columns before running migrations.
        if constraint or (content is not None and database.execute_sql(
            f'SELECT 1 FROM {table} LIMIT 1'
        ).fetchone()):
            raise MigrationError(f'Structured Cards V2 schema exists without migration {migration_id} record')

        add_column = 'ADD COLUMN content_v2 JSONB,' if content is None else ''
        legacy_empty = ' AND '.join(f'{name} IS NULL' for name in _LEGACY_CONTENT_FIELDS)
        drop_legacy_not_null = ', '.join(f'ALTER COLUMN {name} DROP NOT NULL' for name in _LEGACY_CONTENT_FIELDS)
        database.execute_sql(f'''
            ALTER TABLE {table}
              {add_column}
              {drop_legacy_not_null},
              ADD CONSTRAINT {constraint_name} CHECK ((
                (content_v2 IS NULL AND front_text IS NOT NULL AND back_text IS NOT NULL AND card_type IS NOT NULL)
                OR
                (content_v2 IS NOT NULL AND {legacy_empty}
                  AND CASE WHEN jsonb_typeof(content_v2) = 'object' THEN
                    jsonb_typeof(content_v2->'schema_version') = 'number'
                    AND content_v2->>'schema_version' = '2'
                    AND content_v2 - 'schema_version' - 'card' = '{{}}'::jsonb
                    AND jsonb_typeof(content_v2->'card') = 'object'
                    AND jsonb_typeof(content_v2->'card'->'type') = 'string'
                    AND length(content_v2->'card'->>'type') > 0
                    AND jsonb_typeof(content_v2->'card'->'data') = 'object'
                  ELSE FALSE END)
              ) IS TRUE)
        ''')
        database.execute_sql('INSERT INTO tma_migration_history (migration_id) VALUES (%s)', (migration_id,))
    return {'applied': True, 'migration_id': migration_id}


def run_card_rating_migration(database):
    """Create the private like/dislike table; never run on non-LOCAL API startup."""
    from api.models import TMACardRating
    database = getattr(database, 'obj', database)
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)):
        raise RuntimeError('Unsupported card rating database')
    model, table = TMACardRating, TMACardRating._meta.table_name
    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    with database.atomic(**options):
        if isinstance(database, PostgresqlDatabase):
            database.execute_sql("SET LOCAL lock_timeout = '5s'")
            database.execute_sql(f'SELECT pg_advisory_xact_lock({CARD_RATING_LOCK_ID})')
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        marker = database.param
        applied = database.execute_sql(
            f'SELECT 1 FROM tma_migration_history WHERE migration_id = {marker}',
            (CARD_RATING_MIGRATION_ID,)).fetchone()
        present = database.table_exists(table)
        if applied:
            if not present or {column.name for column in database.get_columns(table)} != {
                    field.column_name for field in model._meta.sorted_fields}:
                raise MigrationError('Card rating migration history/schema mismatch')
            return
        if present:
            raise MigrationError('Card rating table exists without migration 92 record')
        with database.bind_ctx([model], bind_refs=False, bind_backrefs=False):
            database.create_tables([model], safe=False)
        if isinstance(database, PostgresqlDatabase):
            # Lerne uses its own authentication, not Supabase Auth JWTs.
            database.execute_sql(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
            database.execute_sql(f'REVOKE ALL ON {table} FROM PUBLIC')
            for role in ('anon', 'authenticated'):
                if database.execute_sql('SELECT 1 FROM pg_roles WHERE rolname = %s', (role,)).fetchone():
                    database.execute_sql(f'REVOKE ALL ON {table} FROM {role}')
        database.execute_sql(
            f'INSERT INTO tma_migration_history (migration_id) VALUES ({CARD_RATING_MIGRATION_ID})')


def run_card_notes_migration(database):
    """Create private card notes and the shared user message store."""
    from api.models import TMACardNote, TMAUserMessage
    database = getattr(database, 'obj', database)
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)):
        raise RuntimeError('Unsupported card notes database')
    models = (TMACardNote, TMAUserMessage)
    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    with database.atomic(**options):
        if isinstance(database, PostgresqlDatabase):
            database.execute_sql("SET LOCAL lock_timeout = '5s'")
            database.execute_sql('SELECT pg_advisory_xact_lock(76120990)')
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        marker = database.param
        applied = database.execute_sql(
            f'SELECT 1 FROM tma_migration_history WHERE migration_id = {marker}',
            (CARD_COMMUNICATION_MIGRATION_ID,)).fetchone()
        present = [model for model in models if database.table_exists(model._meta.table_name)]
        if applied:
            for model in models:
                if model not in present or {column.name for column in database.get_columns(model._meta.table_name)} != {
                        field.column_name for field in model._meta.sorted_fields}:
                    raise MigrationError('Card communication migration history/schema mismatch')
            return
        if present:
            raise MigrationError('Card communication table exists without migration 90 record')
        with database.bind_ctx(models, bind_refs=False, bind_backrefs=False):
            database.create_tables(models, safe=False)
        if isinstance(database, PostgresqlDatabase):
            # Lerne uses its own authentication, not Supabase Auth JWTs.
            for model in models:
                table = model._meta.table_name
                database.execute_sql(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
                database.execute_sql(f'REVOKE ALL ON {table} FROM PUBLIC')
                for role in ('anon', 'authenticated'):
                    if database.execute_sql('SELECT 1 FROM pg_roles WHERE rolname = %s', (role,)).fetchone():
                        database.execute_sql(f'REVOKE ALL ON {table} FROM {role}')
        database.execute_sql(
            f'INSERT INTO tma_migration_history (migration_id) VALUES ({CARD_COMMUNICATION_MIGRATION_ID})')


def run_knowledge_mastery_migration(database):
    """Additive, transactional upgrade of the derived state table."""
    from peewee import PostgresqlDatabase

    database = getattr(database, 'obj', database)
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)):
        raise RuntimeError('Unsupported knowledge migration database')
    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    with database.atomic(**options):
        if isinstance(database, PostgresqlDatabase):
            database.execute_sql("SET LOCAL lock_timeout = '5s'")
            database.execute_sql("SET LOCAL statement_timeout = '60s'")
            database.execute_sql(f'SELECT pg_advisory_xact_lock({KNOWLEDGE_MASTERY_LOCK_ID})')
        database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        marker = database.param
        applied = database.execute_sql(
            f'SELECT 1 FROM tma_migration_history WHERE migration_id = {marker}',
            (KNOWLEDGE_MASTERY_MIGRATION_ID,)).fetchone()
        columns = {column.name: column for column in database.get_columns('tma_user_knowledge_state')}
        required = {
            'positive_evidence': 'DOUBLE PRECISION NOT NULL DEFAULT 0',
            'negative_evidence': 'DOUBLE PRECISION NOT NULL DEFAULT 0',
            'evidence_mass': 'DOUBLE PRECISION NOT NULL DEFAULT 0',
            'proficiency': 'DOUBLE PRECISION NOT NULL DEFAULT 0.5',
            'confidence': 'DOUBLE PRECISION NOT NULL DEFAULT 0',
            'evidence_event_count': 'INTEGER NOT NULL DEFAULT 0',
            'objective_event_count': 'INTEGER NOT NULL DEFAULT 0',
            'self_rating_event_count': 'INTEGER NOT NULL DEFAULT 0',
            'last_evidence_at': 'TIMESTAMP NULL',
        }
        if applied:
            if not required.keys() <= columns.keys():
                raise RuntimeError('Knowledge migration history/schema mismatch')
            return {'applied': False, 'migration_id': KNOWLEDGE_MASTERY_MIGRATION_ID}
        for name, definition in required.items():
            if name not in columns:
                database.execute_sql(
                    f'ALTER TABLE tma_user_knowledge_state ADD COLUMN {name} {definition}')
        if isinstance(database, PostgresqlDatabase):
            version_type = columns['calculation_version'].data_type.lower()
            if version_type not in ('character varying', 'varchar', 'text'):
                database.execute_sql('''ALTER TABLE tma_user_knowledge_state
                    ALTER COLUMN calculation_version DROP DEFAULT''')
                database.execute_sql('''ALTER TABLE tma_user_knowledge_state
                    ALTER COLUMN calculation_version TYPE VARCHAR(32)
                    USING ''::VARCHAR(32)''')
                database.execute_sql("ALTER TABLE tma_user_knowledge_state "
                                     "ALTER COLUMN calculation_version SET DEFAULT ''")
        database.execute_sql("UPDATE tma_user_knowledge_state SET calculation_version = '' "
                             "WHERE calculation_version IS NULL OR calculation_version <> 'mastery-v1'")
        migrated_columns = {column.name for column in database.get_columns('tma_user_knowledge_state')}
        if not required.keys() <= migrated_columns:
            raise RuntimeError('Knowledge migration left required columns missing')
        database.execute_sql(
            f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
            (KNOWLEDGE_MASTERY_MIGRATION_ID,))
        return {'applied': True, 'migration_id': KNOWLEDGE_MASTERY_MIGRATION_ID}


def run_auth_migrations(database):
    """Explicit additive migration; atomic DDL, backfill and history, fail closed.

    Call on a dedicated connection, after the legacy tma_user schema exists.
    The caller chooses the database; this function never reads connection secrets.
    Do not append ID 76 to MIGRATIONS or the startup fallback runner.
    """
    from peewee import PostgresqlDatabase
    from api.models import (
        AUTH_FOUNDATION_MODELS, AUTH_CHALLENGE_MODELS, AUTH_PASSWORD_MODELS, TMAUser, TMAAuthAccount,
    )

    database = getattr(database, 'obj', database)
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)):
        raise RuntimeError('Unsupported auth migration database')
    if database.in_transaction():
        raise RuntimeError('Auth migration requires its own transaction')
    owned_connection = database.is_closed()
    try:
        database.connect(reuse_if_open=True)
        options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                # Serializes this migration across workers; lock is transaction-scoped.
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '60s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120906)')
                database.execute_sql('LOCK TABLE tma_user IN SHARE MODE')
            database.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
                migration_id INT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )''')
            marker = database.param
            applied = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {marker}',
                (AUTH_FOUNDATION_MIGRATION_ID,),
            ).fetchone()
            if applied:
                missing = [m._meta.table_name for m in AUTH_FOUNDATION_MODELS
                           if not database.table_exists(m._meta.table_name)]
                if missing:
                    raise RuntimeError('Auth migration history/schema mismatch')
                result = {'migration_id': AUTH_FOUNDATION_MIGRATION_ID, 'applied': False}
            else:
                if not database.table_exists('tma_user'):
                    raise RuntimeError('Legacy tma_user schema is required before auth migration')
                if any(database.table_exists(m._meta.table_name) for m in AUTH_FOUNDATION_MODELS):
                    raise RuntimeError('Untracked auth tables exist; inspect before applying migration')
                # bind_ctx is scoped to this explicit maintenance operation, never used
                # by live request handlers. Existing application proxies stay untouched.
                with database.bind_ctx([TMAUser, *AUTH_FOUNDATION_MODELS], bind_refs=False, bind_backrefs=False):
                    database.create_tables(AUTH_FOUNDATION_MODELS, safe=False)
                    # No verified identity is inferred from is_guest, name or email.
                    # Positive, non-guest historical IDs are only candidates for a later
                    # verified Telegram login. Guest collisions require separate recovery.
                    database.execute_sql('''INSERT INTO tma_auth_account
                        (user_id, legacy_telegram_subject, created_at)
                        SELECT user_id,
                               CASE WHEN user_id > 0 AND is_guest = false
                                    THEN CAST(user_id AS VARCHAR(255)) ELSE NULL END,
                               CURRENT_TIMESTAMP
                        FROM tma_user''')
                    users = TMAUser.select().count()
                    accounts = TMAAuthAccount.select().count()
                    if users != accounts:
                        raise RuntimeError('Auth migration account count mismatch')
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                    (AUTH_FOUNDATION_MIGRATION_ID,),
                )
                result = {'migration_id': AUTH_FOUNDATION_MIGRATION_ID, 'applied': True,
                          'accounts': accounts, 'verified_identities': 0}
        # The foundation marker must be durable before the following additive
        # migration is considered. A new deployment can safely resume at 77.
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '60s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120906)')
            marker = database.param
            applied = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {marker}',
                (AUTH_CHALLENGE_MIGRATION_ID,),
            ).fetchone()
            if applied:
                if not database.table_exists('tma_auth_challenge'):
                    raise RuntimeError('Auth challenge migration history/schema mismatch')
            else:
                if database.table_exists('tma_auth_challenge'):
                    raise RuntimeError('Untracked auth challenge table exists; inspect before applying migration')
                with database.bind_ctx(AUTH_CHALLENGE_MODELS, bind_refs=False, bind_backrefs=False):
                    database.create_tables(AUTH_CHALLENGE_MODELS, safe=False)
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                    (AUTH_CHALLENGE_MIGRATION_ID,),
                )
                result['challenge_migration_applied'] = True
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '60s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120906)')
            marker = database.param
            applied = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {marker}',
                (AUTH_PASSWORD_MIGRATION_ID,),
            ).fetchone()
            if applied:
                missing = [m._meta.table_name for m in AUTH_PASSWORD_MODELS
                           if not database.table_exists(m._meta.table_name)]
                if missing:
                    raise RuntimeError('Auth password migration history/schema mismatch')
            else:
                if any(database.table_exists(m._meta.table_name) for m in AUTH_PASSWORD_MODELS):
                    raise RuntimeError('Untracked auth password tables exist; inspect before applying migration')
                with database.bind_ctx(AUTH_PASSWORD_MODELS, bind_refs=False, bind_backrefs=False):
                    database.create_tables(AUTH_PASSWORD_MODELS, safe=False)
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                    (AUTH_PASSWORD_MIGRATION_ID,),
                )
                result['password_migration_applied'] = True
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '60s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120906)')
            applied = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {marker}',
                (AUTH_SESSION_METHOD_MIGRATION_ID,),
            ).fetchone()
            has_column = any(c.name == 'authentication_method'
                             for c in database.get_columns('tma_auth_session'))
            if applied and not has_column:
                raise RuntimeError('Auth session method migration history/schema mismatch')
            if not applied:
                # Fresh foundation schemas already include the nullable field.
                # Existing sessions stay NULL: never infer their login method.
                if not has_column:
                    database.execute_sql('ALTER TABLE tma_auth_session ADD COLUMN authentication_method VARCHAR(16) NULL')
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                    (AUTH_SESSION_METHOD_MIGRATION_ID,),
                )
                result['session_method_migration_applied'] = True
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql("SET LOCAL statement_timeout = '60s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120906)')
            applied = database.execute_sql(
                f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {marker}',
                (AUTH_PROFILE_MIGRATION_ID,),
            ).fetchone()
            has_column = any(c.name == 'verified_profile'
                             for c in database.get_columns('tma_auth_challenge'))
            if applied and not has_column:
                raise RuntimeError('Auth profile migration history/schema mismatch')
            if not applied:
                # Old pending challenges remain valid, with no display fields.
                if not has_column:
                    database.execute_sql('ALTER TABLE tma_auth_challenge ADD COLUMN verified_profile TEXT NULL')
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                    (AUTH_PROFILE_MIGRATION_ID,),
                )
                result['profile_migration_applied'] = True
        return result
    finally:
        if owned_connection and not database.is_closed():
            database.close()


def run_local_bootstrap_migrations(tma_database, lerne_database):
    """Record the legacy migration baseline for a verified empty LOCAL schema.

    LOCAL creates tables from the current Peewee models. Historical ADD COLUMN
    migrations must therefore be skipped when those columns already exist, while
    data/index/table migrations still run before their IDs are recorded.
    """
    tma = getattr(tma_database, 'obj', tma_database)
    lerne = getattr(lerne_database, 'obj', lerne_database)
    if tma is not lerne:
        raise RuntimeError('LOCAL bootstrap requires one PostgreSQL database')
    if not isinstance(tma, (PostgresqlDatabase, SqliteDatabase)):
        raise RuntimeError('Unsupported LOCAL bootstrap database')

    with tma.atomic():
        if isinstance(tma, PostgresqlDatabase):
            tma.execute_sql("SET LOCAL lock_timeout = '5s'")
            tma.execute_sql("SET LOCAL statement_timeout = '60s'")
            tma.execute_sql('SELECT pg_advisory_xact_lock(76120901)')
        tma.execute_sql('''CREATE TABLE IF NOT EXISTS tma_migration_history (
            migration_id INT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        if tma.execute_sql('SELECT COUNT(*) FROM tma_migration_history').fetchone()[0]:
            raise RuntimeError('LOCAL bootstrap migration history is not empty')

        marker = tma.param
        add_column = re.compile(
            r'^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)',
            re.IGNORECASE,
        )
        drop_not_null = re.compile(
            r'^\s*ALTER\s+TABLE\s+(\w+)\s+ALTER\s+COLUMN\s+(\w+)\s+DROP\s+NOT\s+NULL',
            re.IGNORECASE,
        )
        for migration_id, query, _database_key in MIGRATIONS:
            already_in_model = False
            if re.search(r'\b(?:ALTER TABLE|UPDATE) (?:card|deck)\b', query, re.IGNORECASE):
                tma.execute_sql(f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})', (migration_id,))
                continue
            match = add_column.match(query)
            if match:
                table, name = match.groups()
                already_in_model = name in {column.name for column in tma.get_columns(table)}
            else:
                match = drop_not_null.match(query)
                if match:
                    table, name = match.groups()
                    column = next((column for column in tma.get_columns(table)
                                   if column.name == name), None)
                    already_in_model = bool(column and column.null)
            if not already_in_model:
                tma.execute_sql(query)
            tma.execute_sql(
                f'INSERT INTO tma_migration_history (migration_id) VALUES ({marker})',
                (migration_id,),
            )
        logger.info('LOCAL bootstrap migrations complete: %s recorded.', len(MIGRATIONS))

# Список миграций с уникальными ID: (id, SQL-запрос, имя_базы_данных)
# 'tma' — основная база (tma_db), 'lerne' — библиотека (lerne_db)
MIGRATIONS = [
    # --- Deck ---
    (1, 'ALTER TABLE tma_deck ADD COLUMN updated_at TIMESTAMP', 'tma'),
    (2, 'ALTER TABLE tma_deck ADD COLUMN share_id TEXT', 'tma'),
    (3, 'ALTER TABLE tma_deck ADD COLUMN is_inbox BOOLEAN DEFAULT false', 'tma'),
    (4, 'ALTER TABLE deck ADD COLUMN updated_at TIMESTAMP', 'lerne'),
    (5, 'ALTER TABLE deck ADD COLUMN is_deleted BOOLEAN DEFAULT false', 'lerne'),
    (6, 'ALTER TABLE deck ADD COLUMN created_at TIMESTAMP', 'lerne'),
    (7, 'ALTER TABLE deck ADD COLUMN cloud_id INTEGER', 'lerne'),
    (8, 'ALTER TABLE deck ADD COLUMN share_id TEXT', 'lerne'),
    (9, 'ALTER TABLE deck ADD COLUMN is_inbox BOOLEAN DEFAULT false', 'lerne'),

    # --- Card ---
    (10, 'ALTER TABLE tma_card ADD COLUMN history TEXT DEFAULT \'[]\'', 'tma'),
    (11, 'ALTER TABLE tma_card ADD COLUMN tags TEXT DEFAULT \'[]\'', 'tma'),
    (12, 'ALTER TABLE tma_card ADD COLUMN topics TEXT DEFAULT \'[]\'', 'tma'),
    (13, 'ALTER TABLE tma_card ADD COLUMN source TEXT', 'tma'),
    (14, 'ALTER TABLE tma_card ADD COLUMN want_to_learn BOOLEAN DEFAULT false', 'tma'),
    (15, 'ALTER TABLE tma_card ADD COLUMN share_id TEXT', 'tma'),
    (16, 'ALTER TABLE tma_card ADD COLUMN creator_id BIGINT', 'tma'),
    (17, 'ALTER TABLE tma_card ADD COLUMN image_data BYTEA', 'tma'),
    (18, 'ALTER TABLE tma_card ADD COLUMN audio_back_path TEXT', 'tma'),
    (19, 'ALTER TABLE card ADD COLUMN updated_at TIMESTAMP', 'lerne'),
    (20, 'ALTER TABLE card ADD COLUMN history TEXT DEFAULT \'[]\'', 'lerne'),
    (21, 'ALTER TABLE card ADD COLUMN tags TEXT DEFAULT \'[]\'', 'lerne'),
    (22, 'ALTER TABLE card ADD COLUMN topics TEXT DEFAULT \'[]\'', 'lerne'),
    (23, 'ALTER TABLE card ADD COLUMN source TEXT', 'lerne'),
    (24, 'ALTER TABLE card ADD COLUMN audio_back_path TEXT', 'lerne'),
    (25, 'ALTER TABLE card ADD COLUMN card_type TEXT DEFAULT \'translation\'', 'lerne'),
    (26, 'ALTER TABLE card ADD COLUMN is_deleted BOOLEAN DEFAULT false', 'lerne'),
    (27, 'ALTER TABLE card ADD COLUMN created_at TIMESTAMP', 'lerne'),
    (28, 'ALTER TABLE card ADD COLUMN cloud_id INTEGER', 'lerne'),
    (29, 'ALTER TABLE card ADD COLUMN difficulty REAL', 'lerne'),
    (30, 'ALTER TABLE card ADD COLUMN want_to_learn BOOLEAN DEFAULT false', 'lerne'),
    (31, 'ALTER TABLE card ADD COLUMN share_id TEXT', 'lerne'),
    (32, 'ALTER TABLE card ADD COLUMN creator_id BIGINT', 'lerne'),
    (33, 'ALTER TABLE card ADD COLUMN image_data BYTEA', 'lerne'),

    # --- Progress & Review ---
    (34, 'ALTER TABLE tmaprogress ADD COLUMN created_at TIMESTAMP', 'tma'),
    (35, 'ALTER TABLE tmaprogress ADD COLUMN updated_at TIMESTAMP', 'tma'),
    (36, 'ALTER TABLE tmareviewhistory ADD COLUMN reviewed_at TIMESTAMP', 'tma'),

    # --- Settings & Prompts ---
    (37, 'ALTER TABLE tmasetting ADD COLUMN updated_at TIMESTAMP', 'tma'),
    (38, 'ALTER TABLE tmauserprompt ADD COLUMN context_prompt TEXT', 'tma'),

    # --- User ---
    (39, 'ALTER TABLE tma_user ADD COLUMN phone TEXT', 'tma'),

    # --- Folders & Catalogs (v2) ---
    (40, 'ALTER TABLE deck ADD COLUMN folder_id INTEGER', 'lerne'),
    (41, 'ALTER TABLE deck ADD COLUMN category_id INTEGER', 'lerne'),
    (42, 'ALTER TABLE tma_deck ADD COLUMN folder_id INTEGER', 'tma'),
    (43, 'ALTER TABLE deck ADD COLUMN is_default BOOLEAN DEFAULT false', 'lerne'),
    (44, "UPDATE deck SET is_default = true WHERE name IN ('\u2b50 [A1] Basis-Wortschatz / \u0411\u0430\u0437\u043e\u0432\u044b\u0439 \u0441\u043b\u043e\u0432\u0430\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0430\u0441', '\u2b50 [A2] Alltagsdeutsch & Kommunikation', '\u2b50 [A2] Vorschl\u00e4ge machen / \u041f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f \u0438 \u0438\u0434\u0435\u0438', '\u2b50 [B1] Pl\u00e4ne und Bitten / \u041f\u043b\u0430\u043d\u044b \u0438 \u043f\u0440\u043e\u0441\u044c\u0431\u044b', '\u2b50 [B1] H\u00f6ren: Alltagsdialoge / \u0410\u0443\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435: \u0434\u0438\u0430\u043b\u043e\u0433\u0438')", 'lerne'),
    (45, 'ALTER TABLE tma_user ADD COLUMN default_decks_initialized BOOLEAN DEFAULT false', 'tma'),
    (46, 'ALTER TABLE deck ADD COLUMN is_pinned BOOLEAN DEFAULT false', 'lerne'),
    (47, 'ALTER TABLE tma_deck ADD COLUMN is_pinned BOOLEAN DEFAULT false', 'tma'),
    (48, 'ALTER TABLE deck ADD COLUMN position INTEGER DEFAULT 0', 'lerne'),
    (49, 'ALTER TABLE tma_deck ADD COLUMN position INTEGER DEFAULT 0', 'tma'),
    (50, 'ALTER TABLE card ADD COLUMN position INTEGER DEFAULT 0', 'lerne'),
    (51, 'ALTER TABLE tma_card ADD COLUMN position INTEGER DEFAULT 0', 'tma'),
    (52, 'ALTER TABLE tma_deck ADD COLUMN metadata TEXT DEFAULT \'{"resources": []}\'', 'tma'),
    (53, 'ALTER TABLE deck ADD COLUMN metadata TEXT DEFAULT \'{"resources": []}\'', 'lerne'),

    # --- Multi-Language Support (v3) ---
    (54, "ALTER TABLE tma_deck ADD COLUMN target_language TEXT DEFAULT 'de'", 'tma'),
    (55, "ALTER TABLE tma_folder ADD COLUMN target_language TEXT DEFAULT 'de'", 'tma'),
    (56, "ALTER TABLE deck ADD COLUMN target_language TEXT DEFAULT 'de'", 'lerne'),
    (57, "ALTER TABLE tma_custom_prompt ADD COLUMN target_language TEXT DEFAULT 'de'", 'tma'),
    (58, "ALTER TABLE tma_user ADD COLUMN active_language TEXT DEFAULT 'de'", 'tma'),
    (59, "ALTER TABLE tma_folder ADD COLUMN share_id TEXT", 'tma'),
    (60, "ALTER TABLE tma_custom_prompt ADD COLUMN prompt_type TEXT DEFAULT 'standard'", 'tma'),

    # --- Performance Indexes (v4) ---
    (61, "CREATE INDEX IF NOT EXISTS idx_tma_card_deck_deleted ON tma_card(deck_id, is_deleted)", 'tma'),
    (62, "CREATE INDEX IF NOT EXISTS idx_tma_card_front_deleted ON tma_card(front_text, is_deleted)", 'tma'),
    (63, "CREATE INDEX IF NOT EXISTS idx_tma_card_updated ON tma_card(updated_at)", 'tma'),
    (64, "CREATE INDEX IF NOT EXISTS idx_tma_deck_user_deleted ON tma_deck(user_id, is_deleted)", 'tma'),
    (65, "CREATE INDEX IF NOT EXISTS idx_tma_deck_folder ON tma_deck(folder_id)", 'tma'),
    (66, "CREATE INDEX IF NOT EXISTS idx_tma_deck_updated ON tma_deck(updated_at)", 'tma'),
    (67, "CREATE UNIQUE INDEX IF NOT EXISTS idx_tmaprogress_user_card ON tmaprogress(user_id, card_id)", 'tma'),
    (68, "CREATE INDEX IF NOT EXISTS idx_tmaprogress_queue_review ON tmaprogress(user_id, queue, next_review)", 'tma'),
    (69, "CREATE INDEX IF NOT EXISTS idx_tma_folder_user_deleted ON tma_folder(user_id, is_deleted)", 'tma'),
    (70, "ALTER TABLE tma_card ADD COLUMN flag INTEGER DEFAULT 0", 'tma'),
    (71, "ALTER TABLE card ADD COLUMN flag INTEGER DEFAULT 0", 'lerne'),
    (72, "ALTER TABLE tma_user ADD COLUMN has_selected_language BOOLEAN DEFAULT false", 'tma'),
    (73, "ALTER TABLE tma_user ADD COLUMN native_language TEXT DEFAULT 'uk'", 'tma'),
    (74, "ALTER TABLE tma_folder ADD COLUMN position INTEGER DEFAULT 0", 'tma'),
    (75, "CREATE TABLE IF NOT EXISTS tma_offline_batch (key VARCHAR(255) PRIMARY KEY, payload_hash VARCHAR(64) NOT NULL, response TEXT NOT NULL DEFAULT '', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)", 'tma'),
    (80, "ALTER TABLE tma_collaborator ADD COLUMN can_edit_audio BOOLEAN DEFAULT false", 'tma'),
    (81, "ALTER TABLE tmamedia ALTER COLUMN content DROP NOT NULL", 'tma'),
    # Global official lessons: access_scope on folders
    (83, "ALTER TABLE tma_folder ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'private'", 'tma'),
    # User-specific card state: flag and want_to_learn move from canonical card to per-user TMAProgress
    (84, "ALTER TABLE tmaprogress ADD COLUMN flag INTEGER NOT NULL DEFAULT 0", 'tma'),
    (85, "ALTER TABLE tmaprogress ADD COLUMN want_to_learn BOOLEAN NOT NULL DEFAULT false", 'tma'),
    # Partial index for fast global_readonly folder queries
    (86, "CREATE INDEX IF NOT EXISTS idx_tma_folder_access_scope ON tma_folder(access_scope)", 'tma'),
]


class MigrationError(RuntimeError):
    """Migration SQL/history commit was not confirmed; startup must fail."""


def run_migrations_fallback(tma_db, lerne_db):
    """Compatibility entry point; never execute migrations without history."""
    return run_migrations(tma_db, lerne_db)


def run_migrations(tma_db, lerne_db):
    """Commit pending SQL and history together, or roll the entire batch back.

    Both proxies must share one connection owner (as in api.database). Separate
    databases cannot atomically commit SQL and the existing central history.
    """
    database = getattr(tma_db, 'obj', tma_db)
    library = getattr(lerne_db, 'obj', lerne_db)
    if not isinstance(database, (SqliteDatabase, PostgresqlDatabase)):
        raise MigrationError('Unsupported migration database')
    if library is not database:
        raise MigrationError('Migration SQL and history require the same database instance')
    if database.in_transaction():
        raise MigrationError('Migration runner requires its own transaction')

    options = {'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}
    step = 'migration history setup'
    success = skipped = 0
    try:
        with database.atomic(**options):
            if isinstance(database, PostgresqlDatabase):
                database.execute_sql("SET LOCAL lock_timeout = '5s'")
                database.execute_sql('SELECT pg_advisory_xact_lock(76120901)')
            database.execute_sql("""CREATE TABLE IF NOT EXISTS tma_migration_history (
                migration_id INT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""")
            step = 'migration history read'
            applied_ids = {row[0] for row in database.execute_sql(
                'SELECT migration_id FROM tma_migration_history').fetchall()}
            for mig_id, query, db_key in MIGRATIONS:
                step = f'Migration {mig_id} ({db_key})'
                if mig_id in applied_ids:
                    skipped += 1
                    continue
                if db_key not in ('tma', 'lerne'):
                    raise ValueError(f'Unknown migration database key: {db_key}')
                database.execute_sql(query)
                database.execute_sql(
                    f'INSERT INTO tma_migration_history (migration_id) VALUES ({database.param})',
                    (mig_id,))
                applied_ids.add(mig_id)
                success += 1
            step = 'migration batch commit'
    except Exception as exc:
        logger.exception('%s failed; migration batch commit was not confirmed', step)
        raise MigrationError(f'{step} failed; migration batch commit was not confirmed') from exc

    logger.info('Migrations check complete: %s newly applied, %s skipped.', success, skipped)

    if isinstance(database, SqliteDatabase):
        try:
            # Пересоздаем представления, чтобы они подхватили новые колонки
            tma_db.execute_sql("DROP VIEW IF EXISTS tma_deck")
            tma_db.execute_sql("CREATE VIEW tma_deck AS SELECT * FROM deck")
            tma_db.execute_sql("DROP VIEW IF EXISTS tma_card")
            tma_db.execute_sql("CREATE VIEW tma_card AS SELECT * FROM card")

            # Обновляем триггеры для tma_deck и tma_card, чтобы они поддерживали все новые колонки
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_deck_insert")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_deck_insert INSTEAD OF INSERT ON tma_deck
                BEGIN
                    INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at, user_id, cloud_id, share_id, is_inbox, folder_id, category_id, is_pinned, position, metadata)
                    VALUES (NEW.id, NEW.name, NEW.level, NEW.topic, NEW.is_deleted, NEW.created_at, NEW.updated_at, NEW.user_id, NEW.cloud_id, NEW.share_id, NEW.is_inbox, NEW.folder_id, NEW.category_id, NEW.is_pinned, NEW.position, NEW.metadata);
                END;
            """)
            
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_card_insert")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_card_insert INSTEAD OF INSERT ON tma_card
                BEGIN
                    INSERT INTO card (id, deck_id, card_type, difficulty, front_text, back_text, context, audio_path, image_path, tags, topics, metadata, created_at, updated_at, history, is_deleted, cloud_id, source, video_front_path, video_back_path, image_data, audio_back_path, creator_id, share_id, position, flag)
                    VALUES (NEW.id, NEW.deck_id, NEW.card_type, NEW.difficulty, NEW.front_text, NEW.back_text, NEW.context, NEW.audio_path, NEW.image_path, NEW.tags, NEW.topics, NEW.metadata, NEW.created_at, NEW.updated_at, NEW.history, NEW.is_deleted, NEW.cloud_id, NEW.source, NEW.video_front_path, NEW.video_back_path, NEW.image_data, NEW.audio_back_path, NEW.creator_id, NEW.share_id, NEW.position, NEW.flag);
                END;
            """)

            # --- UPDATE triggers ---
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_deck_update")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_deck_update INSTEAD OF UPDATE ON tma_deck
                BEGIN
                    UPDATE deck SET 
                        name = NEW.name, level = NEW.level, topic = NEW.topic, 
                        is_deleted = NEW.is_deleted, updated_at = NEW.updated_at, 
                        user_id = NEW.user_id, cloud_id = NEW.cloud_id, 
                        share_id = NEW.share_id, is_inbox = NEW.is_inbox,
                        folder_id = NEW.folder_id, category_id = NEW.category_id,
                        is_pinned = NEW.is_pinned, position = NEW.position,
                        metadata = NEW.metadata
                    WHERE id = OLD.id;
                END;
            """)

            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_card_update")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_card_update INSTEAD OF UPDATE ON tma_card
                BEGIN
                    UPDATE card SET 
                        deck_id = NEW.deck_id, card_type = NEW.card_type, difficulty = NEW.difficulty, 
                        front_text = NEW.front_text, back_text = NEW.back_text, context = NEW.context, 
                        audio_path = NEW.audio_path, image_path = NEW.image_path, tags = NEW.tags, 
                        topics = NEW.topics, metadata = NEW.metadata, updated_at = NEW.updated_at, 
                        history = NEW.history, is_deleted = NEW.is_deleted, cloud_id = NEW.cloud_id, 
                        source = NEW.source, video_front_path = NEW.video_front_path, 
                        video_back_path = NEW.video_back_path, image_data = NEW.image_data, 
                        audio_back_path = NEW.audio_back_path, 
                        creator_id = NEW.creator_id, share_id = NEW.share_id, position = NEW.position,
                        flag = NEW.flag
                    WHERE id = OLD.id;
                END;
            """)

            # --- DELETE triggers ---
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_deck_delete")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_deck_delete INSTEAD OF DELETE ON tma_deck
                BEGIN
                    DELETE FROM deck WHERE id = OLD.id;
                END;
            """)

            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_card_delete")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_card_delete INSTEAD OF DELETE ON tma_card
                BEGIN
                    DELETE FROM card WHERE id = OLD.id;
                END;
            """)

            # Восстановление случайно удаленной колоды "Моя колода 1" (ID 118)
            try:
                tma_db.execute_sql("UPDATE deck SET is_deleted = 0, name = 'Моя колода 1', user_id = 642478257 WHERE id = 118")
                logger.info("Restored deck ID 118 (Моя колода 1) for user 642478257 successfully.")
            except Exception as e_rest:
                logger.error(f"Error restoring deck 118: {e_rest}")

            logger.info("SQLite INSTEAD OF INSERT/UPDATE/DELETE triggers updated successfully.")
        except Exception as e:
            logger.error(f"Error updating SQLite triggers: {e}")
