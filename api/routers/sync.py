import logging
import datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from peewee import IntegrityError

from api.dependencies.auth import get_user_id
from api import models

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sync",
    tags=["sync"],
)

# --- Pydantic Request/Response Models ---

class SyncDeckItem(BaseModel):
    id: int
    name: str
    level: Optional[str] = None
    topic: Optional[str] = None
    is_deleted: bool = False
    is_pinned: bool = False
    position: int = 0
    folder_id: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncCardItem(BaseModel):
    id: int
    deck_id: int
    front_text: str
    back_text: str
    context: Optional[str] = None
    image_path: Optional[str] = None
    audio_path: Optional[str] = None
    audio_back_path: Optional[str] = None
    video_front_path: Optional[str] = None
    video_back_path: Optional[str] = None
    want_to_learn: bool = False
    is_deleted: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncProgressItem(BaseModel):
    card_id: int
    queue: str
    interval: int
    ease_factor: float
    repetitions: int
    lapses: int
    step_index: Optional[int] = None
    next_review: Optional[str] = None
    last_reviewed: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class SyncFolderItem(BaseModel):
    id: int
    name: str
    is_deleted: bool = False
    is_pinned: bool = False
    position: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class PushRequest(BaseModel):
    folders: List[SyncFolderItem] = []
    decks: List[SyncDeckItem] = []
    cards: List[SyncCardItem] = []
    progress: List[SyncProgressItem] = []

# --- Helper function for robust date parsing ---
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

# --- Endpoints ---

@router.post("/push")
def push_changes(request: PushRequest, user_id: int = Depends(get_user_id)):
    """Receives offline changes from client, inserts/updates them, and maps negative temp IDs to real IDs."""
    logger.info(f"Sync Push: starting for user {user_id} with {len(request.decks)} decks, {len(request.cards)} cards, {len(request.progress)} progress items")
    
    folder_id_map = {}
    deck_id_map = {}
    card_id_map = {}

    try:
        with models.tma_db.atomic():
            # 0. Process Folders
            for f in request.folders:
                client_updated_at = parse_iso_datetime(f.updated_at)
                if f.id < 0:
                    new_folder = models.TMA_Folder.create(
                        user_id=user_id,
                        name=f.name,
                        is_deleted=f.is_deleted,
                        is_pinned=f.is_pinned,
                        position=f.position,
                        created_at=parse_iso_datetime(f.created_at),
                        updated_at=client_updated_at
                    )
                    folder_id_map[str(f.id)] = new_folder.id
                    logger.info(f"Sync: Mapped folder temp ID {f.id} to new real ID {new_folder.id}")
                else:
                    folder = models.TMA_Folder.get_or_none((models.TMA_Folder.id == f.id) & (models.TMA_Folder.user_id == user_id))
                    if folder:
                        if not folder.updated_at or client_updated_at > folder.updated_at:
                            folder.name = f.name
                            folder.is_deleted = f.is_deleted
                            folder.is_pinned = f.is_pinned
                            folder.position = f.position
                            folder.updated_at = client_updated_at
                            folder.save()

            # 1. Process Decks
            for d in request.decks:
                resolved_folder_id = d.folder_id
                if resolved_folder_id and resolved_folder_id < 0:
                    resolved_folder_id = folder_id_map.get(str(resolved_folder_id))
                    
                client_updated_at = parse_iso_datetime(d.updated_at)
                if d.id < 0:
                    # New deck created offline
                    new_deck = models.TMA_Deck.create(
                        user_id=user_id,
                        name=d.name,
                        level=d.level,
                        topic=d.topic,
                        is_deleted=d.is_deleted,
                        is_inbox=False,
                        is_pinned=d.is_pinned,
                        position=d.position,
                        folder_id=resolved_folder_id,
                        created_at=parse_iso_datetime(d.created_at),
                        updated_at=client_updated_at
                    )
                    deck_id_map[str(d.id)] = new_deck.id
                    logger.info(f"Sync: Mapped deck temp ID {d.id} to new real ID {new_deck.id}")
                else:
                    # Existing deck modified offline
                    deck = models.TMA_Deck.get_or_none((models.TMA_Deck.id == d.id) & (models.TMA_Deck.user_id == user_id))
                    if deck:
                        # Only update if client's timestamp is newer than server's
                        if not deck.updated_at or client_updated_at > deck.updated_at:
                            deck.name = d.name
                            deck.level = d.level
                            deck.topic = d.topic
                            deck.is_deleted = d.is_deleted
                            deck.is_pinned = d.is_pinned
                            deck.position = d.position
                            deck.folder_id = resolved_folder_id
                            deck.updated_at = client_updated_at
                            deck.save()

            # 2. Process Cards
            for c in request.cards:
                # Resolve deck ID
                resolved_deck_id = c.deck_id
                if resolved_deck_id < 0:
                    resolved_deck_id = deck_id_map.get(str(resolved_deck_id))
                    if not resolved_deck_id:
                        logger.error(f"Sync Card: Failed to resolve deck temp ID {c.deck_id} for card {c.id}")
                        continue
                
                client_updated_at = parse_iso_datetime(c.updated_at)
                if c.id < 0:
                    # New card created offline
                    new_card = models.TMA_Card.create(
                        deck_id=resolved_deck_id,
                        front_text=c.front_text,
                        back_text=c.back_text,
                        context=c.context,
                        image_path=c.image_path,
                        audio_path=c.audio_path,
                        audio_back_path=c.audio_back_path,
                        video_front_path=c.video_front_path,
                        video_back_path=c.video_back_path,
                        want_to_learn=c.want_to_learn,
                        is_deleted=c.is_deleted,
                        source='user',
                        created_at=parse_iso_datetime(c.created_at),
                        updated_at=client_updated_at
                    )
                    card_id_map[str(c.id)] = new_card.id
                    logger.info(f"Sync: Mapped card temp ID {c.id} to new real ID {new_card.id}")
                else:
                    # Existing card modified offline
                    card = models.TMA_Card.get_or_none(models.TMA_Card.id == c.id)
                    if card:
                        # Check access: make sure card's deck belongs to the user
                        if card.deck and card.deck.user_id == user_id:
                            if not card.updated_at or client_updated_at > card.updated_at:
                                card.deck_id = resolved_deck_id
                                card.front_text = c.front_text
                                card.back_text = c.back_text
                                card.context = c.context
                                card.image_path = c.image_path
                                card.audio_path = c.audio_path
                                card.audio_back_path = c.audio_back_path
                                card.video_front_path = c.video_front_path
                                card.video_back_path = c.video_back_path
                                card.want_to_learn = c.want_to_learn
                                card.is_deleted = c.is_deleted
                                card.updated_at = client_updated_at
                                card.save()

            # 3. Process Card Progress
            for p in request.progress:
                # Resolve card ID
                resolved_card_id = p.card_id
                if resolved_card_id < 0:
                    resolved_card_id = card_id_map.get(str(resolved_card_id))
                    if not resolved_card_id:
                        logger.error(f"Sync Progress: Failed to resolve card temp ID {p.card_id}")
                        continue

                client_updated_at = parse_iso_datetime(p.updated_at)
                progress, created = models.TMAProgress.get_or_create(
                    card_id=resolved_card_id,
                    user_id=user_id,
                    defaults={
                        "queue": p.queue,
                        "interval": p.interval,
                        "ease_factor": p.ease_factor,
                        "repetitions": p.repetitions,
                        "lapses": p.lapses,
                        "step_index": p.step_index,
                        "next_review": parse_iso_datetime(p.next_review),
                        "last_reviewed": parse_iso_datetime(p.last_reviewed) if p.last_reviewed else None,
                        "created_at": parse_iso_datetime(p.created_at),
                        "updated_at": client_updated_at
                    }
                )

                if not created:
                    # Update progress if client is newer
                    if not progress.updated_at or client_updated_at > progress.updated_at:
                        progress.queue = p.queue
                        progress.interval = p.interval
                        progress.ease_factor = p.ease_factor
                        progress.repetitions = p.repetitions
                        progress.lapses = p.lapses
                        progress.step_index = p.step_index
                        progress.next_review = parse_iso_datetime(p.next_review)
                        progress.last_reviewed = parse_iso_datetime(p.last_reviewed) if p.last_reviewed else None
                        progress.updated_at = client_updated_at
                        progress.save()

        return {
            "status": "success",
            "mappings": {
                "folders": folder_id_map,
                "decks": deck_id_map,
                "cards": card_id_map
            }
        }
    except Exception as e:
        logger.error(f"Sync Push Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database sync failed: {str(e)}")


@router.get("/pull")
def pull_changes(since: Optional[str] = None, user_id: int = Depends(get_user_id)):
    """Returns all changes that happened on the server since the given timestamp for this user."""
    logger.info(f"Sync Pull: starting for user {user_id} since={since}")
    
    since_dt = parse_iso_datetime(since) if since else datetime.datetime.min

    try:
        # 0. Pull Folders
        folders = models.TMA_Folder.select().where(
            (models.TMA_Folder.user_id == user_id) &
            (models.TMA_Folder.updated_at > since_dt)
        )

        # 1. Pull Decks
        decks = models.TMA_Deck.select().where(
            (models.TMA_Deck.user_id == user_id) &
            (models.TMA_Deck.updated_at > since_dt)
        )

        # 2. Pull Cards (cards belonging to any user deck that updated since since_dt)
        user_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id)
        cards = models.TMA_Card.select().where(
            (models.TMA_Card.deck_id << user_decks) &
            (models.TMA_Card.updated_at > since_dt)
        )

        # 3. Pull Progress
        progress = models.TMAProgress.select().where(
            (models.TMAProgress.user_id == user_id) &
            (models.TMAProgress.updated_at > since_dt)
        )

        # Format responses
        folders_data = []
        for f in folders:
            folders_data.append({
                "id": f.id,
                "name": f.name,
                "is_deleted": bool(f.is_deleted),
                "is_pinned": bool(f.is_pinned),
                "position": int(f.position or 0),
                "created_at": f.created_at.isoformat() if f.created_at else None,
                "updated_at": f.updated_at.isoformat() if f.updated_at else None
            })

        decks_data = []
        for d in decks:
            decks_data.append({
                "id": d.id,
                "name": d.name,
                "level": d.level or "",
                "topic": d.topic or "",
                "is_deleted": bool(d.is_deleted),
                "is_inbox": bool(d.is_inbox),
                "is_pinned": bool(d.is_pinned),
                "position": int(d.position or 0),
                "folder_id": d.folder_id,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None
            })

        cards_data = []
        for c in cards:
            cards_data.append({
                "id": c.id,
                "deck_id": c.deck_id,
                "front_text": c.front_text,
                "back_text": c.back_text,
                "context": c.context or "",
                "image_path": c.image_path or "",
                "audio_path": c.audio_path or "",
                "audio_back_path": c.audio_back_path or "",
                "video_front_path": c.video_front_path or "",
                "video_back_path": c.video_back_path or "",
                "want_to_learn": bool(c.want_to_learn),
                "is_deleted": bool(c.is_deleted),
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None
            })

        progress_data = []
        for p in progress:
            progress_data.append({
                "card_id": p.card_id,
                "queue": p.queue,
                "interval": p.interval,
                "ease_factor": p.ease_factor,
                "repetitions": p.repetitions,
                "lapses": p.lapses,
                "step_index": p.step_index,
                "next_review": p.next_review.isoformat() if p.next_review else None,
                "last_reviewed": p.last_reviewed.isoformat() if p.last_reviewed else None,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None
            })

        return {
            "status": "success",
            "folders": folders_data,
            "decks": decks_data,
            "cards": cards_data,
            "progress": progress_data,
            "server_time": datetime.datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Sync Pull Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch updates from database: {str(e)}")
