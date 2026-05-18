"""
Migrations module: все SQL-миграции для существующих баз данных.
При добавлении новой колонки/таблицы — просто добавляй строку в MIGRATIONS.
Каждая миграция выполняется с обработкой ошибок, чтобы не падать если колонка уже есть.
"""
import logging
from peewee import SqliteDatabase

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
    ('ALTER TABLE deck ADD COLUMN share_id TEXT', 'lerne'),
    ('ALTER TABLE deck ADD COLUMN is_inbox BOOLEAN DEFAULT false', 'lerne'),

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
    ('ALTER TABLE card ADD COLUMN want_to_learn BOOLEAN DEFAULT false', 'lerne'),
    ('ALTER TABLE card ADD COLUMN share_id TEXT', 'lerne'),
    ('ALTER TABLE card ADD COLUMN creator_id BIGINT', 'lerne'),
    ('ALTER TABLE card ADD COLUMN image_data BYTEA', 'lerne'),

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

    if isinstance(tma_db.obj, SqliteDatabase):
        try:
            # Обновляем триггеры для tma_deck и tma_card, чтобы они поддерживали все новые колонки
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_deck_insert")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_deck_insert INSTEAD OF INSERT ON tma_deck
                BEGIN
                    INSERT INTO deck (id, name, level, topic, is_deleted, created_at, updated_at, user_id, cloud_id, share_id, is_inbox)
                    VALUES (NEW.id, NEW.name, NEW.level, NEW.topic, NEW.is_deleted, NEW.created_at, NEW.updated_at, NEW.user_id, NEW.cloud_id, NEW.share_id, NEW.is_inbox);
                END;
            """)
            
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_card_insert")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_card_insert INSTEAD OF INSERT ON tma_card
                BEGIN
                    INSERT INTO card (id, deck_id, card_type, difficulty, front_text, back_text, context, audio_path, image_path, tags, topics, metadata, created_at, updated_at, history, is_deleted, cloud_id, source, video_front_path, video_back_path, image_data, audio_back_path, want_to_learn, creator_id, share_id)
                    VALUES (NEW.id, NEW.deck_id, NEW.card_type, NEW.difficulty, NEW.front_text, NEW.back_text, NEW.context, NEW.audio_path, NEW.image_path, NEW.tags, NEW.topics, NEW.metadata, NEW.created_at, NEW.updated_at, NEW.history, NEW.is_deleted, NEW.cloud_id, NEW.source, NEW.video_front_path, NEW.video_back_path, NEW.image_data, NEW.audio_back_path, NEW.want_to_learn, NEW.creator_id, NEW.share_id);
                END;
            """)
            logger.info("SQLite INSTEAD OF INSERT triggers updated successfully.")
        except Exception as e:
            logger.error(f"Error updating SQLite triggers: {e}")
