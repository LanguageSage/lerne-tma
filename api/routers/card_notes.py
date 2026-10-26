"""Personal card annotations. Never included in card JSON, study or sync snapshots."""
import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from peewee import Case

from api.models import TMACardNote, TMA_Card
from api.dependencies.auth import get_user_id
from api.services.collaborative_service import _require_cards_access

router = APIRouter(prefix='/card-notes', tags=['card-notes'])


class NoteWrite(BaseModel):
    kind: Literal['note', 'suggestion']
    text: Optional[str] = Field(default=None, max_length=10000)
    is_deleted: bool = False
    seen_revision: int = Field(default=0, ge=0)


def require_card(card_id, user_id):
    _require_cards_access([card_id], user_id, write=False)
    if not TMA_Card.select().where(
            (TMA_Card.id == card_id) & (TMA_Card.is_deleted == False)).exists():
        raise HTTPException(404, 'Card not found')
    if not TMACardNote.table_exists():
        raise HTTPException(503, 'Card notes unavailable: migration 87 is required')


def serialize(note):
    return {field: getattr(note, field) for field in (
        'id', 'card_id', 'user_id', 'kind', 'text', 'status', 'reply', 'revision',
        'seen_revision', 'is_deleted', 'created_at', 'updated_at')}


@router.get('/{card_id}')
def list_notes(card_id: int, user_id: int = Depends(get_user_id)):
    require_card(card_id, user_id)
    return [serialize(row) for row in TMACardNote.select().where(
        (TMACardNote.card == card_id) & (TMACardNote.user_id == user_id))
        .order_by(TMACardNote.created_at, TMACardNote.id)]


@router.put('/{card_id}/{note_id}')
def save_note(card_id: int, note_id: UUID, data: NoteWrite,
              user_id: int = Depends(get_user_id)):
    require_card(card_id, user_id)
    text = data.text.strip() if data.text is not None else None
    if text == '' and not data.is_deleted:
        raise HTTPException(422, 'Text is required')
    with TMACardNote._meta.database.atomic():
        # UUID + conflict-ignore makes a lost response safe to retry.
        if text is not None:
            TMACardNote.insert(id=str(note_id), card=card_id, user_id=user_id,
                               kind=data.kind, text=text).on_conflict_ignore().execute()
        note = TMACardNote.get_or_none(TMACardNote.id == str(note_id))
        if not note or note.user_id != user_id or note.card_id != card_id:
            raise HTTPException(404, 'Note not found')
        if note.kind != data.kind:
            raise HTTPException(422, 'Record kind cannot change')
        if note.kind == 'suggestion' and (data.is_deleted or (text is not None and text != note.text)):
            raise HTTPException(409, 'Submitted suggestions cannot be edited or deleted')
        # Only moderation changes revision. An author cannot forge status/reply or
        # acknowledge a reply newer than the version actually displayed.
        seen = min(data.seen_revision, note.revision)
        changes = dict(
            is_deleted=TMACardNote.is_deleted | data.is_deleted,
            seen_revision=Case(None, ((TMACardNote.seen_revision < seen, seen),), TMACardNote.seen_revision),
            updated_at=datetime.datetime.now(),
        )
        if text is not None:
            changes['text'] = text
        TMACardNote.update(**changes).where(TMACardNote.id == note.id).execute()
        return serialize(TMACardNote.get_by_id(note.id))
