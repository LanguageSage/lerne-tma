import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia, TMA_Folder, TMAUser
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

from .utils import merge_tags, add_to_history, resolve_deck_metadata
from .media import resolve_media_url

STARTER_DECK_NAMES = [
    "⭐ [A1] Basis-Wortschatz / Базовый словарный запас",
    "⭐ [A2] Alltagsdeutsch & Kommunikation",
    "⭐ [A2] Vorschläge machen / Предложения и идеи",
    "⭐ [B1] Pläne und Bitten / Планы и просьбы",
    "⭐ [B1] Hören: Alltagsdialoge / Аудирование: диалоги"
]

def ensure_starter_decks(user_id: int, target_language: str = None):
    try:
        user, _ = TMAUser.get_or_create(user_id=user_id)

        existing_decks = list(TMA_Deck.select().where((TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == False)))
        existing_names = {d.name for d in existing_decks}
        
        default_decks = list(Deck.select().where((Deck.is_default == True) & (Deck.is_deleted == False)))
        
        imported_any = False
        with tma_db.atomic():
            for lib_deck in default_decks:
                clean_lib_name = lib_deck.name.replace("⭐ ", "").strip()
                tma_deck = next(
                    (d for d in existing_decks if d.name == lib_deck.name or d.name == clean_lib_name or d.name.replace("⭐ ", "").strip() == clean_lib_name),
                    None
                )
                if not tma_deck:
                    tma_deck = import_deck(lib_deck.id, user_id)
                    imported_any = True
                    logger.info(f"Auto-imported default deck '{lib_deck.name}' for user {user_id}")
                else:
                    # If deck exists but has 0 cards, populate its cards
                    cards_exist = TMA_Card.select().where((TMA_Card.deck_id == tma_deck.id) & (TMA_Card.is_deleted == False)).exists()
                    if not cards_exist:
                        tma_deck = import_deck(lib_deck.id, user_id, mode='merge', local_deck_id=tma_deck.id)
                        imported_any = True
                        logger.info(f"Populated cards for empty default deck '{lib_deck.name}' for user {user_id}")

                # Attach to folder if lib_deck has folder_name in metadata
                if isinstance(tma_deck, TMA_Deck) and getattr(lib_deck, 'metadata', None):
                    try:
                        m = json.loads(lib_deck.metadata) if isinstance(lib_deck.metadata, str) else (lib_deck.metadata or {})
                        f_name = m.get('folder_name')
                        if f_name:
                            f_color = m.get('folder_color', '#6366f1')
                            user_folder = TMA_Folder.get_or_none(
                                (TMA_Folder.user_id == user_id) &
                                (TMA_Folder.name == f_name) &
                                (TMA_Folder.parent.is_null()) &
                                (TMA_Folder.is_deleted == False)
                            )
                            if not user_folder:
                                user_folder = TMA_Folder.create(
                                    user_id=user_id,
                                    name=f_name,
                                    color=f_color,
                                    target_language=getattr(lib_deck, 'target_language', 'de') or 'de',
                                    created_at=datetime.datetime.now(),
                                    updated_at=datetime.datetime.now()
                                )
                            if getattr(tma_deck, 'folder_id', None) != user_folder.id:
                                tma_deck.folder = user_folder
                                tma_deck.save()
                    except Exception as e:
                        logger.warning(f"Failed to attach default deck to folder for user {user_id}: {e}")

        if not user.default_decks_initialized or imported_any:
            user.default_decks_initialized = True
            user.save()

        return True
    except Exception as e:
        logger.error(f"Error in ensure_starter_decks: {e}")
        return False



def merge_guest_data(guest_id: int, target_user_id: int):
    """Переносит колоды, папки, карточки и прогресс от guest_id к target_user_id."""
    if not guest_id or not target_user_id or guest_id == target_user_id:
        return False
    try:
        logger.info(f"MERGING GUEST DATA: guest_id={guest_id} -> target_user_id={target_user_id}")
        now = datetime.datetime.now()
        with tma_db.atomic():
            # 1. Update folders
            TMA_Folder.update(user_id=target_user_id, updated_at=now).where(TMA_Folder.user_id == guest_id).execute()
            # 2. Update decks
            TMA_Deck.update(user_id=target_user_id, updated_at=now).where(TMA_Deck.user_id == guest_id).execute()
            # 3. Update cards creator_id
            TMA_Card.update(creator_id=target_user_id, updated_at=now).where(TMA_Card.creator_id == guest_id).execute()
            # 4. Update progress
            TMAProgress.update(user_id=target_user_id).where(TMAProgress.user_id == guest_id).execute()
        logger.info(f"MERGED GUEST DATA SUCCESSFULLY for guest_id={guest_id} -> {target_user_id}")
        return True
    except Exception as e:
        logger.error(f"Error merging guest data {guest_id} -> {target_user_id}: {e}", exc_info=True)
        return False



def create_deck(name: str, user_id: int, folder_id: int = None, target_language: str = 'de', deck_type: str = 'standard'):
    """Создает новую пользовательскую колоду."""
    try:
        if folder_id:
            from .collaborative_service import get_effective_user_role
            role = get_effective_user_role(user_id, 'folder', folder_id)
            if role == 'viewer':
                raise PermissionError("У вас роль Слушателя (только чтение). Создавать колоды в этой папке может только Редактор или Владелец.")
            elif role is None:
                raise PermissionError("Родительская папка не найдена или нет доступа")

        meta_dict = {"resources": [], "is_learning": False}
        deck = TMA_Deck.create(
            user_id=user_id,
            name=name,
            folder_id=folder_id,
            target_language=target_language or 'de',
            metadata=json.dumps(meta_dict),
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        return deck

    except PermissionError:
        raise
    except Exception as e:
        logger.error(f"Error in create_deck: {e}")
        raise e


def ensure_inbox_deck(user_id: int, target_language: str = 'de') -> TMA_Deck:
    """Возвращает (или создаёт) специальную колоду «Входящие» для пользователя внутри папки Входящие для целевого языка."""
    lang = (target_language or 'de').lower().strip()
    from .folders import ensure_inbox_folder
    inbox_folder = ensure_inbox_folder(user_id, target_language=lang)
    
    inbox = TMA_Deck.get_or_none(
        (TMA_Deck.user_id == user_id) & 
        (TMA_Deck.is_inbox == True) & 
        ((TMA_Deck.target_language == lang) | (TMA_Deck.target_language.is_null() if lang == 'de' else False))
    )
    if not inbox:
        inbox = TMA_Deck.create(
            user_id=user_id,
            name="📥 Входящие карточки",
            is_inbox=True,
            target_language=lang,
            folder_id=inbox_folder.id,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        logger.info(f"Created Inbox deck for user {user_id} (lang={lang}, id={inbox.id}) inside folder {inbox_folder.id}")
    else:
        if inbox.folder_id != inbox_folder.id or inbox.name != "📥 Входящие карточки" or inbox.is_deleted or getattr(inbox, 'target_language', None) != lang:
            inbox.folder_id = inbox_folder.id
            inbox.name = "📥 Входящие карточки"
            inbox.target_language = lang
            inbox.is_deleted = False
            inbox.updated_at = datetime.datetime.now()
            inbox.save()
            logger.info(f"Updated/Restored Inbox deck for user {user_id} (lang={lang}, id={inbox.id}) inside folder {inbox_folder.id}")
    return inbox



_lib_cache = {
    'time': 0,
    'by_name': {},
    'counts': {}
}

def _get_cached_library_info():
    global _lib_cache
    import time
    now = time.time()
    if now - _lib_cache['time'] < 300 and _lib_cache['by_name']:
        return _lib_cache['by_name'], _lib_cache['counts']
    try:
        ext_decks = list(Deck.select().where(Deck.is_deleted == False))
        by_name = {d.name: d for d in ext_decks}
        ext_ids = [d.id for d in ext_decks]
        counts = {}
        if ext_ids:
            counts = {
                deck_id: count
                for deck_id, count in (
                    Card
                    .select(Card.deck, fn.COUNT(Card.id))
                    .where(Card.deck << ext_ids)
                    .group_by(Card.deck)
                    .tuples()
                )
            }
        _lib_cache = {
            'time': now,
            'by_name': by_name,
            'counts': counts
        }
        return by_name, counts
    except Exception as e:
        logger.error(f"Error caching library info: {e}")
        return _lib_cache.get('by_name', {}), _lib_cache.get('counts', {})


def get_active_decks(user_id: int, folder_map: dict = None):
    """Возвращает список колод со статистикой. Оптимизировано для быстрой загрузки."""
    try:
        now = datetime.datetime.now()
        
        if folder_map is None:
            all_folders = list(TMA_Folder.select().where(TMA_Folder.is_deleted == False))
            folder_map = {f.id: f for f in all_folders}

        # 1. Убеждаемся, что дефолтные колоды и папки импортированы
        try:
            ensure_starter_decks(user_id)
        except Exception:
            pass

        # Update folder_map in case ensure_starter_decks created folders
        if folder_map is not None:
            user_folders = list(TMA_Folder.select().where((TMA_Folder.user_id == user_id) & (TMA_Folder.is_deleted == False)))
            for uf in user_folders:
                if uf.id not in folder_map:
                    folder_map[uf.id] = uf
        
        # 2. Получаем все доступные пользователю колоды (собственные и расшаренные)
        from .collaborative_service import get_user_accessible_deck_ids, get_user_accessible_folder_ids, get_batch_collaborative_info
        accessible_deck_ids = get_user_accessible_deck_ids(user_id, folder_map=folder_map)
        accessible_folder_ids = get_user_accessible_folder_ids(user_id, folder_map=folder_map)

        if not accessible_deck_ids:
            # Fallback: ensure inbox if user has 0 decks
            ensure_inbox_deck(user_id)
            accessible_deck_ids = get_user_accessible_deck_ids(user_id, folder_map=folder_map)
            if not accessible_deck_ids:
                return []

        decks = list(TMA_Deck.select().where(
            (TMA_Deck.id << list(accessible_deck_ids)) & (TMA_Deck.is_deleted == False)
        ).order_by(TMA_Deck.is_pinned.desc(), TMA_Deck.is_inbox.desc(), TMA_Deck.position.asc(), TMA_Deck.id.desc()))

        # Check if inbox exists in decks, if not ensure and reload
        if not any(getattr(d, 'is_inbox', False) for d in decks):
            ensure_inbox_deck(user_id)
            accessible_deck_ids = get_user_accessible_deck_ids(user_id, folder_map=folder_map)
            decks = list(TMA_Deck.select().where(
                (TMA_Deck.id << list(accessible_deck_ids)) & (TMA_Deck.is_deleted == False)
            ).order_by(TMA_Deck.is_pinned.desc(), TMA_Deck.is_inbox.desc(), TMA_Deck.position.asc(), TMA_Deck.id.desc()))

        if not decks:
            logger.warning(f"No decks found for user {user_id}")
            return []

        deck_ids = [d.id for d in decks]

        # Batch resolve collaborative roles and is_shared in 1 query
        collab_info = get_batch_collaborative_info(user_id, decks=decks, folder_map=folder_map)
        deck_collab_map = collab_info.get('decks', {})

        from peewee import Case
        
        # --- Оптимизированный запрос статистики через Peewee ---
        tracked_case = Case(None, [(TMAProgress.queue != 'new', 1)], None)
        learning_case = Case(None, [(TMAProgress.queue << ['learning', 'relearning'], 1)], None)
        due_case = Case(None, [((TMAProgress.queue == 'review') & (TMAProgress.next_review <= now), 1)], None)
        trainer_case = Case(None, [(TMA_Card.card_type == 'trainer', 1)], None)
        stats_query = (TMA_Card
                      .select(
                          TMA_Card.deck_id.alias('deck_id'),
                          fn.COUNT(TMA_Card.id).alias('total'),
                          fn.COUNT(tracked_case).alias('tracked'),
                          fn.COUNT(learning_case).alias('learning'),
                          fn.COUNT(due_case).alias('due'),
                          fn.COUNT(trainer_case).alias('trainer_count')
                      )
                      .join(TMAProgress, JOIN.LEFT_OUTER, on=(
                          (TMAProgress.card_id == TMA_Card.id) & (TMAProgress.user_id == user_id)
                      ))
                      .where((TMA_Card.deck_id << deck_ids) & (TMA_Card.is_deleted == False))
                      .group_by(TMA_Card.deck_id))
        
        stats_map = {}
        for row in stats_query.dicts():
            stats_map[row['deck_id']] = {
                'total': row['total'], 
                'tracked': row['tracked'], 
                'learning': int(row['learning'] or 0),
                'due': int(row['due'] or 0),
                'trainer_count': int(row['trainer_count'] or 0)
            }

        # --- Кэшированная проверка обновлений из библиотеки ---
        ext_by_name, lib_counts = _get_cached_library_info()
        
        result = []
        for d in decks:
            s = stats_map.get(d.id, {'total': 0, 'tracked': 0, 'learning': 0, 'due': 0, 'trainer_count': 0})
            total = s['total']
            tracked = s['tracked']
            learning = s['learning']
            due = s['due']
            trainer_count = s['trainer_count']
            is_trainer_deck = bool(total > 0 and trainer_count == total)
            
            # Check for updates
            has_updates = False
            ext_deck = ext_by_name.get(d.name)
            if ext_deck:
                lib_count = lib_counts.get(ext_deck.id, 0)
                if lib_count > total:
                    has_updates = True
                elif ext_deck.updated_at and d.updated_at and ext_deck.updated_at > d.updated_at:
                    has_updates = True

            parsed_metadata = resolve_deck_metadata(d)

            collab_meta = deck_collab_map.get(d.id, {})
            role = collab_meta.get('role', 'owner' if d.user_id == user_id else None)
            is_shared = collab_meta.get('is_shared', False)


            deck_folder_id = getattr(d, 'folder_id', None)
            if deck_folder_id and deck_folder_id not in accessible_folder_ids:
                deck_folder_id = None

            result.append({
                "id": d.id,
                "name": d.name,
                "level": getattr(d, 'level', ''),
                "topic": getattr(d, 'topic', ''),
                "target_language": getattr(d, 'target_language', 'de') or 'de',
                "is_inbox": getattr(d, 'is_inbox', False),
                "is_pinned": getattr(d, 'is_pinned', False),
                "is_trainer": is_trainer_deck,
                "position": getattr(d, 'position', 0),
                "folder_id": deck_folder_id,
                "has_updates": has_updates,
                "metadata": parsed_metadata,
                "is_learning": bool(parsed_metadata.get('is_learning', False)),
                "is_shared": is_shared,
                "role": role,
                "is_owner": role == 'owner',
                "stats": {
                    "total": total,
                    "new": max(0, total - tracked),
                    "learning": learning,
                    "due": due,
                    "trainer_count": trainer_count
                }
            })


        return result
    except Exception as e:
        logger.error(f"Error in get_active_decks: {e}", exc_info=True)
        raise e


def get_external_decks(target_language: str = None):
    """Возвращает список всех колод из общей библиотеки с учетом изучаемого языка."""
    try:
        counts = {c.deck_id: c.count for c in Card.select(Card.deck_id, fn.COUNT(Card.id).alias('count')).group_by(Card.deck_id)}
        
        query = Deck.select()
        if target_language:
            if target_language == 'de':
                query = query.where((Deck.target_language == 'de') | (Deck.target_language.is_null()))
            else:
                query = query.where(Deck.target_language == target_language)

        decks = list(query.order_by(Deck.name))
        return [{
            "id": d.id,
            "name": d.name,
            "level": getattr(d, 'level', ''),
            "topic": getattr(d, 'topic', ''),
            "target_language": getattr(d, 'target_language', 'de') or 'de',
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


def import_deck(external_deck_id: int, user_id: int, mode: str = 'merge', local_deck_id: int = None, force_trash: bool = False):
    """Импортирует колоду из библиотеки. Поддерживает режимы: merge, replace, copy.
    Если колода уже находится в корзине и force_trash=False, возвращает {'status': 'in_trash', ...}."""
    try:
        logger.info(f"IMPORT START: deck_id={external_deck_id}, user_id={user_id}, mode={mode}, force_trash={force_trash}")
        
        ext_deck = Deck.get_by_id(external_deck_id)
        ext_target_lang = getattr(ext_deck, 'target_language', None) or 'de'

        # Check if user has this deck in trash (soft-deleted)
        if not local_deck_id and mode in ('merge', 'replace'):
            deleted_deck = TMA_Deck.get_or_none(
                (TMA_Deck.user_id == user_id) & 
                (TMA_Deck.name == ext_deck.name) & 
                (TMA_Deck.is_deleted == True)
            )
            active_deck = TMA_Deck.get_or_none(
                (TMA_Deck.user_id == user_id) & 
                (TMA_Deck.name == ext_deck.name) & 
                (TMA_Deck.is_deleted == False)
            )

            if deleted_deck and not active_deck:
                if not force_trash:
                    logger.info(f"IMPORT DETECTED TRASH CONFLICT: user {user_id} has deleted deck '{ext_deck.name}' (id={deleted_deck.id})")
                    return {
                        "status": "in_trash",
                        "name": ext_deck.name,
                        "deck_name": ext_deck.name,
                        "deck_id": external_deck_id,
                        "trash_deck_id": deleted_deck.id
                    }
                else:
                    logger.info(f"PURGING TRASH DECK {deleted_deck.id} for user {user_id} before re-importing")
                    card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == deleted_deck.id)]
                    if card_ids:
                        TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                        TMA_Card.delete().where(TMA_Card.id << card_ids).execute()
                    deleted_deck.delete_instance()
        
        if mode == 'copy':
            copy_name = f"{ext_deck.name} (v2)"
            local_deck, created = TMA_Deck.get_or_create(
                user_id=user_id, 
                name=copy_name,
                defaults={
                    'level': getattr(ext_deck, 'level', ''),
                    'topic': getattr(ext_deck, 'topic', ''),
                    'target_language': ext_target_lang,
                    'created_at': datetime.datetime.now(),
                    'updated_at': datetime.datetime.now()
                }
            )
            if not created and local_deck.is_deleted:
                local_deck.is_deleted = False
                local_deck.target_language = ext_target_lang or local_deck.target_language or 'de'
                local_deck.updated_at = datetime.datetime.now()
                local_deck.save()

            _bulk_copy_cards_from_library(local_deck.id, external_deck_id, "Imported as copy")
            _save_source_library_id(local_deck, external_deck_id)
            return local_deck

        elif mode == 'replace':
            if local_deck_id:
                local_deck = TMA_Deck.get_by_id(local_deck_id)
            else:
                local_deck, _ = TMA_Deck.get_or_create(
                    user_id=user_id, 
                    name=ext_deck.name,
                    defaults={
                        'level': getattr(ext_deck, 'level', ''),
                        'topic': getattr(ext_deck, 'topic', ''),
                        'target_language': ext_target_lang,
                        'created_at': datetime.datetime.now(),
                        'updated_at': datetime.datetime.now()
                    }
                )
            
            if local_deck.is_deleted:
                local_deck.is_deleted = False
            local_deck.target_language = ext_target_lang or local_deck.target_language or 'de'
            
            # Delete old cards and progress before replacing
            card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == local_deck.id)]
            if card_ids:
                TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                TMA_Card.delete().where(TMA_Card.id << card_ids).execute()

            _bulk_copy_cards_from_library(local_deck.id, external_deck_id, "Imported via replace")
            local_deck.updated_at = datetime.datetime.now()
            _save_source_library_id(local_deck, external_deck_id)
            local_deck.save()
            return local_deck
            
        else:  # merge
            if local_deck_id:
                local_deck = TMA_Deck.get_by_id(local_deck_id)
            else:
                local_deck, created = TMA_Deck.get_or_create(
                    user_id=user_id, 
                    name=ext_deck.name,
                    defaults={
                        'level': getattr(ext_deck, 'level', ''),
                        'topic': getattr(ext_deck, 'topic', ''),
                        'target_language': ext_target_lang,
                        'created_at': datetime.datetime.now(),
                        'updated_at': datetime.datetime.now()
                    }
                )
                
            logger.info(f"IMPORT MERGE: Processing deck '{local_deck.name}' (id={local_deck.id}) for user {user_id}")
            
            # If the local deck was previously soft-deleted, un-delete it
            if local_deck.is_deleted:
                local_deck.is_deleted = False
                local_deck.updated_at = datetime.datetime.now()
            local_deck.target_language = ext_target_lang or local_deck.target_language or 'de'
            local_deck.save()
                
            # Check if local deck has active cards
            local_cards_query = TMA_Card.select().where(TMA_Card.deck_id == local_deck.id)
            has_active_cards = local_cards_query.where(TMA_Card.is_deleted == False).exists()
            
            if not has_active_cards:
                # Clean up any old soft-deleted cards to prevent ghost duplicates
                card_ids = [c.id for c in local_cards_query]
                if card_ids:
                    TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                    TMA_Card.delete().where(TMA_Card.id << card_ids).execute()

                _bulk_copy_cards_from_library(local_deck.id, external_deck_id, "Imported from library")
                local_deck.updated_at = datetime.datetime.now()
                _save_source_library_id(local_deck, external_deck_id)
                local_deck.save()
                logger.info(f"FAST IMPORT MERGE: Deck '{local_deck.name}' cards copied via ORM bulk insert")
                return local_deck

            # Update existing cards & insert new ones (incremental merge)
            remote_cards = list(Card.select().where((Card.deck_id == external_deck_id) & (Card.is_deleted == False)))
            local_cards = {c.front_text: c for c in TMA_Card.select().where(TMA_Card.deck_id == local_deck.id)}
            
            logger.info(f"MERGE STATS: {len(remote_cards)} in library, {len(local_cards)} in local")
            
            new_cards_to_insert = []
            
            for rc in remote_cards:
                if rc.front_text in local_cards:
                    lc = local_cards[rc.front_text]
                    # Ensure card is restored if it was soft-deleted
                    if lc.is_deleted:
                        lc.is_deleted = False
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
                        'is_deleted': False,
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
            _save_source_library_id(local_deck, external_deck_id)
            local_deck.save()
            return local_deck
            
    except Exception as e:
        error_msg = f"CRITICAL ERROR in import_deck: {e}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg)


def _bulk_copy_cards_from_library(local_deck_id: int, external_deck_id: int, history_note: str = "Imported from library"):
    """Copies all active cards from a library deck into a TMA deck using ORM bulk insert.
    Replaces the old raw SQL INSERT-SELECT that required dialect-specific placeholders.
    """
    ext_cards = list(Card.select(
        Card.front_text, Card.back_text, Card.context,
        Card.image_path, Card.audio_path, Card.metadata
    ).where((Card.deck_id == external_deck_id) & (Card.is_deleted == False)))

    if not ext_cards:
        return 0

    now = datetime.datetime.now()
    rows = [{
        'deck_id': local_deck_id,
        'front_text': c.front_text or '',
        'back_text': c.back_text or '',
        'context': c.context or '',
        'image_path': c.image_path or '',
        'audio_path': c.audio_path or '',
        'card_type': 'translation',
        'is_deleted': False,
        'source': 'library',
        'topics': '[]',
        'metadata': c.metadata or '{}',
        'tags': '[]',
        'created_at': now,
        'updated_at': now,
        'history': add_to_history('[]', history_note)
    } for c in ext_cards]

    with tma_db.atomic():
        for i in range(0, len(rows), 100):
            TMA_Card.insert_many(rows[i:i+100]).execute()
    return len(rows)


def _save_source_library_id(local_deck, external_deck_id: int):
    try:
        import json
        meta = json.loads(local_deck.metadata or '{}')
        meta['source_library_id'] = external_deck_id
        local_deck.metadata = json.dumps(meta)
        local_deck.save()
    except Exception as e:
        logger.warning(f"Failed to set source_library_id metadata: {e}")


def import_decks_batch(external_deck_ids: list[int], user_id: int, mode: str = 'merge', force_trash: bool = False):
    """Массовый импорт нескольких колод из библиотеки."""
    imported_ids = []
    for deck_id in external_deck_ids:
        try:
            d = import_deck(deck_id, user_id, mode=mode, force_trash=force_trash)
            if isinstance(d, dict) and d.get("status") == "in_trash":
                continue
            if d:
                imported_ids.append(getattr(d, 'id', d))
        except Exception as err:
            logger.error(f"Error importing batch deck {deck_id}: {err}")
    return imported_ids


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
        
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck_id, TMA_Card.is_deleted == False).order_by(TMA_Card.position.asc(), TMA_Card.id.asc()))
        
        now = datetime.datetime.now()
        card_data = [{
            'deck_id': new_deck.id,
            'front_text': card.front_text,
            'back_text': card.back_text,
            'context': card.context,
            'image_path': card.image_path,
            'audio_path': card.audio_path,
            'audio_back_path': card.audio_back_path,
            'video_front_path': card.video_front_path,
            'video_back_path': card.video_back_path,
            'source': card.source,
            'position': card.position,
            'flag': card.flag if card.flag is not None else 0,
            'created_at': now,
            'updated_at': now
        } for card in cards]
        
        with tma_db.atomic():
            if card_data:
                TMA_Card.insert_many(card_data).execute()
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

        # If deck has a share_id, delete stored preview screenshot so fresh preview with new name is generated
        if deck.share_id:
            filename = f"preview_{deck.share_id}.png"
            TMAMedia.delete().where((TMAMedia.filename == filename) & (TMAMedia.folder == 'previews')).execute()

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
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False))
        if not deck:
            return None
        
        from .collaborative_service import get_effective_user_role
        role = get_effective_user_role(user_id, 'deck', deck_id)
        if not role or role not in ('owner', 'editor', 'admin'):
            return None

        deck.metadata = json.dumps(metadata_dict)
        deck.updated_at = datetime.datetime.now()
        deck.save()
        return deck
    except Exception as e:
        logger.error(f"Error updating deck metadata {deck_id}: {e}")
        raise e


def toggle_deck_learning(deck_id: int, user_id: int, is_learning: bool = None):
    """Переключает или устанавливает статус 'Учу' (is_learning) для колоды."""
    try:
        from .collaborative_service import get_effective_user_role
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False))
        if not deck:
            return None
        
        role = get_effective_user_role(user_id, 'deck', deck_id)
        if not role:
            return None
        
        meta = {}
        if deck.metadata:
            try:
                meta = json.loads(deck.metadata)
            except Exception:
                meta = {}
        
        current_status = bool(meta.get('is_learning', False))
        new_status = not current_status if is_learning is None else bool(is_learning)
        meta['is_learning'] = new_status
        deck.metadata = json.dumps(meta)
        deck.updated_at = datetime.datetime.now()
        deck.save()
        logger.info(f"Deck {deck_id} learning status set to {new_status} by user {user_id}")
        return new_status
    except Exception as e:
        logger.error(f"Error toggling deck learning {deck_id}: {e}", exc_info=True)
        raise e




