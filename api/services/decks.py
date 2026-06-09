import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia, TMA_Folder, TMAUser
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

from .utils import merge_tags, add_to_history
from .media import resolve_media_url

STARTER_DECK_NAMES = [
    "⭐ [A1] Basis-Wortschatz / Базовый словарный запас",
    "⭐ [A2] Alltagsdeutsch & Kommunikation",
    "⭐ [A2] Vorschläge machen / Предложения и идеи",
    "⭐ [B1] Pläne und Bitten / Планы и просьбы",
    "⭐ [B1] Hören: Alltagsdialoge / Аудирование: диалоги"
]

def ensure_starter_decks(user_id: int, existing_names: set = None):
    try:
        user = TMAUser.get_or_none(TMAUser.user_id == user_id)
        if user and user.default_decks_initialized:
            return True
            
        if existing_names is None:
            existing_decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id))
            existing_names = {d.name for d in existing_decks}
        
        # Get default decks from library (where is_default == True and is_deleted == False)
        default_decks = list(Deck.select().where((Deck.is_default == True) & (Deck.is_deleted == False)))
        
        with tma_db.atomic():
            for lib_deck in default_decks:
                if lib_deck.name not in existing_names:
                    import_deck(lib_deck.id, user_id)
            if user:
                user.default_decks_initialized = True
                user.save()
        return True
    except Exception as e:
        logger.error(f"Error in ensure_starter_decks: {e}")
        return False


def create_deck(name: str, user_id: int, folder_id: int = None):
    """Создает новую пользовательскую колоду."""
    try:
        deck = TMA_Deck.create(
            user_id=user_id,
            name=name,
            folder_id=folder_id,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        return deck
    except Exception as e:
        logger.error(f"Error in create_deck: {e}")
        raise e


def ensure_inbox_deck(user_id: int) -> TMA_Deck:
    """Возвращает (или создаёт) специальную колоду «Входящие» для пользователя внутри папки Входящие."""
    from .folders import ensure_inbox_folder
    inbox_folder = ensure_inbox_folder(user_id)
    
    inbox = TMA_Deck.get_or_none(
        (TMA_Deck.user_id == user_id) & (TMA_Deck.is_inbox == True)
    )
    if not inbox:
        inbox = TMA_Deck.create(
            user_id=user_id,
            name="📥 Входящие карточки",
            is_inbox=True,
            folder_id=inbox_folder.id,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        logger.info(f"Created Inbox deck for user {user_id} (id={inbox.id}) inside folder {inbox_folder.id}")
    else:
        if inbox.folder_id != inbox_folder.id or inbox.name != "📥 Входящие карточки" or inbox.is_deleted:
            inbox.folder_id = inbox_folder.id
            inbox.name = "📥 Входящие карточки"
            inbox.is_deleted = False
            inbox.updated_at = datetime.datetime.now()
            inbox.save()
            logger.info(f"Updated/Restored Inbox deck for user {user_id} (id={inbox.id}) inside folder {inbox_folder.id}")
    return inbox



def get_active_decks(user_id: int):
    """Возвращает список колод со статистикой. Оптимизировано: 2 запроса вместо 5."""
    try:
        now = datetime.datetime.now()
        
        # 1. Сначала проверяем/создаем Входящие (всегда должны быть)
        ensure_inbox_deck(user_id)
        
        # 2. Убеждаемся, что все дефолтные колоды импортированы
        ensure_starter_decks(user_id)
        
        # 3. Получаем все активные колоды
        decks = list(TMA_Deck.select().where(
            (TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == False)
        ).order_by(TMA_Deck.is_pinned.desc(), TMA_Deck.is_inbox.desc(), TMA_Deck.position.asc(), TMA_Deck.id.desc()))

        if not decks:
            logger.warning(f"No decks found for user {user_id} even after ensure_inbox and ensure_starter_decks")
            return []

        deck_ids = [d.id for d in decks]
        deck_names = [d.name for d in decks]

        from peewee import Case
        
        # --- Кросс-платформенный запрос статистики через Peewee ---
        tracked_case = Case(None, [(TMAProgress.queue != 'new', 1)], None)
        learning_case = Case(None, [((TMAProgress.queue << ['learning', 'relearning']) & (TMAProgress.next_review <= now), 1)], None)
        due_case = Case(None, [((TMAProgress.queue == 'review') & (TMAProgress.next_review <= now), 1)], None)
        stats_query = (TMA_Card
                      .select(
                          TMA_Card.deck_id.alias('deck_id'),
                          fn.COUNT(TMA_Card.id).alias('total'),
                          fn.COUNT(tracked_case).alias('tracked'),
                          fn.COUNT(learning_case).alias('learning'),
                          fn.COUNT(due_case).alias('due')
                      )
                      .join(TMAProgress, JOIN.LEFT_OUTER, on=(
                          (TMAProgress.card_id == TMA_Card.id) & (TMAProgress.user_id == user_id)
                      ))
                      .where((TMA_Card.deck_id << deck_ids) & (TMA_Card.is_deleted == False))
                      .group_by(TMA_Card.deck_id))
        
        # logger.info(f"Stats query SQL: {stats_query.sql()}")
        
        stats_map = {}
        for row in stats_query.dicts():
            stats_map[row['deck_id']] = {
                'total': row['total'], 
                'tracked': row['tracked'], 
                'learning': int(row['learning'] or 0),
                'due': int(row['due'] or 0)
            }

        # --- ОДИН запрос для проверки обновлений из библиотеки ---
        ext_by_name = {}
        lib_counts = {}
        if deck_names:
            ext_decks = list(Deck.select().where(Deck.name << deck_names))
            ext_by_name = {d.name: d for d in ext_decks}
            ext_ids = [d.id for d in ext_decks]
            if ext_ids:
                lib_counts = {
                    deck_id: count
                    for deck_id, count in (
                        Card
                        .select(Card.deck, fn.COUNT(Card.id))
                        .where(Card.deck << ext_ids)
                        .group_by(Card.deck)
                        .tuples()
                    )
                }
        
        result = []
        for d in decks:
            s = stats_map.get(d.id, {'total': 0, 'tracked': 0, 'learning': 0, 'due': 0})
            total = s['total']
            tracked = s['tracked']
            learning = s['learning']
            due = s['due']
            
            # Check for updates
            has_updates = False
            ext_deck = ext_by_name.get(d.name)
            if ext_deck:
                lib_count = lib_counts.get(ext_deck.id, 0)
                if lib_count > total:
                    has_updates = True
                elif ext_deck.updated_at and d.updated_at and ext_deck.updated_at > d.updated_at:
                    has_updates = True

            # Parse and resolve metadata resources
            raw_metadata = getattr(d, 'metadata', None)
            parsed_metadata = {"resources": []}
            if raw_metadata:
                try:
                    parsed_metadata = json.loads(raw_metadata)
                except Exception:
                    pass
            
            resolved_resources = []
            for res in parsed_metadata.get('resources', []):
                res_type = res.get('type')
                path = res.get('path')
                url = res.get('url')
                if path:
                    if res_type == 'image':
                        url = resolve_media_url(path, 'images')
                    elif res_type == 'audio':
                        url = resolve_media_url(path, 'audio')
                    elif res_type == 'video':
                        url = resolve_media_url(path, 'videos')
                resolved_resources.append({
                    "type": res_type,
                    "path": path,
                    "url": url,
                    "title": res.get('title')
                })
            parsed_metadata['resources'] = resolved_resources

            result.append({
                "id": d.id,
                "name": d.name,
                "level": getattr(d, 'level', ''),
                "topic": getattr(d, 'topic', ''),
                "is_inbox": getattr(d, 'is_inbox', False),
                "is_pinned": getattr(d, 'is_pinned', False),
                "position": getattr(d, 'position', 0),
                "folder_id": getattr(d, 'folder_id', None),
                "has_updates": has_updates,
                "metadata": parsed_metadata,
                "stats": {
                    "total": total,
                    "new": max(0, total - tracked),
                    "learning": learning,
                    "due": due
                }
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_active_decks: {e}", exc_info=True)
        raise e


def get_external_decks():
    """Возвращает список всех колод из общей библиотеки. Оптимизировано для быстрой загрузки."""
    try:
        # Используем один запрос с группировкой для подсчета карточек
        counts = {c.deck_id: c.count for c in Card.select(Card.deck_id, fn.COUNT(Card.id).alias('count')).group_by(Card.deck_id)}
        
        decks = list(Deck.select().order_by(Deck.name))
        return [{
            "id": d.id,
            "name": d.name,
            "level": getattr(d, 'level', ''),
            "topic": getattr(d, 'topic', ''),
            "category_id": getattr(d, 'category_id', None),
            "is_default": getattr(d, 'is_default', False),
            "cards_count": counts.get(d.id, 0)
        } for d in decks]
    except Exception as e:
        logger.error(f"Error in get_external_decks: {e}", exc_info=True)
        raise e


def toggle_default_deck(deck_id: int) -> bool:
    """Переключает статус 'is_default' для колоды в библиотеке."""
    try:
        deck = Deck.get_by_id(deck_id)
        deck.is_default = not deck.is_default
        deck.updated_at = datetime.datetime.now()
        deck.save()
        logger.info(f"Toggled default status for library deck '{deck.name}' (id={deck.id}) to {deck.is_default}")
        return deck.is_default
    except Exception as e:
        logger.error(f"Error toggling default status for deck {deck_id}: {e}")
        raise e

def get_library_categories():
    """Возвращает список категорий библиотеки."""
    try:
        from ..models import LibraryCategory
        categories = list(LibraryCategory.select().order_by(LibraryCategory.id.asc()))
        return [{
            "id": c.id,
            "name": c.name,
            "parent_id": getattr(c, 'parent_id', None),
            "icon": c.icon,
            "description": c.description
        } for c in categories]
    except Exception as e:
        logger.error(f"Error in get_library_categories: {e}", exc_info=True)
        raise e


def import_deck(external_deck_id: int, user_id: int, mode: str = 'merge', local_deck_id: int = None):
    """Импортирует колоду из библиотеки. Поддерживает режимы: merge, replace, copy."""
    try:
        logger.info(f"IMPORT START: deck_id={external_deck_id}, user_id={user_id}, mode={mode}")
        
        ext_deck = Deck.get_by_id(external_deck_id)
        
        if mode == 'copy':
            copy_name = f"{ext_deck.name} (v2)"
            local_deck, _ = TMA_Deck.get_or_create(
                user_id=user_id, 
                name=copy_name,
                defaults={
                    'level': getattr(ext_deck, 'level', ''),
                    'topic': getattr(ext_deck, 'topic', ''),
                    'created_at': datetime.datetime.now(),
                    'updated_at': datetime.datetime.now()
                }
            )
            # Insert all cards without checking
            sql = f"""
                INSERT INTO tma_card (deck_id, front_text, back_text, context, image_path, audio_path, card_type, is_deleted, source, topics, metadata, tags, created_at, updated_at, history)
                SELECT {local_deck.id}, COALESCE(front_text, ''), COALESCE(back_text, ''), COALESCE(context, ''), COALESCE(image_path, ''), COALESCE(audio_path, ''), 'translation', false, 'library', '[]', COALESCE(metadata, '{{}}'), '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '["Imported as copy"]'
                FROM card WHERE deck_id = {external_deck_id}
            """
            tma_db.execute_sql(sql)
            return local_deck
            
        elif mode == 'replace':
            if local_deck_id:
                local_deck = TMA_Deck.get_by_id(local_deck_id)
            else:
                local_deck, _ = TMA_Deck.get_or_create(user_id=user_id, name=ext_deck.name)
            
            # Delete old cards
            card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == local_deck.id)]
            if card_ids:
                TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                TMA_Card.delete().where(TMA_Card.id << card_ids).execute()
                
            # Insert all cards
            sql = f"""
                INSERT INTO tma_card (deck_id, front_text, back_text, context, image_path, audio_path, card_type, is_deleted, source, topics, metadata, tags, created_at, updated_at, history)
                SELECT {local_deck.id}, COALESCE(front_text, ''), COALESCE(back_text, ''), COALESCE(context, ''), COALESCE(image_path, ''), COALESCE(audio_path, ''), 'translation', false, 'library', '[]', COALESCE(metadata, '{{}}'), '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '["Imported via replace"]'
                FROM card WHERE deck_id = {external_deck_id} AND is_deleted = false
            """
            tma_db.execute_sql(sql)
            
            local_deck.updated_at = datetime.datetime.now()
            local_deck.save()
            return local_deck
            
        else: # merge
            if local_deck_id:
                local_deck = TMA_Deck.get_by_id(local_deck_id)
            else:
                local_deck, _ = TMA_Deck.get_or_create(
                    user_id=user_id, 
                    name=ext_deck.name,
                    defaults={
                        'level': getattr(ext_deck, 'level', ''),
                        'topic': getattr(ext_deck, 'topic', ''),
                        'created_at': datetime.datetime.now(),
                        'updated_at': datetime.datetime.now()
                    }
                )
                
            logger.info(f"IMPORT MERGE: Processing deck '{local_deck.name}' for user {user_id}")
                
            # Update existing cards & insert new ones
            remote_cards = list(Card.select().where(Card.deck_id == external_deck_id))
            local_cards = {c.front_text: c for c in TMA_Card.select().where(TMA_Card.deck_id == local_deck.id)}
            
            logger.info(f"MERGE STATS: {len(remote_cards)} in library, {len(local_cards)} in local")
            
            new_cards_to_insert = []
            
            for rc in remote_cards:
                if rc.front_text in local_cards:
                    lc = local_cards[rc.front_text]
                    # Check if remote is newer
                    if rc.updated_at and (not lc.updated_at or rc.updated_at > lc.updated_at):
                        logger.info(f"UPDATING CARD: {rc.front_text}")
                        lc.back_text = rc.back_text
                        lc.context = rc.context
                        lc.image_path = rc.image_path
                        lc.audio_path = rc.audio_path
                        lc.tags = merge_tags(lc.tags, getattr(rc, 'tags', '[]'))
                        lc.updated_at = datetime.datetime.now()
                        lc.history = add_to_history(lc.history, "Updated from library")
                        lc.save()
                else:
                    new_cards_to_insert.append({
                        'deck_id': local_deck.id,
                        'front_text': rc.front_text or '',
                        'back_text': rc.back_text or '',
                        'context': rc.context or '',
                        'image_path': rc.image_path or '',
                        'audio_path': rc.audio_path or '',
                        'card_type': 'translation',
                        'source': 'library',
                        'tags': getattr(rc, 'tags', '[]'),
                        'metadata': getattr(rc, 'metadata', '{}'),
                        'created_at': datetime.datetime.now(),
                        'updated_at': datetime.datetime.now(),
                        'history': add_to_history('[]', "Imported from library")
                    })
            
            if new_cards_to_insert:
                with tma_db.atomic():
                    for i in range(0, len(new_cards_to_insert), 100):
                        TMA_Card.insert_many(new_cards_to_insert[i:i+100]).execute()
            
            local_deck.updated_at = datetime.datetime.now()
            local_deck.save()
            return local_deck
            
    except Exception as e:
        error_msg = f"CRITICAL ERROR in import_deck: {e}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg)


def import_deck_from_json(data: dict, user_id: int):
    """Импорт колоды из JSON-объекта (загруженного пользователем)."""
    try:
        deck_name = data.get('name', 'Imported Deck')
        cards = data.get('cards', [])
        
        local_deck, _ = TMA_Deck.get_or_create(user_id=user_id, name=deck_name)
        
        now = datetime.datetime.now()
        new_cards = []
        for c in cards:
            new_cards.append({
                'deck_id': local_deck.id,
                'front_text': c.get('front', ''),
                'back_text': c.get('back', ''),
                'context': c.get('context', ''),
                'image_path': c.get('image_path', ''),
                'audio_path': c.get('audio_path', ''),
                'created_at': now,
                'updated_at': now
            })
            
        if new_cards:
            with tma_db.atomic():
                for i in range(0, len(new_cards), 100):
                    TMA_Card.insert_many(new_cards[i:i+100]).execute()
                    
        return local_deck
    except Exception as e:
        logger.error(f"Error importing from JSON: {e}")
        return None


def delete_deck(deck_id: int, user_id: int):
    try:
        # Мягкое удаление: помечаем колоду и её карточки как is_deleted = True
        now = datetime.datetime.now()
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return False
        TMA_Card.update(is_deleted=True, updated_at=now).where(TMA_Card.deck_id == deck_id).execute()
        deck.is_deleted = True
        deck.updated_at = now
        deck.save()
        return True
    except Exception as e:
        logger.error(f"Error deleting deck: {e}", exc_info=True)
        raise e


def sync_deck_with_library(user_id: int, deck_id: int, mode: str = 'merge'):
    try:
        local = TMA_Deck.get_by_id(deck_id)
        logger.info(f"SYNC START: local_name='{local.name}', user_id={user_id}")
        ext = Deck.get_or_none(Deck.name == local.name)
        if ext:
            logger.info(f"SYNC MATCH: Found library deck '{ext.name}' (id={ext.id})")
            import_deck(ext.id, user_id, mode=mode, local_deck_id=local.id)
            return True
        logger.warning(f"SYNC FAIL: No matching deck in library for '{local.name}'")
        return False
    except Exception as e:
        logger.error(f"Error syncing deck: {e}")
        return False


def promote_to_library(deck_id: int):
    """Переносит пользовательскую колоду в общую библиотеку."""
    try:
        tma_deck = TMA_Deck.get_by_id(deck_id)
        lib_deck, _ = Deck.get_or_create(
            name=tma_deck.name,
            defaults={'level': tma_deck.level, 'topic': tma_deck.topic}
        )
        
        tma_cards = TMA_Card.select().where(TMA_Card.deck_id == deck_id)
        for tc in tma_cards:
            Card.get_or_create(
                deck_id=lib_deck.id,
                front_text=tc.front_text,
                defaults={
                    'back_text': tc.back_text,
                    'context': tc.context,
                    'image_path': tc.image_path,
                    'audio_path': tc.audio_path,
                    'video_front_path': tc.video_front_path,
                    'video_back_path': tc.video_back_path
                }
            )
        return lib_deck
    except Exception as e:
        logger.error(f"Error promoting deck: {e}")
        return None


def reset_deck_progress(user_id: int, deck_id: int):
    try:
        card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == deck_id)]
        if card_ids:
            TMAProgress.delete().where(TMAProgress.user_id == user_id, TMAProgress.card_id << card_ids).execute()
        return True
    except Exception as e:
        logger.error(f"Error resetting progress: {e}", exc_info=True)
        raise e


def move_deck_to_folder(deck_id: int, folder_id: int, user_id: int):
    """Перемещает колоду в указанную папку (или в корень, если folder_id=None)."""
    try:
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return None
        # Verify folder belongs to user
        if folder_id is not None:
            folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
            if not folder:
                raise ValueError("Target folder not found or access denied")
        
        deck.folder_id = folder_id
        deck.updated_at = datetime.datetime.now()
        deck.save()
        return deck
    except Exception as e:
        logger.error(f"Error moving deck {deck_id} to folder {folder_id}: {e}")
        raise e

def copy_deck_to_folder(deck_id: int, folder_id: int, user_id: int):
    """Копирует колоду в указанную папку (или в корень, если folder_id=None) вместе со всеми её активными карточками."""
    try:
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return None
        # Verify folder belongs to user
        if folder_id is not None:
            folder = TMA_Folder.get_or_none((TMA_Folder.id == folder_id) & (TMA_Folder.user_id == user_id))
            if not folder:
                raise ValueError("Target folder not found or access denied")
        
        new_deck = TMA_Deck.create(
            user_id=user_id,
            name=f"{deck.name} (Копия)",
            folder_id=folder_id,
            is_inbox=False,
            is_pinned=False,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck_id, TMA_Card.is_deleted == False))
        
        with tma_db.atomic():
            for card in cards:
                TMA_Card.create(
                    deck_id=new_deck.id,
                    front_text=card.front_text,
                    back_text=card.back_text,
                    context=card.context,
                    image_path=card.image_path,
                    audio_path=card.audio_path,
                    audio_back_path=card.audio_back_path,
                    video_front_path=card.video_front_path,
                    video_back_path=card.video_back_path,
                    source=card.source,
                    position=card.position,
                    want_to_learn=card.want_to_learn,
                    created_at=datetime.datetime.now(),
                    updated_at=datetime.datetime.now()
                )
        return new_deck
    except Exception as e:
        logger.error(f"Error copying deck {deck_id} to folder {folder_id}: {e}")
        raise e

def rename_deck(deck_id: int, new_name: str, user_id: int):
    """Переименовывает пользовательскую колоду."""
    try:
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return None
        if deck.is_inbox:
            raise ValueError("Cannot rename the Inbox deck")
        deck.name = new_name
        deck.updated_at = datetime.datetime.now()
        deck.save()
        return deck
    except Exception as e:
        logger.error(f"Error renaming deck {deck_id}: {e}")
        raise e




def get_community_content(user_id: int):
    """Возвращает колоды пользователей, которые можно 'влить' в библиотеку (для админа)."""
    try:
        # Для простоты возвращаем все колоды, которых нет в Deck
        lib_names = {d.name for d in Deck.select(Deck.name)}
        user_decks = TMA_Deck.select().where(~(TMA_Deck.name << list(lib_names)) & (TMA_Deck.is_deleted == False))
        return [{
            "id": d.id,
            "name": d.name,
            "user_id": d.user_id,
            "cards_count": TMA_Card.select().where(TMA_Card.deck_id == d.id, TMA_Card.is_deleted == False).count()
        } for d in user_decks]
    except Exception as e:
        logger.error(f"Error fetching community content: {e}", exc_info=True)
        raise e

def update_deck_metadata(deck_id: int, metadata_dict: dict, user_id: int):
    try:
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return None
        deck.metadata = json.dumps(metadata_dict)
        deck.updated_at = datetime.datetime.now()
        deck.save()
        return deck
    except Exception as e:
        logger.error(f"Error updating deck metadata {deck_id}: {e}")
        raise e



