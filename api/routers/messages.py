"""Private conversations between a learner and the local Admin console."""
import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from peewee import fn

from api.dependencies.auth import get_user_id
from api.models import TMAUserMessage, TMA_Card
from api.services.collaborative_service import _require_cards_access

router = APIRouter(prefix='/messages', tags=['messages'])


class MessageWrite(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    thread_id: UUID | None = None
    card_id: int | None = Field(default=None, gt=0)


class ReadWrite(BaseModel):
    read: bool


def require_messages():
    if not TMAUserMessage.table_exists():
        raise HTTPException(503, 'Messages unavailable: migration 90 is required')


def serialize(row):
    return {field: getattr(row, field) for field in (
        'id', 'user_id', 'sender', 'kind', 'text', 'thread_id', 'card_id',
        'link', 'read_at', 'created_at')}


def root_for(message_id, user_id):
    root = TMAUserMessage.get_or_none((TMAUserMessage.id == str(message_id)) &
                                      (TMAUserMessage.user_id == user_id) &
                                      TMAUserMessage.thread.is_null())
    if not root:
        raise HTTPException(404, 'Conversation not found')
    return root


@router.get('')
def conversations(user_id: int = Depends(get_user_id)):
    require_messages()
    roots = TMAUserMessage.select().where(
        (TMAUserMessage.user_id == user_id) & TMAUserMessage.thread.is_null()
    ).order_by(TMAUserMessage.created_at.desc(), TMAUserMessage.id.desc())
    root_id = fn.COALESCE(TMAUserMessage.thread, TMAUserMessage.id)
    unread = dict(TMAUserMessage.select(root_id, fn.COUNT(TMAUserMessage.id)).where(
        (TMAUserMessage.user_id == user_id) &
        (TMAUserMessage.sender != 'user') & TMAUserMessage.read_at.is_null()
    ).group_by(root_id).tuples())
    return [{**serialize(root), 'unread_count': unread.get(root.id, 0)} for root in roots]


@router.get('/{thread_id}')
def conversation(thread_id: UUID, user_id: int = Depends(get_user_id)):
    require_messages()
    root = root_for(thread_id, user_id)
    return [serialize(row) for row in TMAUserMessage.select().where(
        (TMAUserMessage.user_id == user_id) &
        ((TMAUserMessage.id == root.id) | (TMAUserMessage.thread == root.id))
    ).order_by(TMAUserMessage.created_at, TMAUserMessage.id)]


@router.put('/{message_id}')
def send_message(message_id: UUID, data: MessageWrite, user_id: int = Depends(get_user_id)):
    require_messages()
    text = data.text.strip()
    if not text:
        raise HTTPException(422, 'Text is required')
    with TMAUserMessage._meta.database.atomic():
        existing = TMAUserMessage.get_or_none(TMAUserMessage.id == str(message_id))
        if existing:
            if existing.user_id != user_id or existing.sender != 'user' or existing.text != text or \
                    existing.thread_id != (str(data.thread_id) if data.thread_id else None) or \
                    existing.card_id != data.card_id:
                raise HTTPException(409, 'Message ID already used')
            return serialize(existing)
        if data.thread_id:
            root_for(data.thread_id, user_id)
            if data.card_id is not None:
                raise HTTPException(422, 'Card ID belongs to the first message')
            kind, card_id, link = 'reply', None, None
        elif data.card_id is not None:
            _require_cards_access([data.card_id], user_id, write=False)
            if not TMA_Card.select().where((TMA_Card.id == data.card_id) &
                                           (TMA_Card.is_deleted == False)).exists():
                raise HTTPException(404, 'Card not found')
            kind, card_id, link = 'suggestion', data.card_id, f'/cards/{data.card_id}'
        else:
            kind, card_id, link = 'message', None, None
        TMAUserMessage.insert(id=str(message_id), user_id=user_id, sender='user',
                              kind=kind, text=text, thread=str(data.thread_id) if data.thread_id else None,
                              card_id=card_id, link=link).on_conflict_ignore().execute()
        row = TMAUserMessage.get_by_id(str(message_id))
        if row.user_id != user_id or row.sender != 'user' or row.text != text or row.thread_id != \
                (str(data.thread_id) if data.thread_id else None) or row.card_id != card_id:
            raise HTTPException(409, 'Message ID already used')
        return serialize(row)


@router.put('/{thread_id}/read')
def mark_read(thread_id: UUID, data: ReadWrite, user_id: int = Depends(get_user_id)):
    require_messages()
    root = root_for(thread_id, user_id)
    TMAUserMessage.update(read_at=datetime.datetime.now() if data.read else None).where(
        (TMAUserMessage.user_id == user_id) &
        ((TMAUserMessage.id == root.id) | (TMAUserMessage.thread == root.id)) &
        (TMAUserMessage.sender != 'user')).execute()
    return {'status': 'ok'}
