"""
Migrations module: все SQL-миграции для существующих баз данных.
При добавлении новой колонки/таблицы — просто добавляй строку в MIGRATIONS.
Каждая миграция выполняется с обработкой ошибок, чтобы не падать если колонка уже есть.
"""
import logging

logger = logging.getLogger(__name__)

# Список миграций: (SQL-запрос, имя_базы_данных)
# 'tma' — основная база (tma_db), 'lerne' — библиотека (lerne_db)
MIGRATIONS = [
    # --- Deck ---
    ('ALTER TABLE tma_deck ADD COLUMN updated_at TIMESTAMP', 'tma'),
    ('ALTER TABLE tma_deck ADD COLUMN share_id TEXT', 'tma'),
    ('ALTER TABLE tma_deck ADD COLUMN is_inbox BOOLEAN DEFAULT false', 'tma'),
    ('ALTER TABLE deck ADD COLUMN updated_at TIMESTAMP', 'lerne'),
    ('ALTER TABLE deck ADD COLUMN is_deleted BOOLEAN DEFAULT false', 'lerne'),
    ('ALTER TABLE deck ADD COLUMN created_at TIMESTAMP', 'lerne'),
    ('ALTER TABLE deck ADD COLUMN cloud_id INTEGER', 'lerne'),

    # --- Card ---
    ('ALTER TABLE tma_card ADD COLUMN history TEXT DEFAULT \'[]\'', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN tags TEXT DEFAULT \'[]\'', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN topics TEXT DEFAULT \'[]\'', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN source TEXT', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN want_to_learn BOOLEAN DEFAULT false', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN share_id TEXT', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN creator_id BIGINT', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN image_data BYTEA', 'tma'),
    ('ALTER TABLE tma_card ADD COLUMN audio_back_path TEXT', 'tma'),
    ('ALTER TABLE card ADD COLUMN updated_at TIMESTAMP', 'lerne'),
    ('ALTER TABLE card ADD COLUMN history TEXT DEFAULT \'[]\'', 'lerne'),
    ('ALTER TABLE card ADD COLUMN tags TEXT DEFAULT \'[]\'', 'lerne'),
    ('ALTER TABLE card ADD COLUMN topics TEXT DEFAULT \'[]\'', 'lerne'),
    ('ALTER TABLE card ADD COLUMN source TEXT', 'lerne'),
    ('ALTER TABLE card ADD COLUMN audio_back_path TEXT', 'lerne'),
    ('ALTER TABLE card ADD COLUMN card_type TEXT DEFAULT \'translation\'', 'lerne'),
    ('ALTER TABLE card ADD COLUMN is_deleted BOOLEAN DEFAULT false', 'lerne'),
    ('ALTER TABLE card ADD COLUMN created_at TIMESTAMP', 'lerne'),
    ('ALTER TABLE card ADD COLUMN cloud_id INTEGER', 'lerne'),
    ('ALTER TABLE card ADD COLUMN difficulty REAL', 'lerne'),

    # --- Progress & Review ---
    ('ALTER TABLE tmaprogress ADD COLUMN created_at TIMESTAMP', 'tma'),
    ('ALTER TABLE tmaprogress ADD COLUMN updated_at TIMESTAMP', 'tma'),
    ('ALTER TABLE tmareviewhistory ADD COLUMN reviewed_at TIMESTAMP', 'tma'),

    # --- Settings & Prompts ---
    ('ALTER TABLE tmasetting ADD COLUMN updated_at TIMESTAMP', 'tma'),
    ('ALTER TABLE tmauserprompt ADD COLUMN context_prompt TEXT', 'tma'),

    # --- User ---
    ('ALTER TABLE tma_user ADD COLUMN phone TEXT', 'tma'),
]


def run_migrations(tma_db, lerne_db):
    """Выполняет все накопленные миграции. Безопасно — ошибки игнорируются (колонка уже есть)."""
    db_map = {'tma': tma_db, 'lerne': lerne_db}
    success = 0
    skipped = 0
    for query, db_key in MIGRATIONS:
        db = db_map.get(db_key)
        if not db:
            continue
        try:
            db.execute_sql(query)
            success += 1
        except Exception:
            skipped += 1  # Колонка/таблица уже существует — нормально

    logger.info(f"Migrations: {success} applied, {skipped} skipped (already exist).")
