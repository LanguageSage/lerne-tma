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
KNOWLEDGE_MASTERY_MIGRATION_ID = 82
KNOWLEDGE_MASTERY_LOCK_ID = 76120982
CARD_COMMUNICATION_MIGRATION_ID = 90  # 87-89 are already recorded in deployed histories.


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
