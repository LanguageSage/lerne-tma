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
            "cards_count": counts.get(d.id, 0)
        } for d in decks]
    except Exception as e:
        logger.error(f"Error in get_external_decks: {e}")
        return []

def import_deck(external_deck_id: int, user_id: int):
    """Импортирует колоду и все её карточки из библиотеки для конкретного пользователя через Raw SQL."""
    try:
        logger.info(f"IMPORT START: deck_id={external_deck_id}, user_id={user_id}")
        
        # 1. Берем колоду из библиотеки (проверка существования)
        ext_deck = Deck.get_by_id(external_deck_id)
        
        # 2. Создаем или находим локальную колоду у пользователя
        local_deck, created = TMA_Deck.get_or_create(
            user_id=user_id, 
            name=ext_deck.name,
            defaults={
                'level': getattr(ext_deck, 'level', ''),
                'topic': getattr(ext_deck, 'topic', ''),
                'created_at': datetime.datetime.now()
            }
        )
        
        # 3. Копируем карточки через Raw SQL
        # Используем COALESCE для всех полей, которые могут быть NOT NULL в базе
        sql = f"""
            INSERT INTO tma_card (
                deck_id, front_text, back_text, context, image_path, audio_path, 
                card_type, is_deleted, source, topics, metadata, tags,
                created_at, updated_at
            )
            SELECT 
                {local_deck.id}, front_text, back_text, COALESCE(context, ''), 
                COALESCE(image_path, ''), COALESCE(audio_path, ''), 
                COALESCE(card_type, 'translation'), COALESCE(is_deleted, false),
                COALESCE(source, ''), COALESCE(topics, ''), COALESCE(metadata, ''), COALESCE(tags, ''),
                NOW(), NOW()
            FROM card
            WHERE deck_id = {external_deck_id}
            AND front_text NOT IN (SELECT front_text FROM tma_card WHERE deck_id = {local_deck.id})
        """
        
        logger.info(f"IMPORT SQL EXECUTION for deck {external_deck_id}...")
        tma_db.execute_sql(sql)
        
        logger.info(f"IMPORT SUCCESS: Deck '{local_deck.name}' (Local ID: {local_deck.id}) updated from Library ID {external_deck_id}")
        return local_deck
        
    except Exception as e:
        error_msg = f"CRITICAL ERROR in import_deck (Raw SQL): {e}"
        logger.error(error_msg, exc_info=True)
        # Пробрасываем ошибку выше, чтобы debug эндпоинт её увидел
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

def delete_deck(deck_id: int):
    try:
        # Сначала удаляем карточки и прогресс (каскадно или вручную)
        TMA_Card.delete().where(TMA_Card.deck_id == deck_id).execute()
        TMA_Deck.delete().where(TMA_Deck.id == deck_id).execute()
        return True
    except Exception as e:
        logger.error(f"Error deleting deck: {e}")
        return False

def delete_card(card_id: int):
    try:
        TMA_Card.delete().where(TMA_Card.id == card_id).execute()
        TMAProgress.delete().where(TMAProgress.card_id == card_id).execute()
        return True
    except Exception as e:
        logger.error(f"Error deleting card: {e}")
        return False

def get_community_content(user_id: int):
    """Возвращает колоды пользователей, которые можно 'влить' в библиотеку (для админа)."""
    try:
        # Для простоты возвращаем все колоды, которых нет в Deck
        lib_names = {d.name for d in Deck.select(Deck.name)}
        user_decks = TMA_Deck.select().where(~(TMA_Deck.name << list(lib_names)))
        return [{
            "id": d.id,
            "name": d.name,
            "user_id": d.user_id,
            "cards_count": TMA_Card.select().where(TMA_Card.deck_id == d.id).count()
        } for d in user_decks]
    except Exception as e:
        logger.error(f"Error fetching community content: {e}")
        return []

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
        card_id = data.get('card_id') or data.get('id')
        if card_id:
            card = TMA_Card.get_by_id(card_id)
        else:
            card = TMA_Card()
            
        card.deck_id = data.get('deck_id')
        card.front_text = data.get('front') or data.get('front_text')
        card.back_text = data.get('back') or data.get('back_text')
        card.context = data.get('context')
        card.image_path = data.get('image_path')
        card.audio_path = data.get('audio_path')
        card.save()
        return card
    except Exception as e:
        logger.error(f"Error saving card: {e}")
        return None

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
                    'audio_path': tc.audio_path
                }
            )
        return lib_deck
    except Exception as e:
        logger.error(f"Error promoting deck: {e}")
        return None

def resolve_media_url(path_str: str, media_type: str) -> str | None:
    if not path_str: return None
    if path_str.startswith("http"): return path_str
    # Извлекаем только имя файла
    filename = os.path.basename(path_str)
    return f"/api/media/{media_type}/{filename}"
