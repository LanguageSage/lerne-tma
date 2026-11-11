import logging
import datetime
from typing import Optional

from api import models

logger = logging.getLogger(__name__)

def parse_iso_datetime(iso_str: Optional[str]) -> datetime.datetime:
    if not iso_str:
        return datetime.datetime.now()
    if iso_str.endswith('Z'):
        iso_str = iso_str[:-1] + '+00:00'
    try:
        dt = datetime.datetime.fromisoformat(iso_str)
        return dt.replace(tzinfo=None)
    except Exception:
        return datetime.datetime.now()

def execute_collab_pull(since: Optional[str], user_id: int) -> dict:
    """Returns changes from ALL participants in shared folders/decks the user has access to.
    This is the backbone of real-time collaborative sync polling.
    """
    from api.services.collaborative_service import get_user_accessible_deck_ids, get_user_accessible_folder_ids, get_folder_access_map
    since_dt = parse_iso_datetime(since) if since else datetime.datetime.min
    # Use the same naive clock as the stored updated_at values. Capture it BEFORE reading.
    # Later commits must remain visible to the next poll.
    server_time = datetime.datetime.now().isoformat()
    folder_map = get_folder_access_map()
    folder_ids = get_user_accessible_folder_ids(user_id, folder_map=folder_map)
    deck_ids = get_user_accessible_deck_ids(user_id, folder_map=folder_map, accessible_folder_ids=folder_ids)
    changed = (models.TMA_Folder.select().where(models.TMA_Folder.id.in_(folder_ids), models.TMA_Folder.updated_at > since_dt).exists()
        or models.TMA_Deck.select().where(models.TMA_Deck.id.in_(deck_ids), models.TMA_Deck.updated_at > since_dt).exists()
        or models.TMA_Card.select().where(models.TMA_Card.deck_id.in_(deck_ids), models.TMA_Card.updated_at > since_dt).exists())
    return {'has_changes': changed, 'server_time': server_time}
