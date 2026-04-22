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

def get_active_decks(user_id: int):
    """Возвращает список ЛИЧНЫХ колод пользователя из tma_deck."""
    try:
        decks = list(TMA_Deck.select().where(
            TMA_Deck.user_id == user_id, 
            TMA_Deck.is_deleted == False
        ))
        result = []
        now = datetime.datetime.now()
        
        for d in decks:
            total = TMA_Card.select().where(TMA_Card.deck == d).count() 
            if total == 0: continue
                
            deck_card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck == d)]
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
                    "new": total - tracked,
                    "learning": learning,
                    "due": due
                }
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_active_decks: {e}")
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
                audio_path=getattr(ec, 'audio_path', None)
            )
        return local_deck
    except Exception as e:
        logger.error(f"Error importing deck {external_deck_id}: {e}")
        return None

def get_next_card(user_id: int, deck_id: int):
    """Логика выбора следующей карты для изучения (SRS)."""
    try:
        now = datetime.datetime.now()
        deck_card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == deck_id)]
        if not deck_card_ids: return None, None

        # 1. Сначала карточки на изучении
        learning = (TMAProgress.select().where(
                TMAProgress.user_id == user_id,
                TMAProgress.card_id << deck_card_ids,
                TMAProgress.queue.in_(["learning", "relearning"]),
                TMAProgress.next_review <= now,
            ).order_by(TMAProgress.next_review).first())
        if learning:
            card = TMA_Card.get_or_none(TMA_Card.id == learning.card_id)
            if card: return card, learning
                
        # 2. Затем карточки на повторение (review)
        due = (TMAProgress.select().where(
                TMAProgress.user_id == user_id,
                TMAProgress.card_id << deck_card_ids,
                TMAProgress.queue == "review",
                TMAProgress.next_review <= now,
            ).order_by(fn.Random()).first())
        if due:
            card = TMA_Card.get_or_none(TMA_Card.id == due.card_id)
            if card: return card, due

        # 3. Наконец, новые карточки
        existing_ids = [p.card_id for p in TMAProgress.select(TMAProgress.card_id).where(TMAProgress.user_id == user_id)]
        new_card_ids = [cid for cid in deck_card_ids if cid not in existing_ids]
        
        if not new_card_ids: return None, None
            
        target_id = new_card_ids[0]
        progress, created = TMAProgress.get_or_create(
            card_id=target_id, 
            user_id=user_id, 
            defaults={"queue": "new", "next_review": now}
        )
        card = TMA_Card.get_or_none(TMA_Card.id == target_id)
        return card, progress
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
        
    card.front_text = data.get('front', card.front_text)
    card.back_text = data.get('back', card.back_text)
    card.context = data.get('context', card.context)
    card.image_path = data.get('image_path', card.image_path)
    card.audio_path = data.get('audio_path', card.audio_path)
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
