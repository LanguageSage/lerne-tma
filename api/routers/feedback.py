from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import logging
import datetime

import models
from api.dependencies.auth import get_user_id

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/feedback",
    tags=["feedback"],
)

class FeedbackRequest(BaseModel):
    rating: Optional[int] = None
    message: str

@router.post("")
@router.post("/")
def submit_feedback(request: FeedbackRequest, user_id: int = Depends(get_user_id)):
    """Saves user feedback to the database."""
    try:
        feedback = models.TMAFeedback.create(
            user_id=user_id,
            rating=request.rating,
            message=request.message,
            created_at=datetime.datetime.now()
        )
        logger.info(f"FEEDBACK: Received from user {user_id}")
        return {"status": "success", "id": feedback.id}
    except Exception as e:
        logger.error(f"Error saving feedback: {e}")
        raise HTTPException(status_code=500, detail="Could not save feedback")
