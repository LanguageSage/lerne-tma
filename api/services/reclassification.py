"""Resumable request-bound CEFR batches, using the existing receipt table."""
import asyncio
import datetime
import hashlib
import json
import logging
import time
from uuid import uuid4

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from api import ai_service, models
from .cefr_metadata import build_ai_cefr_payload, build_local_cefr_payload, merge_cefr_metadata
from .classifier import classify_sentence_fast
from .collaborative_service import _require_can_mutate, _require_cards_access

logger = logging.getLogger(__name__)
BATCH_SIZE = 10
AI_TIMEOUT = 20
LEASE_SECONDS = 60
MAX_ATTEMPTS = 3


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _authorize(scope, user_id):
    if scope['deck_id']:
        _require_can_mutate(user_id, 'deck', scope['deck_id'])
    elif scope['card_ids']:
        _require_cards_access(scope['card_ids'], user_id)


def _progress(state, operation_id, status, cards=None, error=None):
    return {
        'operation_id': operation_id, 'status': status,
        'complete': not state['pending'], 'total_count': state['total'],
        'completed_count': state['total'] - len(state['pending']),
        'remaining_count': len(state['pending']), 'next_batch': state['next_batch'],
        'updated_count': len(cards or []), 'cards': cards or [],
        'pending_background_count': 0, 'error_code': error,
    }


def _claim(scope, user_id, operation_id, batch_index):
    with models.tma_db.connection_context(), models.tma_db.atomic():
        _authorize(scope, user_id)
        key = f'classify:{user_id}:{operation_id}'
        fingerprint = hashlib.sha256(_dump(scope).encode()).hexdigest()
        receipt = models.TMAOfflineBatch.get_or_none(models.TMAOfflineBatch.key == key)
        if receipt is None:
            if batch_index != 0:
                raise HTTPException(409, 'Не найдена операция переклассификации')
            query = models.TMA_Card.select(models.TMA_Card.id).where(models.TMA_Card.is_deleted == False)
            if scope['deck_id']:
                query = query.where(models.TMA_Card.deck_id == scope['deck_id'])
            else:
                query = query.where(models.TMA_Card.id.in_(scope['card_ids']))
            ids = [c.id for c in query.order_by(models.TMA_Card.position, models.TMA_Card.id)]
            state = {'pending': ids, 'total': len(ids), 'next_batch': 0, 'attempts': {}, 'lease': 0}
            models.TMAOfflineBatch.insert(key=key, payload_hash=fingerprint, response=_dump(state)).on_conflict_ignore().execute()
            receipt = models.TMAOfflineBatch.get_by_id(key)
        if receipt.payload_hash != fingerprint:
            raise HTTPException(409, 'Идентификатор операции уже использован с другими данными')
        state = json.loads(receipt.response)
        if batch_index < state['next_batch']:
            # A lost response is replayed without repeating provider calls or writes.
            return {'response': state['last_result']}
        if batch_index != state['next_batch']:
            raise HTTPException(409, 'Неверный номер пакета')
        if not state['pending']:
            return {'response': _progress(state, operation_id, 'ok')}
        if state['lease'] > time.time():
            return {'response': _progress(state, operation_id, 'busy', error='classification.busy')}
        ids = state['pending'][:BATCH_SIZE]
        _require_cards_access(ids, user_id)
        cards = list(models.TMA_Card.select().where(models.TMA_Card.id.in_(ids)))
        if any(c.is_deleted or (scope['deck_id'] and c.deck_id != scope['deck_id']) for c in cards):
            raise HTTPException(409, 'Карточки перемещены или удалены. Начните новую операцию.')
        if any(state['attempts'].get(str(cid), 0) >= MAX_ATTEMPTS for cid in ids):
            if time.time() - state.get('attempted_at', 0) < 300:
                return {'response': _progress(state, operation_id, 'partial', error='classification.attempt_limit')}
            state['attempts'] = {}
        for cid in ids:
            state['attempts'][str(cid)] = state['attempts'].get(str(cid), 0) + 1
        state['lease'] = time.time() + LEASE_SECONDS
        state['attempted_at'] = time.time()
        state['token'] = uuid4().hex
        claimed = _dump(state)
        changed = models.TMAOfflineBatch.update(response=claimed).where(
            (models.TMAOfflineBatch.key == key) & (models.TMAOfflineBatch.response == receipt.response)).execute()
        if not changed:
            return {'response': _progress(state, operation_id, 'busy', error='classification.busy')}
        return {'key': key, 'claimed': claimed, 'state': state, 'cards': [
            {'id': c.id, 'deck_id': c.deck_id, 'front': c.front_text, 'updated_at': c.updated_at,
             'tags': c.tags, 'metadata': c.metadata} for c in cards]}


def _finish(claim, results, error, user_id, operation_id):
    with models.tma_db.connection_context(), models.tma_db.atomic():
        # Acquire the receipt row by CAS before writing cards. An expired worker
        # cannot overwrite the results of a newer claim. No lock spans AI I/O.
        if not models.TMAOfflineBatch.update(response=claim['claimed']).where(
                (models.TMAOfflineBatch.key == claim['key']) &
                (models.TMAOfflineBatch.response == claim['claimed'])).execute():
            raise HTTPException(409, 'Пакет уже продолжен другим запросом')
        state = claim['state']
        updated = []
        for original, payload in results:
            _require_cards_access([original['id']], user_id)
            card = models.TMA_Card.get_by_id(original['id'])
            if (card.is_deleted or card.deck_id != original['deck_id'] or
                    card.front_text != original['front'] or card.updated_at != original['updated_at'] or
                    card.tags != original['tags'] or card.metadata != original['metadata']):
                error = 'classification.card_changed'
                continue
            tags = [t for t in (card.tags or '').split(',') if t and t.strip().upper() not in {'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}]
            card.tags = ','.join([*tags, payload['level']])
            card.metadata = merge_cefr_metadata(card.metadata, payload)
            card.updated_at = datetime.datetime.now()
            # Never save stale text, media or other card fields after AI waiting.
            saved = models.TMA_Card.update(tags=card.tags, metadata=card.metadata, updated_at=card.updated_at).where(
                (models.TMA_Card.id == card.id) & (models.TMA_Card.updated_at == original['updated_at']) &
                (models.TMA_Card.front_text == original['front']) & (models.TMA_Card.deck == original['deck_id']) &
                (models.TMA_Card.tags == original['tags']) & (models.TMA_Card.metadata == original['metadata']) &
                (models.TMA_Card.is_deleted == False)).execute()
            if not saved:
                error = 'classification.card_changed'
                continue
            state['pending'].remove(card.id)
            state['attempts'].pop(str(card.id), None)
            updated.append({'id': card.id, 'deck_id': card.deck_id, 'front': card.front_text,
                            'tags': card.tags, 'level': payload['level'], 'cefr': payload,
                            'source': 'local_rules' if payload['source'] == 'local' else 'ai'})
        state['lease'] = 0
        state['next_batch'] += 1
        status = 'partial' if error else 'more' if state['pending'] else 'ok'
        response = _progress(state, operation_id, status, updated, error)
        state['last_result'] = response
        models.TMAOfflineBatch.update(response=_dump(state)).where(models.TMAOfflineBatch.key == claim['key']).execute()
        return response


async def classify_batch(request, user_id):
    operation_id = str(request.operation_id or uuid4())
    scope = {'deck_id': request.deck_id, 'card_ids': sorted(set(request.card_ids or [])),
             'target_language': (request.target_language or 'de').lower()}
    claim = await run_in_threadpool(_claim, scope, user_id, operation_id, request.batch_index)
    if 'response' in claim:
        return claim['response']
    results, ambiguous = [], []
    error = None
    for card in claim['cards']:
        local = classify_sentence_fast((card['front'] or '').strip(), 'de') if scope['target_language'] == 'de' else {}
        if local.get('confidence', 0) >= .8:
            results.append((card, build_local_cefr_payload(local)))
        else:
            ambiguous.append(card)
    if ambiguous:
        try:
            levels = await asyncio.wait_for(ai_service.classify_phrases_batch(
                [(c['front'] or '').strip() for c in ambiguous], scope['target_language'], strict=True), AI_TIMEOUT)
            validated = [(c, build_ai_cefr_payload(level)) for c, level in zip(ambiguous, levels, strict=True)]
            if any(payload['level'] is None for _, payload in validated):
                raise ValueError('Invalid CEFR levels')
            results.extend(validated)
        except Exception as exc:
            logger.warning('CEFR batch unavailable: %s', type(exc).__name__)
            error = 'classification.ai_unavailable'
    # Cancellation deliberately propagates: the lease expires and the same
    # batch can be retried. Completed batches remain committed in the receipt.
    return await run_in_threadpool(_finish, claim, results, error, user_id, operation_id)
