from fastapi import APIRouter, HTTPException, Depends
import logging

from api import services
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/cards",
    tags=["cards"],
)

@router.post("/save")
def save_card(data: dict, user_id: int = Depends(get_user_id)):
    card = services.save_card(data, user_id)
    if card:
        return {"status": "success", "id": card.id}
    raise HTTPException(status_code=400, detail="Failed to save card")

@router.delete("/{card_id}")
def delete_card(card_id: int):
    # Note: user_id check is missing here currently.
    if services.delete_card(card_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Card not found")
