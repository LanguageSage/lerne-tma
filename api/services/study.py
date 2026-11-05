import os
import datetime
import logging
import json
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, Deck, Card, tma_db, TMAMedia
from .. import srs
from .. import models
from peewee import fn, JOIN
from functools import lru_cache
from fastapi import HTTPException
import hashlib

logger = logging.getLogger(__name__)

def update_card_progress(card_id: int, user_id: int, grade: int, is_extended: bool = False, review_context='scheduled', action_id=None, review_time=None):
    try:
        with tma_db.atomic():
            receipt = None
            if action_id:
                fingerprint = hashlib.sha256(json.dumps([card_id, grade, bool(is_extended), review_context]).encode()).hexdigest()
                receipt, created = models.TMAOfflineBatch.get_or_create(
                    key=f'grade:{user_id}:{action_id}', defaults={'payload_hash': fingerprint, 'response': ''})
                if not created:
                    if receipt.payload_hash != fingerprint:
                        raise HTTPException(409, 'Grade action already used with different data')
                    return json.loads(receipt.response)
            progress = TMAProgress.get_or_none(TMAProgress.card_id == card_id, TMAProgress.user_id == user_id)
            if not progress:
                progress, _ = TMAProgress.get_or_create(card_id=card_id, user_id=user_id,
                    defaults={'next_review': datetime.datetime.now()})
            # Serialize different actions on an existing progress row as well.
            if action_id and isinstance(getattr(tma_db, 'obj', tma_db), models.PostgresqlDatabase):
                progress = TMAProgress.select().where(TMAProgress.id == progress.id).for_update().get()
            srs.review_card(progress, grade, is_extended=is_extended, review_context=review_context, **({'now': review_time} if review_time else {}))
            TMAReviewHistory.create(card_id=card_id, user_id=user_id, rating=grade, scheduled_interval=progress.interval,
                                   **({'review_time': review_time} if review_time else {}))
            if receipt:
                receipt.response = json.dumps({'status': 'success', 'next_review': progress.next_review.isoformat()})
                receipt.save()
        return {"status": "success", "next_review": progress.next_review}
    except Exception as e:
        logger.error(f"Error updating progress: {e}")
        raise e


