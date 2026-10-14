"""Experimental online Game Mode; all persisted attempts require an authenticated owner."""
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from api.auth.dependencies import get_authenticated_user_id
from api.services.game_dialogue import configuration
from api.services.game_scene import NEIGHBOR
from api.services.game_service import start_attempt, load_attempt, send_turn

router = APIRouter(prefix='/game', tags=['game'])


class StartRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    version: int = Field(ge=0)
    action: Literal['message', 'hint', 'end'] = 'message'
    message: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def validate_message(self):
        self.message = self.message.strip()
        if self.action == 'message' and not self.message:
            raise ValueError('A message is required')
        if self.action != 'message' and self.message:
            raise ValueError('Support/end actions do not accept a message')
        return self


@router.get('/scene')
async def scene(user_id: int = Depends(get_authenticated_user_id)):
    try:
        mode, _ = await run_in_threadpool(configuration)
    except Exception:
        mode = 'unavailable'
    return {'npc': {key: NEIGHBOR['npc'][key] for key in ('id', 'name', 'age', 'profession', 'tts_voice')},
            'scene': {key: NEIGHBOR['scene'][key] for key in ('id', 'name', 'situation_id')},
            'ai_mode': mode}


@router.post('/attempts')
def start(request: StartRequest, user_id: int = Depends(get_authenticated_user_id)):
    return start_attempt(str(request.attempt_id), user_id)


@router.get('/attempts/{attempt_id}')
def attempt(attempt_id: UUID, user_id: int = Depends(get_authenticated_user_id)):
    return load_attempt(str(attempt_id), user_id)


@router.post('/attempts/{attempt_id}/turns')
async def turn(attempt_id: UUID, request: TurnRequest, user_id: int = Depends(get_authenticated_user_id)):
    return await send_turn(str(attempt_id), user_id, request)
