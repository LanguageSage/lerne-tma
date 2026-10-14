"""Disposable SQLite only; synthetic data, no .env DB connection, AI, STT or TTS."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase, IntegrityError
from pydantic import ValidationError
# api.models has legacy import-time initialization. Suppress it before importing
# any storage/auth module, even if a developer has configured a production .env.
from api import database as _database
with patch.object(_database, 'initialize_database', return_value=False), patch.dict(
        os.environ, {'VERCEL': '1', 'RUN_MIGRATIONS': 'false', 'FORCE_LOCAL_DB': 'false'}):
    from api.models import TMAGameAttempt, tma_db
from api.auth.dependencies import get_authenticated_user_id
from api.game_mvp3.catalog import Catalog, DEFAULT_CATALOG
from api.game_mvp3.memory import NPCMemoryService
from api.game_mvp3.migration import run_migration, MIGRATION_ID
from api.game_mvp3.models import NPCMemory, CommunicationResult, MODELS
from api.game_mvp3.privacy import delete_user_data
from api.game_mvp3.progress import LanguageProgressService
from api.game_mvp3.router import router
from api.game_mvp3.schemas import MemoryEvent, MemoryFact, ServerObservation

TASK = 'library_balcony_book_v1'


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lerne-mvp3-test-')
        self.previous_db = tma_db.obj
        self.db = SqliteDatabase(str(Path(self.temp.name) / 'test.sqlite'),
                                 pragmas={'foreign_keys': 1}, check_same_thread=False)
        tma_db.initialize(self.db)
        with self.db.connection_context():
            self.db.create_tables([TMAGameAttempt])
        run_migration(self.db)
        self.memory = NPCMemoryService()
        self.progress = LanguageProgressService()
        self.serial = 0
        self.pilot_env = patch.dict(os.environ, {
            'GAME_MVP3_ISOLATED': '1', 'GAME_MVP3_ENABLED': '1',
            'GAME_MVP3_TEST_USER_ID': '101', 'ENVIRONMENT': 'test'})
        self.pilot_env.start()

    def tearDown(self):
        self.pilot_env.stop()
        if not self.db.is_closed():
            self.db.close()
        tma_db.initialize(self.previous_db)
        self.temp.cleanup()

    def attempt(self, user=101, npc='frau_mueller', outcome='success', hints=0, situation=TASK,
                scene=None, history=None):
        self.serial += 1
        when = datetime(2026, 1, 1) + timedelta(days=self.serial)
        with self.db.connection_context():
            return TMAGameAttempt.create(
                id=str(uuid4()), user_id=user, npc_id=npc, situation_id=situation,
                scene_state=json.dumps(scene or {}), history=json.dumps(history or [
                    {'role': 'user', 'text': 'Ich möchte Gemüse anbauen.'},
                    {'role': 'npc', 'text': 'Welches Thema?'},
                    {'role': 'user', 'text': 'Ich mag Gemüse und Kochen.'}]),
                outcome=outcome, hint_count=hints, clarification_count=2, turn_count=4,
                version=4, created_at=when, updated_at=when)

    def observation(self, *, help_count=0, modality='text', state=None, skills=True,
                    task_events=None):
        state = state or ('with_help' if help_count else 'independent')
        events = task_events if task_events is not None else ['request_understood', 'task_resolved']
        return ServerObservation(
            modality=modality, support_tracking_complete=True, translation_count=0,
            other_help_count=help_count, task_event_ids=events,
            skills=[{'skill_id': 'express_request', 'state': state,
                     'event_ids': events, 'modality': modality}] if skills and events else [])

    def result(self, row=None, **kwargs):
        row = row or self.attempt()
        observation = kwargs.pop('observation', self.observation())
        return self.progress.register_result(row.user_id, row.id, kwargs.pop('task_id', TASK),
                                             expected_version=row.version,
                                             observation=observation, **kwargs)

    def event(self, row, *, value='gardening', kind='topic', source='user_statement',
              event_id='topic-1', **kwargs):
        return MemoryEvent(event_id=event_id, attempt_id=row.id,
                           fact={'kind': kind, 'key': 'subject', 'value': value}, source=source,
                           evidence='Ich mag Gemüse und Kochen.' if source != 'engine' else None,
                           **kwargs)

    def count(self, model):
        with self.db.connection_context():
            return model.select().count()

    def assert_http(self, code, operation, *args, **kwargs):
        with self.assertRaises(HTTPException) as caught:
            operation(*args, **kwargs)
        self.assertEqual(caught.exception.status_code, code)
        return caught.exception.detail

    def test_first_meeting_has_no_invented_memory(self):
        self.attempt()
        self.assertEqual(self.memory.relevant(101, 'frau_mueller'), [])

    def test_confirmed_memory_and_repeat_meeting(self):
        a = self.attempt()
        encounter = MemoryEvent(event_id='meeting-1', attempt_id=a.id,
                                fact={'kind': 'encounter', 'key': 'meeting', 'value': 'visited'},
                                source='engine')
        self.memory.record(101, a.npc_id, encounter)
        self.memory.record(101, a.npc_id, self.event(a))
        self.attempt()
        memories = self.memory.relevant(101, a.npc_id)
        self.assertEqual(len(memories), 2)
        self.assertTrue(all(m['source_attempt_id'] == a.id for m in memories))
        self.assertNotIn('Gemüse', json.dumps(memories, ensure_ascii=False))

    def test_update_and_optimistic_revision(self):
        a = self.attempt()
        m = self.memory.record(101, a.npc_id, self.event(a))
        fact = MemoryFact(kind='topic', key='subject', value='cooking')
        updated = self.memory.update(101, a.npc_id, m['id'], fact, expected_revision=0,
                                     source='user_statement', evidence='Ich mag Gemüse und Kochen.')
        self.assertEqual(updated['revision'], 1)
        self.assertEqual(self.memory.relevant(101, a.npc_id)[0]['fact']['value'], 'cooking')
        self.assert_http(409, self.memory.update, 101, a.npc_id, m['id'], fact,
                         expected_revision=0, source='engine')
        # Retry of the original event returns current revision, no new write.
        self.assertEqual(self.memory.record(101, a.npc_id, self.event(a))['revision'], 1)

    def test_deleted_memory_does_not_resurrect_on_retry(self):
        a = self.attempt()
        event = self.event(a)
        m = self.memory.record(101, a.npc_id, event)
        self.memory.delete(101, a.npc_id, m['id'])
        self.memory.delete(101, a.npc_id, m['id'])
        self.assertTrue(self.memory.record(101, a.npc_id, event)['deleted'])
        self.assertEqual(self.memory.relevant(101, a.npc_id), [])
        with self.db.connection_context():
            self.assertEqual(NPCMemory.get_by_id(m['id']).fact, '{}')

    def test_memory_user_and_npc_isolation(self):
        a = self.attempt()
        b = self.attempt(user=202)
        c = self.attempt(npc='synthetic_second_npc')
        m = self.memory.record(101, a.npc_id, self.event(a))
        self.memory.record(202, b.npc_id, self.event(b))
        self.memory.record(101, c.npc_id, self.event(c))
        self.assertEqual(len(self.memory.relevant(101, a.npc_id)), 1)
        self.assertEqual(len(self.memory.relevant(101, c.npc_id)), 1)
        self.assert_http(404, self.memory.record, 202, a.npc_id, self.event(a))
        self.assert_http(404, self.memory.record, 101, c.npc_id, self.event(a))
        self.assert_http(404, self.memory.delete, 202, a.npc_id, m['id'])
        self.assert_http(404, self.memory.delete, 101, c.npc_id, m['id'])

    def test_memory_duplicate_and_conflict(self):
        a = self.attempt()
        m = self.memory.record(101, a.npc_id, self.event(a))
        self.assertEqual(self.memory.record(101, a.npc_id, self.event(a))['id'], m['id'])
        self.assert_http(409, self.memory.record, 101, a.npc_id, self.event(a, value='cooking'))
        self.assertEqual(self.count(NPCMemory), 1)

    def test_engine_outcome_requires_existing_fact(self):
        a = self.attempt(outcome='other_book')
        event = MemoryEvent(event_id='result', attempt_id=a.id,
                            fact={'kind': 'outcome', 'key': 'result', 'value': 'success'},
                            source='engine')
        self.assert_http(422, self.memory.record, 101, a.npc_id, event)
        event = event.model_copy(update={'fact': MemoryFact(kind='outcome', key='result', value='other_book')})
        self.memory.record(101, a.npc_id, event)

    def test_model_inference_stays_out_of_npc_context(self):
        a = self.attempt()
        self.memory.record(101, a.npc_id, self.event(a, source='model_inference'))
        self.assertEqual(self.memory.relevant(101, a.npc_id), [])
        with self.db.connection_context():
            self.assertEqual(NPCMemory.get().confidence, 'unconfirmed')

    def test_invented_quote_and_unverified_preference_rejected(self):
        a = self.attempt()
        self.assert_http(422, self.memory.record, 101, a.npc_id,
                         self.event(a).model_copy(update={'evidence': 'Not in the conversation'}))
        self.assert_http(422, self.memory.record, 101, a.npc_id, self.event(a, kind='preference'))
        self.assertEqual(self.count(NPCMemory), 0)

    def test_confirmed_preference_promise_and_agreement(self):
        facts = [
            {'kind': 'preference', 'key': 'subject', 'value': 'gardening'},
            {'kind': 'promise', 'key': 'action', 'value': 'return_book'},
            {'kind': 'agreement', 'key': 'action', 'value': 'return_book'},
        ]
        a = self.attempt(scene={'confirmed_memory_events': facts})
        for n, fact in enumerate(facts):
            self.memory.record(101, a.npc_id, MemoryEvent(
                event_id=f'event-{n}', attempt_id=a.id, fact=fact, source='engine'))
        self.assertEqual(len(self.memory.relevant(101, a.npc_id)), 3)

    def test_sensitive_arbitrary_fields_and_values_rejected(self):
        a = self.attempt()
        with self.assertRaises(ValidationError):
            MemoryFact(kind='topic', key='subject', value='gardening', personal_notes='synthetic')
        self.assert_http(422, self.memory.record, 101, a.npc_id, self.event(a, value='health_record'))
        with self.assertRaises(ValidationError):
            MemoryFact(kind='topic', key='address', value='Synthetic street 1')

    def test_relevant_filter_and_context_bound(self):
        a = self.attempt()
        for n in range(20):
            self.memory.record(101, a.npc_id, self.event(a, event_id=f'e-{n}'))
        self.memory.record(101, a.npc_id, self.event(a, event_id='cooking', value='cooking'))
        items = self.memory.relevant(101, a.npc_id)
        self.assertEqual(len(items), 12)
        self.assertLessEqual(sum(len(json.dumps(m, ensure_ascii=False)) for m in items), 4000)
        self.assertEqual(len(self.memory.relevant(101, a.npc_id, values=['cooking'])), 1)
        self.assert_http(422, self.memory.relevant, 101, a.npc_id, limit=13)

    def test_expiry_and_explicit_purge(self):
        a = self.attempt()
        m = self.memory.record(101, a.npc_id, self.event(
            a, expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
        with self.db.connection_context():
            NPCMemory.update(expires_at=datetime(2020, 1, 1)).where(NPCMemory.id == m['id']).execute()
        self.assertEqual(self.memory.relevant(101, a.npc_id), [])
        self.assertEqual(self.memory.purge_expired(101), 1)
        self.assertEqual(self.memory.purge_expired(101), 0)
        self.assert_http(422, self.memory.record, 101, a.npc_id, self.event(
            a, event_id='expired', expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc)))

    def test_clear_only_requested_pair_and_replay_safe(self):
        a = self.attempt()
        b = self.attempt(npc='other_npc')
        c = self.attempt(user=202)
        for row in (a, b, c):
            self.memory.record(row.user_id, row.npc_id, self.event(row))
        self.assertEqual(self.memory.clear(101, a.npc_id), 1)
        self.assertTrue(self.memory.record(101, a.npc_id, self.event(a))['deleted'])
        self.assertEqual(len(self.memory.relevant(101, b.npc_id)), 1)
        self.assertEqual(len(self.memory.relevant(202, c.npc_id)), 1)
        self.assertEqual(self.memory.clear(101), 1)

    def test_register_success_and_failure(self):
        success = self.result()
        partial = self.result(self.attempt(outcome='other_book', hints=3),
                              observation=self.observation(state='difficulty'))
        failed = self.result(self.attempt(outcome='failed'),
                             observation=self.observation(state='difficulty'))
        self.assertEqual(success['objective']['outcome'], 'succeeded')
        self.assertEqual(success['objective']['independence'], 'independent')
        self.assertEqual(partial['objective']['outcome'], 'partial')
        self.assertEqual(failed['objective']['outcome'], 'failed')
        self.assertEqual(len(self.progress.history(101)), 3)

    def test_existing_mvp2_data_does_not_invent_telemetry_or_skills(self):
        result = self.result(observation=None)
        objective = result['objective']
        self.assertEqual(objective['independence'], 'unknown')
        self.assertIsNone(objective['observation']['translation_count'])
        states = self.progress.skills(101, language='de', modality='text')
        self.assertTrue(all(s['state'] == 'not_tested' for s in states))

    def test_ongoing_attempt_is_not_automatically_a_failure(self):
        row = self.attempt(outcome='ongoing')
        self.assert_http(409, self.result, row)
        self.assertEqual(self.count(CommunicationResult), 0)

    def test_result_duplicate_is_idempotent_and_changed_payload_conflicts(self):
        a = self.attempt()
        first = self.result(a)
        self.assertEqual(self.result(a)['id'], first['id'])
        self.assert_http(409, self.result, a, observation=self.observation(skills=False))
        self.assertEqual(self.count(CommunicationResult), 1)

    def test_stale_or_inflight_attempt_is_rejected(self):
        a = self.attempt()
        self.assert_http(409, self.progress.register_result, 101, a.id, TASK,
                         expected_version=3)
        with self.db.connection_context():
            TMAGameAttempt.update(inflight_id=str(uuid4())).where(TMAGameAttempt.id == a.id).execute()
        self.assert_http(409, self.result, a)

    def test_progress_owner_checks_and_multiple_npcs(self):
        a = self.attempt()
        b = self.attempt(user=202)
        c = self.attempt(npc='other_npc')
        ra, rb, rc = [self.result(row) for row in (a, b, c)]
        self.assertEqual(len(self.progress.history(101)), 2)
        self.assertEqual(len(self.progress.history(202)), 1)
        self.assert_http(404, self.progress.register_result, 202, a.id, TASK, expected_version=4)
        self.assert_http(404, self.progress.compare, 101, ra['id'], rb['id'])
        self.assertEqual(self.progress.compare(101, ra['id'], rc['id'])['status'], 'no_change')

    def test_compare_improvement_example(self):
        before = self.result(self.attempt(outcome='other_book', hints=3),
                             observation=self.observation(state='difficulty'))
        after = self.result()
        compared = self.progress.compare(101, before['id'], after['id'])
        self.assertEqual(compared['status'], 'improved')
        self.assertIn('самостоятельно', compared['text'])
        self.assertEqual(compared['observed_differences']['total_help_count'], [3, 0])

    def test_compare_decline_no_change_and_mixed(self):
        a = self.result()
        b = self.result(self.attempt(hints=2), observation=self.observation(state='with_help'))
        self.assertEqual(self.progress.compare(101, a['id'], b['id'])['status'], 'declined')
        c = self.result(self.attempt(hints=2), observation=self.observation(state='with_help'))
        self.assertEqual(self.progress.compare(101, b['id'], c['id'])['status'], 'no_change')
        d = self.result(self.attempt(outcome='other_book'), observation=self.observation(state='difficulty'))
        e = self.result(self.attempt(hints=3), observation=self.observation(state='with_help'))
        self.assertEqual(self.progress.compare(101, d['id'], e['id'])['status'], 'mixed')

    def test_less_help_alone_on_failed_tasks_is_not_progress(self):
        a = self.result(self.attempt(outcome='failed', hints=3), observation=self.observation(state='difficulty'))
        b = self.result(self.attempt(outcome='failed'), observation=self.observation(state='difficulty'))
        self.assertEqual(self.progress.compare(101, a['id'], b['id'])['status'], 'no_change')

    def test_compare_insufficient_tracking_and_single_event(self):
        a = self.result(observation=ServerObservation(modality='text', task_event_ids=['one', 'two']))
        b = self.result()
        self.assertEqual(self.progress.compare(101, a['id'], b['id'])['reason'], 'support_tracking_incomplete')
        c = self.result(observation=self.observation(skills=False, task_events=['one']))
        self.assertEqual(self.progress.compare(101, b['id'], c['id'])['status'], 'insufficient_data')

    def test_comparison_requires_distinct_chronological_attempts(self):
        a = self.result()
        b = self.result()
        self.assertEqual(self.progress.compare(101, a['id'], a['id'])['status'], 'insufficient_data')
        self.assertEqual(self.progress.compare(101, b['id'], a['id'])['status'], 'insufficient_data')

    def custom_progress(self, **task_changes):
        base = DEFAULT_CATALOG.tasks[TASK]
        other = replace(base, id='equivalent-task-v1', situation_id='equivalent-situation-v1',
                        equivalence_group='book-request', **task_changes)
        tasks = {TASK: replace(base, equivalence_group='book-request'), other.id: other}
        return LanguageProgressService(Catalog(
            tasks, DEFAULT_CATALOG.skills, DEFAULT_CATALOG.memory_values,
            DEFAULT_CATALOG.statement_terms)), other

    def test_equivalent_tasks_and_repeated_skill_in_different_situations(self):
        service, task = self.custom_progress()
        a = self.attempt()
        ra = service.register_result(101, a.id, TASK, expected_version=4, observation=self.observation())
        b = self.attempt(npc='second_npc', situation=task.situation_id)
        rb = service.register_result(101, b.id, task.id, expected_version=4, observation=self.observation())
        self.assertEqual(service.compare(101, ra['id'], rb['id'])['status'], 'no_change')
        skill = next(s for s in service.skills(101, language='de', modality='text') if s['id'] == 'express_request')
        self.assertEqual(skill['state'], 'confirmed_in_multiple_situations')
        self.assertEqual(len(skill['confirmations']), 2)

    def test_difficulty_changes_are_not_compared(self):
        service, task = self.custom_progress(difficulty='hard-v2')
        a = self.attempt()
        ra = service.register_result(101, a.id, TASK, expected_version=4, observation=self.observation())
        b = self.attempt(situation=task.situation_id)
        rb = service.register_result(101, b.id, task.id, expected_version=4, observation=self.observation())
        self.assertEqual(service.compare(101, ra['id'], rb['id'])['status'], 'not_comparable')

    def test_language_rubric_and_modality_changes_are_not_compared(self):
        for changes in ({'language': 'en'}, {'rubric_version': 'new-rubric'}):
            service, task = self.custom_progress(**changes)
            a = self.attempt()
            ra = service.register_result(101, a.id, TASK, expected_version=4, observation=self.observation())
            b = self.attempt(situation=task.situation_id)
            rb = service.register_result(101, b.id, task.id, expected_version=4, observation=self.observation())
            self.assertEqual(service.compare(101, ra['id'], rb['id'])['status'], 'not_comparable')
        a = self.result()
        b = self.result(observation=self.observation(modality='speech_transcript'))
        self.assertEqual(self.progress.compare(101, a['id'], b['id'])['status'], 'not_comparable')

    def test_wrong_task_or_unknown_task_rejected(self):
        a = self.attempt(situation='unrelated')
        self.assert_http(422, self.result, a)
        self.assert_http(422, self.progress.register_result, 101, a.id, 'missing', expected_version=4)

    def test_ai_invalid_incomplete_invented_and_high_confidence_not_proof(self):
        outputs = ['not json', '{}', '{"schema_version":1}', json.dumps({
            'schema_version': 1, 'findings': [{'skill_id': 'express_request', 'state': 'independent',
                'confidence': 1.0, 'evidence': ['made up phrase']}]}),
            json.dumps({'schema_version': 1, 'findings': [], 'cefr_level': 'C2'})]
        for raw in outputs:
            r = self.result(observation=None, model_output=raw)
            self.assertEqual(r['model_analysis']['status'], 'invalid')
        raw = json.dumps({'schema_version': 1, 'findings': [{
            'skill_id': 'express_request', 'state': 'independent', 'confidence': 1.0,
            'evidence': ['Ich möchte Gemüse anbauen.']}]})
        result = self.result(observation=None, model_output=raw)
        self.assertEqual(result['model_analysis']['status'], 'valid')
        self.assertFalse(result['model_analysis']['confirmed'])
        self.assertNotIn('Gemüse', json.dumps(result['model_analysis'], ensure_ascii=False))
        self.assertTrue(all(s['state'] == 'not_tested' for s in self.progress.skills(
            101, language='de', modality='text')))

    def test_stt_cannot_confirm_listening_or_pronunciation(self):
        base = replace(DEFAULT_CATALOG.tasks[TASK], skills=('listening_comprehension',))
        service = LanguageProgressService(Catalog({TASK: base}, DEFAULT_CATALOG.skills,
                                                   DEFAULT_CATALOG.memory_values))
        observation = ServerObservation(
            modality='speech_transcript', task_event_ids=['a', 'b'],
            skills=[{'skill_id': 'listening_comprehension', 'state': 'difficulty',
                     'event_ids': ['a', 'b'], 'modality': 'speech_transcript'}])
        self.assert_http(422, service.register_result, 101, self.attempt().id, TASK,
                         expected_version=4, observation=observation)
        raw = json.dumps({'schema_version': 1, 'findings': [{
            'skill_id': 'listening_comprehension', 'state': 'independent', 'confidence': 1.0,
            'evidence': ['Ich möchte Gemüse anbauen.']}]})
        result = service.register_result(101, self.attempt().id, TASK, expected_version=4,
                                         model_output=raw)
        self.assertEqual(result['model_analysis']['status'], 'invalid')
        self.assertNotIn('pronunciation', json.dumps(self.progress.skills(
            101, language='de', modality='speech_transcript')))

    def test_written_success_does_not_confirm_speaking(self):
        self.result()
        self.assertTrue(all(s['state'] == 'not_tested' for s in self.progress.skills(
            101, language='de', modality='speech_transcript')))

    def test_later_difficulty_is_not_hidden_by_earlier_successes(self):
        self.result()
        self.result(observation=self.observation(state='difficulty'))
        skill = next(s for s in self.progress.skills(101, language='de', modality='text')
                     if s['id'] == 'express_request')
        self.assertEqual(skill['state'], 'difficulty')

    def test_independence_needs_observed_support_and_multiple_events(self):
        a = self.attempt(hints=1)
        self.assert_http(422, self.result, a)
        with self.assertRaises(ValidationError):
            ServerObservation(support_tracking_complete=True)
        with self.assertRaises(ValidationError):
            self.observation(task_events=['same', 'same'])
        self.assert_http(422, self.result, observation=self.observation(task_events=['one']))

    def test_full_user_erasure_and_foreign_key_cascade(self):
        a = self.attempt()
        b = self.attempt(user=202)
        for row in (a, b):
            self.memory.record(row.user_id, row.npc_id, self.event(row))
            self.result(row)
        erased = delete_user_data(101, include_source_attempts=True)
        self.assertEqual(erased, {'memories': 1, 'results': 1, 'attempts': 1})
        self.assertEqual(len(self.progress.history(202)), 1)
        self.assertEqual(len(self.memory.relevant(202, b.npc_id)), 1)
        self.assertEqual(delete_user_data(101, include_source_attempts=True)['attempts'], 0)
        with self.db.connection_context():
            TMAGameAttempt.delete().where(TMAGameAttempt.id == b.id).execute()
        self.assertEqual(self.count(NPCMemory), 0)
        self.assertEqual(self.count(CommunicationResult), 0)

    def test_mvp3_only_erasure_preserves_source_attempt(self):
        a = self.attempt()
        self.result(a)
        delete_user_data(101)
        self.assertEqual(self.count(TMAGameAttempt), 1)
        self.assertEqual(self.count(CommunicationResult), 0)

    def test_migration_is_idempotent_and_preserves_mvp2_rows(self):
        a = self.attempt()
        result = run_migration(self.db)
        self.assertEqual(result, {'migration_id': MIGRATION_ID, 'applied': False})
        with self.db.connection_context():
            self.assertEqual(TMAGameAttempt.get_by_id(a.id).version, 4)
            self.assertEqual(self.db.execute_sql(
                'SELECT COUNT(*) FROM tma_migration_history WHERE migration_id=88').fetchone()[0], 1)

    def test_migration_failure_rolls_back_all_new_tables_and_marker(self):
        other = SqliteDatabase(str(Path(self.temp.name) / 'migration-failure.sqlite'), pragmas={'foreign_keys': 1})
        with other.connection_context(), other.bind_ctx([TMAGameAttempt], bind_refs=False, bind_backrefs=False):
            other.create_tables([TMAGameAttempt])
        with patch.object(other, 'get_indexes', return_value=[]):
            with self.assertRaises(RuntimeError):
                run_migration(other)
        with other.connection_context():
            tables = set(other.get_tables())
            self.assertNotIn('tma_npc_memory', tables)
            self.assertNotIn('tma_communication_result', tables)
            self.assertNotIn('tma_migration_history', tables)

    def test_concurrent_duplicate_processing(self):
        a = self.attempt()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.result(a), range(2)))
        self.assertEqual(results[0]['id'], results[1]['id'])
        self.assertEqual(self.count(CommunicationResult), 1)
        event = self.event(a)
        with ThreadPoolExecutor(max_workers=2) as pool:
            memories = list(pool.map(lambda _: self.memory.record(101, a.npc_id, event), range(2)))
        self.assertEqual(memories[0]['id'], memories[1]['id'])
        self.assertEqual(self.count(NPCMemory), 1)

    def test_delete_transaction_rolls_back_on_failure(self):
        a = self.attempt()
        self.result(a)
        self.memory.record(101, a.npc_id, self.event(a))
        with patch.object(CommunicationResult, 'delete', side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError):
                delete_user_data(101)
        self.assertEqual(self.count(NPCMemory), 1)
        self.assertEqual(self.count(CommunicationResult), 1)

    def test_postgres_protection_statements_and_policy_failure(self):
        from unittest.mock import MagicMock
        from api.game_mvp3.migration import _protect
        database = MagicMock()
        database.execute_sql.return_value.fetchall.return_value = []
        _protect(database, 'tma_npc_memory')
        sql = '\\n'.join(c.args[0] for c in database.execute_sql.call_args_list)
        self.assertIn('ENABLE ROW LEVEL SECURITY', sql)
        for role in ('PUBLIC', 'anon', 'authenticated'):
            self.assertIn(f'FROM {role}', sql)
        self.assertNotIn('GRANT ', sql)
        self.assertNotIn('CREATE POLICY', sql)
        database.execute_sql.return_value.fetchall.return_value = [('unexpected-policy',)]
        with self.assertRaises(RuntimeError):
            _protect(database, 'tma_npc_memory')

    def test_unknown_difficulty_is_not_comparable(self):
        service, task = self.custom_progress(difficulty=None)
        a = self.attempt()
        ra = service.register_result(101, a.id, TASK, expected_version=4, observation=self.observation())
        b = self.attempt(situation=task.situation_id)
        rb = service.register_result(101, b.id, task.id, expected_version=4, observation=self.observation())
        self.assertEqual(service.compare(101, ra['id'], rb['id'])['status'], 'insufficient_data')

    def test_registry_handles_other_language_and_npc(self):
        base = replace(DEFAULT_CATALOG.tasks[TASK], id='en-task-v1', language='en',
                       situation_id='en-scene-v1')
        service = LanguageProgressService(Catalog({base.id: base}, DEFAULT_CATALOG.skills,
                                                   DEFAULT_CATALOG.memory_values))
        a = self.attempt(npc='synthetic_english_npc', situation=base.situation_id)
        result = service.register_result(101, a.id, base.id, expected_version=4,
                                         observation=self.observation())
        self.assertEqual(result['task']['language'], 'en')
        skills = service.skills(101, language='en', modality='text')
        self.assertEqual(next(s for s in skills if s['id'] == 'express_request')['state'], 'independent')

    def test_abandoned_attempt_cannot_confirm_task_improvement(self):
        a = self.result(self.attempt(outcome='abandoned'), observation=self.observation(state='difficulty'))
        b = self.result()
        self.assertEqual(self.progress.compare(101, a['id'], b['id'])['status'], 'insufficient_data')

    def test_memory_updates_can_use_a_new_owned_encounter(self):
        a = self.attempt()
        m = self.memory.record(101, a.npc_id, self.event(a))
        b = self.attempt()
        updated = self.memory.update(101, a.npc_id, m['id'],
            MemoryFact(kind='topic', key='subject', value='cooking'), expected_revision=0,
            source='user_statement', evidence='Ich mag Gemüse und Kochen.', source_attempt_id=b.id)
        self.assertEqual(updated['source_attempt_id'], b.id)
        self.assertEqual(updated['occurred_at'], b.created_at.isoformat() + 'Z')
        foreign = self.attempt(user=202)
        self.assert_http(404, self.memory.update, 101, a.npc_id, m['id'],
            MemoryFact(kind='topic', key='subject', value='gardening'), expected_revision=1,
            source='user_statement', evidence='Ich mag Gemüse und Kochen.', source_attempt_id=foreign.id)

    def test_listening_requires_verified_stimulus_and_comprehension_events(self):
        with self.assertRaises(ValidationError):
            ServerObservation(modality='verified_audio')
        base = replace(DEFAULT_CATALOG.tasks[TASK], skills=('listening_comprehension',))
        service = LanguageProgressService(Catalog({TASK: base}, DEFAULT_CATALOG.skills,
                                                   DEFAULT_CATALOG.memory_values))
        kwargs = dict(modality='verified_audio', audio_stimulus_id='synthetic-stimulus-1',
                      task_event_ids=['understood-question', 'appropriate-response'],
                      translation_count=0, other_help_count=0, support_tracking_complete=True,
                      skills=[{'skill_id': 'listening_comprehension', 'state': 'independent',
                               'event_ids': ['understood-question', 'appropriate-response'],
                               'modality': 'verified_audio'}])
        self.assert_http(422, service.register_result, 101, self.attempt().id, TASK,
                         expected_version=4, observation=ServerObservation(**kwargs))
        observation = ServerObservation(**kwargs, audio_comprehension_event_ids=kwargs['task_event_ids'])
        service.register_result(101, self.attempt().id, TASK, expected_version=4, observation=observation)
        skill = next(s for s in service.skills(101, language='de', modality='verified_audio')
                     if s['id'] == 'listening_comprehension')
        self.assertEqual(skill['state'], 'independent')

    def test_database_uniqueness_cannot_be_bypassed(self):
        a = self.attempt()
        self.result(a)
        with self.db.connection_context():
            row = CommunicationResult.get()
            values = dict(row.__data__)
            values['id'] = str(uuid4())
            with self.assertRaises(IntegrityError):
                CommunicationResult.create(**values)

    def test_pagination_validation_and_no_frequency_based_growth(self):
        for _ in range(5):
            self.attempt()
        self.assertEqual(self.progress.history(101), [])
        self.assertTrue(all(s['state'] == 'not_tested' for s in self.progress.skills(
            101, language='de', modality='text')))
        self.assert_http(422, self.progress.history, 101, limit=101)
        self.assert_http(401, self.progress.history, 0)

    def test_unmounted_router_authentication_and_owner_access(self):
        app = FastAPI()
        app.include_router(router, prefix='/api')
        client = TestClient(app)
        for path in ('/api/game-foundation/results',
                     '/api/game-foundation/npcs/frau_mueller/memories'):
            self.assertEqual(client.get(path).status_code, 401)
            self.assertEqual(client.get(path, headers={'X-User-ID': '101'}).status_code, 401)
        a = self.attempt()
        m = self.memory.record(101, a.npc_id, self.event(a))
        self.result(a)
        app.dependency_overrides[get_authenticated_user_id] = lambda: 202
        with patch.dict(os.environ, {'GAME_MVP3_TEST_USER_ID': '202'}):
            self.assertEqual(client.get('/api/game-foundation/results').json(), [])
            self.assertEqual(client.delete(
                f'/api/game-foundation/npcs/{a.npc_id}/memories/{m["id"]}').status_code, 404)
        app.dependency_overrides[get_authenticated_user_id] = lambda: 101
        self.assertEqual(len(client.get('/api/game-foundation/results').json()), 1)
        self.assertEqual(client.get('/api/game-foundation/skills?language=de').status_code, 200)
        self.assertEqual(client.post('/api/game-foundation/results', json={
            'user_id': 202, 'outcome': 'succeeded'}).status_code, 405)
        self.assertEqual(client.delete(
            f'/api/game-foundation/npcs/{a.npc_id}/memories/{m["id"]}').status_code, 204)


if __name__ == '__main__':
    unittest.main()
