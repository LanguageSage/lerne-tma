import os
import logging
import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from peewee import *
from playhouse.pool import PooledPostgresqlDatabase
from playhouse.db_url import connect as db_connect
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

tma_db = Proxy()
lerne_db = Proxy()

# Пути к файлам данных (модульный уровень — используется в main.py)
TMA_ROOT = Path(__file__).resolve().parent.parent
TMA_DATA_DIR = TMA_ROOT / "api" / "data"

def _parse_db_url(url: str):
    """Разбирает DATABASE_URL в параметры для PooledPostgresqlDatabase."""
    parsed = urlparse(url)
    params = {
        'database': parsed.path.lstrip('/'),
        'user': parsed.username,
        'password': parsed.password,
        'host': parsed.hostname,
        'port': parsed.port or 5432,
    }
    # Supabase pooler нуждается в sslmode
    qs = parse_qs(parsed.query)
    if 'sslmode' in qs:
        params['sslmode'] = qs['sslmode'][0]
    return params

def initialize_database():
    global tma_db, lerne_db
    SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL")
    FORCE_LOCAL = os.environ.get("FORCE_LOCAL_DB", "false").lower().strip() == "true"
    print(f"--- Database Mode: {'LOCAL (SQLite)' if FORCE_LOCAL else 'CLOUD (Postgres)'} (FORCE_LOCAL_DB={os.environ.get('FORCE_LOCAL_DB')}) ---")
    
    if SUPABASE_DB_URL and not FORCE_LOCAL:
        try:
            db_params = _parse_db_url(SUPABASE_DB_URL)
            actual_db = PooledPostgresqlDatabase(
                autorollback=True,
                max_connections=8,
                stale_timeout=300,
                **db_params,
            )
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Connected via PooledPostgresqlDatabase")
            return True
        except Exception as e:
            logger.error(f"DATABASE CLOUD ERROR (Pooled): {e}")
            try:
                # Вторая попытка через простой коннект, если пулер не сработал
                actual_db = db_connect(SUPABASE_DB_URL)
                tma_db.initialize(actual_db)
                lerne_db.initialize(actual_db)
                logger.info("DATABASE: Connected via db_url fallback")
                return True
            except Exception as e2:
                logger.error(f"DATABASE FALLBACK ERROR: {e2}")
                # Если мы в облаке (на Vercel) и база не подключилась - это критично
                if not FORCE_LOCAL:
                    raise e2
    
    TMA_ROOT = Path(__file__).resolve().parent.parent
    # Путь к основной базе данных (может быть переопределен через LOCAL_DB_PATH)
    default_db_path = TMA_ROOT.parent / "Lerne" / "db" / "lerne.db"
    TMA_DB_PATH = Path(os.environ.get("LOCAL_DB_PATH", str(default_db_path)))
    os.makedirs(TMA_DB_PATH.parent, exist_ok=True)
    shared_db = SqliteDatabase(TMA_DB_PATH)
    tma_db.initialize(shared_db)
    lerne_db.initialize(shared_db)
    return False

def create_all_tables():
    """Создает все таблицы и запускает накопленные миграции."""
    from api.migrations import run_migrations
    try:
        models_to_create = [
            TMAProgress, TMAReviewHistory, TMASetting, TMAUserPrompt,
            TMAMedia, TMAFeedback, TMAUser, TMALinkedSession,
            LibraryCategory, Deck, Card, TMA_Folder
        ]
        
        # Если это SQLite, проверим, являются ли tma_deck и tma_card представлениями (VIEW)
        if isinstance(tma_db.obj, SqliteDatabase):
            try:
                cursor = tma_db.execute_sql("SELECT name, type FROM sqlite_master WHERE name IN ('tma_deck', 'tma_card')")
                existing = {row[0]: row[1] for row in cursor.fetchall()}
                if existing.get('tma_deck') != 'view':
                    models_to_create.append(TMA_Deck)
                if existing.get('tma_card') != 'view':
                    models_to_create.append(TMA_Card)
            except Exception as e:
                logger.error(f"Error checking views in sqlite_master: {e}")
                models_to_create.extend([TMA_Deck, TMA_Card])
        else:
            models_to_create.extend([TMA_Deck, TMA_Card])

        tma_db.create_tables(models_to_create, safe=True)
        logger.info("DATABASE: All tables created/verified.")
        run_migrations(tma_db, lerne_db)
    except Exception as e:
        logger.error(f"Error in create_all_tables: {e}")

class BaseModel(Model):
    class Meta:
        database = tma_db

class TMA_Folder(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True)
    name = CharField()
    parent = ForeignKeyField('self', backref='subfolders', null=True, column_name='parent_id', on_delete='CASCADE')
    color = CharField(null=True)
    is_deleted = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    class Meta:
        table_name = 'tma_folder'

class TMA_Deck(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True)
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    is_inbox = BooleanField(default=False)  # Special "Inbox" deck for shared items
    folder = ForeignKeyField(TMA_Folder, backref='decks', null=True, column_name='folder_id', on_delete='SET NULL')
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    share_id = CharField(null=True, unique=True)
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
    audio_back_path = TextField(null=True)
    video_front_path = TextField(null=True)
    video_back_path = TextField(null=True)
    tags = TextField(null=True)
    metadata = TextField(null=True)
    card_type = CharField(default='translation')
    difficulty = FloatField(null=True)
    topics = TextField(null=True)
    source = TextField(null=True)
    is_deleted = BooleanField(default=False)
    want_to_learn = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    history = TextField(default='[]')
    creator_id = BigIntegerField(null=True, index=True)
    share_id = CharField(null=True, unique=True)
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
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    class Meta:
        table_name = 'tmaprogress'

class TMAReviewHistory(BaseModel):
    id = AutoField()
    card_id = IntegerField(index=True)
    user_id = BigIntegerField(index=True)
    rating = IntegerField()
    review_time = DateTimeField(default=datetime.datetime.now)
    reviewed_at = DateTimeField(null=True) # Cloud compatibility
    scheduled_interval = IntegerField(default=0)
    class Meta:
        table_name = 'tmareviewhistory'

class TMASetting(BaseModel):
    id = AutoField()
    key = CharField(unique=True)
    value = TextField()
    updated_at = DateTimeField(default=datetime.datetime.now, null=True)
    class Meta:
        table_name = 'tmasetting'

class TMAMedia(BaseModel):
    id = AutoField()
    filename = CharField(index=True)
    folder = CharField()  # 'images', 'audio', 'videos', 'backgrounds'
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
    context_prompt = TextField(null=True)
    class Meta:
        table_name = 'tmauserprompt'

class TMAUser(BaseModel):
    user_id = BigIntegerField(primary_key=True)
    first_name = CharField(null=True)
    last_name = CharField(null=True)
    username = CharField(null=True)
    photo_url = TextField(null=True)
    phone = CharField(null=True)
    is_guest = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    class Meta:
        table_name = 'tma_user'

class TMAFeedback(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True)
    rating = IntegerField(null=True)
    message = TextField()
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        table_name = 'tma_feedback'

class TMALinkedSession(BaseModel):
    guest_id = BigIntegerField(primary_key=True)
    telegram_id = BigIntegerField(null=True, index=True)
    is_confirmed = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        table_name = 'tma_linked_session'

class LibraryCategory(Model):
    id = AutoField()
    name = CharField()
    parent = ForeignKeyField('self', backref='subcategories', null=True, column_name='parent_id', on_delete='CASCADE')
    icon = CharField(null=True)
    description = TextField(null=True)
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        database = lerne_db
        table_name = 'library_category'

class Deck(Model):
    id = AutoField()
    name = CharField()
    level = CharField(null=True)
    topic = CharField(null=True)
    is_deleted = BooleanField(default=False)
    cloud_id = IntegerField(null=True)
    category = ForeignKeyField(LibraryCategory, backref='decks', null=True, column_name='category_id', on_delete='SET NULL')
    is_default = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    class Meta:
        database = lerne_db
        table_name = 'deck'

class Card(Model):
    id = AutoField()
    deck = ForeignKeyField(Deck, backref='cards', column_name='deck_id')
    front_text = TextField()
    back_text = TextField()
    context = TextField(null=True)
    image_path = CharField(null=True)
    audio_path = CharField(null=True)
    audio_back_path = CharField(null=True)
    video_front_path = CharField(null=True)
    video_back_path = CharField(null=True)
    tags = TextField(null=True)
    topics = TextField(null=True)
    source = TextField(null=True)
    card_type = CharField(default='translation')
    difficulty = FloatField(null=True)
    metadata = TextField(null=True)
    is_deleted = BooleanField(default=False)
    cloud_id = IntegerField(null=True)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    history = TextField(default='[]')
    class Meta:
        database = lerne_db
        table_name = 'card'

try:
    initialize_database()
    create_all_tables()
except Exception as e:
    logger.error(f"CRITICAL: Database initialization failed: {e}")
