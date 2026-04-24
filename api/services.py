import os
import datetime
import logging
from models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db
import srs
from peewee import fn

logger = logging.getLogger(__name__)

def ensure_starter_decks(user_id: int):
    try:
        # Список обязательных колод
        STARTER_DECK_NAMES = [
            "Для картинок", "херен2", "письма 1", "херен", 
            "13.03.26", "мои для обихода", "последнее перед б1", 
            "новая тестовая колода", "14.03.26"
        ]
        
        existing_decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id))
        existing_names = {d.name for d in existing_decks}
        
        for name in STARTER_DECK_NAMES:
            if name not in existing_names:
                lib_deck = Deck.get_or_none(Deck.name == name)
                if lib_deck:
                    import_deck(lib_deck.id, user_id)
        return True
    except Exception as e:
        logger.error(f"Error in ensure_starter_decks: {e}")
        return False

def get_active_decks(user_id: int):
    """Возвращает список колод со статистикой."""
    try:
        now = datetime.datetime.now()
        decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id).order_by(TMA_Deck.id.desc()))
        
        if not decks:
            ensure_starter_decks(user_id)
            decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id).order_by(TMA_Deck.id.desc()))
        
        result = []
        for d in decks:
            # Считаем количество карт
            total = TMA_Card.select().where(TMA_Card.deck_id == d.id).count()
            
            # Считаем прогресс (быстрый запрос)
            # tracked = количество карт колоды, которые есть в TMAProgress для этого юзера
            tracked = (TMAProgress.select()
                       .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                       .where(TMAProgress.user_id == user_id, TMA_Card.deck_id == d.id)
                       .count())
            
            # Считаем карточки к повторению
            due = (TMAProgress.select()
                   .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                   .where(TMAProgress.user_id == user_id, TMA_Card.deck_id == d.id, TMAProgress.next_review <= now)
                   .count())
            
            result.append({
                "id": d.id,
                "name": d.name,
                "level": getattr(d, 'level', ''),
                "topic": getattr(d, 'topic', ''),
                "stats": {
                    "total": total,
                    "new": max(0, total - tracked),
                    "learning": 0,
                    "due": due
                }
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_active_decks: {e}")
        return []

def get_next_card(user_id: int, deck_id: int, exclude_ids: list = None):
    """Выбирает следующую карту для изучения (SRS)."""
    try:
        now = datetime.datetime.now()
        exclude_ids = exclude_ids or []
        
        # 1. Повторение (Due) — с учётом exclude_ids
        due_query = (TMAProgress
                    .select()
                    .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                    .where(
                        TMAProgress.user_id == user_id,
                        TMA_Card.deck_id == deck_id,
                        TMAProgress.next_review <= now
                    ))
        if exclude_ids:
            due_query = due_query.where(~(TMAProgress.card_id << exclude_ids))
        progress = due_query.order_by(TMAProgress.queue.asc(), TMAProgress.next_review.asc()).first()
        
        if progress:
            card = TMA_Card.get_by_id(progress.card_id)
            return card, progress
            
        # 2. Новые карты
        # Исключаем те, что уже в прогрессе
        tracked_ids = [p.card_id for p in TMAProgress.select(TMAProgress.card_id).where(TMAProgress.user_id == user_id)]
        
        new_query = TMA_Card.select().where(TMA_Card.deck_id == deck_id)
        if tracked_ids:
            new_query = new_query.where(~(TMA_Card.id << tracked_ids))
        if exclude_ids:
            new_query = new_query.where(~(TMA_Card.id << exclude_ids))
            
        card = new_query.first()
        
        # Fallback: если всё пройдено, берем любую первую для режима "учить заново" без сброса
        if not card and not exclude_ids:
            card = TMA_Card.select().where(TMA_Card.deck_id == deck_id).first()
            
        if not card:
            return None, None
            
        # Создаем запись прогресса
        progress, _ = TMAProgress.get_or_create(
            card_id=card.id,
            user_id=user_id,
            defaults={"queue": "new", "next_review": now}
        )
        return card, progress
        
    except Exception as e:
        logger.error(f"Error in get_next_card: {e}")
        return {"error": str(e)}, None

def import_deck(external_deck_id: int, user_id: int):
    try:
        ext_deck = Deck.get_by_id(external_deck_id)
        local_deck, _ = TMA_Deck.get_or_create(
            user_id=user_id, 
            name=ext_deck.name,
            defaults={'level': ext_deck.level, 'topic': ext_deck.topic}
        )
        
        ext_cards = list(Card.select().where(Card.deck_id == external_deck_id))
        
        # Индексируем существующие карты по front_text для быстрого поиска
        local_cards_map = {c.front_text: c for c in TMA_Card.select().where(TMA_Card.deck_id == local_deck.id)}
        
        new_cards = []
        now = datetime.datetime.now()
        for ec in ext_cards:
            if ec.front_text in local_cards_map:
                # Если карта есть, проверяем, не нужно ли обновить медиа-пути
                local_card = local_cards_map[ec.front_text]
                changed = False
                if ec.image_path and not local_card.image_path:
                    local_card.image_path = ec.image_path
                    changed = True
                if ec.audio_path and not local_card.audio_path:
                    local_card.audio_path = ec.audio_path
                    changed = True
                if changed:
                    local_card.save()
                continue
                
            new_cards.append({
                'deck_id': local_deck.id,
                'front_text': ec.front_text,
                'back_text': ec.back_text,
                'context': ec.context,
                'image_path': ec.image_path,
                'audio_path': ec.audio_path,
                'created_at': now,
                'updated_at': now
            })
            
        if new_cards:
            with tma_db.atomic():
                for i in range(0, len(new_cards), 100):
                    TMA_Card.insert_many(new_cards[i:i+100]).execute()
                    
        return local_deck
    except Exception as e:
        logger.error(f"Error importing deck: {e}")
        return None

def reset_deck_progress(user_id: int, deck_id: int):
    try:
        card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id == deck_id)]
        if card_ids:
            TMAProgress.delete().where(TMAProgress.user_id == user_id, TMAProgress.card_id << card_ids).execute()
        return True
    except Exception as e:
        logger.error(f"Error resetting progress: {e}")
        return False

def sync_deck_with_library(user_id: int, deck_id: int):
    try:
        local = TMA_Deck.get_by_id(deck_id)
        ext = Deck.get_or_none(Deck.name == local.name)
        if ext:
            import_deck(ext.id, user_id)
            return True
        return False
    except Exception as e:
        logger.error(f"Error syncing deck: {e}")
        return False

def update_card_progress(card_id: int, user_id: int, grade: int):
    try:
        progress = TMAProgress.get_or_none(TMAProgress.card_id == card_id, TMAProgress.user_id == user_id)
        if not progress:
            progress = TMAProgress.create(card_id=card_id, user_id=user_id, next_review=datetime.datetime.now())
        srs.review_card(progress, grade)
        TMAReviewHistory.create(card_id=card_id, user_id=user_id, rating=grade, scheduled_interval=progress.interval)
        return {"status": "success", "next_review": progress.next_review}
    except Exception as e:
        logger.error(f"Error updating progress: {e}")
        raise e

def get_cards_for_study(deck_id: int, user_id: int):
    """Возвращает список всех карточек в колоде с их статусом SRS."""
    try:
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck_id))
        progress_map = {p.card_id: p for p in TMAProgress.select().where(TMAProgress.user_id == user_id)}
        
        result = []
        for c in cards:
            p = progress_map.get(c.id)
            result.append({
                "id": c.id,
                "front": c.front_text,
                "back": c.back_text,
                "context": c.context,
                "audio_url": resolve_media_url(c.audio_path, "audio"),
                "image_url": resolve_media_url(c.image_path, "images"),
                "queue": p.queue if p else "new",
                "interval": p.interval if p else 0,
                "next_review": p.next_review.isoformat() if p and p.next_review else None
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_cards_for_study: {e}")
        return []

def save_card(data, user_id):
    """Сохраняет или обновляет карточку."""
    try:
        card_id = data.get('id')
        if card_id:
            card = TMA_Card.get_by_id(card_id)
        else:
            card = TMA_Card()
            
        card.deck_id = data.get('deck_id')
        card.front_text = data.get('front_text')
        card.back_text = data.get('back_text')
        card.context = data.get('context')
        card.image_path = data.get('image_path')
        card.audio_path = data.get('audio_path')
        card.save()
        return card
    except Exception as e:
        logger.error(f"Error saving card: {e}")
        return None

def resolve_media_url(path_str: str, media_type: str) -> str | None:
    if not path_str: return None
    if path_str.startswith("http"): return path_str
    return f"/api/media/{media_type}/{os.path.basename(path_str)}"
