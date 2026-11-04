from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import logging
import datetime

from api import models
from api.db_workers import db_phases, run_db
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/feedback",
    tags=["feedback"],
)

class FeedbackRequest(BaseModel):
    rating: Optional[int] = None
    message: str

def _save_feedback(request: FeedbackRequest, user_id: int):
    feedback = models.TMAFeedback.create(
        user_id=user_id,
        rating=request.rating,
        message=request.message,
        created_at=datetime.datetime.now()
    )
    logger.info(f"FEEDBACK: Received from user {user_id}")
    return {"status": "success", "id": feedback.id}


@router.post("")
@router.post("/")
@db_phases
async def submit_feedback(request: FeedbackRequest, user_id: int = Depends(get_user_id)):
    """Saves user feedback to the database."""
    try:
        return await run_db(_save_feedback, request, user_id)
    except Exception as e:
        logger.error(f"Error saving feedback: {e}")
        raise HTTPException(status_code=500, detail="Could not save feedback")
