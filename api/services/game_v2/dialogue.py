"""GameMode V2 - Dialogue service managing conversation turns with Frau Müller."""
import asyncio
import logging
import uuid
import json
from api import models
from api.db_workers import run_db
from starlette.concurrency import run_in_threadpool
from typing import List, Optional
from datetime import datetime, timezone

from api.services.answer_evaluation import configured_ai
from api.services.game_v2.scenario import FRAU_MUELLER_SCENARIO, SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# Reuse the existing namespaced service-record store; no new schema or accounts.
def _key(session_id, user_id):
    return f"game-v2:{user_id}:{session_id}"


def _save(session, previous=None):
    value = json.dumps(session, ensure_ascii=False)
    key = _key(session['session_id'], session['user_id'])
    if previous is None:
        models.TMAOfflineBatch.create(key=key, payload_hash='game-v2', response=value)
    else:
        changed = (models.TMAOfflineBatch.update(response=value)
                   .where((models.TMAOfflineBatch.key == key) &
                          (models.TMAOfflineBatch.response == previous)).execute())
        if changed != 1:
            raise DialogueUnavailable("Conversation changed. Please reload the session.")
    return session


class DialogueUnavailable(Exception):
    pass


class SessionClosed(Exception):
    pass


def create_session(user_id: int) -> dict:
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    session = {
        "session_id": session_id,
        "user_id": user_id,
        "character": FRAU_MUELLER_SCENARIO["character"],
        "created_at": now,
        "status": "active",  # active | closed
        "history": [
            {
                "role": "assistant",
                "text": FRAU_MUELLER_SCENARIO["character"]["initial_greeting"],
                "created_at": now
            }
        ]
    }
    _save(session)
    return session


def get_session(session_id: str, user_id: int) -> Optional[dict]:
    record = models.TMAOfflineBatch.get_or_none(
        models.TMAOfflineBatch.key == _key(session_id, user_id))
    return json.loads(record.response) if record else None


def close_session(session_id: str, user_id: int) -> Optional[dict]:
    session = get_session(session_id, user_id)
    if not session:
        return None
    previous = json.dumps(session, ensure_ascii=False)
    session["status"] = "closed"
    session["closed_at"] = datetime.now(timezone.utc).isoformat()
    return _save(session, previous)


async def generate_assistant_reply(history: List[dict]) -> str:
    """Generate in-character response using Lerne's existing AI configuration."""
    try:
        client, configured_model = await run_in_threadpool(configured_ai)
        client.json_output = False
        client.key_attempts = 1
        client.request_attempts = 1
    except Exception:
        logger.warning("Game Mode AI configuration unavailable")
        raise DialogueUnavailable("AI configuration unavailable.") from None

    candidate_models = [configured_model]

    # Format dialogue history for context
    dialogue_context = []
    for msg in history[-8:]:  # keep last 8 messages for tight context
        role = "Frau Müller" if msg["role"] == "assistant" else "Nachbar"
        dialogue_context.append(f"{role}: {msg['text']}")

    prompt_content = "\n".join(dialogue_context)
    user_prompt = f"Bisheriger Dialogverlauf:\n{prompt_content}\n\nAntworte jetzt als Frau Müller (maximal 1-2 kurze Sätze):"

    for model in candidate_models:
        try:
            reply_raw, success = await asyncio.wait_for(
                client.chat_completion(
                    system_prompt=SYSTEM_PROMPT,
                    user_message=user_prompt,
                    model=model,
                    temperature=0.7,
                    max_output_tokens=2048,
                ),
                timeout=25.0,
            )
            if success and reply_raw:
                reply_text = reply_raw.strip().strip('"').strip("'").strip()
                if reply_text.startswith("Frau Müller:"):
                    reply_text = reply_text[len("Frau Müller:"):].strip()
                if reply_text:
                    return reply_text
        except asyncio.TimeoutError:
            logger.warning("GameMode V2 model %s timed out", model)
        except Exception:
            logger.warning("Game Mode AI request failed")

    logger.warning("Game Mode AI unavailable")
    raise DialogueUnavailable("AI provider returned failure.")


async def process_user_turn(session_id: str, user_id: int, user_message: str) -> dict:
    session = await run_db(get_session, session_id, user_id)
    if not session:
        raise ValueError("Session not found.")
    if session["status"] == "closed":
        raise SessionClosed("Session is closed. No further messages allowed.")

    clean_message = user_message.strip()
    if not clean_message:
        raise ValueError("Message cannot be empty.")

    now = datetime.now(timezone.utc).isoformat()
    history = session["history"]
    user_entry = {
        "role": "user",
        "text": clean_message,
        "created_at": now
    }

    reply_text = await generate_assistant_reply([*history, user_entry])
    previous = json.dumps(session, ensure_ascii=False)

    reply_entry = {
        "role": "assistant",
        "text": reply_text,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    session["history"] = [*history, user_entry, reply_entry]
    await run_db(_save, session, previous)

    return {
        "session_id": session_id,
        "status": session["status"],
        "reply": reply_entry,
        "history": session["history"]
    }
