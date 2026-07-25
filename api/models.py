import os
import logging
import datetime
from urllib.parse import urlparse, parse_qs
from peewee import *
try:
    from playhouse.pool import PooledPostgresqlDatabase
    from playhouse.db_url import connect as db_connect
except Exception as _pg_err:
    PooledPostgresqlDatabase = None
    db_connect = None

# Try pg8000 — pure Python Postgres driver (no C extensions, works on Vercel)
try:
    import pg8000
    _HAS_PG8000 = True
except ImportError:
    _HAS_PG8000 = False

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

tma_db = Proxy()
lerne_db = Proxy()



class Pg8000Database(PostgresqlDatabase):
    def _connect(self):
        if not _HAS_PG8000:
            raise ImproperlyConfigured('pg8000 driver not installed')
        import pg8000
        params = self.connect_params.copy()
        if 'dbname' in params:
            params['database'] = params.pop('dbname')
        if 'port' in params and params['port']:
            params['port'] = int(params['port'])
        if 'sslmode' in params:
            params.pop('sslmode')
        params['ssl_context'] = True
        conn = pg8000.connect(**params)
        conn.autocommit = True
        return conn

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

    if not SUPABASE_DB_URL:
        logger.error("FATAL: SUPABASE_DB_URL is not set.")
        return False

    db_params = _parse_db_url(SUPABASE_DB_URL)
    logger.info("DATABASE: Initializing Postgres connection...")

    # 1. Standard Peewee PooledPostgresqlDatabase (uses psycopg2)
    if PooledPostgresqlDatabase is not None:
        try:
            actual_db = PooledPostgresqlDatabase(
                autorollback=True, max_connections=8, stale_timeout=300, **db_params
            )
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via PooledPostgresqlDatabase (psycopg2)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE PooledPostgresqlDatabase setup failed: {e}")

    # 2. Standard Peewee db_connect (uses psycopg2)
    if db_connect is not None:
        try:
            actual_db = db_connect(SUPABASE_DB_URL)
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via db_url (psycopg2)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE db_url setup failed: {e}")

    # 3. Pg8000 pure Python fallback
    if _HAS_PG8000:
        try:
            actual_db = Pg8000Database(
                database=db_params['database'],
                user=db_params['user'],
                password=db_params['password'],
                host=db_params['host'],
                port=db_params['port'],
                autorollback=True
            )
            tma_db.initialize(actual_db)
            lerne_db.initialize(actual_db)
            logger.info("DATABASE: Initialized via Pg8000Database (pg8000)")
            return True
        except Exception as e:
            logger.warning(f"DATABASE Pg8000Database setup failed: {e}")

    logger.error("FATAL: All Postgres drivers failed. Check SUPABASE_DB_URL and installed packages.")
    return False



def create_all_tables():
    """Создает все таблицы и запускает накопленные миграции."""
    from api.migrations import run_migrations
    try:
        models_to_create = [
            TMAProgress, TMAReviewHistory, TMASetting, TMAUserPrompt,
            TMAMedia, TMAFeedback, TMAUser, TMALinkedSession,
            LibraryCategory, Deck, Card, TMA_Folder, TMA_Deck, TMA_Card, TMACustomPrompt
        ]
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
    target_language = CharField(default='de', index=True, null=True)
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
    target_language = CharField(default='de', index=True, null=True)
    is_deleted = BooleanField(default=False)
    is_inbox = BooleanField(default=False)  # Special "Inbox" deck for shared items
    is_pinned = BooleanField(default=False)
    position = IntegerField(default=0)
    folder = ForeignKeyField(TMA_Folder, backref='decks', null=True, column_name='folder_id', on_delete='SET NULL')
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    share_id = CharField(null=True, unique=True)
    metadata = TextField(default='{"resources": []}')
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
    position = IntegerField(default=0)
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

class TMACustomPrompt(BaseModel):
    id = AutoField()
    user_id = BigIntegerField(index=True)
    name = CharField()
    translation_prompt = TextField()
    context_prompt = TextField()
    target_language = CharField(default='de', index=True, null=True)
    is_active = BooleanField(default=False)
    created_at = DateTimeField(default=datetime.datetime.now)
    class Meta:
        table_name = 'tma_custom_prompt'

class TMAUser(BaseModel):
    user_id = BigIntegerField(primary_key=True)
    first_name = CharField(null=True)
    last_name = CharField(null=True)
    username = CharField(null=True)
    photo_url = TextField(null=True)
    phone = CharField(null=True)
    active_language = CharField(default='de', null=True)
    is_guest = BooleanField(default=False)
    default_decks_initialized = BooleanField(default=False)
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
    target_language = CharField(default='de', index=True, null=True)
    is_deleted = BooleanField(default=False)
    cloud_id = IntegerField(null=True)
    category = ForeignKeyField(LibraryCategory, backref='decks', null=True, column_name='category_id', on_delete='SET NULL')
    is_default = BooleanField(default=False)
    is_pinned = BooleanField(default=False)
    position = IntegerField(default=0)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    metadata = TextField(default='{"resources": []}')
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
    position = IntegerField(default=0)
    class Meta:
        database = lerne_db
        table_name = 'card'

try:
    initialize_database()
    # On Vercel serverless, skip running 50+ migration SQL queries on every lambda cold start
    # unless RUN_MIGRATIONS=true is explicitly set.
    should_run_migrations = os.environ.get("RUN_MIGRATIONS", "false").lower() in ("true", "1")
    is_local_env = not os.environ.get("VERCEL") or os.environ.get("FORCE_LOCAL_DB", "false").lower() == "true"
    
    if should_run_migrations or is_local_env:
        create_all_tables()
except Exception as e:
    logger.error(f"CRITICAL: Database initialization failed: {e}")
