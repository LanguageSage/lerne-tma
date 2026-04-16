import datetime
import os
from pathlib import Path
from peewee import *

# Пути к базам данных
# TMA_ROOT всегда указывает на папку tma/
TMA_ROOT = Path(__file__).resolve().parent.parent.resolve()
TMA_DATA_DIR = TMA_ROOT / "api" / "data"
 
# LERNE_LIBRARY_ROOT - корень основного проекта Lerne (откуда импортируем)
DEFAULT_LIBRARY_ROOT = r"C:\121\Lerne_projekt\Lerne"
LIBRARY_ROOT = Path(os.environ.get("LERNE_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT)).resolve()

LERNE_DB_PATH = Path(os.environ.get("LERNE_DB_PATH", LIBRARY_ROOT / "db" / "lerne.db")).resolve()
TMA_DB_PATH = (TMA_DATA_DIR / "tma.db").resolve()

print(f"DEBUG: TMA_ROOT = {TMA_ROOT}")
print(f"DEBUG: LIBRARY_ROOT = {LIBRARY_ROOT}")
print(f"DEBUG: LERNE_DB_PATH = {LERNE_DB_PATH}")
print(f"DEBUG: TMA_DB_PATH = {TMA_DB_PATH}")

# 1. Основная БД (Библиотека - только чтение)
lerne_db = SqliteDatabase(
    str(LERNE_DB_PATH),
    pragmas={"journal_mode": "wal", "cache_size": -1024 * 8},
    timeout=10
)

class LerneModel(Model):
    class Meta:
        database = lerne_db

# 2. БД TMA (Прогресс - чтение и запись)
tma_db = SqliteDatabase(
    str(TMA_DB_PATH),
    pragmas={"journal_mode": "wal", "cache_size": -1024 * 8},
    timeout=10
)

class TMAModel(Model):
    class Meta:
        database = tma_db

# --- Модели Внешней Библиотеки (Только чтение для импорта) ---

class ExternalDeck(LerneModel):
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
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
    try:
        tma_db.connect(reuse_if_open=True)
        tma_db.create_tables([
            Deck, Card,
            TMAProgress, TMAReviewHistory,
            TMASetting, TMAUserPrompt
        ])
    except Exception as e:
        print(f"Error initializing TMA DB: {e}")
    
    # Миграция: добавляем lapses если его нет
    try:
        cursor = tma_db.execute_sql("PRAGMA table_info(tmaprogress)")
        columns = [row[1] for row in cursor.fetchall()]
        if 'lapses' not in columns:
            tma_db.execute_sql("ALTER TABLE tmaprogress ADD COLUMN lapses INTEGER DEFAULT 0")
            print("TMA Migration: Added 'lapses' column to tmaprogress")
    except Exception as e:
        print(f"TMA Migration warning: {e}")
    
    # Инициализация настроек по умолчанию (если пусто)
    if TMASetting.select().count() == 0:
        TMASetting.create(key="AI_PROVIDER", value="ollama")
        TMASetting.create(key="OLLAMA_URL", value="http://localhost:11434")
        TMASetting.create(key="DEFAULT_MODEL", value="google/gemini-2.0-flash-lite-preview-02-05:free")
        TMASetting.create(key="ADMIN_SECRET", value="1") # Для ?admin=1
        TMASetting.create(key="TTS_VOICE", value="de-DE-KatjaNeural")

    # Подключаем lerne_db
    try:
        lerne_db.connect(reuse_if_open=True)
        print(f"Lerne DB connected from: {LERNE_DB_PATH}")
    except Exception as e:
        print(f"Warning: Could not connect to Lerne Library DB at {LERNE_DB_PATH}: {e}")

if __name__ == "__main__":
    init_tma_db()
