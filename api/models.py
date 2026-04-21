import datetime
import os
import logging
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

# Настройка логирования
logger = logging.getLogger(__name__)

# Загружаем переменные из .env
load_dotenv()

# Пути к базам данных
TMA_ROOT = Path(__file__).resolve().parent.parent.resolve()
TMA_DATA_DIR = TMA_ROOT / "api" / "data"

# LERNE_LIBRARY_ROOT - корень основного проекта Lerne (откуда импортируем)
DEFAULT_LIBRARY_ROOT = r"C:\121\Lerne_projekt\Lerne"
LIBRARY_ROOT = Path(os.environ.get("LERNE_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT)).resolve()

LERNE_DB_PATH = Path(os.environ.get("LERNE_DB_PATH", LIBRARY_ROOT / "db" / "lerne.db")).resolve()
TMA_DB_PATH = (TMA_DATA_DIR / "tma.db").resolve()

# --- Логика выбора Базы Данных (Cloud vs Local) ---
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")

if SUPABASE_DB_URL and "your_database_url_here" not in SUPABASE_DB_URL:
    logger.info("DATABASE: Attempting Cloud PostgreSQL (Supabase)")
    try:
        # playhouse.db_url.connect умеет парсить postgresql:// URI
        tma_db = db_connect(SUPABASE_DB_URL)
        lerne_db = tma_db 
    except Exception as e:
        logger.error(f"DATABASE ERROR: Could not connect to Supabase: {e}")
        # Фолбэк на локальную базу в случае ошибки сети
        lerne_db = SqliteDatabase(str(LERNE_DB_PATH))
        tma_db = SqliteDatabase(str(TMA_DB_PATH))
else:
    logger.info("DATABASE: Using Local SQLite")
    lerne_db = SqliteDatabase(
        str(LERNE_DB_PATH),
        pragmas={"journal_mode": "wal", "cache_size": -1024 * 8},
        timeout=10
    )
    tma_db = SqliteDatabase(
        str(TMA_DB_PATH),
        pragmas={"journal_mode": "wal", "cache_size": -1024 * 8},
        timeout=10
    )

class LerneModel(Model):
    class Meta:
        database = lerne_db

class TMAModel(Model):
    class Meta:
        database = tma_db

# --- Модели Внешней Библиотеки (Только чтение для импорта) ---

class ExternalDeck(LerneModel):
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        table_name = "deck"

class ExternalCard(LerneModel):
    deck = ForeignKeyField(ExternalDeck, backref="cards")
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    audio_path = CharField(null=True)
    image_path = CharField(null=True)
    tags = TextField(null=True)
    metadata = TextField(null=True)
    
    # Поля для полной совместимости
    card_type = CharField(default="standard")
    difficulty = FloatField(null=True)
    topics = TextField(null=True)
    source = TextField(default="tma")
    
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(default=datetime.datetime.now)
    
    class Meta:
        table_name = "card"

# --- Модели Локальной Библиотеки TMA (Чтение и Запись) ---

class Deck(TMAModel):
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    class Meta:
        table_name = "tma_deck"

class Card(TMAModel):
    deck = ForeignKeyField(Deck, backref="cards")
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    audio_path = CharField(null=True)
    image_path = CharField(null=True)
    tags = TextField(null=True)
    metadata = TextField(null=True)
    
    # Поля для полной совместимости
    card_type = CharField(default="standard")
    difficulty = FloatField(null=True)
    topics = TextField(null=True)
    source = TextField(default="tma")
    
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(default=datetime.datetime.now)
    
    class Meta:
        table_name = "tma_card"

# --- Модели Прогресса TMA ---

class TMAProgress(TMAModel):
    """Отдельная система учета прогресса для TMA."""
    user_id = IntegerField()  # Telegram ID пользователя
    card_id = IntegerField()  # Ссылка на Card.id в локальной tma.db
    
    repetitions = IntegerField(default=0)
    interval = IntegerField(default=0)
    ease_factor = FloatField(default=2.5)
    lapses = IntegerField(default=0)
    
    last_reviewed = DateTimeField(null=True)
    next_review = DateTimeField(default=datetime.datetime.now)
    
    queue = CharField(default="new") # new, learning, review, relearning
    step_index = IntegerField(null=True)
    
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(default=datetime.datetime.now)

    class Meta:
        table_name = "tmaprogress"
        indexes = (
            (("card_id", "user_id"), True),
        )

class TMAReviewHistory(TMAModel):
    """История ответов специально для TMA."""
    user_id = IntegerField()
    card_id = IntegerField()
    rating = IntegerField()
    review_time = DateTimeField(default=datetime.datetime.now)
    scheduled_interval = IntegerField()

class TMASetting(TMAModel):
    """Глобальные настройки ИИ и системы (Admin)."""
    key = CharField(unique=True)
    value = TextField(null=True)
    updated_at = DateTimeField(default=datetime.datetime.now)

class TMAUserPrompt(TMAModel):
    """Персональные промпты пользователя."""
    user_id = IntegerField(unique=True)
    translation_prompt = TextField()
    context_prompt = TextField()
    updated_at = DateTimeField(default=datetime.datetime.now)

def init_tma_db():
    """Инициализация базы данных TMA."""
    is_sqlite = isinstance(tma_db, SqliteDatabase)
    
    try:
        tma_db.connect(reuse_if_open=True)
        tma_db.create_tables([
            ExternalDeck, ExternalCard, # Таблицы библиотеки
            Deck, Card,                  # Таблицы TMA
            TMAProgress, TMAReviewHistory,
            TMASetting, TMAUserPrompt
        ])
        logger.info("All Database Tables initialized successfully (TMA & Library)")
    except Exception as e:
        logger.error(f"Error initializing TMA DB tables: {e}")
    
    # Миграция: добавляем lapses (только для SQLite, в Postgres создастся сразу)
    if is_sqlite:
        try:
            cursor = tma_db.execute_sql("PRAGMA table_info(tmaprogress)")
            columns = [row[1] for row in cursor.fetchall()]
            if 'lapses' not in columns:
                tma_db.execute_sql("ALTER TABLE tmaprogress ADD COLUMN lapses INTEGER DEFAULT 0")
                logger.info("TMA Migration: Added 'lapses' column to tmaprogress")
        except Exception as e:
            logger.warning(f"TMA Migration warning (SQLite): {e}")
    
    # Инициализация настроек по умолчанию (если пусто)
    if TMASetting.select().count() == 0:
        TMASetting.create(key="AI_PROVIDER", value="ollama")
        TMASetting.create(key="OLLAMA_URL", value="http://localhost:11434")
        TMASetting.create(key="DEFAULT_MODEL", value="google/gemini-2.0-flash-lite-preview-02-05:free")
        TMASetting.create(key="ADMIN_SECRET", value="1")
        TMASetting.create(key="TTS_VOICE", value="de-DE-KatjaNeural")
        TMASetting.create(key="TTS_SPEED", value="+0%")
        logger.info("Default settings created")

    # Убеждаемся что новые настройки есть (если БД уже была)
    for key, val in [("TTS_SPEED", "+0%"), ("TTS_VOICE", "de-DE-KatjaNeural")]:
        if TMASetting.select().where(TMASetting.key == key).count() == 0:
            TMASetting.create(key=key, value=val)

    # Подключаем lerne_db (только если она отличается от tma_db)
    if lerne_db != tma_db:
        try:
            lerne_db.connect(reuse_if_open=True)
            logger.info(f"Lerne DB connected (SQLite) from: {LERNE_DB_PATH}")
        except Exception as e:
            logger.warning(f"Could not connect to Lerne Library DB (SQLite) at {LERNE_DB_PATH}: {e}")

if __name__ == "__main__":
    init_tma_db()
