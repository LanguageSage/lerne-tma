"""
Migrations module: все SQL-миграции для существующих баз данных.
При добавлении новой колонки/таблицы — просто добавляй строку в MIGRATIONS.
Каждая миграция выполняется с обработкой ошибок, чтобы не падать если колонка уже есть.
"""
import logging
from peewee import SqliteDatabase

logger = logging.getLogger(__name__)

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
]


def run_migrations_fallback(tma_db, lerne_db):
    """Резервный метод на случай проблем с таблицей истории миграций."""
    db_map = {'tma': tma_db, 'lerne': lerne_db}
    success = 0
    skipped = 0
    for mig_id, query, db_key in MIGRATIONS:
        db = db_map.get(db_key)
        if not db:
            continue
        try:
            db.execute_sql(query)
            success += 1
        except Exception:
            skipped += 1
    logger.info(f"Fallback Migrations: {success} applied, {skipped} skipped.")


def run_migrations(tma_db, lerne_db):
    """Выполняет все накопленные миграции. Оптимизировано: проверяет историю миграций."""
    db_map = {'tma': tma_db, 'lerne': lerne_db}

    # 1. Создаем таблицу истории миграций, если её еще нет (в tma_db)
    try:
        tma_db.execute_sql("""
            CREATE TABLE IF NOT EXISTS tma_migration_history (
                migration_id INT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as e:
        logger.error(f"Failed to create migration history table: {e}")
        # В случае ошибки создаем резервный запуск без истории
        return run_migrations_fallback(tma_db, lerne_db)

    # 2. Получаем список уже примененных миграций
    try:
        cursor = tma_db.execute_sql("SELECT migration_id FROM tma_migration_history")
        applied_ids = {row[0] for row in cursor.fetchall()}
    except Exception as e:
        logger.error(f"Failed to fetch applied migrations: {e}")
        applied_ids = set()

    success = 0
    skipped = 0
    new_applied = []

    for mig_id, query, db_key in MIGRATIONS:
        if mig_id in applied_ids:
            skipped += 1
            continue

        db = db_map.get(db_key)
        if not db:
            continue

        try:
            db.execute_sql(query)
            success += 1
            new_applied.append(mig_id)
        except Exception as e:
            err_msg = str(e).lower()
            # Если миграция падает, потому что колонка/таблица уже есть, или это view в SQLite —
            # мы считаем её выполненной и записываем в историю, чтобы больше не пытаться.
            is_already_exists = (
                "already exists" in err_msg or 
                "duplicate column" in err_msg or 
                "duplicate key" in err_msg or
                "is_deleted" in err_msg or
                "duplicate" in err_msg or
                "cannot add a column to a view" in err_msg or
                "no such column" in err_msg or
                "view" in err_msg
            )
            if is_already_exists:
                skipped += 1
                new_applied.append(mig_id)
            else:
                logger.warning(f"Migration {mig_id} failed (continuing): {query}. Error: {e}")
                # Мы всё равно помечаем её как примененную, чтобы не зависать на ней при каждом старте.
                # Если разработчику нужно переприменить её, он может удалить строку из tma_migration_history.
                new_applied.append(mig_id)

    # 3. Записываем вновь примененные миграции в историю
    if new_applied:
        try:
            with tma_db.atomic():
                for mig_id in new_applied:
                    tma_db.execute_sql(f"INSERT INTO tma_migration_history (migration_id) VALUES ({mig_id})")
        except Exception as e:
            logger.error(f"Failed to record applied migrations: {e}")

    logger.info(f"Migrations: {success} newly applied, {skipped} skipped/already applied.")

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

            # --- UPDATE triggers ---
            tma_db.execute_sql("DROP TRIGGER IF EXISTS tma_deck_update")
            tma_db.execute_sql("""
                CREATE TRIGGER tma_deck_update INSTEAD OF UPDATE ON tma_deck
                BEGIN
                    UPDATE deck SET 
                        name = NEW.name, level = NEW.level, topic = NEW.topic, 
                        is_deleted = NEW.is_deleted, updated_at = NEW.updated_at, 
                        user_id = NEW.user_id, cloud_id = NEW.cloud_id, 
                        share_id = NEW.share_id, is_inbox = NEW.is_inbox
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
                        audio_back_path = NEW.audio_back_path, want_to_learn = NEW.want_to_learn, 
                        creator_id = NEW.creator_id, share_id = NEW.share_id
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
