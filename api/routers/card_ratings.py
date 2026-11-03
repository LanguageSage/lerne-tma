"""Private like/dislike ratings. Never included in card JSON, study or sync snapshots."""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator
from api.models import TMACardRating, TMA_Card, TMA_Deck
from api.db_workers import db_worker
from api.dependencies.auth import get_user_id
from api.services.collaborative_service import _require_cards_access, get_effective_user_role

router = APIRouter(prefix='/card-ratings', tags=['card-ratings'])
UNAVAILABLE = 'Card ratings unavailable: migration 92 is required'


class RatingWrite(BaseModel):
    """`rating: null` clears the vote; a reason is only meaningful for a dislike."""
    model_config = ConfigDict(extra='forbid')
    rating: Optional[Literal[-1, 1]] = None
    reason: Optional[Literal['unclear', 'error', 'too_hard', 'boring']] = None

    @model_validator(mode='after')
    def reason_requires_dislike(self):
        if self.reason and self.rating != -1:
            raise ValueError('reason requires rating -1')
        return self


def require_table():
    if not TMACardRating.table_exists():
        raise HTTPException(503, UNAVAILABLE)


def serialize(row):
    return {field: getattr(row, field) for field in ('card_id', 'rating', 'reason', 'updated_at')}


@router.get('/deck/{deck_id}')
@db_worker(retry_reads=True)
def list_deck_ratings(deck_id: int, user_id: int = Depends(get_user_id)):
    require_table()
    if not TMA_Deck.select().where((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False)).exists():
        raise HTTPException(404, 'Deck not found')
    if not get_effective_user_role(user_id, 'deck', deck_id):
        raise HTTPException(403, 'Access denied')
    return [serialize(row) for row in TMACardRating.select().join(TMA_Card).where(
        (TMA_Card.deck == deck_id) & (TMA_Card.is_deleted == False) &
        (TMACardRating.user_id == user_id))]


@router.put('/{card_id}')
@db_worker
def save_rating(card_id: int, data: RatingWrite, user_id: int = Depends(get_user_id)):
    _require_cards_access([card_id], user_id, write=False)
    if not TMA_Card.select().where((TMA_Card.id == card_id) & (TMA_Card.is_deleted == False)).exists():
        raise HTTPException(404, 'Card not found')
    require_table()
    if data.rating is None:
        TMACardRating.delete().where(
            (TMACardRating.card == card_id) & (TMACardRating.user_id == user_id)).execute()
        return {'card_id': card_id, 'rating': None, 'reason': None}
    now = datetime.datetime.now()
    # The unique (user, card) index makes repeated or racing writes converge on one row.
    TMACardRating.insert(card=card_id, user_id=user_id, rating=data.rating, reason=data.reason,
                         created_at=now, updated_at=now).on_conflict(
        conflict_target=(TMACardRating.user_id, TMACardRating.card),
        update={TMACardRating.rating: data.rating, TMACardRating.reason: data.reason,
                TMACardRating.updated_at: now}).execute()
    return serialize(TMACardRating.get(
        (TMACardRating.card == card_id) & (TMACardRating.user_id == user_id)))
