"""Evidence-led task results and qualitative skills; independent of NPC memory/Classic."""
import json
from dataclasses import asdict
from uuid import uuid4
from pydantic import ValidationError
from .catalog import DEFAULT_CATALOG
from .common import digest, dump, fail, iso, owned_attempt, transaction, utcnow
from .models import CommunicationResult
from .schemas import ModelAnalysis, ServerObservation

OUTCOMES = {'success': 'succeeded', 'other_book': 'partial',
            'failed': 'failed', 'abandoned': 'not_completed'}
RANK = {'failed': 0, 'partial': 1, 'succeeded': 2}
STATUSES_RU = {
    'insufficient_data': 'Недостаточно данных',
    'not_comparable': 'Задачи нельзя сравнить напрямую',
    'improved': 'Подтверждено улучшение результата задачи',
    'declined': 'Результат задачи ухудшился',
    'no_change': 'Подтверждённого изменения нет',
    'mixed': 'Результаты изменились в разные стороны',
}


def serialize(row):
    return {'id': row.id, 'attempt_id': row.source_attempt_id, 'npc_id': row.npc_id,
            'task_id': row.task_id, 'occurred_at': iso(row.occurred_at),
            'source_version': row.source_version, 'task': json.loads(row.task_definition),
            'objective': json.loads(row.objective),
            'model_analysis': json.loads(row.model_analysis) if row.model_analysis else None}


def _help(objective):
    tracking = objective['observation']
    if not tracking['support_tracking_complete']:
        return None
    return objective['hint_count'] + tracking['translation_count'] + tracking['other_help_count']


class LanguageProgressService:
    def __init__(self, catalog=DEFAULT_CATALOG):
        self.catalog = catalog

    def _analysis(self, raw, attempt, task):
        if raw is None:
            return None
        try:
            if not isinstance(raw, str) or len(raw) > 10000:
                raise ValueError('Invalid model output')
            analysis = ModelAnalysis.model_validate_json(raw)
            texts = [m['text'] for m in json.loads(attempt.history)
                     if m.get('role') == 'user' and isinstance(m.get('text'), str)]
            if len({f.skill_id for f in analysis.findings}) != len(analysis.findings):
                raise ValueError('Duplicate model findings')
            for finding in analysis.findings:
                skill = self.catalog.skills.get(finding.skill_id)
                if (finding.skill_id not in task.skills or skill is None or
                        skill.type in ('listening', 'pronunciation') or
                        not all(any(span in text for text in texts) for span in finding.evidence)):
                    raise ValueError('Unsupported or invented model evidence')
            # Store event references/assessment, not the quoted personal utterance.
            return {'status': 'valid', 'source': 'model', 'confirmed': False,
                    'schema_version': 1, 'findings': [
                        {'skill_id': f.skill_id, 'state': f.state, 'confidence': f.confidence,
                         'evidence_verified_in_retained_history': True} for f in analysis.findings]}
        except (ValidationError, ValueError, TypeError):
            return {'status': 'invalid', 'source': 'model', 'confirmed': False,
                    'reason': 'invalid_or_unsupported_analysis'}

    def register_result(self, user_id, attempt_id, task_id, *, expected_version,
                        observation=None, model_output=None):
        """Trusted backend entry only. Client writes cannot supply server evidence."""
        observation = observation if observation is not None else ServerObservation()
        if not isinstance(observation, ServerObservation):
            raise TypeError('Expected validated ServerObservation')
        task = self.catalog.tasks.get(task_id)
        if task is None:
            fail(422, 'unknown_communication_task')
        with transaction(user_id):
            attempt = owned_attempt(user_id, attempt_id, lock=True)
            if attempt.version != expected_version or attempt.inflight_id:
                fail(409, 'attempt_version_conflict')
            if attempt.situation_id != task.situation_id:
                fail(422, 'task_situation_mismatch')
            if attempt.outcome not in OUTCOMES:
                fail(409, 'attempt_not_finished')
            for evidence in observation.skills:
                skill = self.catalog.skills.get(evidence.skill_id)
                if (evidence.skill_id not in task.skills or skill is None or
                        evidence.modality not in skill.modalities):
                    fail(422, 'unsupported_skill_evidence')
                if skill.type == 'listening' and not set(evidence.event_ids) <= set(
                        observation.audio_comprehension_event_ids):
                    fail(422, 'audio_comprehension_not_confirmed')
                if evidence.state == 'independent' and (
                        not observation.support_tracking_complete or attempt.hint_count > 0 or
                        observation.translation_count != 0 or observation.other_help_count != 0 or
                        len(evidence.event_ids) < 2):
                    fail(422, 'independence_not_confirmed')
                if evidence.state == 'with_help' and not (
                        attempt.hint_count > 0 or (observation.translation_count or 0) > 0 or
                        (observation.other_help_count or 0) > 0):
                    fail(422, 'help_not_recorded')
            analysis = self._analysis(model_output, attempt, task)
            objective = {
                'source': 'engine', 'outcome': OUTCOMES[attempt.outcome],
                'outcome_confidence': 'confirmed', 'hint_count': attempt.hint_count,
                'clarification_count': attempt.clarification_count,
                # NPC clarification count is descriptive, never a penalty for learner skill.
                'observation': observation.model_dump(),
            }
            help_count = _help(objective)
            objective['independence'] = (
                'independent' if help_count == 0 and objective['outcome'] == 'succeeded' and
                len(observation.task_event_ids) >= 2 else
                'with_help' if help_count is not None and help_count > 0 else 'unknown')
            # Hash raw request, not merely parsed output: differing retries must conflict.
            processing_hash = digest({
                'attempt_id': attempt_id, 'version': expected_version,
                'task': asdict(task), 'observation': observation.model_dump(),
                'model_output_hash': digest(model_output)})
            previous = CommunicationResult.get_or_none(
                (CommunicationResult.source_attempt == attempt_id) &
                (CommunicationResult.task_id == task_id))
            if previous:
                if previous.user_id != user_id or previous.processing_hash != processing_hash:
                    fail(409, 'attempt_already_processed_differently')
                return serialize(previous)
            row = CommunicationResult.create(
                id=str(uuid4()), user_id=user_id, source_attempt=attempt.id,
                source_version=attempt.version, npc_id=attempt.npc_id,
                task_id=task_id, task_definition=dump(asdict(task)),
                objective=dump(objective), model_analysis=dump(analysis) if analysis else None,
                occurred_at=attempt.updated_at, created_at=utcnow(), processing_hash=processing_hash)
            return serialize(row)

    def history(self, user_id, *, task_id=None, language=None, limit=50, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or offset < 0:
            fail(422, 'invalid_history_page')
        with transaction(user_id):
            query = CommunicationResult.select().where(CommunicationResult.user_id == user_id)
            if task_id is not None:
                query = query.where(CommunicationResult.task_id == task_id)
            # Language is a task snapshot; use task IDs from the trusted catalog.
            if language is not None:
                ids = [t.id for t in self.catalog.tasks.values() if t.language == language]
                query = query.where(CommunicationResult.task_id.in_(ids))
            return [serialize(r) for r in query.order_by(
                CommunicationResult.occurred_at.desc(), CommunicationResult.id).offset(offset).limit(limit)]

    @staticmethod
    def _owned(user_id, result_id):
        row = CommunicationResult.get_or_none(
            (CommunicationResult.id == result_id) & (CommunicationResult.user_id == user_id))
        if row is None:
            fail(404, 'result_not_found')
        return row

    def compare(self, user_id, earlier_id, later_id):
        with transaction(user_id):
            earlier = self._owned(user_id, earlier_id)
            later = self._owned(user_id, later_id)
            a, b = serialize(earlier), serialize(later)
            def report(status, reason, differences=None, text=None):
                return {'status': status, 'label': STATUSES_RU[status], 'reason': reason,
                        'earlier_id': earlier.id, 'later_id': later.id,
                        'observed_differences': differences or {}, 'source': 'engine',
                        'confidence': 'confirmed' if status in ('improved', 'declined', 'no_change', 'mixed')
                        else 'insufficient', 'text': text or STATUSES_RU[status]}
            if earlier.source_attempt_id == later.source_attempt_id or earlier.occurred_at >= later.occurred_at:
                return report('insufficient_data', 'distinct_chronological_attempts_required')
            ta, tb = a['task'], b['task']
            oa, ob = a['objective'], b['objective']
            ma = oa['observation']['modality']
            mb = ob['observation']['modality']
            if not ta['difficulty'] or not tb['difficulty'] or ma == 'unknown' or mb == 'unknown':
                return report('insufficient_data', 'comparability_metadata_missing')
            equivalent = ta['id'] == tb['id'] or (
                bool(ta['equivalence_group']) and ta['equivalence_group'] == tb['equivalence_group'])
            if (not equivalent or ta['language'] != tb['language'] or
                    ta['rubric_version'] != tb['rubric_version'] or
                    set(ta['skills']) != set(tb['skills']) or
                    ta['difficulty'] != tb['difficulty'] or
                    ma != mb):
                return report('not_comparable', 'task_language_rubric_difficulty_or_modality_mismatch')
            differences = {'outcome': [oa['outcome'], ob['outcome']],
                           'hint_count': [oa['hint_count'], ob['hint_count']],
                           'independence': [oa['independence'], ob['independence']]}
            if oa['outcome'] not in RANK or ob['outcome'] not in RANK:
                return report('insufficient_data', 'unfinished_or_abandoned_task', differences)
            if any(len(o['observation']['task_event_ids']) < 2 for o in (oa, ob)):
                return report('insufficient_data', 'multiple_task_events_required', differences)
            ha, hb = _help(oa), _help(ob)
            if ha is None or hb is None:
                return report('insufficient_data', 'support_tracking_incomplete', differences)
            differences['total_help_count'] = [ha, hb]
            changes = [RANK[ob['outcome']] - RANK[oa['outcome']]]
            # Less help confirms progress only alongside an achieved task result.
            if oa['outcome'] == 'succeeded' or ob['outcome'] == 'succeeded':
                changes.append(ha - hb)
            positive, negative = any(c > 0 for c in changes), any(c < 0 for c in changes)
            status = 'mixed' if positive and negative else 'improved' if positive else 'declined' if negative else 'no_change'
            text = None
            if status == 'improved' and ob['independence'] == 'independent':
                text = ('Раньше эта задача вызывала затруднения или требовала помощи. '
                        'Теперь ты самостоятельно справился с сопоставимой задачей.')
            return report(status, 'comparable_objective_task_evidence', differences, text)

    def skills(self, user_id, *, language, modality):
        if modality not in ('text', 'speech_transcript', 'verified_audio'):
            fail(422, 'unsupported_skill_modality')
        with transaction(user_id):
            evidence = {s.id: [] for s in self.catalog.skills.values() if modality in s.modalities}
            query = CommunicationResult.select().where(
                CommunicationResult.user_id == user_id).order_by(
                    CommunicationResult.occurred_at, CommunicationResult.id)
            for row in query.iterator():
                task = json.loads(row.task_definition)
                objective = json.loads(row.objective)
                if task['language'] != language or objective['observation']['modality'] != modality:
                    continue
                for item in objective['observation']['skills']:
                    if item['skill_id'] in evidence:
                        evidence[item['skill_id']].append({
                            'result_id': row.id, 'attempt_id': row.source_attempt_id,
                            'task_id': row.task_id, 'situation_id': task['situation_id'],
                            'occurred_at': iso(row.occurred_at), 'state': item['state'],
                            'source': 'engine', 'confidence': 'confirmed',
                            'event_ids': item['event_ids']})
            result = []
            for skill_id, confirmations in evidence.items():
                skill = self.catalog.skills[skill_id]
                state = confirmations[-1]['state'] if confirmations else 'not_tested'
                independent = [e for e in confirmations if e['state'] == 'independent']
                # The latest observation still matters: historical successes cannot
                # hide current difficulties.
                if state == 'independent' and len({e['situation_id'] for e in independent}) >= 2:
                    state = 'confirmed_in_multiple_situations'
                result.append({
                    'id': skill.id, 'name': skill.name, 'description': skill.description,
                    'type': skill.type, 'language': language, 'modality': modality,
                    'task_ids': [t.id for t in self.catalog.tasks.values()
                                 if t.language == language and skill_id in t.skills],
                    'state': state, 'confidence': 'confirmed' if confirmations else 'insufficient',
                    'confirmations': confirmations,
                })
            return result
