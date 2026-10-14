"""Authenticated read/delete API, gated by isolated mode and the pilot owner."""
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from api.auth.dependencies import get_authenticated_user_id
from .integration import interactions, pilot_user
from .privacy import delete_user_data
from .memory import NPCMemoryService
from .progress import LanguageProgressService

router = APIRouter(prefix='/game-foundation', tags=['game-foundation'])
def get_pilot_user(user_id: Annotated[int, Depends(get_authenticated_user_id)]):
    return pilot_user(user_id)


Owner = Annotated[int, Depends(get_pilot_user)]
memory = NPCMemoryService()
progress = LanguageProgressService()


@router.get('/attempts/{attempt_id}/events')
def events(attempt_id: UUID, user_id: Owner):
    return interactions(user_id, str(attempt_id))


@router.delete('/data')
def erase_data(user_id: Owner, include_source_attempts: bool = False):
    return delete_user_data(user_id, include_source_attempts=include_source_attempts)


@router.get('/npcs/{npc_id}/memories')
def memories(npc_id: str, user_id: Owner,
             values: Annotated[list[str] | None, Query(max_length=20)] = None,
             limit: int = Query(default=12, ge=1, le=12)):
    return memory.relevant(user_id, npc_id, values=values or (), limit=limit)


@router.delete('/npcs/{npc_id}/memories/{memory_id}', status_code=204)
def delete_memory(npc_id: str, memory_id: UUID, user_id: Owner):
    memory.delete(user_id, npc_id, str(memory_id))


@router.delete('/npcs/{npc_id}/memories')
def clear_npc_memory(npc_id: str, user_id: Owner):
    return {'cleared': memory.clear(user_id, npc_id)}


@router.delete('/memories')
def clear_memory(user_id: Owner):
    return {'cleared': memory.clear(user_id)}


@router.get('/results')
def results(user_id: Owner, task_id: str | None = None, language: str | None = None,
            limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    return progress.history(user_id, task_id=task_id, language=language, limit=limit, offset=offset)


@router.get('/comparison')
def comparison(earlier_id: UUID, later_id: UUID, user_id: Owner):
    return progress.compare(user_id, str(earlier_id), str(later_id))


@router.get('/skills')
def skills(user_id: Owner, language: str = Query(min_length=2, max_length=16),
           modality: Literal['text', 'speech_transcript', 'verified_audio'] = 'text'):
    return progress.skills(user_id, language=language, modality=modality)
