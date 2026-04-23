import datetime
import os
import shutil
import logging
from peewee import fn
from pathlib import Path

# Универсальные импорты
try:
    from models import (
        Card, Deck, TMA_Card, TMA_Deck,
        TMAProgress, TMAReviewHistory,
        tma_db, lerne_db, TMA_ROOT, LIBRARY_ROOT
    )
    import srs
except ImportError:
    from api.models import (
        Card, Deck, TMA_Card, TMA_Deck,
        TMAProgress, TMAReviewHistory,
        tma_db, lerne_db, TMA_ROOT, LIBRARY_ROOT
    )
    from api import srs

logger = logging.getLogger(__name__)

# Локальные пути к медиа TMA
MEDIA_DIR = TMA_ROOT / "api" / "data" / "media"
AUDIO_DIR = MEDIA_DIR / "audio"
IMAGE_DIR = MEDIA_DIR / "images"

def ensure_starter_deck(user_id: int):
    """Проверяет наличие колод у пользователя и импортирует первую из библиотеки, если пусто."""
    try:
        user_id = int(user_id)
        # Проверяем существующие колоды
        existing = TMA_Deck.select().where(
            TMA_Deck.user_id == user_id, 
            TMA_Deck.is_deleted == False
        ).exists()
        
        logger.info(f"ONBOARDING check for user {user_id}: existing={existing}")
        
        if not existing:
            # Ищем что-нибудь в библиотеке
            starter = Deck.select().where(Deck.is_deleted == False).order_by(Deck.id.asc()).first()
            if starter:
                logger.info(f"ONBOARDING: Auto-importing starter deck '{starter.name}' (ID={starter.id}) for user {user_id}")
                import_deck(starter.id, user_id)
            else:
                logger.warning("ONBOARDING: No decks found in library to auto-import!")
    except Exception as e:
        logger.error(f"Error in ensure_starter_deck for user {user_id}: {e}", exc_info=True)

def get_active_decks(user_id: int):
    """Возвращает список ЛИЧНЫХ колод пользователя из tma_deck."""
    try:
        user_id = int(user_id)
        # Пытаемся добавить стартовую колоду для новичка
        ensure_starter_deck(user_id)
        
        decks = list(TMA_Deck.select().where(
            TMA_Deck.user_id == user_id, 
            TMA_Deck.is_deleted == False
        ))
        
        logger.info(f"GET_DECKS: User {user_id} has {len(decks)} decks in tma_deck")
        
        result = []
        now = datetime.datetime.now()
        
        for d in decks:
            total = TMA_Card.select().where(TMA_Card.deck == d, TMA_Card.is_deleted == False).count() 
            # Не скрываем пустые колоды, чтобы пользователь понимал, что колода есть
            # if total == 0: continue
                
            deck_card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck == d, TMA_Card.is_deleted == False)]
            
            tracked = 0
            due = 0
            learning = 0
            
            if deck_card_ids:
                tma_deck_progress = TMAProgress.select().where(
                    TMAProgress.user_id == user_id,
                    TMAProgress.card_id << deck_card_ids
                )
                
                tracked = tma_deck_progress.count()
                due = tma_deck_progress.where(TMAProgress.queue == "review", TMAProgress.next_review <= now).count()
                learning = tma_deck_progress.where(TMAProgress.queue.in_(["learning", "relearning", "new"])).count()
            
            result.append({
                "id": d.id,
                "name": d.name,
                "level": getattr(d, 'level', ''),
                "topic": getattr(d, 'topic', ''),
                "is_user_deck": True,
                "stats": {
                    "total": total,
                    "new": max(0, total - tracked),
                    "learning": learning,
                    "due": due
                }
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_active_decks for user {user_id}: {e}", exc_info=True)
        return []

def get_external_decks():
    """Возвращает список всех колод из ОБЩЕЙ библиотеки (deck)."""
    try:
        decks = list(Deck.select().where(Deck.is_deleted == False))
        return [{
            "id": d.id,
            "name": d.name,
            "level": getattr(d, 'level', ''),
            "topic": getattr(d, 'topic', ''),
            "is_user_deck": False,
            "stats": {"total": Card.select().where(Card.deck == d).count()}
        } for d in decks]
    except Exception as e:
        logger.error(f"Error in get_external_decks: {e}")
        return []

def import_deck_from_json(data: dict, user_id: int):
    """Создает колоду и карточки из JSON-данных."""
    try:
        deck_name = data.get('name', 'Новая колода (из файла)')
        cards_data = data.get('cards', [])
        
        if not cards_data:
            return None
            
        # Создаем колоду
        deck = TMA_Deck.create(
            user_id=user_id,
            name=deck_name,
            created_at=datetime.datetime.now()
        )
        
        # Создаем карточки
        for c in cards_data:
            TMA_Card.create(
                deck=deck,
                front_text=c.get('front', ''),
                back_text=c.get('back', ''),
                context=c.get('context', ''),
                card_type='translation',
                source='file_import',
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now()
            )
        
        logger.info(f"JSON IMPORT: User {user_id} imported deck '{deck_name}' with {len(cards_data)} cards")
        return deck
    except Exception as e:
        logger.error(f"Error in import_deck_from_json: {e}")
        return None

def import_deck(external_deck_id: int, user_id: int):
    """Копирует колоду из Библиотеки в Личное."""
    try:
        ext_deck = Deck.get_or_none(Deck.id == external_deck_id)
        if not ext_deck: return None
        
        local_deck = TMA_Deck.get_or_none(TMA_Deck.user_id == user_id, TMA_Deck.name == ext_deck.name)
        if not local_deck:
            local_deck = TMA_Deck.create(
                user_id=user_id, 
                name=ext_deck.name, 
                level=ext_deck.level, 
                topic=ext_deck.topic
            )
        
        ext_cards = Card.select().where(Card.deck == ext_deck)
        for ec in ext_cards:
            if TMA_Card.select().where(TMA_Card.deck == local_deck, TMA_Card.front_text == ec.front_text).exists():
                continue
            TMA_Card.create(
                deck=local_deck,
                front_text=ec.front_text,
                back_text=ec.back_text,
                context=ec.context,
                image_path=getattr(ec, 'image_path', None),
                audio_path=getattr(ec, 'audio_path', None),
                card_type=getattr(ec, 'card_type', 'translation') or 'translation',
                source=getattr(ec, 'source', 'import') or 'import',
                difficulty=getattr(ec, 'difficulty', None),
                tags=getattr(ec, 'tags', None),
                topics=getattr(ec, 'topics', None),
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now()
            )
        return local_deck
    except Exception as e:
        logger.error(f"Error importing deck {external_deck_id}: {e}")
        return None

def get_next_card(user_id: int, deck_id: int, exclude_ids: list[int] = None):
    """Логика выбора следующей карты для изучения (SRS). Оптимизировано."""
    try:
        now = datetime.datetime.now()
        exclude_ids = exclude_ids or []
        
        # 1. Сначала ищем карточки, которые уже есть в прогрессе (learning или due)
        progress_query = (TMAProgress
                   .select(TMAProgress, TMA_Card)
                   .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                   .where(
                       TMAProgress.user_id == user_id,
                       TMA_Card.deck == deck_id,
                       TMAProgress.next_review <= now
                   ))
        
        if exclude_ids:
            progress_query = progress_query.where(~(TMA_Card.id << exclude_ids))

        progress = progress_query.order_by(
                       TMAProgress.queue.asc(), # 'learning' < 'review'
                       TMAProgress.next_review.asc()
                   ).first()
        
        if progress:
            # Безопасно получаем объект карты
            card = TMA_Card.get_by_id(progress.card_id)
            return card, progress

        # 2. Если ничего к повторению нет, ищем НОВУЮ карточку
        new_card_query = (TMA_Card
                   .select()
                   .where(
                       TMA_Card.deck == deck_id,
                       TMA_Card.is_deleted == False,
                       ~(TMA_Card.id << TMAProgress.select(TMAProgress.card_id).where(TMAProgress.user_id == user_id))
                   ))
        
        if exclude_ids:
            new_card_query = new_card_query.where(~(TMA_Card.id << exclude_ids))

        new_card = new_card_query.order_by(TMA_Card.id.asc()).first()
        
        if not new_card:
            return None, None
            
        progress = TMAProgress.create(
            card_id=new_card.id, 
            user_id=user_id, 
            queue="new", 
            next_review=now
        )
        return new_card, progress
        
    except Exception as e:
        logger.error(f"Error in get_next_card: {e}")
        return None, None

def get_deck_info(deck_id: int, user_id: int):
    """Детали ЛИЧНОЙ колоды."""
    d = TMA_Deck.get_or_none(TMA_Deck.id == deck_id, TMA_Deck.user_id == user_id)
    if not d: return None
    return {
        "id": d.id,
        "name": d.name,
        "level": getattr(d, 'level', ''),
        "topic": getattr(d, 'topic', ''),
    }

def get_cards_for_study(deck_id: int, user_id: int):
    """Возвращает все карточки из ЛИЧНОЙ колоды."""
    try:
        cards = TMA_Card.select().where(TMA_Card.deck_id == deck_id)
        return [{
            "id": c.id,
            "front": c.front_text,
            "back": c.back_text,
            "context": c.context
        } for c in cards]
    except Exception as e:
        logger.error(f"Error in get_cards_for_study: {e}")
        return []

def update_card_progress(card_id: int, user_id: int, grade: int):
    """Обновляет прогресс ЛИЧНОЙ карточки."""
    try:
        progress = TMAProgress.get_or_none(TMAProgress.card_id == card_id, TMAProgress.user_id == user_id)
        if not progress:
            now = datetime.datetime.now()
            progress = TMAProgress.create(card_id=card_id, user_id=user_id, next_review=now)
            
        srs.review_card(progress, grade)
        return {"status": "success", "next_review": progress.next_review}
    except Exception as e:
        logger.error(f"Error in update_card_progress: {e}")
        raise e

def resolve_media_url(path_str: str, media_type: str) -> str | None:
    if not path_str: return None
    if path_str.startswith("http"):
        return path_str
    filename = os.path.basename(path_str)
    return f"/api/media/{media_type}/{filename}"

def save_card(data: dict, user_id: int):
    """Создает или обновляет карточку."""
    card_id = data.get('card_id')
    deck_id = data.get('deck_id')
    
    if card_id:
        card = TMA_Card.get_or_none(TMA_Card.id == card_id)
        if not card: return None
    else:
        if not deck_id: return None
        card = TMA_Card(deck_id=deck_id)
        card.card_type = data.get('card_type', 'translation')
        card.source = data.get('source', 'tma')
        card.created_at = datetime.datetime.now()
        
    card.front_text = data.get('front', card.front_text)
    card.back_text = data.get('back', card.back_text)
    card.context = data.get('context', card.context)
    card.image_path = data.get('image_path', card.image_path)
    card.audio_path = data.get('audio_path', card.audio_path)
    card.updated_at = datetime.datetime.now()
    card.save()
    return card

def delete_card(card_id: int):
    """Помечает карточку как удаленную."""
    card = TMA_Card.get_or_none(TMA_Card.id == card_id)
    if card:
        card.is_deleted = True
        card.save()
        return True
    return False

def create_deck(name: str, user_id: int):
    """Создает новую личную колоду."""
    return TMA_Deck.create(name=name, user_id=user_id)

def delete_deck(deck_id: int):
    """Помечает колоду как удаленную."""
    deck = TMA_Deck.get_or_none(TMA_Deck.id == deck_id)
    if deck:
        deck.is_deleted = True
        deck.save()
        return True
    return False

# --- Администрирование и Модерация ---

def get_community_content(admin_user_id: int):
    """Возвращает список колод, созданных другими пользователями."""
    try:
        # Ищем колоды, владельцы которых не админ
        decks = (TMA_Deck.select()
                 .where(TMA_Deck.user_id != admin_user_id, TMA_Deck.is_deleted == False)
                 .order_by(TMA_Deck.id.desc()))
        
        result = []
        for d in decks:
            card_count = TMA_Card.select().where(TMA_Card.deck == d, TMA_Card.is_deleted == False).count()
            if card_count == 0: continue
            
            result.append({
                "id": d.id,
                "name": d.name,
                "user_id": str(d.user_id),
                "level": d.level or "",
                "topic": d.topic or "",
                "card_count": card_count
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_community_content: {e}")
        return []

def promote_to_library(tma_deck_id: int):
    """Копирует пользовательскую колоду в общую библиотеку (Deck/Card)."""
    try:
        tma_deck = TMA_Deck.get_by_id(tma_deck_id)
        
        # 1. Создаем запись в общей таблице Deck
        new_deck = Deck.create(
            name=tma_deck.name,
            level=tma_deck.level,
            topic=tma_deck.topic,
            is_deleted=False
        )
        
        # 2. Копируем все карточки
        tma_cards = TMA_Card.select().where(TMA_Card.deck == tma_deck, TMA_Card.is_deleted == False)
        for tc in tma_cards:
            Card.create(
                deck=new_deck,
                front_text=tc.front_text,
                back_text=tc.back_text,
                context=tc.context,
                is_deleted=False
            )
            
        logger.info(f"ADMIN: Promoted deck {tma_deck_id} ('{tma_deck.name}') to library as ID {new_deck.id}")
        return new_deck
    except Exception as e:
        logger.error(f"Error in promote_to_library: {e}")
        return None
