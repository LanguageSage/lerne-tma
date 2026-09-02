import os
import logging
import datetime
from peewee import *
from api.database import tma_db, lerne_db, initialize_database

logger = logging.getLogger(__name__)



_tables_created = False

def create_all_tables():
    """Создает все таблицы и запускает накопленные миграции (выполняется только 1 раз за запуск)."""
    global _tables_created
    if _tables_created:
        return
    from api.migrations import run_migrations
    try:
        run_migrations(tma_db, lerne_db)
        models_to_create = [
            TMAProgress, TMAReviewHistory, TMASetting, TMAUserPrompt,
            TMAMedia, TMAFeedback, TMAUser, TMALinkedSession,
            LibraryCategory, Deck, Card, TMA_Folder, TMA_Deck, TMA_Card, TMACustomPrompt,
            TMA_Collaborator
        ]
        tma_db.create_tables(models_to_create, safe=True)
        _tables_created = True
        logger.info("DATABASE: All tables created/verified.")
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
    position = IntegerField(default=0)
    created_at = DateTimeField(default=datetime.datetime.now)
    updated_at = DateTimeField(null=True)
    share_id = CharField(null=True, unique=True)
    class Meta:
        table_name = 'tma_folder'
        indexes = (
            (('user_id', 'is_deleted'), False),
        )

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
        indexes = (
            (('user_id', 'is_deleted'), False),
            (('folder_id',), False),
            (('updated_at',), False),
        )

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
    flag = IntegerField(default=0)
    class Meta:
        table_name = 'tma_card'
        indexes = (
            (('deck_id', 'is_deleted'), False),
            (('front_text', 'is_deleted'), False),
            (('updated_at',), False),
        )

class TMA_Collaborator(BaseModel):
    id = AutoField()
    target_type = CharField(index=True)  # 'folder' or 'deck'
    target_id = IntegerField(index=True)  # ID of folder or deck
    user_id = BigIntegerField(index=True) # Telegram User ID of collaborator
    role = CharField(default='editor')    # 'owner', 'editor', 'viewer'
    added_by = BigIntegerField(null=True) # Telegram User ID who added this collaborator
    created_at = DateTimeField(default=datetime.datetime.now)

    class Meta:
        table_name = 'tma_collaborator'
        indexes = (
            (('target_type', 'target_id', 'user_id'), True),
        )

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
        indexes = (
            (('user_id', 'card_id'), True),
            (('user_id', 'queue', 'next_review'), False),
        )

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
    prompt_type = CharField(default='standard', index=True)
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
    native_language = CharField(default='uk', null=True)
    has_selected_language = BooleanField(default=False)
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
    flag = IntegerField(default=0)
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
