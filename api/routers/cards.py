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
    try:
        card = services.save_card(data, user_id)
        if card:
            # Сразу возвращаем полные данные для StudyView
            return services.format_card_for_study(card, user_id)
        raise HTTPException(status_code=400, detail="Could not save card. Check logs.")
    except Exception as e:
        logger.error(f"Router save_card error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{card_id}")
def delete_card(card_id: int):
    # Note: user_id check is missing here currently.
    if services.delete_card(card_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Card not found")

