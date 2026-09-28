"""Read-only projections of raw Knowledge Attempts and their materialized state."""

import math

from peewee import JOIN

from api import models
from api.services.knowledge_mastery import (
    accumulate_knowledge_evidence, empty_knowledge_state,
    explain_knowledge_attempt, parse_evaluation_data,
)


CONFIDENCE_THRESHOLD = 0.45
WEAK_PROFICIENCY_THRESHOLD = 0.40
STRONG_PROFICIENCY_THRESHOLD = 0.70
STATE_FIELDS = tuple(empty_knowledge_state())


def diagnostic_status(state):
    if state['evidence_event_count'] == 0:
        return 'unobserved'
    if state['confidence'] < CONFIDENCE_THRESHOLD:
        return 'insufficient'
    if state['proficiency'] < WEAK_PROFICIENCY_THRESHOLD:
        return 'weak'
    if state['proficiency'] < STRONG_PROFICIENCY_THRESHOLD:
        return 'developing'
    return 'strong'


def _visible_condition(user_id):
    item = models.TMAKnowledgeItem
    return (item.is_global == True) | (item.author_id == user_id)


def _catalog(user_id):
    item = models.TMAKnowledgeItem
    return list(item.select(item.id, item.language, item.category, item.name,
                            item.description, item.rule_code, item.cefr_level)
                .where(_visible_condition(user_id)).dicts())


def _states(user_id):
    row, item = models.TMAUserKnowledgeState, models.TMAKnowledgeItem
    query = (row.select(row)
             .join(item, JOIN.INNER)
             .where((row.user_id == user_id) & _visible_condition(user_id)))
    return {state.knowledge_item_id: state for state in query.iterator()}


def _history(user_id, knowledge_item_id=None):
    attempt, item = models.TMAKnowledgeAttempt, models.TMAKnowledgeItem
    query = (attempt.select(attempt.knowledge_item_id, attempt.evaluation_data,
                            attempt.event_time)
             .join(item, JOIN.INNER)
             .where((attempt.user_id == user_id) & _visible_condition(user_id)))
    if knowledge_item_id is not None:
        query = query.where(attempt.knowledge_item_id == knowledge_item_id)
    return query.order_by(attempt.knowledge_item_id, attempt.id).iterator()


def _computed_history(user_id, knowledge_item_id=None):
    result = {}
    for attempt in _history(user_id, knowledge_item_id):
        item_id = attempt.knowledge_item_id
        entry = result.setdefault(item_id, {'state': empty_knowledge_state(), 'raw_attempt_count': 0})
        entry['raw_attempt_count'] += 1
        contribution, _ = explain_knowledge_attempt(parse_evaluation_data(attempt.evaluation_data))
        if contribution is not None:
            accumulate_knowledge_evidence(entry['state'], contribution, attempt.event_time)
    return result


def _materialized_state(state):
    if state is None:
        return None
    fields = ('id', 'user_id', 'knowledge_item_id', 'attempts_count', 'last_attempt_at',
              'state_data', 'created_at', 'updated_at', *STATE_FIELDS)
    return {field: getattr(state, field) for field in fields}


def _state_matches(state, computed):
    if state is None:
        return computed['evidence_event_count'] == 0
    if state.attempts_count != computed['evidence_event_count'] or state.last_attempt_at != computed['last_evidence_at']:
        return False
    for field in STATE_FIELDS:
        actual, expected = getattr(state, field), computed[field]
        if isinstance(expected, float):
            if not math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12):
                return False
        elif actual != expected:
            return False
    return True


def _project(item, history, stored):
    computed = history['state'] if history else empty_knowledge_state()
    raw_count = history['raw_attempt_count'] if history else 0
    scorable_count = computed['evidence_event_count']
    return {
        **item, **computed,
        'diagnostic_status': diagnostic_status(computed),
        'has_evidence': scorable_count > 0,
        'raw_attempt_count': raw_count,
        'scorable_attempt_count': scorable_count,
        'ignored_attempt_count': raw_count - scorable_count,
        'materialized_state': _materialized_state(stored),
        'state_matches_rebuild': _state_matches(stored, computed),
    }


def summary(user_id):
    catalog = _catalog(user_id)
    history = _computed_history(user_id)
    states = _states(user_id)
    items = [_project(item, history.get(item['id']), states.get(item['id'])) for item in catalog]
    result = {f'{status}_count': sum(item['diagnostic_status'] == status for item in items)
              for status in ('strong', 'developing', 'weak', 'insufficient')}
    result.update(
        observed_knowledge_items=sum(item['has_evidence'] for item in items),
        unobserved_knowledge_items=sum(not item['has_evidence'] for item in items),
        raw_attempt_count=sum(item['raw_attempt_count'] for item in items),
        scorable_attempt_count=sum(item['scorable_attempt_count'] for item in items),
        ignored_attempt_count=sum(item['ignored_attempt_count'] for item in items),
        objective_event_count=sum(item['objective_event_count'] for item in items),
        self_rating_event_count=sum(item['self_rating_event_count'] for item in items),
        calculation_versions=sorted({state.calculation_version for state in states.values()}),
        state_mismatch_count=sum(not item['state_matches_rebuild'] for item in items),
    )
    return result


def list_items(user_id, *, limit, offset, sort_by, sort_dir, language=None, category=None,
               cefr_level=None, status=None, confidence_min=None, confidence_max=None,
               search=None, has_objective_evidence=None):
    catalog = _catalog(user_id)
    history = _computed_history(user_id)
    states = _states(user_id)
    items = [_project(item, history.get(item['id']), states.get(item['id'])) for item in catalog]
    if language is not None:
        items = [item for item in items if item['language'] == language]
    if category is not None:
        items = [item for item in items if item['category'] == category]
    if cefr_level is not None:
        items = [item for item in items if item['cefr_level'] == cefr_level]
    if status is not None:
        items = [item for item in items if item['diagnostic_status'] == status]
    if confidence_min is not None:
        items = [item for item in items if item['confidence'] >= confidence_min]
    if confidence_max is not None:
        items = [item for item in items if item['confidence'] <= confidence_max]
    if search:
        items = [item for item in items if search.casefold() in item['name'].casefold()]
    if has_objective_evidence is not None:
        items = [item for item in items if (item['objective_event_count'] > 0) == has_objective_evidence]
    items.sort(key=lambda item: item['id'])
    populated = sorted((item for item in items if item[sort_by] is not None),
                       key=lambda item: item[sort_by], reverse=sort_dir == 'desc')
    ordered = populated + [item for item in items if item[sort_by] is None]
    return {'items': ordered[offset:offset + limit], 'total': len(items),
            'limit': limit, 'offset': offset}


def get_item(user_id, knowledge_item_id):
    item = (models.TMAKnowledgeItem.select(
        models.TMAKnowledgeItem.id, models.TMAKnowledgeItem.language,
        models.TMAKnowledgeItem.category, models.TMAKnowledgeItem.name,
        models.TMAKnowledgeItem.description, models.TMAKnowledgeItem.rule_code,
        models.TMAKnowledgeItem.cefr_level)
        .where((models.TMAKnowledgeItem.id == knowledge_item_id) & _visible_condition(user_id))
        .dicts().first())
    if item is None:
        return None
    history = _computed_history(user_id, knowledge_item_id).get(knowledge_item_id)
    state = models.TMAUserKnowledgeState.get_or_none(
        (models.TMAUserKnowledgeState.user_id == user_id) &
        (models.TMAUserKnowledgeState.knowledge_item_id == knowledge_item_id))
    return _project(item, history, state)


def item_exists(user_id, knowledge_item_id):
    item = models.TMAKnowledgeItem
    return item.select(item.id).where((item.id == knowledge_item_id) &
                                      _visible_condition(user_id)).exists()


def attempt_diagnostic(attempt):
    data = parse_evaluation_data(attempt.evaluation_data)
    contribution, reason = explain_knowledge_attempt(data)
    exercise = data.get('exercise_evidence') if isinstance(data, dict) else None
    exercise = exercise if isinstance(exercise, dict) else {}
    result = {
        'id': attempt.id, 'client_event_id': attempt.client_event_id,
        'card_id': attempt.card_id, 'review_id': attempt.review_id,
        'event_time': attempt.event_time, 'created_at': attempt.created_at,
        'evaluation_data': data if data is not None else attempt.evaluation_data,
        'scorable': contribution is not None, 'ignored_reason': reason,
        'evaluation_type': data.get('evaluation_type') if isinstance(data, dict) else None,
        'schema_version': data.get('schema_version') if isinstance(data, dict) else None,
        'rating': data.get('rating') if isinstance(data, dict) else None,
        'score': contribution.score if contribution else None,
        'weight': contribution.weight if contribution else None,
        'positive_delta': contribution.positive_delta if contribution else None,
        'negative_delta': contribution.negative_delta if contribution else None,
        'has_objective': contribution.has_objective if contribution else False,
        'has_self_rating': contribution.has_self_rating if contribution else False,
    }
    if isinstance(data, dict) and data.get('evaluation_type') == 'hybrid':
        result['objective_evidence'] = {field: exercise.get(field) for field in (
            'attempt_count', 'mistake_count', 'first_try_correct', 'auto_evaluated', 'completed')}
    return _json_safe(result)


def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def list_attempts(user_id, knowledge_item_id, *, limit, offset):
    attempt = models.TMAKnowledgeAttempt
    query = attempt.select().where((attempt.user_id == user_id) &
                                   (attempt.knowledge_item_id == knowledge_item_id))
    total = query.count()
    rows = query.order_by(attempt.event_time.desc(), attempt.id.desc()).limit(limit).offset(offset)
    return {'items': [attempt_diagnostic(row) for row in rows], 'total': total,
            'limit': limit, 'offset': offset}
