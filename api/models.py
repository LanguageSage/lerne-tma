import os
import logging
import datetime
from pathlib import Path
from peewee import *
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

tma_db = Proxy()
lerne_db = Proxy()

# Пути к файлам данных (модульный уровень — используется в main.py)
TMA_ROOT = Path(__file__).resolve().parent.parent
TMA_DATA_DIR = TMA_ROOT / "api" / "data"

def initialize_database():
    global tma_db, lerne_db
    SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")
    FORCE_LOCAL = os.environ.get("FORCE_LOCAL_DB", "false").lower() == "true"
    
    if SUPABASE_DB_URL and not FORCE_LOCAL:
        try:
            actual_db = db_connect(SUPABASE_DB_URL)
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            return True
        except Exception as e:
            logger.error(f"DATABASE CLOUD ERROR: {e}")
    
    TMA_ROOT = Path(__file__).resolve().parent.parent
    TMA_DB_PATH = TMA_ROOT / "api" / "data" / "lerne.db"
    os.makedirs(TMA_DB_PATH.parent, exist_ok=True)
    shared_db = SqliteDatabase(TMA_DB_PATH)
    tma_db.initialize(shared_db)
    lerne_db.initialize(shared_db)
    return False

def create_all_tables():
    try:
        tma_db.create_tables([
            TMA_Deck, TMA_Card, TMAProgress, 
            TMAReviewHistory, TMASetting, TMAUserPrompt,
            TMAMedia, # Новая таблица для медиа
            Deck, Card 
        ])
        # Миграция: добавляем image_data если колонки нет (для существующих БД)
        try:
            tma_db.execute_sql('ALTER TABLE tma_card ADD COLUMN image_data BYTEA')
            logger.info("Migration: added image_data column to tma_card")
        except Exception:
            pass  # Колонка уже есть
    except: pass

class BaseModel(Model):
    class Meta:
        database = tma_db

class TMA_Deck(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True)
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        table_name = 'tma_deck'

class TMA_Card(BaseModel):
    id = AutoField()
    deck = ForeignKeyField(TMA_Deck, backref='cards', column_name='deck_id')
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    image_path = TextField(null=True)
    image_data = BlobField(null=True)  # Бинарные данные изображения
    audio_path = TextField(null=True)
    tags = TextField(null=True)
    metadata = TextField(null=True)
    card_type = CharField(default='translation')
    difficulty = FloatField(null=True)
    topics = TextField(null=True)
    source = TextField(null=True)
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    class Meta:
        table_name = 'tma_card'

class TMAProgress(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    queue = CharField(default='new')
    interval = IntegerField(default=0)
    ease_factor = FloatField(default=2.5)
    repetitions = IntegerField(default=0)
    lapses = IntegerField(default=0)
    step_index = IntegerField(default=0, null=True)
    next_review = DateTimeField(null=True)
    last_reviewed = DateTimeField(null=True)
    class Meta:
        table_name = 'tmaprogress'

class TMAReviewHistory(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    rating = IntegerField()
    review_time = DateTimeField(default=datetime.datetime.now)
    scheduled_interval = IntegerField(default=0)
    class Meta:
        table_name = 'tmareviewhistory'

class TMASetting(BaseModel):
    id = AutoField()
    key = CharField(unique=True)
    value = TextField()
    class Meta:
        table_name = 'tmasetting'

class TMAMedia(BaseModel):
    id = AutoField()
    filename = CharField(index=True)
    folder = CharField()  # 'images' или 'audio'
    content = BlobField()
    created_at = DateTimeField(default=datetime.datetime.now)

    class Meta:
        table_name = 'tmamedia'
        indexes = (
            (('filename', 'folder'), True),
        )

class TMAUserPrompt(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(unique=True)
    translation_prompt = TextField(null=True)
    class Meta:
        table_name = 'tmauserprompt'

class Deck(Model):
    id = AutoField()
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    class Meta:
        database = lerne_db
        table_name = 'deck'

class Card(Model):
    id = AutoField()
    deck = ForeignKeyField(Deck, backref='cards', column_name='deck_id')
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    image_path = TextField(null=True)
    audio_path = TextField(null=True)
    class Meta:
        database = lerne_db
        table_name = 'card'

try:
    initialize_database()
    create_all_tables()
except: pass
