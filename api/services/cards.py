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
    logger.info(f"Saving card for user {user_id}. Data: {data}")
    
    raw_card_id = data.get('card_id') or data.get('id')
    card_id = int(raw_card_id) if raw_card_id else None
    
    if card_id:
        try:
            card = TMA_Card.get_by_id(card_id)
        except TMA_Card.DoesNotExist:
            logger.warning(f"Card {card_id} not found, creating new.")
            card = TMA_Card()
    else:
        card = TMA_Card()
        
    raw_deck_id = data.get('deck_id')
    try:
        deck_id = int(raw_deck_id) if (raw_deck_id and raw_deck_id != 'duplicates') else None
    except (ValueError, TypeError):
        deck_id = None
    
    if deck_id:
        card.deck_id = deck_id
    elif not card.id:
        raise ValueError("Missing deck_id for new card")
    
    # Обновляем только если передано (используем get с проверкой наличия ключа, чтобы позволить пустые строки)
    if 'front' in data or 'front_text' in data:
        card.front_text = data.get('front') if 'front' in data else data.get('front_text')
        
    if 'back' in data or 'back_text' in data:
        card.back_text = data.get('back') if 'back' in data else data.get('back_text')
        
    if 'context' in data:
        card.context = data.get('context')
    if 'image_path' in data:
        card.image_path = data.get('image_path')
    if 'audio_path' in data:
        card.audio_path = data.get('audio_path')
    if 'audio_back_path' in data:
        card.audio_back_path = data.get('audio_back_path')
    if 'video_front_path' in data:
        card.video_front_path = data.get('video_front_path')
    if 'video_back_path' in data:
        card.video_back_path = data.get('video_back_path')
        
    if 'source' in data:
        card.source = data.get('source')
    if 'video_back_path' in data:
        card.video_back_path = data.get('video_back_path')
        
    if 'source' in data:
        card.source = data.get('source')
    elif not card.source:
        card.source = 'user'
        
    if 'want_to_learn' in data:
        card.want_to_learn = bool(data.get('want_to_learn'))

    # Проверяем, не перепутаны ли стороны (если на лицевой кириллица, меняем местами)
    import re
    if card.front_text and re.search(r'[а-яА-ЯёЁ]', card.front_text):
        logger.info("Swapping front and back for saved card because front contains Cyrillic.")
        front = card.front_text
        back = card.back_text
        card.front_text = back
        card.back_text = front
        card.audio_path = None

    # Гарантируем, что обязательные поля не None
    if card.front_text is None: card.front_text = ""
    if card.back_text is None: card.back_text = ""
    if card.context is None: card.context = ""
    if card.source is None: card.source = "user"
        
    card.updated_at = datetime.datetime.now()
    if not data.get('silent'):
        card.history = add_to_history(card.history, "Edited manually")
    
    card.save()
    logger.info(f"Card {card.id} saved successfully")
    return card


def delete_card(card_id: int, user_id: int):
    try:
        # Мягкое удаление: помечаем карточку как is_deleted = True
        card = TMA_Card.get_or_none(TMA_Card.id == card_id)
        if not card:
            return False
            
        if card.deck and card.deck.user_id != user_id:
            return False
            
        card.is_deleted = True
        card.updated_at = datetime.datetime.now()
        card.save()
        return True
    except Exception as e:
        logger.error(f"Error deleting card: {e}", exc_info=True)
        raise e


def toggle_want_to_learn(card_id: int, user_id: int):
    try:
        card = TMA_Card.get_by_id(card_id)
        card.want_to_learn = not card.want_to_learn
        card.save()
        return card
    except Exception as e:
        logger.error(f"Error toggling want_to_learn: {e}", exc_info=True)
        raise e


def _build_card_dict(c, p=None, media_exists=None, include_intervals=False, creator=None):
    is_dict = isinstance(c, dict)
    get_val = lambda k_dict, k_obj: c.get(k_dict) if is_dict else getattr(c, k_obj, None)
    
    audio_path = get_val('audio_path', 'audio_path')
    audio_back_path = get_val('audio_back_path', 'audio_back_path')
    image_path = get_val('image_path', 'image_path')
    video_front = get_val('video_front_path', 'video_front_path')
    video_back = get_val('video_back_path', 'video_back_path')

    creator_name = None
    creator_avatar = None
    if creator:
        creator_name = creator.username or creator.first_name
        creator_avatar = creator.photo_url

    result = {
        "id": get_val('id', 'id'),
        "deck_id": get_val('deck_id', 'deck_id'),
        "front": get_val('front_text', 'front_text'),
        "back": get_val('back_text', 'back_text'),
        "context": get_val('context', 'context'),
        "audio_url": resolve_media_url(audio_path, "audio", exists_map=media_exists),
        "audio_back_url": resolve_media_url(audio_back_path, "audio", exists_map=media_exists),
        "image_url": resolve_media_url(image_path, "images", exists_map=media_exists),
        "video_front_url": resolve_media_url(video_front, "videos", exists_map=media_exists),
        "video_back_url": resolve_media_url(video_back, "videos", exists_map=media_exists),
        "image_path": audio_path if False else image_path, # keep variables used
        "audio_path": audio_path,
        "audio_back_path": audio_back_path,
        "video_front_path": video_front,
        "video_back_path": video_back,
        "want_to_learn": bool(get_val('want_to_learn', 'want_to_learn')),
        "creator_name": creator_name,
        "creator_avatar": creator_avatar
    }

    if include_intervals:
        result["intervals"] = srs.get_next_intervals(p) if p else []
    else:
        result["queue"] = getattr(p, 'queue', 'new') if p else "new"
        result["interval"] = getattr(p, 'interval', 0) if p else 0
        
        nr = getattr(p, 'next_review', None) if p else None
        result["next_review"] = nr.isoformat() if nr else None
        
    return result


def get_cards_for_study(deck_id: int, user_id: int):
    """Возвращает список всех карточек в колоде. Оптимизировано: батчинг медиа."""
    try:
        # Используем .dicts() для более быстрой выборки
        cards = list(TMA_Card.select().where(TMA_Card.deck_id == deck_id, TMA_Card.is_deleted == False).order_by(TMA_Card.id.asc()).dicts())
        
        if not cards:
            return []

        # Получаем прогресс через JOIN с TMA_Card по deck_id, избегая передачи тысяч параметров
        progress_query = (TMAProgress.select()
                          .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                          .where(TMAProgress.user_id == user_id, TMA_Card.deck_id == deck_id))
        progress_map = {p.card_id: p for p in progress_query}
        
        # Предзагрузка: собираем все пути медиа и проверяем существование ОДНИМ запросом
        media_exists = _build_media_exists_map(cards)
        
        creator_ids = list(set([c.get('creator_id') for c in cards if c.get('creator_id')]))
        creators = {}
        if creator_ids:
            from ..models import TMAUser
            for u in TMAUser.select().where(TMAUser.user_id << creator_ids):
                creators[u.user_id] = u
        
        result = []
        for c in cards:
            p = progress_map.get(c['id'])
            creator = creators.get(c.get('creator_id'))
            result.append(_build_card_dict(c, p=p, media_exists=media_exists, creator=creator))
        return result
    except Exception as e:
        logger.error(f"Error in get_cards_for_study: {e}", exc_info=True)
        raise e


def get_next_card(user_id: int, deck_id: int, exclude_ids: list = None, learn_more: bool = False):
    """Выбирает следующую карту для изучения (SRS). Оптимизировано: JOIN вместо 2 запросов."""
    try:
        now = datetime.datetime.now()
        exclude_ids = exclude_ids or []
        
        # Функция для поиска новой карты
        def get_new_card():
            subquery = TMAProgress.select(TMAProgress.card_id).where(
                TMAProgress.card_id == TMA_Card.id,
                TMAProgress.user_id == user_id
            )
            new_query = (TMA_Card.select()
                         .where(
                             TMA_Card.deck_id == deck_id,
                             TMA_Card.is_deleted == False,
                             ~fn.EXISTS(subquery)
                         ))
            if exclude_ids:
                new_query = new_query.where(~(TMA_Card.id << exclude_ids))
            return new_query.first()

        # Функция для поиска карты на повторение (или раннее повторение при learn_more)
        def get_due_card():
            due_query = (TMAProgress
                        .select(TMAProgress, TMA_Card)
                        .join(TMA_Card, on=(TMAProgress.card_id == TMA_Card.id))
                        .where(
                            TMAProgress.user_id == user_id,
                            TMA_Card.deck_id == deck_id,
                            TMA_Card.is_deleted == False
                        ))
            if not learn_more:
                due_query = due_query.where(TMAProgress.next_review <= now)
                
            if exclude_ids:
                due_query = due_query.where(~(TMAProgress.card_id << exclude_ids))
            
            p = due_query.order_by(TMAProgress.queue.asc(), TMAProgress.next_review.asc()).first()
            if p:
                c = getattr(p, 'tma_card', None) or getattr(p, 'card', None)
                if not c:
                    c = TMA_Card.get_by_id(p.card_id)
                return c, p
            return None, None

        # Если включен режим learn_more, новые карты приоритетнее,
        # так как повторять старые раньше времени нужно только когда нет новых.
        if learn_more:
            card = get_new_card()
            if card:
                progress, _ = TMAProgress.get_or_create(
                    card_id=card.id,
                    user_id=user_id,
                    defaults={"queue": "new", "next_review": now}
                )
                return card, progress
            
            return get_due_card()
        else:
            card, progress = get_due_card()
            if card:
                return card, progress
                
            card = get_new_card()
            if card:
                progress, _ = TMAProgress.get_or_create(
                    card_id=card.id,
                    user_id=user_id,
                    defaults={"queue": "new", "next_review": now}
                )
                return card, progress
                
            return None, None
            
    except Exception as e:
        logger.error(f"Error in get_next_card: {e}")
        return {"error": str(e)}, None


def format_card_for_study(card: TMA_Card, user_id: int):
    """Форматирует карту для StudyView (с URL и интервалами)."""
    progress = TMAProgress.get_or_none(
        TMAProgress.card_id == card.id,
        TMAProgress.user_id == user_id
    )
    
    return _build_card_dict(card, p=progress, include_intervals=True)


def get_favorite_cards(user_id: int):
    """Возвращает карточки с want_to_learn = True у пользователя."""
    try:
        cards = list(TMA_Card
                     .select()
                     .join(TMA_Deck)
                     .where(TMA_Deck.user_id == user_id, TMA_Card.want_to_learn == True, TMA_Card.is_deleted == False)
                     .dicts())
        
        if not cards:
            return []
            
        media_exists = _build_media_exists_map(cards)
        
        result = []
        for c in cards:
            result.append(_build_card_dict(c, media_exists=media_exists))
        return result
    except Exception as e:
        logger.error(f"Error in get_favorite_cards: {e}", exc_info=True)
        raise e



def get_duplicate_cards(user_id: int):
    """Находит карточки с одинаковым front_text у пользователя."""
    try:
        # 1. Находим тексты, которые встречаются больше одного раза
        duplicate_texts_query = (TMA_Card
                                .select(TMA_Card.front_text)
                                .join(TMA_Deck)
                                .where(TMA_Deck.user_id == user_id, TMA_Card.is_deleted == False)
                                .group_by(TMA_Card.front_text)
                                .having(fn.COUNT(TMA_Card.id) > 1))
        
        text_list = [c.front_text for c in duplicate_texts_query]
        if not text_list:
            return []
            
        # 2. Получаем все карточки с этими текстами
        all_duplicates = (TMA_Card
                         .select(TMA_Card, TMA_Deck)
                         .join(TMA_Deck)
                         .where(TMA_Deck.user_id == user_id, TMA_Card.front_text << text_list, TMA_Card.is_deleted == False)
                         .order_by(TMA_Card.front_text))
        
        result = []
        for c in all_duplicates:
            result.append({
                "id": c.id,
                "front": c.front_text,
                "back": c.back_text,
                "context": c.context,
                "image_path": c.image_path,
                "audio_path": c.audio_path,
                "audio_back_path": c.audio_back_path,
                "video_front_path": c.video_front_path,
                "video_back_path": c.video_back_path,
                "want_to_learn": bool(c.want_to_learn),
                "deck_id": c.deck_id,
                "deck_name": c.deck.name if c.deck else "Без колоды"
            })
        return result
    except Exception as e:
        logger.error(f"Error in get_duplicate_cards: {e}", exc_info=True)
        raise e


def get_next_duplicate_card(user_id: int, exclude_ids: list = None):
    """Выбирает следующую карточку-дубликат для изучения."""
    try:
        exclude_ids = exclude_ids or []
        
        # 1. Находим тексты дубликатов
        duplicate_texts_query = (TMA_Card
                                .select(TMA_Card.front_text)
                                .join(TMA_Deck)
                                .where(TMA_Deck.user_id == user_id, TMA_Card.is_deleted == False)
                                .group_by(TMA_Card.front_text)
                                .having(fn.COUNT(TMA_Card.id) > 1))
        
        text_list = [c.front_text for c in duplicate_texts_query]
        if not text_list:
            return None, None
            
        # 2. Получаем карточку из этого списка, которой нет в exclude_ids
        query = (TMA_Card
                .select(TMA_Card, TMA_Deck)
                .join(TMA_Deck)
                .where(
                    TMA_Deck.user_id == user_id, 
                    TMA_Card.front_text << text_list, 
                    TMA_Card.is_deleted == False
                ))
        
        if exclude_ids:
            query = query.where(~(TMA_Card.id << exclude_ids))
            
        card = query.first()
        if not card:
            return None, None
            
        progress, _ = TMAProgress.get_or_create(
            card_id=card.id,
            user_id=user_id,
            defaults={"queue": "new", "next_review": datetime.datetime.now()}
        )
        return card, progress
    except Exception as e:
        logger.error(f"Error in get_next_duplicate_card: {e}", exc_info=True)
        raise e
