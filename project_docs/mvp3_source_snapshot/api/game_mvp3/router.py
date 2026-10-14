"""Prepared authenticated read/delete API. NOT mounted in api.main."""
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from api.auth.dependencies import get_authenticated_user_id
from .common import transaction
from .memory import NPCMemoryService
from .progress import LanguageProgressService

router = APIRouter(prefix='/game-foundation', tags=['game-foundation'])
Owner = Annotated[int, Depends(get_authenticated_user_id)]
memory = NPCMemoryService()
progress = LanguageProgressService()


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
