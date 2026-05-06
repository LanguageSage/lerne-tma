import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

from .media import resolve_media_url, _build_media_exists_map
from .utils import add_to_history

def save_card(data, user_id):
    """Сохраняет или обновляет карточку."""
    try:
        card_id = data.get('card_id') or data.get('id')
        if card_id:
            card = TMA_Card.get_by_id(card_id)
        else:
            card = TMA_Card()
            
        if data.get('deck_id'):
            card.deck_id = data.get('deck_id')
        
        # Обновляем только если передано, чтобы не затереть существующие данные
        front = data.get('front') or data.get('front_text')
        if front is not None:
            card.front_text = front
            
        back = data.get('back') or data.get('back_text')
        if back is not None:
            card.back_text = back
            
        if 'context' in data:
            card.context = data.get('context')
        if 'image_path' in data:
            card.image_path = data.get('image_path')
        if 'audio_path' in data:
            card.audio_path = data.get('audio_path')
        if 'video_front_path' in data:
            card.video_front_path = data.get('video_front_path')
        if 'video_back_path' in data:
            card.video_back_path = data.get('video_back_path')
            
        card.updated_at = datetime.datetime.now()
        card.history = add_to_history(card.history, "Edited manually")
        card.save()
        return card
    except Exception as e:
        import traceback
        logger.error(f"Error saving card: {e}\n{traceback.format_exc()}")
        return None


def delete_card(card_id: int):
    try:
        TMA_Card.delete().where(TMA_Card.id == card_id).execute()
        TMAProgress.delete().where(TMAProgress.card_id == card_id).execute()
        return True
    except Exception as e:
        logger.error(f"Error deleting card: {e}")
        return False


def get_cards_for_study(deck_id: int, user_id: int):
    """Возвращает список всех карточек в колоде. Оптимизировано: батчинг медиа."""
    try:
        # Используем .dicts() для более быстрой выборки
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck_id).dicts())
        
        # Получаем прогресс только для карт этой колоды одним запросом
        card_ids = [c['id'] for c in cards]
        progress_query = TMAProgress.select().where(
            TMAProgress.user_id == user_id,
            TMAProgress.card_id << card_ids
        )
        progress_map = {p.card_id: p for p in progress_query}
        
        # Предзагрузка: собираем все пути медиа и проверяем существование ОДНИМ запросом
        media_exists = _build_media_exists_map(cards)
        
        result = []
        for c in cards:
            p = progress_map.get(c['id'])
            result.append({
                "id": c['id'],
                "front": c['front_text'],
                "back": c['back_text'],
                "context": c['context'],
                "audio_url": resolve_media_url(c.get('audio_path'), "audio", exists_map=media_exists),
                "image_url": resolve_media_url(c.get('image_path'), "images", exists_map=media_exists),
                "video_front_url": resolve_media_url(c.get('video_front_path'), "videos", exists_map=media_exists),
                "video_back_url": resolve_media_url(c.get('video_back_path'), "videos", exists_map=media_exists),
                "queue": p.queue if p else "new",
                "interval": p.interval if p else 0,
                "next_review": p.next_review.isoformat() if p and p.next_review else None
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_cards_for_study: {e}")
        return []


def get_next_card(user_id: int, deck_id: int, exclude_ids: list = None):
    """Выбирает следующую карту для изучения (SRS). Оптимизировано: JOIN вместо 2 запросов."""
    try:
        now = datetime.datetime.now()
        exclude_ids = exclude_ids or []
        
        # 1. Повторение (Due) — JOIN для получения card+progress за один запрос
        due_query = (TMAProgress
                    .select(TMAProgress, TMA_Card)
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
            # Карта уже загружена через JOIN — используем tma__card
            card = progress.card_id  # peewee вернёт FK как объект через JOIN
            try:
                card = TMA_Card.get_by_id(progress.card_id)
            except Exception:
                pass
            return card, progress
            
        # 2. Новые карты — используем LEFT JOIN для исключения уже отслеживаемых
        new_query = (TMA_Card
                    .select()
                    .join(TMAProgress, on=(
                        (TMAProgress.card_id == TMA_Card.id) & 
                        (TMAProgress.user_id == user_id)
                    ), join_type=JOIN.LEFT_OUTER)
                    .where(
                        TMA_Card.deck_id == deck_id,
                        TMAProgress.id.is_null()  # Нет записи в прогрессе = новая карта
                    ))
        if exclude_ids:
            new_query = new_query.where(~(TMA_Card.id << exclude_ids))
            
        card = new_query.first()
        
        # Fallback удален, чтобы избежать бесконечного цикла
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


