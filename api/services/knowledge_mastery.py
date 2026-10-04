"""Mastery v1: raw knowledge attempts are the only source of truth."""

import datetime
import hashlib
import json
import logging
import math
from dataclasses import dataclass

from peewee import PostgresqlDatabase, SqliteDatabase

from api import models


logger = logging.getLogger(__name__)
CALCULATION_VERSION = 'mastery-v1'
SELF_RATING_SCORES = {
    'again': 0.10, 'hard': 0.40, 'good': 0.75, 'easy': 0.95,
    'ext_0': 0.10, 'ext_1': 0.25, 'ext_2': 0.40, 'ext_3': 0.575,
    'ext_4': 0.75, 'ext_5': 0.85, 'ext_6': 0.95, 'ext_7': 1.00,
}
OBJECTIVE_ATTEMPT_SCORES = {1: 1.00, 2: 0.80, 3: 0.65, 4: 0.55}
OBJECTIVE_5_PLUS = 0.45
SELF_RATING_WEIGHT = 0.5
HYBRID_WEIGHT = 1.0
HYBRID_OBJECTIVE_FACTOR = 0.8
HYBRID_SELF_FACTOR = 0.2
CONFIDENCE_SCALE = 5.0


@dataclass(frozen=True)
class Evidence:
    score: float
    weight: float
    has_objective: bool
    has_self_rating: bool

    @property
    def positive_delta(self):
        return self.weight * self.score

    @property
    def negative_delta(self):
        return self.weight * (1 - self.score)


def score_knowledge_attempt(evaluation_data):
    """Return a contribution, or None for an event v1 cannot interpret."""
    contribution, reason = explain_knowledge_attempt(evaluation_data)
    if reason in ('objective_not_auto_evaluated', 'objective_not_completed',
                  'invalid_attempt_count', 'invalid_first_try_correct'):
        logger.warning('Unscorable hybrid knowledge evidence: invalid objective fields')
    return contribution


def explain_knowledge_attempt(evaluation_data):
    """Return (contribution, stable ignored reason) using the v1 scoring rules."""
    if not isinstance(evaluation_data, dict):
        return None, 'invalid_evaluation_data'
    evaluation_type = evaluation_data.get('evaluation_type')
    version = evaluation_data.get('schema_version')
    rating = evaluation_data.get('rating')
    if evaluation_type not in ('self_rating', 'hybrid'):
        return None, 'unsupported_evaluation_type'
    if type(version) is not int or version != (1 if evaluation_type == 'self_rating' else 2):
        return None, 'unsupported_schema_version'
    if type(rating) is not str or rating not in SELF_RATING_SCORES:
        return None, 'unknown_rating'
    rating_score = SELF_RATING_SCORES[rating]
    if evaluation_type == 'self_rating':
        return Evidence(rating_score, SELF_RATING_WEIGHT, False, True), None
    exercise = evaluation_data.get('exercise_evidence')
    if not isinstance(exercise, dict):
        return None, 'missing_exercise_evidence'
    count = exercise.get('attempt_count')
    first_try = exercise.get('first_try_correct')
    if exercise.get('auto_evaluated') is not True:
        return None, 'objective_not_auto_evaluated'
    if exercise.get('completed') is not True:
        return None, 'objective_not_completed'
    if type(count) is not int or count < 1:
        return None, 'invalid_attempt_count'
    if type(first_try) is not bool or first_try != (count == 1):
        return None, 'invalid_first_try_correct'
    objective = OBJECTIVE_ATTEMPT_SCORES.get(count, OBJECTIVE_5_PLUS)
    score = objective * HYBRID_OBJECTIVE_FACTOR + rating_score * HYBRID_SELF_FACTOR
    return Evidence(score, HYBRID_WEIGHT, True, True), None


def parse_evaluation_data(value):
    try:
        return json.loads(value) if value else None
    except (TypeError, ValueError):
        return None


def knowledge_transaction():
    database = models.tma_db.obj
    return models.tma_db.atomic(**({'lock_type': 'IMMEDIATE'} if isinstance(database, SqliteDatabase) else {}))


def _lock_pair(user_id, knowledge_item_id):
    database = models.tma_db.obj
    if isinstance(database, PostgresqlDatabase):
        key = f'{user_id}:{knowledge_item_id}'.encode('ascii')
        lock_id = int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), 'big', signed=True)
        database.execute_sql('SELECT pg_advisory_xact_lock(%s)', (lock_id,))
    elif not isinstance(database, SqliteDatabase):
        raise RuntimeError('Unsupported knowledge state database')


def normalize_event_time(value):
    if isinstance(value, str):
        value = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is not None:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def empty_knowledge_state():
    return dict(positive_evidence=0.0, negative_evidence=0.0, evidence_mass=0.0,
                proficiency=0.5, confidence=0.0, evidence_event_count=0,
                objective_event_count=0, self_rating_event_count=0,
                last_evidence_at=None, calculation_version=CALCULATION_VERSION)


def accumulate_knowledge_evidence(state, contribution, event_time):
    state['positive_evidence'] += contribution.positive_delta
    state['negative_evidence'] += contribution.negative_delta
    state['evidence_mass'] += contribution.weight
    state['evidence_event_count'] += 1
    state['objective_event_count'] += int(contribution.has_objective)
    state['self_rating_event_count'] += int(contribution.has_self_rating)
    event_time = normalize_event_time(event_time)
    if state['last_evidence_at'] is None or event_time > state['last_evidence_at']:
        state['last_evidence_at'] = event_time
    state['proficiency'] = (1 + state['positive_evidence']) / (2 + state['evidence_mass'])
    state['confidence'] = 1 - math.exp(-state['evidence_mass'] / CONFIDENCE_SCALE)


def _save_state(user_id, knowledge_item_id, state):
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    values = {**state, 'updated_at': now,
              'attempts_count': state['evidence_event_count'],
              'last_attempt_at': state['last_evidence_at']}
    updated = (models.TMAUserKnowledgeState.update(**values)
               .where(models.TMAUserKnowledgeState.user_id == user_id,
                      models.TMAUserKnowledgeState.knowledge_item_id == knowledge_item_id).execute())
    if not updated:
        models.TMAUserKnowledgeState.create(user_id=user_id, knowledge_item_id=knowledge_item_id,
                                             **values)


def _rebuild_locked(user_id, knowledge_item_id):
    state = empty_knowledge_state()
    attempts = (models.TMAKnowledgeAttempt.select()
                .where(models.TMAKnowledgeAttempt.user_id == user_id,
                       models.TMAKnowledgeAttempt.knowledge_item_id == knowledge_item_id)
                .order_by(models.TMAKnowledgeAttempt.id))
    for attempt in attempts:
        evaluation_data = parse_evaluation_data(attempt.evaluation_data)
        contribution = score_knowledge_attempt(evaluation_data)
        if contribution is not None:
            accumulate_knowledge_evidence(state, contribution, attempt.event_time)
    if state['evidence_event_count']:
        _save_state(user_id, knowledge_item_id, state)
        return models.TMAUserKnowledgeState.get(
            models.TMAUserKnowledgeState.user_id == user_id,
            models.TMAUserKnowledgeState.knowledge_item_id == knowledge_item_id)
    (models.TMAUserKnowledgeState.delete()
     .where(models.TMAUserKnowledgeState.user_id == user_id,
            models.TMAUserKnowledgeState.knowledge_item_id == knowledge_item_id).execute())
    return None


def rebuild_knowledge_state(user_id, knowledge_item_id):
    """Replace one derived state from immutable history in a single transaction."""
    with knowledge_transaction():
        _lock_pair(user_id, knowledge_item_id)
        return _rebuild_locked(user_id, knowledge_item_id)


def rebuild_all_knowledge_states():
    """Rebuild derived states for every pair present in raw attempts (manual maintenance)."""
    pairs = (models.TMAKnowledgeAttempt.select(
        models.TMAKnowledgeAttempt.user_id, models.TMAKnowledgeAttempt.knowledge_item_id)
        .distinct().tuples())
    rebuilt = 0
    for user_id, knowledge_item_id in pairs.iterator():
        rebuild_knowledge_state(user_id, knowledge_item_id)
        rebuilt += 1
    return rebuilt


def apply_created_attempt(attempt, evaluation_data):
    """Called inside the attempt-insert transaction, after locking the pair."""
    contribution = score_knowledge_attempt(evaluation_data)
    if contribution is None:
        return
    user_id, knowledge_item_id = attempt.user_id, attempt.knowledge_item_id
    state_row = models.TMAUserKnowledgeState.get_or_none(
        models.TMAUserKnowledgeState.user_id == user_id,
        models.TMAUserKnowledgeState.knowledge_item_id == knowledge_item_id)
    if state_row is None or state_row.calculation_version != CALCULATION_VERSION:
        _rebuild_locked(user_id, knowledge_item_id)
        return
    state = {field: getattr(state_row, field) for field in empty_knowledge_state()}
    accumulate_knowledge_evidence(state, contribution, attempt.event_time)
    _save_state(user_id, knowledge_item_id, state)


def lock_knowledge_pair(user_id, knowledge_item_id):
    """Serialize attempt insert and state update for this pair."""
    _lock_pair(user_id, knowledge_item_id)
