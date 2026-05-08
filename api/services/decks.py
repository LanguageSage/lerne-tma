import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

from .utils import merge_tags, add_to_history

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
        
        with tma_db.atomic():
            for name in STARTER_DECK_NAMES:
                if name not in existing_names:
                    lib_deck = Deck.get_or_none(Deck.name == name)
                    if lib_deck:
                        import_deck(lib_deck.id, user_id)
        return True
    except Exception as e:
        logger.error(f"Error in ensure_starter_decks: {e}")
        return False


def create_deck(name: str, user_id: int):
    """Создает новую пользовательскую колоду."""
    try:
        deck = TMA_Deck.create(
            user_id=user_id,
            name=name,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        return deck
    except Exception as e:
        logger.error(f"Error in create_deck: {e}")
        raise e


def get_active_decks(user_id: int):
    """Возвращает список колод со статистикой. Оптимизировано: 2 запроса вместо 5."""
    try:
        now = datetime.datetime.now()
        decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id).order_by(TMA_Deck.id.desc()))
        
        if not decks:
            ensure_starter_decks(user_id)
            decks = list(TMA_Deck.select().where(TMA_Deck.user_id == user_id).order_by(TMA_Deck.id.desc()))

        if not decks:
            return []

        deck_ids = [d.id for d in decks]
        deck_names = [d.name for d in decks]

        # --- ОДИН запрос для total, tracked и due (вместо 3 отдельных) ---
        stats_sql = """
            SELECT 
                c.deck_id,
                COUNT(c.id) AS total,
                COUNT(p.id) AS tracked,
                COUNT(CASE WHEN p.next_review <= %s THEN 1 END) AS due
            FROM tma_card c
            LEFT JOIN tmaprogress p ON p.card_id = c.id AND p.user_id = %s
            WHERE c.deck_id IN ({})
            GROUP BY c.deck_id
        """.format(','.join(['%s'] * len(deck_ids)))
        
        cursor = tma_db.execute_sql(stats_sql, [now, user_id] + deck_ids)
        stats_map = {}
        for row in cursor.fetchall():
            stats_map[row[0]] = {'total': row[1], 'tracked': row[2], 'due': row[3]}

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
            s = stats_map.get(d.id, {'total': 0, 'tracked': 0, 'due': 0})
            total = s['total']
            tracked = s['tracked']
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

            result.append({
                "id": d.id,
                "name": d.name,
                "level": getattr(d, 'level', ''),
                "topic": getattr(d, 'topic', ''),
                "has_updates": has_updates,
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
                        'created_at': datetime.datetime.now()
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


def delete_deck(deck_id: int):
    try:
        # Сначала удаляем карточки и прогресс (каскадно или вручную)
        TMA_Card.delete().where(TMA_Card.deck_id == deck_id).execute()
        TMA_Deck.delete().where(TMA_Deck.id == deck_id).execute()
        return True
    except Exception as e:
        logger.error(f"Error deleting deck: {e}")
        return False


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
        logger.error(f"Error resetting progress: {e}")
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


