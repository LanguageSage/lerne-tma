"""GameMode V2 API router - authenticated Lerne conversations."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from api.services.game_v2 import dialogue
from api.dependencies.auth import get_user_id
from api.db_workers import db_phases, run_db

router = APIRouter(prefix="/game/v2", tags=["game_v2"])




class TurnMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/session/start")
@db_phases
async def start_game_session(user_id: int = Depends(get_user_id)):
    """Initialize a new GameMode V2 session with Frau Müller for the authenticated user."""
    session = await run_db(dialogue.create_session, user_id)
    return {
        "session_id": session["session_id"],
        "character": session["character"],
        "greeting": session["character"]["initial_greeting"],
        "status": session["status"],
        "history": session["history"]
    }


@router.get("/session/{session_id}")
@db_phases
async def get_game_session(session_id: str, user_id: int = Depends(get_user_id)):
    """Get the current session state and history."""
    session = await run_db(dialogue.get_session, session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/session/{session_id}/message")
@db_phases
async def send_turn_message(
    session_id: str,
    payload: TurnMessageRequest,
    user_id: int = Depends(get_user_id),
):
    """Send user message and receive AI response from Frau Müller."""
    try:
        result = await dialogue.process_user_turn(session_id, user_id=user_id, user_message=payload.message)
        return result
    except dialogue.SessionClosed:
        raise HTTPException(status_code=400, detail="Session is closed")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except dialogue.DialogueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Internal conversation error")


@router.post("/session/{session_id}/end")
@db_phases
async def end_game_session(session_id: str, user_id: int = Depends(get_user_id)):
    """Explicitly conclude the dialogue session."""
    session = await run_db(dialogue.close_session, session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session["session_id"],
        "status": "closed",
        "farewell": "Auf Wiedersehen! Es war schön, mit Ihnen zu sprechen."
    }
