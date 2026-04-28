from fastapi import APIRouter, HTTPException, Depends
import logging

import services
import srs
import models
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["study"],
)

@router.get("/decks/{deck_id}/next")
def get_next_card(deck_id: int, exclude_ids: str = None, user_id: int = Depends(get_user_id)):
    """Выбор следующей карты для изучения (SRS)."""
    parsed_exclude = []
    if exclude_ids:
        try:
            parsed_exclude = [int(i) for i in exclude_ids.split(',') if i.strip()]
        except ValueError:
            pass

    card, progress = services.get_next_card(user_id, deck_id, exclude_ids=parsed_exclude)
    
    if isinstance(card, dict) and "error" in card:
        return card # Возвращаем ошибку для отладки
        
    if not card:
        logger.info(f"User {user_id} finished deck {deck_id}")
        return {"finished": True}
    
    resp = {
        "id": card.id,
        "front": card.front_text,
        "back": card.back_text,
        "context": card.context,
        "audio_url": services.resolve_media_url(card.audio_path, "audio"),
        "image_url": services.resolve_media_url(card.image_path, "images"),
        "intervals": srs.get_next_intervals(progress)
    }
    
    logger.info(f"NEXT CARD: user={user_id}, deck={deck_id}, card={card.id}")
    return resp

@router.post("/study/grade")
def submit_grade(data: dict, user_id: int = Depends(get_user_id)):
    def run_grade():
        logger.info(f"submit_grade: User {user_id}, Data: {data}")
        services.update_card_progress(data['card_id'], user_id, data['grade'])
        logger.info("submit_grade: Progress updated successfully")
        return get_next_card(deck_id=data['deck_id'], exclude_ids=None, user_id=user_id)

    try:
        return run_grade()
    except Exception as e:
        if "connection already closed" in str(e).lower():
            try:
                models.tma_db.close()
            except Exception:
                pass
            try:
                models.tma_db.connect(reuse_if_open=True)
                return run_grade()
            except Exception as retry_error:
                logger.error(f"submit_grade RETRY ERROR: {retry_error}")
                raise HTTPException(status_code=500, detail=str(retry_error))
        logger.error(f"submit_grade ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))
