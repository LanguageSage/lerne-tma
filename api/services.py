import datetime
import os
import shutil
import logging
from peewee import fn
from pathlib import Path

from tma.api.models import (
    Card, Deck, ExternalCard, ExternalDeck, 
    TMAProgress, TMAReviewHistory,
    tma_db, lerne_db, TMA_ROOT, LIBRARY_ROOT
)
from tma.api import srs

logger = logging.getLogger(__name__)

# Локальные пути к медиа TMA
MEDIA_DIR = TMA_ROOT / "api" / "data" / "media"
AUDIO_DIR = MEDIA_DIR / "audio"
IMAGE_DIR = MEDIA_DIR / "images"

# Внешние пути (библиотека)
LIBRARY_MEDIA_DIR = LIBRARY_ROOT / "user_files"

def get_active_decks(user_id: int):
    """Возвращает список локальных колод TMA."""
    try:
        decks = list(Deck.select().where(Deck.is_deleted == False))
        result = []
        now = datetime.datetime.now()
        
        for d in decks:
            # Считаем карточки в локальной базе
            total = Card.select().where(Card.deck_id == d.id).count() 
            if total == 0:
                continue
                
            deck_card_ids = [c.id for c in Card.select(Card.id).where(Card.deck_id == d.id)]
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

def get_next_card(user_id: int, deck_id: int):
    """Логика выбора следующей карты из локальной БД."""
    now = datetime.datetime.now()
    deck_card_ids = [c.id for c in Card.select(Card.id).where(Card.deck_id == deck_id)]
    if not deck_card_ids: return None, None

    learning = (TMAProgress.select().where(
            TMAProgress.user_id == user_id,
            TMAProgress.card_id << deck_card_ids,
            TMAProgress.queue.in_(["learning", "relearning"]),
            TMAProgress.next_review <= now,
        ).order_by(TMAProgress.next_review).first())
    if learning:
        card = Card.get_or_none(Card.id == learning.card_id)
        if card: return card, learning
            
    due = (TMAProgress.select().where(
            TMAProgress.user_id == user_id,
            TMAProgress.card_id << deck_card_ids,
            TMAProgress.queue == "review",
            TMAProgress.next_review <= now,
        ).order_by(fn.Random()).first())
    if due:
        card = Card.get_or_none(Card.id == due.card_id)
        if card: return card, due

    existing_ids = [p.card_id for p in TMAProgress.select(TMAProgress.card_id).where(TMAProgress.user_id == user_id)]
    new_card_ids = [cid for cid in deck_card_ids if cid not in existing_ids]
    if not new_card_ids: return None, None
        
    target_id = new_card_ids[0]
    progress = TMAProgress.get_or_create(card_id=target_id, user_id=user_id, defaults={"queue": "new", "next_review": now})[0]
    card = Card.get_or_none(Card.id == target_id)
    return card, progress

async def get_deck_cards_full(deck_id: int):
    """Список всех карт локальной колоды."""
    try:
        cards = Card.select().where(Card.deck_id == deck_id)
        return [{
            "id": c.id,
            "front": str(c.front_text or ""),
            "back": str(c.back_text or ""),
            "image_url": resolve_media_url(c.image_path, "images"),
            "audio_url": resolve_media_url(c.audio_path, "audio"),
        } for c in cards]
    except Exception as e:
        logger.error(f"Error in get_deck_cards_full for deck {deck_id}: {e}")
        return []

def update_card(card_id: int, data: dict):
    """Прямое обновление карточки."""
    card = Card.get_or_none(Card.id == card_id)
    if not card: return None
    
    # Маппинг полей
    if 'front' in data: card.front_text = data['front']
    if 'back' in data: card.back_text = data['back']
    if 'context' in data: card.context = data['context']
    if 'image_path' in data: card.image_path = data['image_path']
    if 'audio_path' in data: card.audio_path = data['audio_path']
    
    # Добавляем тег TMA если нет
    tags = (card.tags or "").split(",")
    if "[TMA]" not in tags:
        tags.append("[TMA]")
        card.tags = ",".join(filter(None, tags))
    
    card.updated_at = datetime.datetime.now()
    card.save()
    return card

def create_card(deck_id: int, data: dict):
    """Прямое создание карточки."""
    deck = Deck.get_or_none(Deck.id == deck_id)
    if not deck: return None
    
    card = Card.create(
        deck=deck,
        front_text=data.get('front', ''),
        back_text=data.get('back', ''),
        context=data.get('context', ''),
        image_path=data.get('image_path'),
        audio_path=data.get('audio_path'),
        tags="[TMA]"
    )
    return card

def delete_deck(deck_id: int):
    """Удаляет колоду и все её карточки/прогресс из локальной БД."""
    try:
        deck = Deck.get_or_none(Deck.id == deck_id)
        if not deck: return False
        
        card_ids = [c.id for c in Card.select(Card.id).where(Card.deck_id == deck_id)]
        if card_ids:
            TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
            TMAReviewHistory.delete().where(TMAReviewHistory.card_id << card_ids).execute()
            
        Card.delete().where(Card.deck_id == deck_id).execute()
        deck.delete_instance()
        return True
    except Exception as e:
        logger.error(f"Error deleting deck {deck_id}: {e}")
        return False

def delete_card(card_id: int):
    """Удаляет одну карточку и её прогресс из локальной БД."""
    try:
        card = Card.get_or_none(Card.id == card_id)
        if not card: return False
        
        TMAProgress.delete().where(TMAProgress.card_id == card_id).execute()
        TMAReviewHistory.delete().where(TMAReviewHistory.card_id == card_id).execute()
        card.delete_instance()
        return True
    except Exception as e:
        logger.error(f"Error deleting card {card_id}: {e}")
        return False

# --- Сервисы Импорта ---

def get_external_decks():
    return list(ExternalDeck.select().where(ExternalDeck.is_deleted == False))

def import_deck(external_deck_id: int):
    ext_deck = ExternalDeck.get_or_none(ExternalDeck.id == external_deck_id)
    if not ext_deck: return None
    
    local_deck = Deck.get_or_none(Deck.name == ext_deck.name)
    if not local_deck:
        local_deck = Deck.create(name=ext_deck.name, level=ext_deck.level, topic=ext_deck.topic)
    
    ext_cards = ExternalCard.select().where(ExternalCard.deck_id == external_deck_id)
    count = 0
    for ec in ext_cards:
        if Card.select().where(Card.deck == local_deck, Card.front_text == ec.front_text).exists():
            continue
            
        local_audio = copy_external_to_local(ec.audio_path, "audio")
        local_image = copy_external_to_local(ec.image_path, "images")
        
        existing_tags = ec.tags or ""
        new_tags = f"{existing_tags},[TMA]".strip(",")
        
        Card.create(
            deck=local_deck,
            front_text=ec.front_text,
            back_text=ec.back_text,
            context=ec.context,
            audio_path=local_audio or ec.audio_path,
            image_path=local_image or ec.image_path,
            tags=new_tags,
            metadata=ec.metadata,
            card_type=ec.card_type,
            difficulty=ec.difficulty,
            topics=ec.topics,
            source=ec.source or "imported",
            created_at=ec.created_at,
            updated_at=ec.updated_at
        )
        count += 1
    return local_deck

def copy_external_to_local(original_path, media_type):
    if not original_path or original_path.startswith("http"): return None
    filename = os.path.basename(original_path)
    dest_dir = MEDIA_DIR / media_type
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / filename

    src_paths = [
        LIBRARY_MEDIA_DIR / media_type / filename,
        LIBRARY_ROOT / original_path,
        LIBRARY_MEDIA_DIR / "media" / filename,
    ]
    
    for src_path in src_paths:
        if src_path.exists():
            try:
                shutil.copy2(str(src_path), str(dest_path))
                return f"{media_type}/{filename}" 
            except Exception as e:
                logger.error(f"Error copying {src_path}: {e}")
    return None

def resolve_media_url(path_str: str, media_type: str) -> str | None:
    if not path_str: return None
    if not isinstance(path_str, str): return None
    if path_str.startswith("http") or path_str.startswith("/api/media"):
        return path_str
        
    clean_path = path_str.strip().split(",")[0]
    filename = os.path.basename(clean_path)
    
    # Теперь мы ВСЕГДА ищем в основной папке media_type (audio/images)
    return f"/api/media/{media_type}/{filename}"
