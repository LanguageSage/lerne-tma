import logging
import datetime
from ..models import (
    TMA_Folder, TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory,
    TMACardNote, TMACardRating, TMACardKnowledgeItem, TMA_Collaborator, tma_db,
)
from peewee import fn
from fastapi import HTTPException
from .collaborative_service import _require_can_mutate, is_folder_chain_active, is_deck_active
from .structured_card_api import lifecycle_state

logger = logging.getLogger(__name__)


def _collect_subtree_ids(root_ids: list[int], children_by_parent: dict[int, list], *, active_only: bool = False) -> list[int]:
    """Collect root_ids and descendant folder IDs using a prebuilt adjacency map."""
    if not root_ids:
        return []
    collected = []
    seen = set(root_ids) if active_only else set()
    stack = list(root_ids)
    if active_only:
        collected.extend(root_ids)
    while stack:
        fid = stack.pop()
        if not active_only:
            if fid in seen:
                continue
            seen.add(fid)
            collected.append(fid)
        for child in children_by_parent.get(fid, ()):
            if child.id in seen or (active_only and child.is_deleted):
                continue
            if active_only:
                seen.add(child.id)
                collected.append(child.id)
            stack.append(child.id)
    return collected


def get_trash_items(user_id: int):
    """Возвращает список удаленных папок, колод и карточек."""
    try:
        user_folders = list(TMA_Folder.select().where(TMA_Folder.user_id == user_id).order_by(TMA_Folder.id.desc()))
        children_by_parent = {}
        for folder in user_folders:
            children_by_parent.setdefault(folder.parent_id, []).append(folder)

        deleted_folders = [f for f in user_folders if f.is_deleted]
        user_active_decks = list(TMA_Deck.select(TMA_Deck.id, TMA_Deck.folder_id).where(
            (TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == False)
        ))
        active_decks_by_folder = {}
        for deck in user_active_decks:
            active_decks_by_folder.setdefault(deck.folder_id, []).append(deck.id)

        active_deck_card_counts = {}
        if user_active_decks:
            all_active_deck_ids = [d.id for d in user_active_decks]
            for row in (TMA_Card.select(TMA_Card.deck_id, fn.COUNT(TMA_Card.id).alias('count'))
                        .where((TMA_Card.deck_id << all_active_deck_ids) & (TMA_Card.is_deleted == False))
                        .group_by(TMA_Card.deck_id)):
                active_deck_card_counts[row.deck_id] = row.count

        folders_data = []
        for f in deleted_folders:
            subtree_ids = _collect_subtree_ids([f.id], children_by_parent, active_only=True)
            subtree_deck_ids = [did for fid in subtree_ids for did in active_decks_by_folder.get(fid, ())]
            folders_data.append({
                "id": f.id,
                "name": f.name,
                "color": f.color,
                "target_language": getattr(f, 'target_language', 'de') or 'de',
                "parent_id": getattr(f, 'parent_id', None),
                "parent_deleted": f.parent_id is not None and not is_folder_chain_active(f.parent_id),
                "updated_at": f.updated_at.isoformat() if f.updated_at else getattr(f, 'created_at', datetime.datetime.now()).isoformat(),
                "decks_count": len(subtree_deck_ids),
                "cards_count": sum(active_deck_card_counts.get(did, 0) for did in subtree_deck_ids),
            })

        # 1. Удаленные колоды
        deleted_decks = list(TMA_Deck.select().where(
            (TMA_Deck.user_id == user_id) & (TMA_Deck.is_deleted == True)
        ).order_by(TMA_Deck.id.desc()))

        # Подсчет только не удаленных отдельно карточек в удаленных колодах
        deck_ids = [d.id for d in deleted_decks]
        deck_counts = {}
        if deck_ids:
            counts_query = TMA_Card.select(TMA_Card.deck_id, fn.COUNT(TMA_Card.id).alias('count')).where(
                (TMA_Card.deck_id << deck_ids) & (TMA_Card.is_deleted == False)
            ).group_by(TMA_Card.deck_id)
            deck_counts = {c.deck_id: c.count for c in counts_query}

        decks_data = [{
            "id": d.id,
            "name": d.name,
            "level": getattr(d, 'level', ''),
            "topic": getattr(d, 'topic', ''),
            "folder_id": getattr(d, 'folder_id', None),
            "parent_deleted": d.folder_id is not None and not is_folder_chain_active(d.folder_id),
            "updated_at": d.updated_at.isoformat() if d.updated_at else getattr(d, 'created_at', datetime.datetime.now()).isoformat(),
            "cards_count": deck_counts.get(d.id, 0)
        } for d in deleted_decks]

        # 2. Индивидуально удаленные карточки (где is_deleted=True)
        deleted_cards_query = (TMA_Card
                               .select(TMA_Card, TMA_Deck)
                               .join(TMA_Deck, on=(TMA_Card.deck_id == TMA_Deck.id))
                               .where((TMA_Deck.user_id == user_id) & (TMA_Card.is_deleted == True) & TMA_Card.content_v2.is_null(False))
                               .order_by(TMA_Card.updated_at.desc()))

        cards_data = [{
            "id": c.id,
            "deck_id": c.deck_id,
            "deck_name": c.deck.name if c.deck else "Без колоды",
            "deck_deleted": not is_deck_active(c.deck),
            "updated_at": c.updated_at.isoformat() if c.updated_at else datetime.datetime.now().isoformat(),
            **lifecycle_state(c),
        } for c in deleted_cards_query]

        return {
            "folders": folders_data,
            "decks": decks_data,
            "cards": cards_data
        }
    except Exception as e:
        logger.error(f"Error in get_trash_items: {e}", exc_info=True)
        raise e


def _restore_container(model, target_type: str, item_id: int, user_id: int, label: str):
    """Restores a deleted folder or deck iff its parent folder chain is active."""
    try:
        with tma_db.atomic():
            query = model.select().where((model.id == item_id) & (model.user_id == user_id))
            if tma_db.for_update:
                query = query.for_update()
            item = query.first()
            if not item:
                return False

            _require_can_mutate(user_id, target_type, item.id, allow_deleted=True)

            if target_type == 'deck' and TMA_Card.select().where(
                TMA_Card.deck_id == item.id, TMA_Card.content_v2.is_null(True)
            ).exists():
                raise HTTPException(409, {'code': 'deck_requires_migration'})

            parent_id = item.parent_id if target_type == 'folder' else item.folder_id
            if parent_id is not None:
                if not TMA_Folder.get_or_none(TMA_Folder.id == parent_id):
                    raise HTTPException(409, {
                        'code': 'parent_folder_missing',
                        'message': f'Нельзя восстановить {label}: родительская папка отсутствует.',
                    })
                if not is_folder_chain_active(parent_id):
                    raise HTTPException(409, {
                        'code': 'parent_folder_deleted',
                        'message': 'Сначала восстановите родительскую папку.',
                    })

            if not item.is_deleted:
                return True

            item.is_deleted = False
            item.updated_at = datetime.datetime.now()
            item.save(only=[model.is_deleted, model.updated_at])

        logger.info(f"Restored {target_type} {item.id} for user {user_id}")
        return True
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring {target_type}: {e}", exc_info=True)
        raise e


def restore_folder(folder_id: int, user_id: int):
    """Восстанавливает папку из корзины без перезаписи состояний потомков."""
    return _restore_container(TMA_Folder, 'folder', folder_id, user_id, 'папку')


def restore_deck(deck_id: int, user_id: int):
    """Восстанавливает колоду без восстановления индивидуально удалённых карточек."""
    return _restore_container(TMA_Deck, 'deck', deck_id, user_id, 'колоду')


def clear_trash(user_id: int):
    """Окончательно удаляет все элементы в корзине (HARD DELETE), не удаляя медиафайлы."""
    try:
        user_folders = list(TMA_Folder.select(
            TMA_Folder.id, TMA_Folder.parent_id, TMA_Folder.is_deleted
        ).where(TMA_Folder.user_id == user_id))
        children_by_parent = {}
        for folder in user_folders:
            children_by_parent.setdefault(folder.parent_id, []).append(folder)
        root_deleted_folders = [f for f in user_folders if f.is_deleted]
        for folder in root_deleted_folders:
            _require_can_mutate(user_id, 'folder', folder.id, allow_deleted=True)

        all_deleted_folder_ids = _collect_subtree_ids(
            [f.id for f in root_deleted_folders], children_by_parent
        )

        # Check directly deleted decks and decks with individually deleted cards.
        affected_decks = TMA_Deck.select().where(
            (TMA_Deck.user_id == user_id) & (
                (TMA_Deck.is_deleted == True) |
                TMA_Deck.id.in_(TMA_Card.select(TMA_Card.deck_id).where(TMA_Card.is_deleted == True))
            )
        )
        for deck in affected_decks:
            if deck.folder_id not in all_deleted_folder_ids:
                _require_can_mutate(user_id, 'deck', deck.id, allow_deleted=True)

        deleted_decks_query = TMA_Deck.select(TMA_Deck.id).where(
            (TMA_Deck.user_id == user_id) & (
                (TMA_Deck.is_deleted == True) |
                ((TMA_Deck.folder_id << all_deleted_folder_ids) if all_deleted_folder_ids else False)
            )
        )
        deck_ids = [d.id for d in deleted_decks_query]

        # Individually deleted cards in user's active decks + all cards inside deleted decks/folders.
        user_deck_ids = [d.id for d in TMA_Deck.select(TMA_Deck.id).where(TMA_Deck.user_id == user_id)]
        card_ids = []
        if user_deck_ids:
            card_ids = [c.id for c in TMA_Card.select(TMA_Card.id).where(
                (TMA_Card.deck_id << user_deck_ids) & (
                    (TMA_Card.is_deleted == True) |
                    ((TMA_Card.deck_id << deck_ids) if deck_ids else False)
                )
            )]

        with tma_db.atomic():
            if card_ids:
                TMAProgress.delete().where(TMAProgress.card_id << card_ids).execute()
                if TMAReviewHistory.table_exists():
                    TMAReviewHistory.delete().where(TMAReviewHistory.card_id << card_ids).execute()
                if TMACardNote.table_exists():
                    TMACardNote.delete().where(TMACardNote.card_id << card_ids).execute()
                if TMACardRating.table_exists():
                    TMACardRating.delete().where(TMACardRating.card_id << card_ids).execute()
                if TMACardKnowledgeItem.table_exists():
                    TMACardKnowledgeItem.delete().where(TMACardKnowledgeItem.card_id << card_ids).execute()
                TMA_Card.delete().where(TMA_Card.id << card_ids).execute()

            if deck_ids:
                if TMA_Collaborator.table_exists():
                    TMA_Collaborator.delete().where(
                        (TMA_Collaborator.target_type == 'deck') & (TMA_Collaborator.target_id << deck_ids)
                    ).execute()
                TMA_Deck.delete().where(TMA_Deck.id << deck_ids).execute()

            if all_deleted_folder_ids:
                if TMA_Collaborator.table_exists():
                    TMA_Collaborator.delete().where(
                        (TMA_Collaborator.target_type == 'folder') & (TMA_Collaborator.target_id << all_deleted_folder_ids)
                    ).execute()
                TMA_Folder.update(parent=None).where(TMA_Folder.id << all_deleted_folder_ids).execute()
                TMA_Folder.delete().where(TMA_Folder.id << all_deleted_folder_ids).execute()

        logger.info(
            f"Cleared trash for user {user_id}: {len(card_ids)} cards, "
            f"{len(deck_ids)} decks, {len(all_deleted_folder_ids)} folders removed."
        )
        return True
    except Exception as e:
        logger.error(f"Error clearing trash: {e}", exc_info=True)
        raise e
