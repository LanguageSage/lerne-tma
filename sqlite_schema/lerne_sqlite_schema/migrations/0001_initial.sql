-- Canonical Lerne SQLite Schema — Migration 0001 (Initial)
-- Compatible with Python sqlite3 and Android @capacitor-community/sqlite.
-- Native V2 content lives in cards.content_v2_json without altering lerne-card-core.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES library_categories(id) ON DELETE CASCADE,
    icon TEXT,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_library_categories_parent
    ON library_categories(parent_id, position);

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    color TEXT,
    target_language TEXT NOT NULL DEFAULT 'de',
    position INTEGER NOT NULL DEFAULT 0,
    is_readonly INTEGER NOT NULL DEFAULT 0 CHECK (is_readonly IN (0, 1)),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    origin_key TEXT UNIQUE,
    source_id INTEGER,
    local_edited INTEGER NOT NULL DEFAULT 0 CHECK (local_edited IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_folders_parent_active
    ON folders(parent_id, is_deleted, position);

CREATE INDEX IF NOT EXISTS idx_folders_lang_active
    ON folders(target_language, is_deleted);

CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    scope TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'library')),
    category_id INTEGER REFERENCES library_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    level TEXT,
    topic TEXT,
    target_language TEXT NOT NULL DEFAULT 'de',
    color TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_learning INTEGER NOT NULL DEFAULT 0 CHECK (is_learning IN (0, 1)),
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    is_readonly INTEGER NOT NULL DEFAULT 0 CHECK (is_readonly IN (0, 1)),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    metadata_json TEXT NOT NULL DEFAULT '{"resources":[]}',
    origin_key TEXT UNIQUE,
    source_key TEXT,
    local_edited INTEGER NOT NULL DEFAULT 0 CHECK (local_edited IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_decks_folder_active
    ON decks(folder_id, is_deleted, position);

CREATE INDEX IF NOT EXISTS idx_decks_scope_lang
    ON decks(scope, target_language, is_deleted);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    content_v2_json TEXT NOT NULL,
    front_preview TEXT NOT NULL DEFAULT '',
    back_preview TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    audio_path TEXT,
    audio_back_path TEXT,
    video_front_path TEXT,
    video_back_path TEXT,
    difficulty REAL,
    source TEXT NOT NULL DEFAULT 'user',
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    origin_key TEXT UNIQUE,
    source_key TEXT,
    local_edited INTEGER NOT NULL DEFAULT 0 CHECK (local_edited IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_deck_active
    ON cards(deck_id, is_deleted, position, id);

CREATE INDEX IF NOT EXISTS idx_cards_front_preview
    ON cards(front_preview, is_deleted);

CREATE TABLE IF NOT EXISTS media_assets (
    sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
    folder TEXT NOT NULL CHECK (folder IN ('images', 'audio', 'videos', 'backgrounds')),
    rel_path TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    created_at TEXT NOT NULL,
    verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_assets_folder
    ON media_assets(folder, rel_path);

CREATE TABLE IF NOT EXISTS media_links (
    owner_type TEXT NOT NULL CHECK (owner_type IN ('card', 'deck', 'app_state')),
    owner_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    media_sha256 TEXT NOT NULL REFERENCES media_assets(sha256) ON DELETE RESTRICT,
    PRIMARY KEY (owner_type, owner_id, slot, media_sha256)
);

CREATE INDEX IF NOT EXISTS idx_media_links_sha256
    ON media_links(media_sha256);

CREATE TABLE IF NOT EXISTS tts_cache (
    cache_key TEXT PRIMARY KEY CHECK (length(cache_key) = 64),
    media_sha256 TEXT NOT NULL REFERENCES media_assets(sha256) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL,
    lang TEXT NOT NULL,
    rate TEXT NOT NULL DEFAULT '+0%',
    options_json TEXT NOT NULL DEFAULT '{}',
    text_norm TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tts_cache_media
    ON tts_cache(media_sha256);

CREATE INDEX IF NOT EXISTS idx_tts_cache_lookup
    ON tts_cache(provider, model, voice, lang, rate);

CREATE TABLE IF NOT EXISTS card_progress (
    card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    queue TEXT NOT NULL DEFAULT 'new' CHECK (queue IN ('new', 'learning', 'relearning', 'review')),
    interval INTEGER NOT NULL DEFAULT 0 CHECK (interval >= 0),
    ease_factor REAL NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.0 AND ease_factor <= 5.0),
    repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
    lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    step_index INTEGER DEFAULT 0,
    next_review TEXT,
    last_reviewed TEXT,
    flag INTEGER NOT NULL DEFAULT 0 CHECK (flag >= 0 AND flag <= 7),
    want_to_learn INTEGER NOT NULL DEFAULT 0 CHECK (want_to_learn IN (0, 1)),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_card_progress_due
    ON card_progress(queue, next_review);

CREATE TABLE IF NOT EXISTS review_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    review_time TEXT NOT NULL,
    scheduled_interval INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_review_history_card_time
    ON review_history(card_id, review_time);

CREATE TABLE IF NOT EXISTS card_notes (
    id TEXT PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_notes_card
    ON card_notes(card_id, is_deleted);

CREATE TABLE IF NOT EXISTS knowledge_items (
    rule_code TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('language', 'domain', 'topic', 'skill')),
    name TEXT NOT NULL,
    description TEXT,
    cefr_level TEXT,
    parent_key TEXT,
    prerequisite_keys_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_lang_kind
    ON knowledge_items(language, kind);

CREATE TABLE IF NOT EXISTS card_knowledge_items (
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rule_code TEXT NOT NULL REFERENCES knowledge_items(rule_code) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    complexity INTEGER DEFAULT 3 CHECK (complexity IS NULL OR (complexity BETWEEN 1 AND 5)),
    ability TEXT,
    example_key TEXT,
    weight REAL,
    PRIMARY KEY (card_id, rule_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_ki_primary
    ON card_knowledge_items(card_id) WHERE role = 'primary';

CREATE INDEX IF NOT EXISTS idx_card_ki_rule
    ON card_knowledge_items(rule_code, role);

CREATE TABLE IF NOT EXISTS knowledge_attempts (
    client_event_id TEXT PRIMARY KEY,
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    rule_code TEXT NOT NULL REFERENCES knowledge_items(rule_code) ON DELETE CASCADE,
    event_time TEXT NOT NULL,
    evaluation_data_json TEXT NOT NULL,
    review_id INTEGER REFERENCES review_history(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_attempts_rule_time
    ON knowledge_attempts(rule_code, event_time);

CREATE INDEX IF NOT EXISTS idx_knowledge_attempts_card
    ON knowledge_attempts(card_id);

CREATE TABLE IF NOT EXISTS user_knowledge_state (
    rule_code TEXT PRIMARY KEY REFERENCES knowledge_items(rule_code) ON DELETE CASCADE,
    attempts_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    calculation_version TEXT NOT NULL DEFAULT '',
    state_data_json TEXT,
    positive_evidence REAL NOT NULL DEFAULT 0,
    negative_evidence REAL NOT NULL DEFAULT 0,
    evidence_mass REAL NOT NULL DEFAULT 0,
    proficiency REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0,
    evidence_event_count INTEGER NOT NULL DEFAULT 0,
    objective_event_count INTEGER NOT NULL DEFAULT 0,
    self_rating_event_count INTEGER NOT NULL DEFAULT 0,
    last_evidence_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS custom_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    translation_prompt TEXT NOT NULL,
    context_prompt TEXT NOT NULL,
    target_language TEXT NOT NULL DEFAULT 'de',
    prompt_type TEXT NOT NULL DEFAULT 'standard',
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_prompts_active
    ON custom_prompts(target_language, prompt_type, is_active);
