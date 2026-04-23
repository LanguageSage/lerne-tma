import os
import logging
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

# Загружаем переменные из .env
load_dotenv()

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Определение Провайдеров БД (Proxy) ---
tma_db = Proxy()
lerne_db = Proxy()

# Базовые пути
TMA_ROOT = Path(__file__).resolve().parent.parent.resolve()
TMA_DATA_DIR = TMA_ROOT / "api" / "data"

# Определяем среду
IS_VERCEL = os.environ.get("VERCEL") is not None
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")
FORCE_LOCAL = os.environ.get("FORCE_LOCAL_DB", "false").lower() == "true"

if IS_VERCEL:
    # Мы в облаке (Vercel)
    LIBRARY_ROOT = Path("/tmp")
    LERNE_DB_PATH = Path("/tmp/lerne_mock.db")
    TMA_DB_PATH = LERNE_DB_PATH
else:
    # Мы локально (Windows)
    DEFAULT_LIBRARY_ROOT = r"C:\121\Lerne_projekt\Lerne"
    LIBRARY_ROOT = Path(os.environ.get("LERNE_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT)).resolve()
    # Локально теперь используем одну и ту же БД для TMA и основного Lerne
    LERNE_DB_PATH = Path(os.environ.get("LERNE_DB_PATH", LIBRARY_ROOT / "db" / "lerne.db")).resolve()
    TMA_DB_PATH = LERNE_DB_PATH

def initialize_database():
    """Инициализация реального подключения к БД."""
    global tma_db, lerne_db
    
    # Пытаемся подключиться к облаку, если не форсирован локальный режим
    if SUPABASE_DB_URL and not FORCE_LOCAL and "your_database_url_here" not in SUPABASE_DB_URL:
        logger.info(f"DATABASE: Attempting Cloud connection (Supabase)...")
        try:
            actual_db = db_connect(SUPABASE_DB_URL)
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Connected to Cloud Postgres successfully.")
            return True
        except Exception as e:
            logger.error(f"DATABASE CLOUD ERROR: {e}. Falling back to SQLite.")
    
    # Fallback на SQLite (Локально)
    logger.info(f"DATABASE: Using SQLite database ({TMA_DB_PATH})")
    shared_db = SqliteDatabase(TMA_DB_PATH)
    tma_db.initialize(shared_db)
    lerne_db.initialize(shared_db)
    return False

def create_all_tables():
    """Создание всех таблиц в инициализированных базах."""
    try:
        # Используем tma_db, так как теперь они общие
        tma_db.create_tables([
            TMA_Deck, TMA_Card, TMAProgress, 
            TMAReviewHistory, TMASetting, TMAUserPrompt,
            Deck, Card 
        ])
        logger.info("DATABASE: All tables ensured.")
    except Exception as e:
        logger.warning(f"DATABASE: Note while creating tables: {e}")

# Инициализация при импорте перенесена в конец файла

# --- Модели (TMA) ---
class BaseModel(Model):
    class Meta:
        database = tma_db

class TMA_Deck(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True) # Добавляем владельца
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(constraints=[SQL("DEFAULT CURRENT_TIMESTAMP")])
    
    class Meta:
        table_name = 'tma_deck'

class TMA_Card(BaseModel):
    id = AutoField()
    # Связываем с личной колодой
    deck = ForeignKeyField(TMA_Deck, backref='cards', column_name='deck_id')
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    image_path = TextField(null=True)
    audio_path = TextField(null=True)
    
    # Доп. поля для совместимости с основной БД
    tags = TextField(null=True)
    metadata = TextField(null=True)
    card_type = CharField(default='translation')
    difficulty = FloatField(null=True)
    topics = TextField(null=True)
    source = CharField(default='tma')
    
    created_at = DateTimeField(constraints=[SQL("DEFAULT CURRENT_TIMESTAMP")])
    updated_at = DateTimeField(constraints=[SQL("DEFAULT CURRENT_TIMESTAMP")])
    is_deleted = BooleanField(default=False)
    
    class Meta:
        table_name = 'tma_card'

class TMAProgress(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    queue = CharField(default='new')
    interval = IntegerField(default=0)      # По умолчанию 0
    ease_factor = FloatField(default=2.5)
    repetitions = IntegerField(default=0)
    lapses = IntegerField(default=0)
    step_index = IntegerField(default=0)    # По умолчанию 0
    next_review = DateTimeField(null=True)
    last_reviewed = DateTimeField(null=True)
    created_at = DateTimeField(constraints=[SQL("DEFAULT CURRENT_TIMESTAMP")])
    updated_at = DateTimeField(null=True)

    class Meta:
        indexes = (
            # Оптимизация для выбора следующей карты (get_next_card)
            (('user_id', 'queue', 'next_review'), False),
        )

class TMAReviewHistory(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    rating = IntegerField()
    reviewed_at = DateTimeField(constraints=[SQL("DEFAULT CURRENT_TIMESTAMP")])

class TMASetting(BaseModel):
    id = AutoField()
    key = CharField(unique=True)
    value = TextField()

class TMAUserPrompt(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(unique=True)
    translation_prompt = TextField(null=True)
    context_prompt = TextField(null=True)

# --- Модели (Library) ---
class LibraryBaseModel(Model):
    class Meta:
        database = lerne_db

class Deck(LibraryBaseModel):
    id = AutoField()
    name = CharField()
    level = CharField(null=True)   # Соответствие Supabase
    topic = CharField(null=True)   # Соответствие Supabase
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(null=True)
    updated_at = DateTimeField(null=True)
    
    class Meta:
        table_name = 'deck'

class Card(LibraryBaseModel):
    id = AutoField()
    deck = ForeignKeyField(Deck, backref='cards', column_name='deck_id')
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    
    # Поля медиа для импорта
    audio_path = CharField(null=True)
    image_path = CharField(null=True)
    
    # Доп. поля для полноты данных
    card_type = CharField(null=True)
    source = CharField(null=True)
    tags = TextField(null=True)
    topics = TextField(null=True)
    difficulty = FloatField(null=True)
    
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(null=True)
    updated_at = DateTimeField(null=True)
    
    class Meta:
        table_name = 'card'

ExternalDeck = Deck
ExternalCard = Card

# --- Инициализация при импорте ---
try:
    initialize_database()
    create_all_tables()
except Exception as e:
    logger.error(f"CRITICAL: Failed to initialize database: {e}")
