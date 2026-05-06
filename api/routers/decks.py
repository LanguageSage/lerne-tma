from fastapi import APIRouter, HTTPException, Depends
import logging

from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/decks",
    tags=["decks"],
)

@router.get("")
def get_decks(user_id: int = Depends(get_user_id)):
    logger.info(f"GET /api/decks - X-User-ID: {user_id}")
    return services.get_active_decks(user_id)
    
@router.post("")
def create_deck(data: dict, user_id: int = Depends(get_user_id)):
    deck = services.create_deck(data.get('name'), user_id)
    return {"status": "success", "id": deck.id}

@router.delete("/{deck_id}")
def delete_deck(deck_id: int):
    # Note: Currently delete_deck doesn't check user_id. We might want to add it later.
    if services.delete_deck(deck_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Deck not found")

@router.post("/import-json")
def import_json_deck(data: dict, user_id: int = Depends(get_user_id)):
    logger.info(f"POST /api/decks/import-json - X-User-ID: {user_id}")
    result = services.import_deck_from_json(data, user_id)
    if result:
        return {"status": "success", "deck_id": result.id}
    raise HTTPException(status_code=400, detail="Import failed: invalid data or empty deck")

@router.post("/{deck_id}/reset")
def reset_deck(deck_id: int, user_id: int = Depends(get_user_id)):
    if services.reset_deck_progress(user_id, deck_id):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to reset progress")

@router.get("/{deck_id}/cards")
def get_deck_cards(deck_id: int, user_id: int = Depends(get_user_id)):
    return services.get_cards_for_study(deck_id, user_id)

from pydantic import BaseModel

class SyncRequest(BaseModel):
    mode: str = 'merge'

@router.post("/{deck_id}/sync")
def sync_deck(deck_id: int, request: SyncRequest = None, user_id: int = Depends(get_user_id)):
    mode = request.mode if request else 'merge'
    if services.sync_deck_with_library(user_id, deck_id, mode=mode):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to sync deck")

# External/Library decks
@router.get("/external")
def get_external_decks():
    return services.get_external_decks()

@router.post("/external/import/{deck_id}")
def import_external_deck(deck_id: int, user_id: int = Depends(get_user_id)):
    logger.info(f"POST /api/decks/external/import/{deck_id} - X-User-ID: {user_id}")
    result = services.import_deck(deck_id, user_id)
    if result:
        return {"status": "success", "deck_id": result.id}
    raise HTTPException(status_code=404, detail="External deck not found or import failed")
