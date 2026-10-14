"""Shadow collection at the engine commit boundary; never touches dialogue/voice.

Write methods require the existing Game transaction and an owned, committed row.
No history backfill, model-derived skills, modality guesses or NPC prompt changes.
"""
import json
from fastapi import HTTPException
from api.models import TMAUser, tma_db
from api.services.game_scene import CATALOG, LIBRARY
from .catalog import DEFAULT_CATALOG
from .common import dump, fail, owned_attempt, transaction
from .flags import enabled_for
from .memory import NPCMemoryService
from .models import GameCapture, GameInteraction
from .progress import LanguageProgressService
from .schemas import MemoryEvent, MemoryFact, ServerObservation


def _in_transaction():
    if not tma_db.obj.in_transaction():
        raise RuntimeError('Game collection requires the engine transaction')


def begin_capture(attempt):
    if not enabled_for(attempt.user_id):
        return
    if attempt.situation_id not in DEFAULT_CATALOG.tasks:
        return  # Social model observations are not reviewed engine task/skill evidence.
    _in_transaction()
    tables = set(tma_db.obj.get_tables())
    required = {'tma_game_capture', 'tma_game_interaction',
                'tma_npc_memory', 'tma_communication_result', 'tma_migration_history'}
    if not required <= tables:
        fail(503, 'game_foundation_schema_not_ready')
    marker = tma_db.obj.execute_sql(
        f'SELECT migration_id FROM tma_migration_history WHERE migration_id = {tma_db.obj.param}',
        (88,)).fetchone()
    if not marker or attempt.version != 0 or attempt.outcome != 'ongoing':
        fail(503, 'game_foundation_schema_not_ready')
    # Auth can have completed just before concurrent account erasure. The engine
    # user lock also protects deletion, so a removed account cannot start capture.
    if not TMAUser.select().where(TMAUser.user_id == attempt.user_id).exists():
        fail(401, 'authentication_required')
    GameCapture.create(source_attempt=attempt.id, user_id=attempt.user_id,
                       started_at=attempt.created_at)
    NPCMemoryService().record(attempt.user_id, attempt.npc_id, MemoryEvent(
        event_id=f'{attempt.id}:encounter', attempt_id=attempt.id,
        fact=MemoryFact(kind='encounter', key='meeting', value='visited'), source='engine'))


def capture_turn(attempt, request, previous_state, event):
    if not enabled_for(attempt.user_id):
        return
    _in_transaction()
    capture = GameCapture.get_or_none(
        (GameCapture.source_attempt == attempt.id) & (GameCapture.user_id == attempt.user_id))
    if capture is None or capture.erased_at is not None:
        return  # Old, deleted, or initially non-pilot attempts are never backfilled.
    task = DEFAULT_CATALOG.tasks.get(attempt.situation_id)
    if task is None or attempt.npc_id != LIBRARY['npc']['id']:
        fail(422, 'unsupported_capture_task')
    state = json.loads(attempt.scene_state)
    kind = event['kind']
    if request.action == 'hint':
        if kind != 'hint':
            fail(422, 'invalid_engine_event')
        support = 'confirm_offer' if previous_state['offered_book_id'] else 'example_request'
    else:
        support = kind if kind in ('simplify', 'slow', 'repeat') else None
    book_id = state['borrowed_book_id'] if kind == 'borrowed' else (
        state['offered_book_id'] if kind == 'offered' else None)
    if kind in ('borrowed', 'offered') and (
            book_id not in CATALOG or not CATALOG[book_id]['available']):
        fail(422, 'invalid_engine_event')
    terminal = kind == 'borrowed' and previous_state['outcome'] == 'ongoing'
    if terminal:
        expected = 'success' if book_id == LIBRARY['scene']['target_book_id'] else 'other_book'
        if attempt.outcome != expected:
            fail(422, 'invalid_engine_outcome')
    facts = {'source': 'engine', 'modality': 'unknown', 'support': support,
             'book_id': book_id, 'outcome': attempt.outcome if terminal else None,
             'task_resolved': terminal}
    # IDs refer to real committed engine transitions, not transcript fragments.
    GameInteraction.create(
        id=f'{attempt.id}:{request.request_id}', user_id=attempt.user_id,
        source_attempt=attempt.id, source_version=attempt.version,
        request_id=str(request.request_id), task_id=task.id, kind=kind,
        facts=dump(facts), created_at=attempt.updated_at)
    if terminal:
        events = list(GameInteraction.select().where(
            (GameInteraction.source_attempt == attempt.id) &
            (GameInteraction.user_id == attempt.user_id)).order_by(GameInteraction.source_version))
        observation = ServerObservation(
            task_event_ids=[e.id for e in events if e.kind in ('offered', 'borrowed')],
            help_event_ids=[e.id for e in events if json.loads(e.facts)['support'] is not None])
        # Complete assistance and text/STT/audio modality are unavailable in MVP 2.
        # No skill evidence is emitted, even after a successful loan.
        LanguageProgressService().register_result(
            attempt.user_id, attempt.id, task.id, expected_version=attempt.version,
            observation=observation)
        NPCMemoryService().record(attempt.user_id, attempt.npc_id, MemoryEvent(
            event_id=f'{attempt.id}:outcome', attempt_id=attempt.id,
            fact=MemoryFact(kind='outcome', key='result', value=attempt.outcome), source='engine'))


def interactions(user_id, attempt_id):
    with transaction(user_id):
        owned_attempt(user_id, attempt_id)
        return [{'id': row.id, 'version': row.source_version, 'task_id': row.task_id,
                 'kind': row.kind, 'facts': json.loads(row.facts)}
                for row in GameInteraction.select().where(
                    (GameInteraction.user_id == user_id) &
                    (GameInteraction.source_attempt == attempt_id)).order_by(
                        GameInteraction.source_version)]


def pilot_user(user_id):
    if not enabled_for(user_id):
        raise HTTPException(404, 'game_foundation_disabled')
    return user_id
