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
async def save_card(data: dict, user_id: int = Depends(get_user_id)):
    try:
        card = services.save_card(data, user_id)
        if card:
            await services.ensure_card_audio(card, user_id)
            # Сразу возвращаем полные данные для StudyView
            return services.format_card_for_study(card, user_id)
        raise HTTPException(status_code=400, detail="Could not save card. Check logs.")
    except Exception as e:
        logger.error(f"Router save_card error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{card_id}")
def delete_card(card_id: int, user_id: int = Depends(get_user_id)):
    if services.delete_card(card_id, user_id):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Card not found or access denied")

@router.post("/{card_id}/toggle-learn")
async def toggle_learn(card_id: int, user_id: int = Depends(get_user_id)):
    card = services.toggle_want_to_learn(card_id, user_id)
    if card:
        await services.ensure_card_audio(card, user_id)
        return services.format_card_for_study(card, user_id)
    raise HTTPException(status_code=404, detail="Card not found")
    
@router.get("/duplicates")
def get_duplicates(user_id: int = Depends(get_user_id)):
    return services.get_duplicate_cards(user_id)

@router.get("/favorites")
def get_favorites(user_id: int = Depends(get_user_id)):
    return services.get_favorite_cards(user_id)


@router.post("/reorder")
def reorder_cards(data: dict, user_id: int = Depends(get_user_id)):
    from api import models
    card_ids = data.get('card_ids', [])
    try:
        user_decks = models.TMA_Deck.select(models.TMA_Deck.id).where(models.TMA_Deck.user_id == user_id)
        with models.tma_db.atomic():
            for idx, card_id in enumerate(card_ids):
                models.TMA_Card.update(position=idx).where(
                    (models.TMA_Card.id == card_id) & (models.TMA_Card.deck_id << user_decks)
                ).execute()
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error reordering cards: {e}")
        raise HTTPException(status_code=500, detail=str(e))



