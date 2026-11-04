"""Import and refresh TMA decks from the shared library.

Keep the existing import entry points in decks.py as compatibility re-exports.
"""
import datetime
import json
import logging

from fastapi import HTTPException

from ..models import TMA_Deck, TMA_Card, TMAProgress, Deck, Card, tma_db
from .utils import merge_tags, add_to_history

# Preserve the logging category used by the original service.
logger = logging.getLogger('api.services.decks')


def import_deck(external_deck_id: int, user_id: int, mode: str = 'merge', local_deck_id: int = None, force_trash: bool = False):
    """Импортирует колоду из библиотеки. Поддерживает режимы: merge, replace, copy.
    Если колода уже находится в корзине и force_trash=False, возвращает {'status': 'in_trash', ...}."""
    try:
        return _import_deck(external_deck_id, user_id, mode, local_deck_id, force_trash)
    except HTTPException:
        raise
    except Exception as e:
        error_msg = f"CRITICAL ERROR in import_deck: {e}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg)


def _import_deck(external_deck_id, user_id, mode, local_deck_id, force_trash):
    # Include destination selection, trash purge and metadata in the same
    # transaction as the card writes. Batch imports commit one deck at a time.
    with tma_db.atomic():
        from .collaborative_service import _require_can_mutate
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
                    _require_can_mutate(user_id, 'deck', deleted_deck.id, allow_deleted=True)
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
            _require_can_mutate(user_id, 'deck', local_deck.id, allow_deleted=True)
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

            _require_can_mutate(user_id, 'deck', local_deck.id, allow_deleted=True)
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
            _require_can_mutate(user_id, 'deck', local_deck.id, allow_deleted=True)

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
                for i in range(0, len(new_cards_to_insert), 100):
                    TMA_Card.insert_many(new_cards_to_insert[i:i+100]).execute()

            local_deck.updated_at = datetime.datetime.now()
            _save_source_library_id(local_deck, external_deck_id)
            local_deck.save()
            return local_deck


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
        meta = json.loads(local_deck.metadata or '{}')
        meta['source_library_id'] = external_deck_id
    except (ValueError, TypeError) as e:
        logger.warning(f"Failed to set source_library_id metadata: {e}")
        return
    local_deck.metadata = json.dumps(meta)
    local_deck.save()


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
