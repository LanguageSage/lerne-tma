import os
import logging
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect

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
IS_CLOUD = os.environ.get("VERCEL") or os.environ.get("SUPABASE_DB_URL")

if IS_CLOUD:
    LIBRARY_ROOT = Path("/tmp")
    TMA_DB_PATH = Path("/tmp/tma_mock.db")
    LERNE_DB_PATH = Path("/tmp/lerne_mock.db")
else:
    DEFAULT_LIBRARY_ROOT = r"C:\121\Lerne_projekt\Lerne"
    LIBRARY_ROOT = Path(os.environ.get("LERNE_LIBRARY_ROOT", DEFAULT_LIBRARY_ROOT)).resolve()
    LERNE_DB_PATH = Path(os.environ.get("LERNE_DB_PATH", LIBRARY_ROOT / "db" / "lerne.db")).resolve()
    TMA_DB_PATH = (TMA_DATA_DIR / "tma.db").resolve()

def initialize_database():
    """Инициализация реального подключения к БД."""
    global tma_db, lerne_db
    
    db_url = os.environ.get("SUPABASE_DB_URL")
    
    if db_url and "your_database_url_here" not in db_url:
        logger.info(f"DATABASE: Connecting to Supabase (URL length: {len(db_url)})")
        try:
            # В облаке мы уже знаем, что psycopg2-binary работает отлично
            actual_db = db_connect(db_url)
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Cloud connection initialized.")
            return True
        except Exception as e:
            logger.error(f"DATABASE ERROR: {e}")
    
    # Fallback на SQLite
    logger.info(f"DATABASE: Falling back to SQLite ({TMA_DB_PATH})")
    local_tma = SqliteDatabase(TMA_DB_PATH)
    tma_db.initialize(local_tma)
    
    if not IS_CLOUD:
        local_lerne = SqliteDatabase(LERNE_DB_PATH)
        lerne_db.initialize(local_lerne)
    else:
        lerne_db.initialize(local_tma)
    
    return False

# Инициализация при импорте
try:
    initialize_database()
except Exception as e:
    logger.error(f"Failed to init DB: {e}")

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
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(null=True)
    updated_at = DateTimeField(null=True)
    
    class Meta:
        table_name = 'card'

ExternalDeck = Deck
ExternalCard = Card
