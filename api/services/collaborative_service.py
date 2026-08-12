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


def is_shared_item(user_id: int, target_type: str, target_id: int) -> bool:
    """Returns True if the folder or deck has active collaborators or the user is an invited collaborator."""
    role = get_effective_user_role(user_id, target_type, target_id)
    if role and role != 'owner':
        return True

    if target_type == 'folder':
        collab_count = models.TMA_Collaborator.select().where(
            (models.TMA_Collaborator.target_type == 'folder') &
            (models.TMA_Collaborator.target_id == target_id)
        ).count()
        return collab_count > 0
    elif target_type == 'deck':
        collab_count = models.TMA_Collaborator.select().where(
            (models.TMA_Collaborator.target_type == 'deck') &
            (models.TMA_Collaborator.target_id == target_id)
        ).count()
        if collab_count > 0:
            return True
        
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if deck and deck.folder_id:
            return is_shared_item(user_id, 'folder', deck.folder_id)

    return False



def _get_all_parent_folder_ids(folder_id: int) -> List[int]:
    """Recursively collects folder_id and all its parent folder IDs."""
    ids = []
    current_id = folder_id
    while current_id:
        ids.append(current_id)
        f = models.TMA_Folder.get_or_none((models.TMA_Folder.id == current_id) & (models.TMA_Folder.is_deleted == False))
        if f and f.parent_id:
            current_id = f.parent_id
        else:
            break
    return ids


def get_collaborators(target_type: str, target_id: int) -> List[Dict[str, Any]]:
    """Returns all collaborators and owner for a given folder or deck, including inherited folder collaborators."""
    collaborators = []
    seen_user_ids = set()
    
    # Get owner info
    owner_id = None
    folder_id = None
    if target_type == 'deck':
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if deck:
            owner_id = deck.user_id
            folder_id = deck.folder_id
    elif target_type == 'folder':
        folder = models.TMA_Folder.get_or_none(models.TMA_Folder.id == target_id)
        if folder:
            owner_id = folder.user_id
            
    if owner_id:
        seen_user_ids.add(owner_id)
        owner_user = models.TMAUser.get_or_none(models.TMAUser.user_id == owner_id)
        collaborators.append({
            "user_id": owner_id,
            "username": owner_user.username if owner_user else None,
            "first_name": owner_user.first_name if owner_user else "Owner",
            "photo_url": owner_user.photo_url if owner_user else None,
            "role": "owner",
            "is_owner": True
        })

    # Direct collaborators
    direct_rows = list(models.TMA_Collaborator.select().where(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id)
    ))

    # Inherited folder collaborators if deck is inside a folder
    folder_rows = []
    if target_type == 'deck' and folder_id:
        parent_folder_ids = _get_all_parent_folder_ids(folder_id)
        if parent_folder_ids:
            folder_rows = list(models.TMA_Collaborator.select().where(
                (models.TMA_Collaborator.target_type == 'folder') &
                (models.TMA_Collaborator.target_id << parent_folder_ids)
            ))

    all_rows = direct_rows + folder_rows
    for r in all_rows:
        if r.user_id in seen_user_ids:
            continue
        seen_user_ids.add(r.user_id)
        u = models.TMAUser.get_or_none(models.TMAUser.user_id == r.user_id)
        effective_role = get_effective_user_role(r.user_id, target_type, target_id) or r.role
        collaborators.append({
            "id": r.id,
            "user_id": r.user_id,
            "username": u.username if u else None,
            "first_name": u.first_name if u else f"User #{r.user_id}",
            "photo_url": u.photo_url if u else None,
            "role": effective_role,
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
        role = 'viewer'

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


def update_collaborator_role(target_type: str, target_id: int, user_id_to_update: int, new_role: str, requester_id: int) -> dict:
    """Updates role for an existing collaborator. Only owner can change roles."""
    requester_role = get_effective_user_role(requester_id, target_type, target_id)
    if requester_role != 'owner':
        raise Exception("Access denied: Only item owner can change collaborator roles")

    if new_role not in ['editor', 'viewer']:
        new_role = 'viewer'

    collab = models.TMA_Collaborator.get_or_none(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id) &
        (models.TMA_Collaborator.user_id == user_id_to_update)
    )

    if not collab:
        collab = models.TMA_Collaborator.create(
            target_type=target_type,
            target_id=target_id,
            user_id=user_id_to_update,
            role=new_role,
            added_by=requester_id
        )
    else:
        collab.role = new_role
        collab.save()

    return {"status": "ok", "user_id": user_id_to_update, "role": new_role}


def join_by_share_id(share_id: str, user_id: int) -> dict:
    """Allows a user to join a shared folder or deck as a viewer using its share_id."""
    clean_share_id = share_id.replace("collab_", "")
    target_type = None
    target_id = None
    item_name = ""
    owner_id = None

    target_language = "de"
    if clean_share_id.startswith("d_"):
        deck = models.TMA_Deck.get_or_none((models.TMA_Deck.share_id == clean_share_id) & (models.TMA_Deck.is_deleted == False))
        if not deck:
            raise Exception("Shared deck not found")
        target_type = "deck"
        target_id = deck.id
        item_name = deck.name
        owner_id = deck.user_id
        target_language = getattr(deck, 'target_language', 'de') or 'de'
    elif clean_share_id.startswith("f_"):
        folder = models.TMA_Folder.get_or_none((models.TMA_Folder.share_id == clean_share_id) & (models.TMA_Folder.is_deleted == False))
        if not folder:
            raise Exception("Shared folder not found")
        target_type = "folder"
        target_id = folder.id
        item_name = folder.name
        owner_id = folder.user_id
        target_language = getattr(folder, 'target_language', 'de') or 'de'
    else:
        raise Exception("Invalid share link format")

    if owner_id == user_id:
        return {
            "status": "ok",
            "type": target_type,
            "id": target_id,
            "name": item_name,
            "target_language": target_language,
            "is_owner": True,
            "already_had_access": True,
            "role": "owner"
        }

    collab, created = models.TMA_Collaborator.get_or_create(
        target_type=target_type,
        target_id=target_id,
        user_id=user_id,
        defaults={
            "role": "viewer",
            "added_by": owner_id
        }
    )

    return {
        "status": "ok",
        "type": target_type,
        "id": target_id,
        "name": item_name,
        "target_language": target_language,
        "role": collab.role,
        "joined": created,
        "already_had_access": not created,
        "is_owner": False
    }





def remove_collaborator(target_type: str, target_id: int, user_id_to_remove: int, requester_id: int) -> bool:
    """Removes a collaborator from a folder or deck."""
    requester_role = get_effective_user_role(requester_id, target_type, target_id)
    if requester_role != 'owner' and int(requester_id) != int(user_id_to_remove):
        raise Exception("Access denied: Only owner can remove collaborators")

    deleted = models.TMA_Collaborator.delete().where(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id) &
        (models.TMA_Collaborator.user_id == user_id_to_remove)
    ).execute()

    if deleted > 0:
        return True

    if target_type == 'deck':
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if deck and deck.folder_id:
            deleted_folder = models.TMA_Collaborator.delete().where(
                (models.TMA_Collaborator.target_type == 'folder') &
                (models.TMA_Collaborator.target_id == deck.folder_id) &
                (models.TMA_Collaborator.user_id == user_id_to_remove)
            ).execute()
            if deleted_folder > 0:
                return True

    return False


def remove_all_collaborators(target_type: str, target_id: int, requester_id: int) -> int:
    """Removes all collaborators for a folder or deck (completely closes shared access)."""
    requester_role = get_effective_user_role(requester_id, target_type, target_id)
    if requester_role != 'owner':
        raise Exception("Access denied: Only item owner can close shared access")

    count = models.TMA_Collaborator.delete().where(
        (models.TMA_Collaborator.target_type == target_type) &
        (models.TMA_Collaborator.target_id == target_id)
    ).execute()

    if target_type == 'deck':
        deck = models.TMA_Deck.get_or_none(models.TMA_Deck.id == target_id)
        if deck and deck.folder_id:
            count += models.TMA_Collaborator.delete().where(
                (models.TMA_Collaborator.target_type == 'folder') &
                (models.TMA_Collaborator.target_id == deck.folder_id)
            ).execute()

    return count




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
    """Returns all deck IDs that user owns or has collaborator access to, including decks in owned/collaborated folders."""
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

    accessible_folder_ids = get_user_accessible_folder_ids(user_id)
    all_accessible_folder_ids = set()
    for fid in accessible_folder_ids:
        all_accessible_folder_ids.update(_get_all_subfolder_ids(fid))

    if all_accessible_folder_ids:
        folder_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(
            (models.TMA_Deck.folder_id << list(all_accessible_folder_ids)) & (models.TMA_Deck.is_deleted == False)
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

