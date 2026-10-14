"""Compact, pair-owned memory. Never imports or exposes progress assessments."""
import json
import re
from datetime import timedelta
from uuid import uuid4
from .catalog import DEFAULT_CATALOG
from .common import digest, dump, fail, iso, owned_attempt, transaction, utc_naive, utcnow
from .models import NPCMemory
from .schemas import MemoryEvent, MemoryFact

MAX_MEMORIES = 12
CONTEXT_CHARS = 4000


def serialize(row):
    return {'id': row.id, 'npc_id': row.npc_id, 'fact': json.loads(row.fact),
            'source': row.source, 'confidence': row.confidence, 'revision': row.revision,
            'source_attempt_id': row.source_attempt_id,
            'occurred_at': iso(row.occurred_at),
            'created_at': iso(row.created_at), 'updated_at': iso(row.updated_at),
            'expires_at': iso(row.expires_at), 'deleted': row.deleted_at is not None}


class NPCMemoryService:
    def __init__(self, catalog=DEFAULT_CATALOG, retention_days=180):
        if type(retention_days) is not int or not 1 <= retention_days <= 3650:
            raise ValueError('Invalid retention period')
        self.catalog = catalog
        self.retention_days = retention_days

    def _validate(self, attempt, fact, source, evidence):
        if fact.value not in self.catalog.memory_values.get((fact.kind, fact.key), ()):
            fail(422, 'unsupported_memory_fact')
        if source == 'engine':
            if fact.kind == 'encounter':
                return
            if fact.kind == 'outcome':
                if fact.value == attempt.outcome:
                    return
                fail(422, 'memory_event_not_confirmed')
            # Future promises/agreements need explicit structured server events.
            events = json.loads(attempt.scene_state).get('confirmed_memory_events', [])
            if isinstance(events, list) and fact.model_dump() in events:
                return
            fail(422, 'memory_event_not_confirmed')
        history = json.loads(attempt.history)
        texts = [m['text'] for m in history if m.get('role') == 'user' and isinstance(m.get('text'), str)]
        if not evidence or not any(evidence in text for text in texts):
            fail(422, 'memory_evidence_missing')
        # A model guess cannot become a confirmed encounter, outcome or agreement.
        if fact.kind not in ('topic', 'preference'):
            fail(422, 'memory_event_not_confirmed')
        if source == 'user_statement':
            terms = self.catalog.statement_terms.get(fact.value, ())
            if not any(re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', evidence, re.I) for term in terms):
                fail(422, 'memory_evidence_not_specific')
            # Personal preferences need an explicit world/engine event. A word such
            # as "Gemüse" alone shows a topic, not a preference or a promise.
            if fact.kind == 'preference':
                events = json.loads(attempt.scene_state).get('confirmed_memory_events', [])
                if not isinstance(events, list) or fact.model_dump() not in events:
                    fail(422, 'memory_event_not_confirmed')

    def record(self, user_id, npc_id, event: MemoryEvent):
        if not isinstance(event, MemoryEvent):
            raise TypeError('Expected validated MemoryEvent')
        with transaction(user_id):
            attempt = owned_attempt(user_id, event.attempt_id, lock=True)
            if attempt.npc_id != npc_id:
                fail(404, 'attempt_not_found')
            event_hash = digest(event.model_dump(mode='json'))
            row = NPCMemory.get_or_none(
                (NPCMemory.user_id == user_id) & (NPCMemory.npc_id == npc_id) &
                (NPCMemory.event_id == event.event_id))
            if row:
                if row.event_hash != event_hash:
                    fail(409, 'memory_event_conflict')
                return serialize(row)
            self._validate(attempt, event.fact, event.source, event.evidence)
            now = utcnow()
            expiry = utc_naive(event.expires_at) if event.expires_at else now + timedelta(days=self.retention_days)
            if not now < expiry <= now + timedelta(days=self.retention_days):
                fail(422, 'invalid_memory_expiry')
            row = NPCMemory.create(
                id=str(uuid4()), user_id=user_id, npc_id=npc_id, event_id=event.event_id,
                event_hash=event_hash, source_attempt=attempt.id,
                fact=dump(event.fact.model_dump()), value_code=event.fact.value, source=event.source,
                confidence='unconfirmed' if event.source == 'model_inference' else 'confirmed',
                occurred_at=attempt.created_at, created_at=now, updated_at=now, expires_at=expiry)
            return serialize(row)

    def relevant(self, user_id, npc_id, *, values=(), limit=MAX_MEMORIES):
        if type(limit) is not int or not 1 <= limit <= MAX_MEMORIES:
            fail(422, 'invalid_memory_limit')
        if len(values) > 20:
            fail(422, 'invalid_memory_filter')
        with transaction(user_id):
            query = NPCMemory.select().where(
                (NPCMemory.user_id == user_id) & (NPCMemory.npc_id == npc_id) &
                NPCMemory.deleted_at.is_null() & (NPCMemory.confidence == 'confirmed') &
                (NPCMemory.expires_at > utcnow())).order_by(
                    NPCMemory.updated_at.desc(), NPCMemory.id)
            if values:
                query = query.where(NPCMemory.value_code.in_(values))
            query = query.limit(limit)
            selected = []
            used = 0
            for row in query.iterator():
                fact = json.loads(row.fact)
                item = {'fact': fact, 'source': row.source,
                        'source_attempt_id': row.source_attempt_id, 'met_at': iso(row.occurred_at)}
                size = len(dump(item))
                if used + size > CONTEXT_CHARS or len(selected) == limit:
                    break
                selected.append(item)
                used += size
            return selected

    def update(self, user_id, npc_id, memory_id, fact: MemoryFact, *, expected_revision,
               source, evidence=None, source_attempt_id=None):
        if not isinstance(fact, MemoryFact):
            raise TypeError('Expected validated MemoryFact')
        if source not in ('engine', 'user_statement', 'model_inference'):
            fail(422, 'invalid_memory_source')
        with transaction(user_id):
            row = self._owned(user_id, npc_id, memory_id)
            if row.deleted_at or row.expires_at <= utcnow():
                fail(404, 'memory_not_found')
            if row.revision != expected_revision:
                fail(409, 'memory_revision_conflict')
            attempt = owned_attempt(user_id, source_attempt_id or row.source_attempt_id, lock=True)
            if attempt.npc_id != npc_id:
                fail(404, 'attempt_not_found')
            self._validate(attempt, fact, source, evidence)
            row.fact = dump(fact.model_dump())
            row.value_code = fact.value
            row.source_attempt = attempt.id
            row.occurred_at = attempt.created_at
            row.source = source
            row.confidence = 'unconfirmed' if source == 'model_inference' else 'confirmed'
            row.updated_at = utcnow()
            row.revision += 1
            row.save()
            return serialize(row)

    @staticmethod
    def _owned(user_id, npc_id, memory_id):
        row = NPCMemory.get_or_none(
            (NPCMemory.id == memory_id) & (NPCMemory.user_id == user_id) &
            (NPCMemory.npc_id == npc_id))
        if row is None:
            fail(404, 'memory_not_found')
        return row

    def delete(self, user_id, npc_id, memory_id):
        with transaction(user_id):
            row = self._owned(user_id, npc_id, memory_id)
            self._erase(row)

    @staticmethod
    def _erase(row):
        if row.deleted_at is None:
            row.fact = '{}'
            row.value_code = ''
            row.deleted_at = row.updated_at = utcnow()
            row.revision += 1
            row.save()

    def clear(self, user_id, npc_id=None):
        with transaction(user_id):
            condition = (NPCMemory.user_id == user_id) & NPCMemory.deleted_at.is_null()
            if npc_id is not None:
                condition &= NPCMemory.npc_id == npc_id
            # Erase payload but retain a non-content event tombstone: replay is safe.
            return NPCMemory.update(fact='{}', value_code='', deleted_at=utcnow(), updated_at=utcnow(),
                                    revision=NPCMemory.revision + 1).where(condition).execute()

    def purge_expired(self, user_id):
        """Explicit maintenance interface, never scheduled by the active game."""
        with transaction(user_id):
            return NPCMemory.update(fact='{}', value_code='', deleted_at=utcnow(),
                                    revision=NPCMemory.revision + 1).where(
                (NPCMemory.user_id == user_id) & NPCMemory.deleted_at.is_null() &
                (NPCMemory.expires_at <= utcnow())).execute()
