import logging
import datetime
from typing import Optional, List, Dict, Any

from api import models

logger = logging.getLogger(__name__)


def get_effective_user_role(user_id: int, target_type: str, target_id: int) -> Optional[str]:
    """
    Determines effective permission role ('owner', 'editor', 'viewer', or None)
    for a given user on a deck or folder, honoring direct overrides and parent folder cascades.
    """
    if target_type == 'deck':
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if not deck or deck.is_deleted:
            return None
        
        # 1. Direct owner check
        if deck.user_id == user_id:
            return 'owner'
        
        # 2. Direct deck collaborator override check
        direct_collab = models.TMA_Collaborator.get_or_none(
            (models.TMA_Collaborator.target_type == 'deck') &
            (models.TMA_Collaborator.target_id == target_id) &
            (models.TMA_Collaborator.user_id == user_id)
        )
        if direct_collab:
            return direct_collab.role
        
        # 3. Cascade check up folder hierarchy if deck belongs to a folder
        if deck.folder_id:
            return get_effective_user_role(user_id, 'folder', deck.folder_id)
        
        return None

    elif target_type == 'folder':
        folder = models.TMA_Folder.get_or_none(models.TMA_Folder.id == target_id)
        if not folder or folder.is_deleted:
            return None
        
        # 1. Direct owner check
        if folder.user_id == user_id:
            return 'owner'
        
        # 2. Direct folder collaborator check
        direct_collab = models.TMA_Collaborator.get_or_none(
            (models.TMA_Collaborator.target_type == 'folder') &
            (models.TMA_Collaborator.target_id == target_id) &
            (models.TMA_Collaborator.user_id == user_id)
        )
        if direct_collab:
            return direct_collab.role
        
        # 3. Recursive parent folder check
        if folder.parent_id:
            return get_effective_user_role(user_id, 'folder', folder.parent_id)
        
        return None

    return None


def get_collaborators(target_type: str, target_id: int) -> List[Dict[str, Any]]:
    """Returns all collaborators and owner for a given folder or deck."""
    collaborators = []
    
    # Get owner info
    owner_id = None
    if target_type == 'deck':
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if deck:
            owner_id = deck.user_id
    elif target_type == 'folder':
        folder = models.TMA_Folder.get_or_none(models.TMA_Folder.id == target_id)
        if folder:
            owner_id = folder.user_id
            
    if owner_id:
        owner_user = models.TMAUser.get_or_none(models.TMAUser.user_id == owner_id)
        collaborators.append({
            "user_id": owner_id,
            "username": owner_user.username if owner_user else None,
            "first_name": owner_user.first_name if owner_user else "Owner",
            "photo_url": owner_user.photo_url if owner_user else None,
            "role": "owner",
            "is_owner": True
        })

    # Get added collaborators
    rows = models.TMA_Collaborator.select().where(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id)
    )
    
    for r in rows:
        if r.user_id == owner_id:
            continue
        u = models.TMAUser.get_or_none(models.TMAUser.user_id == r.user_id)
        collaborators.append({
            "id": r.id,
            "user_id": r.user_id,
            "username": u.username if u else None,
            "first_name": u.first_name if u else f"User #{r.user_id}",
            "photo_url": u.photo_url if u else None,
            "role": r.role,
            "is_owner": False,
            "created_at": r.created_at.isoformat() if r.created_at else None
        })

    return collaborators


def add_collaborator(target_type: str, target_id: int, user_id_to_add: int, role: str, added_by: int) -> dict:
    """Adds or updates a collaborator for a folder or deck."""
    requester_role = get_effective_user_role(added_by, target_type, target_id)
    if requester_role not in ['owner', 'editor']:
        raise Exception("Access denied: Only owner or editor can add collaborators")

    if role not in ['editor', 'viewer']:
        role = 'editor'

    collab, created = models.TMA_Collaborator.get_or_create(
        target_type=target_type,
        target_id=target_id,
        user_id=user_id_to_add,
        defaults={
            "role": role,
            "added_by": added_by
        }
    )
    if not created:
        collab.role = role
        collab.added_by = added_by
        collab.save()

    return {"status": "ok", "user_id": user_id_to_add, "role": role}


def remove_collaborator(target_type: str, target_id: int, user_id_to_remove: int, requester_id: int) -> bool:
    """Removes a collaborator from a folder or deck."""
    requester_role = get_effective_user_role(requester_id, target_type, target_id)
    if requester_role != 'owner' and requester_id != user_id_to_remove:
        raise Exception("Access denied: Only owner can remove collaborators")

    collab = models.TMA_Collaborator.get_or_none(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id) &
        (models.TMA_Collaborator.user_id == user_id_to_remove)
    )
    if collab:
        collab.delete_instance()
        return True
    return False


def _get_all_subfolder_ids(folder_id: int) -> List[int]:
    """Recursively collects folder_id and all subfolder IDs."""
    ids = [folder_id]
    subfolders = models.TMA_Folder.select(models.TMA_Folder.id).where(
        (models.TMA_Folder.parent == folder_id) & (models.TMA_Folder.is_deleted == False)
    )
    for sf in subfolders:
        ids.extend(_get_all_subfolder_ids(sf.id))
    return ids


def get_group_progress(folder_id: int, requester_id: int) -> dict:
    """Aggregates learning progress for all group collaborators in a folder hierarchy."""
    role = get_effective_user_role(requester_id, 'folder', folder_id)
    if not role:
        raise Exception("Access denied to folder")

    # 1. Collect all card IDs in this folder hierarchy
    all_folder_ids = _get_all_subfolder_ids(folder_id)
    decks = models.TMA_Deck.select(models.TMA_Deck.id).where(
        (models.TMA_Deck.folder_id << all_folder_ids) & (models.TMA_Deck.is_deleted == False)
    )
    deck_ids = [d.id for d in decks]
    
    cards = models.TMA_Card.select(models.TMA_Card.id).where(
        (models.TMA_Card.deck_id << deck_ids) & (models.TMA_Card.is_deleted == False)
    )
    card_ids = [c.id for c in cards]
    total_cards = len(card_ids)

    # 2. Get list of all group members (owner + collaborators)
    members_info = get_collaborators('folder', folder_id)
    
    today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    member_stats = []
    for member in members_info:
        uid = member["user_id"]
        
        mastered_count = 0
        learning_count = 0
        
        if total_cards > 0:
            # Query TMAProgress for this user across card_ids
            progs = models.TMAProgress.select().where(
                (models.TMAProgress.user_id == uid) &
                (models.TMAProgress.card_id << card_ids)
            )
            for p in progs:
                if p.queue == 'review' or (p.interval and p.interval >= 21):
                    mastered_count += 1
                elif p.queue in ['learning', 'relearning']:
                    learning_count += 1

        new_count = max(0, total_cards - mastered_count - learning_count)
        percent = round((mastered_count / total_cards) * 100) if total_cards > 0 else 0

        # Count today's reviews
        reviews_today = 0
        if card_ids:
            reviews_today = models.TMAReviewHistory.select().where(
                (models.TMAReviewHistory.user_id == uid) &
                (models.TMAReviewHistory.card_id << card_ids) &
                (models.TMAReviewHistory.review_time >= today_start)
            ).count()

        member_stats.append({
            "user_id": uid,
            "username": member["username"],
            "first_name": member["first_name"],
            "photo_url": member["photo_url"],
            "role": member["role"],
            "is_owner": member["is_owner"],
            "total_cards": total_cards,
            "mastered_cards": mastered_count,
            "learning_cards": learning_count,
            "new_cards": new_count,
            "progress_percent": percent,
            "reviews_today": reviews_today
        })

    # Sort leaderboard by progress_percent DESC, then reviews_today DESC
    member_stats.sort(key=lambda x: (x["progress_percent"], x["reviews_today"]), reverse=True)

    folder_name = ""
    f = models.TMA_Folder.get_or_none(models.TMA_Folder.id == folder_id)
    if f:
        folder_name = f.name

    return {
        "folder_id": folder_id,
        "folder_name": folder_name,
        "total_cards": total_cards,
        "members": member_stats
    }


def get_user_accessible_deck_ids(user_id: int) -> set:
    """Returns all deck IDs that user owns or has collaborator access to."""
    owned_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(
        (models.TMA_Deck.user_id == user_id) & (models.TMA_Deck.is_deleted == False)
    )
    deck_ids = set(d.id for d in owned_decks)

    collab_decks = models.TMA_Collaborator.select(models.TMA_Collaborator.target_id).where(
        (models.TMA_Collaborator.target_type == 'deck') &
        (models.TMA_Collaborator.user_id == user_id)
    )
    for c in collab_decks:
        d = models.TMA_Deck.get_or_none((models.TMA_Deck.id == c.target_id) & (models.TMA_Deck.is_deleted == False))
        if d:
            deck_ids.add(d.id)

    collab_folders = models.TMA_Collaborator.select(models.TMA_Collaborator.target_id).where(
        (models.TMA_Collaborator.target_type == 'folder') &
        (models.TMA_Collaborator.user_id == user_id)
    )
    shared_folder_ids = set()
    for cf in collab_folders:
        shared_folder_ids.update(_get_all_subfolder_ids(cf.target_id))

    if shared_folder_ids:
        folder_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(
            (models.TMA_Deck.folder_id << list(shared_folder_ids)) & (models.TMA_Deck.is_deleted == False)
        )
        for d in folder_decks:
            deck_ids.add(d.id)

    return deck_ids


def get_user_accessible_folder_ids(user_id: int) -> set:
    """Returns all folder IDs that user owns or has collaborator access to."""
    owned_folders = models.TMA_Folder.select(models.TMA_Folder.id).where(
        (models.TMA_Folder.user_id == user_id) & (models.TMA_Folder.is_deleted == False)
    )
    folder_ids = set(f.id for f in owned_folders)

    collab_folders = models.TMA_Collaborator.select(models.TMA_Collaborator.target_id).where(
        (models.TMA_Collaborator.target_type == 'folder') &
        (models.TMA_Collaborator.user_id == user_id)
    )
    for cf in collab_folders:
        folder_ids.update(_get_all_subfolder_ids(cf.target_id))

    return folder_ids

