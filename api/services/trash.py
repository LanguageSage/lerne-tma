import logging
import datetime
from ..models import TMA_Deck, TMA_Card, TMAProgress, tma_db
from peewee import fn

logger = logging.getLogger(__name__)

def get_trash_items(user_id: int):
    """Возвращает список удаленных колод и карточек."""
    try:
        # 1. Удаленные колоды
        deleted_decks = list(TMA_Deck.select().where(
            (TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == True)
        ).order_by(TMA_Deck.id.desc()))

        # Подсчет карточек в удаленных колодах
        deck_ids = [d.id for d in deleted_decks]
        deck_counts = {}
        if deck_ids:
            counts_query = TMA_Card.select(TMA_Card.deck_id, fn.COUNT(TMA_Card.id).alias('count')).where(
                TMA_Card.deck_id << deck_ids
            ).group_by(TMA_Card.deck_id)
            deck_counts = {c.deck_id: c.count for c in counts_query}

        decks_data = [{
            "id": d.id,
            "name": d.name,
            "level": getattr(d, 'level', ''),
            "topic": getattr(d, 'topic', ''),
            "updated_at": d.updated_at.isoformat() if d.updated_at else getattr(d, 'created_at', datetime.datetime.now()).isoformat(),
            "cards_count": deck_counts.get(d.id, 0)
        } for d in deleted_decks]

        # 2. Удаленные карточки (где is_deleted=True, но колода может быть активной или удаленной)
        deleted_cards_query = (TMA_Card
                               .select(TMA_Card, TMA_Deck)
                               .join(TMA_Deck, on=(TMA_Card.deck_id == TMA_Deck.id))
                               .where((TMA_Deck.user_id == user_id) & (TMA_Card.is_deleted == True))
                               .order_by(TMA_Card.updated_at.desc()))

        cards_data = [{
            "id": c.id,
            "front": c.front_text,
            "back": c.back_text,
            "context": c.context,
            "deck_id": c.deck_id,
            "deck_name": c.deck.name if c.deck else "Без колоды",
            "updated_at": c.updated_at.isoformat() if c.updated_at else datetime.datetime.now().isoformat()
        } for c in deleted_cards_query]

        return {
            "decks": decks_data,
            "cards": cards_data
        }
    except Exception as e:
        logger.error(f"Error in get_trash_items: {e}")
        return {"decks": [], "cards": []}

def restore_deck(deck_id: int, user_id: int):
    """Восстанавливает колоду и все её карточки."""
    try:
        deck = TMA_Deck.get_or_none((TMA_Deck.id == deck_id) & (TMA_Deck.user_id == user_id))
        if not deck:
            return False

        now = datetime.datetime.now()
        with tma_db.atomic():
            deck.is_deleted = False
            deck.updated_at = now
            deck.save()

            TMA_Card.update(is_deleted=False, updated_at=now).where(TMA_Card.deck_id == deck.id).execute()

        logger.info(f"Restored deck {deck.id} for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Error restoring deck: {e}")
        return False

def restore_card(card_id: int, user_id: int):
    """Восстанавливает отдельную карточку."""
    try:
        card = (TMA_Card
                .select(TMA_Card, TMA_Deck)
                .join(TMA_Deck, on=(TMA_Card.deck_id == TMA_Deck.id))
                .where((TMA_Card.id == card_id) & (TMA_Deck.user_id == user_id))
                .first())
        if not card:
            return False

        now = datetime.datetime.now()
        with tma_db.atomic():
            card.is_deleted = False
            card.updated_at = now
            card.save()

            # Если колода карточки тоже была удалена, восстанавливаем и колоду
            if card.deck and card.deck.is_deleted:
                card.deck.is_deleted = False
                card.deck.updated_at = now
                card.deck.save()

        logger.info(f"Restored card {card.id} for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Error restoring card: {e}")
        return False

def clear_trash(user_id: int):
    """Окончательно удаляет все элементы в корзине (HARD DELETE)."""
    try:
        # Находим удаленные карточки
        deleted_cards = list(TMA_Card.select(TMA_Card.id).join(TMA_Deck).where(
            (TMA_Deck.user_id == user_id) & (TMA_Card.is_deleted == True)
        ))
        card_ids = [c.id for c in deleted_cards]

        # Находим удаленные колоды
        deleted_decks = list(TMA_Deck.select(TMA_Deck.id).where(
            (TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == True)
        ))
        deck_ids = [d.id for d in deleted_decks]

        with tma_db.atomic():
            # Удаляем прогресс и карточки
            if card_ids:
                TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                TMA_Card.delete().where(TMA_Card.id << card_ids).execute()

            # Удаляем карточки удаленных колод (если какие-то остались)
            if deck_ids:
                remaining_cards = list(TMA_Card.select(TMA_Card.id).where(TMA_Card.deck_id << deck_ids))
                rem_card_ids = [c.id for c in remaining_cards]
                if rem_card_ids:
                    TMAProgress.delete().where(TMAProgress.card_id << rem_card_ids).execute()
                    TMA_Card.delete().where(TMA_Card.id << rem_card_ids).execute()

                # Удаляем сами колоды
                TMA_Deck.delete().where(TMA_Deck.id << deck_ids).execute()

        logger.info(f"Cleared trash for user {user_id}: {len(card_ids)} cards, {len(deck_ids)} decks removed.")
        return True
    except Exception as e:
        logger.error(f"Error clearing trash: {e}")
        return False
