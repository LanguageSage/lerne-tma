"""Conversation persistence, ownership, budgets and replay protection."""
import datetime
import hashlib
import json
from contextlib import contextmanager

from fastapi import HTTPException
from peewee import PostgresqlDatabase, SqliteDatabase, fn
from starlette.concurrency import run_in_threadpool

from api.models import TMAGameAttempt, tma_db
from api.services.game_dialogue import DialogueUnavailable, create_turn, configuration
from api.services.game_scene import LIBRARY, CATALOG, HISTORY_MESSAGES, MAX_TURNS, advance_scene, initial_scene, hint_for

DAILY_API_REQUESTS = 120
DAILY_ATTEMPTS = 20
MIN_REQUEST_INTERVAL = 1
LEASE_SECONDS = 35


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


@contextmanager
def user_transaction(user_id):
    database = tma_db.obj
    with database.connection_context():
        with database.atomic(**({'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {})):
            if isinstance(database, PostgresqlDatabase):
                # Serialize all this user's attempts across serverless workers.
                database.execute_sql('SELECT pg_advisory_xact_lock(%s)', (hash_lock(user_id),))
            yield


def hash_lock(user_id):
    return int.from_bytes(hashlib.sha256(f'game:{user_id}'.encode()).digest()[:8], 'big', signed=True)


def owned_attempt(attempt_id, user_id):
    row = TMAGameAttempt.get_or_none((TMAGameAttempt.id == attempt_id) & (TMAGameAttempt.user_id == user_id))
    if not row:
        raise HTTPException(404, 'game_attempt_not_found')
    return row


def serialize(row):
    state = json.loads(row.scene_state)
    return {'id': row.id, 'npc_id': row.npc_id, 'situation_id': row.situation_id,
            'scene': state, 'history': json.loads(row.history), 'outcome': row.outcome,
            'book': CATALOG.get(state['borrowed_book_id'] or state['offered_book_id']),
            'hint_count': row.hint_count, 'clarification_count': row.clarification_count,
            'turn_count': row.turn_count, 'max_turns': MAX_TURNS, 'version': row.version,
            'created_at': row.created_at.isoformat() + 'Z',
            'previous_attempt_at': row.previous_attempt_at.isoformat() + 'Z' if row.previous_attempt_at else None}


def start_attempt(attempt_id, user_id):
    now = utcnow()
    with user_transaction(user_id):
        existing = TMAGameAttempt.get_or_none(TMAGameAttempt.id == attempt_id)
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(404, 'game_attempt_not_found')
            return serialize(existing)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if TMAGameAttempt.select().where((TMAGameAttempt.user_id == user_id) &
                                         (TMAGameAttempt.created_at >= today)).count() >= DAILY_ATTEMPTS:
            raise HTTPException(429, 'game_daily_limit')
        previous = TMAGameAttempt.select().where((TMAGameAttempt.user_id == user_id) &
                     (TMAGameAttempt.situation_id == LIBRARY['scene']['situation_id'])).order_by(TMAGameAttempt.created_at.desc()).first()
        row = TMAGameAttempt.create(id=attempt_id, user_id=user_id, npc_id=LIBRARY['npc']['id'],
            situation_id=LIBRARY['scene']['situation_id'], scene_state=json.dumps(initial_scene()),
            history=json.dumps([{'role': 'npc', 'text': LIBRARY['scene']['opening']}], ensure_ascii=False),
            created_at=now, updated_at=now, previous_attempt_at=previous.created_at if previous else None)
        from api.game_mvp3.flags import enabled_for
        if enabled_for(user_id):
            from api.game_mvp3.integration import begin_capture
            begin_capture(row)
        return serialize(row)


def load_attempt(attempt_id, user_id):
    with tma_db.connection_context():
        return serialize(owned_attempt(attempt_id, user_id))


def request_hash(text, action):
    return hashlib.sha256(json.dumps([text, action], ensure_ascii=False).encode()).hexdigest()


def reserve_turn(attempt_id, user_id, request, mode):
    now = utcnow()
    request_id = str(request.request_id)
    digest = request_hash(request.message, request.action)
    with user_transaction(user_id):
        row = owned_attempt(attempt_id, user_id)
        if row.last_request_id == request_id:
            if row.last_request_hash != digest:
                raise HTTPException(409, 'game_request_conflict')
            return {'replay': serialize(row)}
        if row.version != request.version:
            raise HTTPException(409, 'game_state_changed')
        if row.inflight_id and row.last_request_at and (now - row.last_request_at).total_seconds() < LEASE_SECONDS:
            raise HTTPException(409, 'game_request_in_progress')
        if row.turn_count >= MAX_TURNS:
            raise HTTPException(429, 'game_turn_limit')
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        usage = TMAGameAttempt.select(fn.SUM(TMAGameAttempt.api_requests)).where(
            (TMAGameAttempt.user_id == user_id) & (TMAGameAttempt.last_request_at >= today)).scalar() or 0
        budget = 2 if request.action == 'message' and mode == 'live' else 0
        if usage + budget > DAILY_API_REQUESTS:
            raise HTTPException(429, 'game_daily_limit')
        latest = TMAGameAttempt.select(fn.MAX(TMAGameAttempt.last_request_at)).where(TMAGameAttempt.user_id == user_id).scalar()
        if latest and (now - latest).total_seconds() < MIN_REQUEST_INTERVAL:
            raise HTTPException(429, 'game_rate_limit')
        row.inflight_id = request_id
        if not row.last_request_at or row.last_request_at < today:
            row.api_requests = 0
        row.last_request_at = now
        row.api_requests += budget
        row.save()
        return {'state': json.loads(row.scene_state), 'history': json.loads(row.history), 'digest': digest}


def finish_turn(attempt_id, user_id, request, prepared, state, event, reply):
    request_id = str(request.request_id)
    with user_transaction(user_id):
        row = owned_attempt(attempt_id, user_id)
        if row.inflight_id != request_id or row.version != request.version:
            raise HTTPException(409, 'game_state_changed')
        history = prepared['history'] + [
            {'role': 'hint' if request.action == 'hint' else 'user', 'text': request.message if request.action == 'message' else reply}]
        if request.action == 'message':
            history.append({'role': 'npc', 'text': reply})
        retained = history[-HISTORY_MESSAGES:]
        if not any(m['role'] == 'npc' for m in retained):
            retained = [next(m for m in reversed(history) if m['role'] == 'npc'), *retained[-(HISTORY_MESSAGES - 1):]]
        row.history = json.dumps(retained, ensure_ascii=False)
        row.scene_state = json.dumps(state, ensure_ascii=False)
        row.outcome = state['outcome']
        row.hint_count += int(request.action == 'hint')
        row.clarification_count += int(event['kind'] == 'clarify')
        row.turn_count += 1
        row.version += 1
        row.updated_at = utcnow()
        row.last_request_id = request_id
        row.last_request_hash = prepared['digest']
        row.inflight_id = None
        row.save()
        from api.game_mvp3.flags import enabled_for
        if enabled_for(user_id):
            from api.game_mvp3.integration import capture_turn
            capture_turn(row, request, prepared['state'], event)
        return serialize(row)


def release_turn(attempt_id, user_id, request_id):
    with tma_db.connection_context():
        TMAGameAttempt.update(inflight_id=None).where((TMAGameAttempt.id == attempt_id) &
            (TMAGameAttempt.user_id == user_id) & (TMAGameAttempt.inflight_id == str(request_id))).execute()


async def send_turn(attempt_id, user_id, request):
    try:
        configured = await run_in_threadpool(configuration)
        mode = configured[0]
    except Exception:
        raise HTTPException(503, 'game_ai_unavailable') from None
    if mode == 'unconfigured' and request.action == 'message':
        raise HTTPException(503, 'game_ai_not_configured')
    prepared = await run_in_threadpool(reserve_turn, attempt_id, user_id, request, mode)
    if 'replay' in prepared:
        return prepared['replay']
    try:
        if request.action == 'hint':
            state, event = prepared['state'], {'kind': 'hint'}
            reply = hint_for(state)
        else:
            state, event, reply, _ = await create_turn(request.message, prepared['state'], prepared['history'], advance_scene, configured=configured)
        return await run_in_threadpool(finish_turn, attempt_id, user_id, request, prepared, state, event, reply)
    except DialogueUnavailable:
        raise HTTPException(503, 'game_ai_unavailable') from None
    finally:
        await run_in_threadpool(release_turn, attempt_id, user_id, request.request_id)
