import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from peewee import fn, JOIN
from functools import lru_cache

logger = logging.getLogger(__name__)

def update_card_progress(card_id: int, user_id: int, grade: int):
    try:
        progress = TMAProgress.get_or_none(TMAProgress.card_id == card_id, TMAProgress.user_id == user_id)
        if not progress:
            progress = TMAProgress.create(card_id=card_id, user_id=user_id, next_review=datetime.datetime.now())
        srs.review_card(progress, grade)
        TMAReviewHistory.create(card_id=card_id, user_id=user_id, rating=grade, scheduled_interval=progress.interval)
        return {"status": "success", "next_review": progress.next_review}
    except Exception as e:
        logger.error(f"Error updating progress: {e}")
        raise e


