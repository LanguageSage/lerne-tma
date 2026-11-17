import os
import datetime
import logging
from ..models import TMA_Deck, TMA_Card, TMAProgress, TMAReviewHistory, tma_db, TMAMedia
from .. import srs
from .. import models
from peewee import fn, JOIN
from functools import lru_cache
from fastapi import HTTPException
from .receipts import _claim_receipt, batch_digest, finish_receipt

logger = logging.getLogger(__name__)

def progress_response(progress, review_context='scheduled'):
    return {'id': progress.card_id,
            **{field: getattr(progress, field) for field in
               ('queue', 'interval', 'ease_factor', 'repetitions', 'lapses', 'flag')},
            'step_index': getattr(progress, 'step_index', 0) or 0,
            'is_leech': srs.is_leech(progress.lapses or 0),
            'next_review': progress.next_review.isoformat() if progress.next_review else None,
            'last_reviewed': progress.last_reviewed.isoformat() if progress.last_reviewed else None,
            'intervals': {str(key): value for key, value in srs.get_next_intervals(
                progress, review_context=review_context).items()}}


def update_card_progress(card_id: int, user_id: int, grade: int, is_extended: bool = False, review_context='scheduled', action_id=None, review_time=None):
    try:
        with tma_db.atomic():
            receipt = None
            if action_id:
                receipt, replay = _claim_receipt(
                    f'grade:{user_id}:{action_id}',
                    batch_digest([card_id, grade, bool(is_extended), review_context]),
                    'Grade action already used with different data',
                )
                if replay is not None:
                    return replay
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
            result = {'status': 'success', 'next_review': progress.next_review.isoformat(),
                      'graded_progress': progress_response(progress, review_context)}
            if receipt:
                finish_receipt(receipt, result)
        return result
    except Exception as e:
        logger.error(f"Error updating progress: {e}")
        raise e


