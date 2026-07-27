import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional

from api.dependencies.auth import get_user_id
from api.services.sync_service import execute_sync_push, execute_sync_pull


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


# --- Endpoints ---

@router.post("/push")
def push_changes(request: PushRequest, user_id: int = Depends(get_user_id)):
    """Receives offline changes from client, inserts/updates them via service."""
    return execute_sync_push(request, user_id)


@router.get("/pull")
def pull_changes(since: Optional[str] = None, user_id: int = Depends(get_user_id)):
    """Returns all changes that happened on the server since the given timestamp for this user."""
    return execute_sync_pull(since, user_id)
