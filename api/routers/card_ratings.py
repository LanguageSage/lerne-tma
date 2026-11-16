"""Personal votes and anonymous totals, separate from card content and sync."""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator
from peewee import Case, JOIN, fn
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


def rating_summaries(condition, user_id):
    """One grouped query for the whole deck, including cards without votes."""
    personal = TMACardRating.user_id == user_id
    return list(TMA_Card.select(
        TMA_Card.id.alias('card_id'),
        fn.SUM(Case(None, ((TMACardRating.rating == 1, 1),), 0)).alias('likes'),
        fn.SUM(Case(None, ((TMACardRating.rating == -1, 1),), 0)).alias('dislikes'),
        fn.MAX(Case(None, ((personal, TMACardRating.rating),))).alias('rating'),
        fn.MAX(Case(None, ((personal, TMACardRating.reason),))).alias('reason'),
        fn.MAX(Case(None, ((personal, TMACardRating.updated_at),))).alias('updated_at'),
    ).join(TMACardRating, JOIN.LEFT_OUTER).where(
        condition & (TMA_Card.is_deleted == False)
    ).group_by(TMA_Card.id).order_by(TMA_Card.id).dicts())


@router.get('/deck/{deck_id}')
@db_worker(retry_reads=True)
def list_deck_ratings(deck_id: int, user_id: int = Depends(get_user_id), include_counts: bool = False):
    if not TMA_Deck.select().where((TMA_Deck.id == deck_id) & (TMA_Deck.is_deleted == False)).exists():
        raise HTTPException(404, 'Deck not found')
    if not get_effective_user_role(user_id, 'deck', deck_id):
        raise HTTPException(403, 'Access denied')
    require_table()
    if include_counts:
        return rating_summaries(TMA_Card.deck == deck_id, user_id)
    return [serialize(row) for row in TMACardRating.select().join(TMA_Card).where(
        (TMA_Card.deck == deck_id) & (TMA_Card.is_deleted == False) &
        (TMACardRating.user_id == user_id))]


@router.get('/{card_id}')
@db_worker(retry_reads=True)
def get_card_rating(card_id: int, user_id: int = Depends(get_user_id)):
    _require_cards_access([card_id], user_id, write=False)
    require_table()
    rows = rating_summaries(TMA_Card.id == card_id, user_id)
    if not rows:
        raise HTTPException(404, 'Card not found')
    return rows[0]


@router.put('/{card_id}')
@db_worker
def save_rating(card_id: int, data: RatingWrite, user_id: int = Depends(get_user_id)):
    database = TMA_Card._meta.database
    with database.atomic():
        # Lock the card even when this user's vote does not yet exist. Serialize
        # clear/upsert + response totals, including writes by different users.
        query = TMA_Card.select(TMA_Card.id).where(
            (TMA_Card.id == card_id) & (TMA_Card.is_deleted == False))
        if database.for_update:
            query = query.for_update()
        if not query.first():
            raise HTTPException(404, 'Card not found')
        _require_cards_access([card_id], user_id, write=False)
        require_table()
        if data.rating is None:
            TMACardRating.delete().where(
                (TMACardRating.card == card_id) & (TMACardRating.user_id == user_id)).execute()
        else:
            now = datetime.datetime.now()
            TMACardRating.insert(card=card_id, user_id=user_id, rating=data.rating, reason=data.reason,
                                 created_at=now, updated_at=now).on_conflict(
                conflict_target=(TMACardRating.user_id, TMACardRating.card),
                update={TMACardRating.rating: data.rating, TMACardRating.reason: data.reason,
                        TMACardRating.updated_at: now}).execute()
        return rating_summaries(TMA_Card.id == card_id, user_id)[0]
