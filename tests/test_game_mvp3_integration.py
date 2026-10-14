"""Real Game engine + MVP 3 storage, synthetic data. Use the protected runner."""
import asyncio
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api.models import TMAUser, TMAGameAttempt, tma_db
from api.game_mvp3 import integration
from api.game_mvp3.flags import enabled_for
from api.game_mvp3.memory import NPCMemoryService
from api.game_mvp3.migration import run_migration
from api.game_mvp3.models import NPCMemory, CommunicationResult, GameCapture, GameInteraction, MODELS
from api.game_mvp3.privacy import delete_user_data, erase_deleted_account
from api.game_mvp3.progress import LanguageProgressService
from api.game_mvp3.router import router as foundation_router
from api.routers.game import TurnRequest, router as game_router
from api.services import game_service as game
from api.services.game_dialogue import DialogueUnavailable

SEARCH = 'Ich suche ein Buch über Gemüse auf dem Balkon für Anfänger.'


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lerne-integration-')
        self.old_db = tma_db.obj
        self.db = SqliteDatabase(str(Path(self.temp.name) / 'isolated.sqlite'),
                                 pragmas={'foreign_keys': 1}, check_same_thread=False)
        tma_db.initialize(self.db)
        self.addCleanup(tma_db.initialize, self.old_db)
        self.addCleanup(self.temp.cleanup)
        with self.db.connection_context():
            self.db.create_tables([TMAGameAttempt, TMAUser])
            TMAUser.create(user_id=101)
            TMAUser.create(user_id=202)
        run_migration(self.db)
        self.env = patch.dict(os.environ, {
            'GAME_MVP3_ENABLED': '1', 'GAME_MVP3_ISOLATED': '1',
            'GAME_MVP3_TEST_USER_ID': '101', 'ENVIRONMENT': 'test'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.now = datetime(2026, 10, 12, 12)
        self.clock_lock = threading.Lock()
        self.clock = patch.object(game, 'utcnow', side_effect=self.tick)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.ai = patch.object(game, 'configuration', return_value=('mock', None))
        self.ai.start()
        self.addCleanup(self.ai.stop)
        self.progress = LanguageProgressService()
        self.memory = NPCMemoryService()

    def tick(self):
        with self.clock_lock:
            self.now += timedelta(seconds=2)
            return self.now

    def start(self, user=101):
        return game.start_attempt(str(uuid4()), user)

    def turn(self, attempt, text=SEARCH, *, user=101, action='message', request=None):
        request = request or TurnRequest(request_id=uuid4(), version=attempt['version'],
                                         action=action, message=text)
        return asyncio.run(game.send_turn(attempt['id'], user, request))

    def completed(self, user=101, hints=False):
        a = self.start(user)
        if hints:
            a = self.turn(a, '', user=user, action='hint')
        a = self.turn(a, user=user)
        return self.turn(a, 'Ja bitte.', user=user)

    def count(self, model, user=None):
        with self.db.connection_context():
            query = model.select()
            if user is not None:
                query = query.where(model.user_id == user)
            return query.count()

    def client(self):
        app = FastAPI()
        app.include_router(game_router, prefix='/api')
        app.include_router(foundation_router, prefix='/api')
        return TestClient(app)

    def test_default_flag_and_nonpilot_never_touch_foundation_tables(self):
        with self.db.connection_context():
            self.db.drop_tables(MODELS)
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0'}), patch.object(
                integration, 'begin_capture', side_effect=AssertionError('unexpected write')):
            a = self.completed()
            self.assertEqual(a['outcome'], 'success')
        b = self.completed(user=202)
        self.assertEqual(b['outcome'], 'success')
        with self.db.connection_context():
            self.assertNotIn('tma_game_capture', self.db.get_tables())

    def test_fail_closed_configuration(self):
        for bad in ('', '*', '101,202', '-1', '0', 'abc', '1' * 5000, '9223372036854775808'):
            with self.subTest(bad=bad[:30]), patch.dict(os.environ, {'GAME_MVP3_TEST_USER_ID': bad}):
                self.assertFalse(enabled_for(101))
        for settings in ({'GAME_MVP3_ENABLED': ''}, {'GAME_MVP3_ISOLATED': '0'},
                         {'ENVIRONMENT': 'production'}, {'ENVIRONMENT': ' Production '}):
            with patch.dict(os.environ, settings):
                self.assertFalse(enabled_for(101))
        self.assertTrue(enabled_for(101))
        self.assertFalse(enabled_for(202))
        self.assertFalse(enabled_for(True))

    def test_enabled_schema_missing_fails_without_creating_or_migrating(self):
        with self.db.connection_context():
            self.db.drop_tables(MODELS)
        with self.assertRaises(HTTPException) as caught:
            self.start()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(self.count(TMAGameAttempt), 0)
        with self.db.connection_context():
            self.assertNotIn('tma_game_capture', self.db.get_tables())

    def test_engine_outcome_has_real_event_references_but_no_skill_or_independence(self):
        a = self.completed()
        self.assertEqual(a['outcome'], 'success')
        events = integration.interactions(101, a['id'])
        self.assertEqual([e['kind'] for e in events], ['offered', 'borrowed'])
        result = self.progress.history(101)[0]
        objective = result['objective']
        self.assertEqual(result['task_id'], a['situation_id'])
        self.assertEqual(result['source_version'], 2)
        self.assertEqual(objective['outcome'], 'succeeded')
        self.assertEqual(objective['independence'], 'unknown')
        self.assertEqual(objective['observation']['modality'], 'unknown')
        self.assertIsNone(objective['observation']['translation_count'])
        self.assertIsNone(objective['observation']['other_help_count'])
        self.assertFalse(objective['observation']['support_tracking_complete'])
        self.assertEqual(objective['observation']['task_event_ids'], [e['id'] for e in events])
        self.assertEqual(objective['observation']['skills'], [])
        for modality in ('text', 'speech_transcript', 'verified_audio'):
            self.assertTrue(all(s['state'] == 'not_tested' for s in self.progress.skills(
                101, language='de', modality=modality)))
        self.assertNotIn(SEARCH, json.dumps(events, ensure_ascii=False))
        self.assertEqual([m['fact']['kind'] for m in self.memory.relevant(101, a['npc_id'])],
                         ['outcome', 'encounter'])

    def test_actual_hints_and_support_requests_are_recorded_without_unknown_zeroes(self):
        a = self.start()
        a = self.turn(a, '', action='hint')
        for text in ('Bitte einfacher sprechen.', 'Bitte langsam.', 'Bitte wiederholen.'):
            a = self.turn(a, text)
        a = self.turn(a)
        a = self.turn(a, '', action='hint')
        a = self.turn(a, 'Ja bitte.')
        events = integration.interactions(101, a['id'])
        self.assertEqual([e['facts']['support'] for e in events if e['facts']['support']],
                         ['example_request', 'simplify', 'slow', 'repeat', 'confirm_offer'])
        obj = self.progress.history(101)[0]['objective']
        self.assertEqual(obj['hint_count'], 2)
        self.assertEqual(obj['independence'], 'with_help')
        self.assertEqual(obj['observation']['help_event_ids'],
                         [e['id'] for e in events if e['facts']['support']])
        self.assertFalse(obj['observation']['support_tracking_complete'])

    def test_recognized_text_chat_and_unresolved_search_do_not_become_success(self):
        a = self.start()
        for text in ('Guten Tag!', 'Ich suche ein Buch.', '???', 'Was mögen Sie an Ihrer Arbeit?'):
            a = self.turn(a, text)
        self.assertEqual(a['outcome'], 'ongoing')
        self.assertEqual(self.progress.history(101), [])
        self.assertEqual(len(integration.interactions(101, a['id'])), 4)
        self.assertEqual([m['fact']['kind'] for m in self.memory.relevant(101, a['npc_id'])], ['encounter'])

    def test_unavailable_and_other_book_are_distinct_engine_results(self):
        a = self.start()
        a = self.turn(a, 'Ich möchte Einfach kochen jeden Tag ausleihen.')
        self.assertEqual(a['outcome'], 'ongoing')
        self.assertEqual(self.progress.history(101), [])
        self.assertEqual(integration.interactions(101, a['id'])[0]['kind'], 'unavailable')
        b = self.start()
        b = self.turn(b, 'Ich möchte ein Buch über Reisen ausleihen.')
        self.assertEqual(b['outcome'], 'other_book')
        result = self.progress.history(101)[0]
        self.assertEqual(result['objective']['outcome'], 'partial')
        self.assertEqual(result['objective']['independence'], 'unknown')
        self.assertEqual(len(result['objective']['observation']['task_event_ids']), 1)

    def test_snapshot_stays_at_task_completion_after_social_turns(self):
        a = self.completed()
        before = self.progress.history(101)[0]
        for _ in range(5):
            a = self.turn(a, 'Was mögen Sie an Ihrer Arbeit?')
        self.assertEqual(self.progress.history(101), [before])
        self.assertEqual(self.count(CommunicationResult), 1)
        self.assertEqual(self.count(NPCMemory), 2)
        self.assertEqual(a['version'], 7)

    def test_replay_is_idempotent_and_changed_or_stale_requests_do_not_write(self):
        a = self.turn(self.start())
        request = TurnRequest(request_id=uuid4(), version=a['version'], message='Ja bitte.')
        b = self.turn(a, request=request)
        self.assertEqual(self.turn(a, request=request), b)
        self.assertEqual(self.count(GameInteraction), 2)
        self.assertEqual(self.count(CommunicationResult), 1)
        altered = request.model_copy(update={'message': 'Nein.'})
        with self.assertRaises(HTTPException) as caught:
            self.turn(a, request=altered)
        self.assertEqual(caught.exception.status_code, 409)
        with self.assertRaises(HTTPException) as caught:
            self.turn(a, request=TurnRequest(request_id=uuid4(), version=0, message=SEARCH))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.count(GameInteraction), 2)

    def test_concurrent_same_turn_and_retry_create_one_event(self):
        a = self.start()
        request = TurnRequest(request_id=uuid4(), version=0, message=SEARCH)
        def submit(_):
            try:
                return self.turn(a, request=request)
            except HTTPException as exc:
                self.assertEqual(exc.status_code, 409)
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, range(2)))
        b = self.turn(a, request=request)
        self.assertTrue(any(r == b for r in results))
        self.assertEqual(self.count(GameInteraction), 1)
        self.assertEqual(b['version'], 1)

    def test_ai_failure_never_creates_evidence_and_can_retry(self):
        a = self.start()
        request = TurnRequest(request_id=uuid4(), version=0, message=SEARCH)
        with patch.object(game, 'create_turn', new=AsyncMock(side_effect=DialogueUnavailable)):
            with self.assertRaises(HTTPException) as caught:
                self.turn(a, request=request)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(game.load_attempt(a['id'], 101)['version'], 0)
        self.assertEqual(self.count(GameInteraction), 0)
        self.assertEqual(self.count(CommunicationResult), 0)
        b = self.turn(a, request=request)
        self.assertEqual(b['version'], 1)
        self.assertEqual(self.count(GameInteraction), 1)

    def test_foundation_write_failure_rolls_back_game_result_and_all_evidence(self):
        a = self.turn(self.start())
        request = TurnRequest(request_id=uuid4(), version=1, message='Ja bitte.')
        with patch.object(CommunicationResult, 'create', side_effect=RuntimeError('synthetic write failure')):
            with self.assertRaises(RuntimeError):
                self.turn(a, request=request)
        self.assertEqual(game.load_attempt(a['id'], 101), a)
        self.assertEqual(self.count(GameInteraction), 1)
        self.assertEqual(self.count(NPCMemory), 1)
        self.assertEqual(self.count(CommunicationResult), 0)
        b = self.turn(a, request=request)
        self.assertEqual(b['outcome'], 'success')
        self.assertEqual(self.count(GameInteraction), 2)

    def test_enabling_mid_attempt_does_not_backfill_history_or_register_outcome(self):
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0'}):
            a = self.turn(self.start())
        a = self.turn(a, 'Ja bitte.')
        self.assertEqual(a['outcome'], 'success')
        for model in MODELS:
            self.assertEqual(self.count(model), 0)

    def test_disabled_interval_cannot_invent_independence(self):
        a = self.start()
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0'}):
            a = self.turn(a, '', action='hint')
            a = self.turn(a)
        a = self.turn(a, 'Ja bitte.')
        obj = self.progress.history(101)[0]['objective']
        self.assertEqual(obj['hint_count'], 1)
        self.assertEqual(obj['independence'], 'with_help')
        self.assertEqual(len(obj['observation']['task_event_ids']), 1)

    def test_erasure_preserves_source_but_blocks_recollection_and_replay(self):
        a = self.completed()
        result = delete_user_data(101)
        self.assertEqual(result, {'memories': 2, 'results': 1, 'attempts': 0})
        for model in (NPCMemory, CommunicationResult, GameInteraction):
            self.assertEqual(self.count(model), 0)
        a = self.turn(a, 'Hallo!')
        for model in (NPCMemory, CommunicationResult, GameInteraction):
            self.assertEqual(self.count(model), 0)
        with self.db.connection_context():
            self.assertIsNotNone(GameCapture.get().erased_at)
        b = self.completed()
        self.assertNotEqual(a['id'], b['id'])
        self.assertEqual(self.count(CommunicationResult), 1)

    def test_full_erasure_cascade_and_user_isolation(self):
        a = self.completed()
        with patch.dict(os.environ, {'GAME_MVP3_TEST_USER_ID': '202'}):
            b = self.completed(user=202)
        delete_user_data(101, include_source_attempts=True)
        for model in [TMAGameAttempt, *MODELS]:
            self.assertEqual(self.count(model, 101), 0)
        self.assertEqual(len(self.progress.history(202)), 1)
        self.assertEqual(len(integration.interactions(202, b['id'])), 2)
        with self.db.connection_context():
            TMAGameAttempt.delete().where(TMAGameAttempt.id == b['id']).execute()
        for model in MODELS:
            self.assertEqual(self.count(model), 0)
        with self.assertRaises(HTTPException):
            game.load_attempt(a['id'], 101)

    def test_clear_memory_and_turn_replay_do_not_resurrect_deleted_facts(self):
        a = self.turn(self.start())
        request = TurnRequest(request_id=uuid4(), version=1, message='Ja bitte.')
        b = self.turn(a, request=request)
        self.memory.clear(101, b['npc_id'])
        self.assertEqual(self.turn(a, request=request), b)
        self.assertEqual(self.memory.relevant(101, b['npc_id']), [])
        self.assertEqual(len(self.progress.history(101)), 1)

    def test_account_cleanup_works_inside_outer_transaction_with_collection_off(self):
        a = self.completed()
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0', 'GAME_MVP3_ISOLATED': '0'}), self.db.connection_context():
            with self.db.atomic():
                erased = erase_deleted_account(101)
                self.assertEqual(erased['attempts'], 1)
                self.assertTrue(self.db.in_transaction())
            self.assertEqual(TMAGameAttempt.select().count(), 0)
        for model in MODELS:
            self.assertEqual(self.count(model), 0)
        self.assertEqual(self.memory.relevant(101, a['npc_id']), [])

    def test_erasure_failure_rolls_back_barrier_events_memory_and_result(self):
        a = self.completed()
        with patch.object(CommunicationResult, 'delete', side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError):
                delete_user_data(101)
        self.assertEqual(self.count(GameInteraction), 2)
        self.assertEqual(self.count(NPCMemory), 2)
        with self.db.connection_context():
            self.assertIsNone(GameCapture.get().erased_at)
        self.assertEqual(len(integration.interactions(101, a['id'])), 2)

    def test_http_requires_bearer_pilot_and_owner_and_rejects_client_evidence(self):
        client = self.client()
        a = self.completed()
        def authenticated(token):
            if token not in ('one', 'two'):
                raise HTTPException(401, 'invalid_session')
            return SimpleNamespace(account_id=101 if token == 'one' else 202)
        with patch('api.auth.dependencies.authenticate', side_effect=authenticated):
            path = f'/api/game-foundation/attempts/{a["id"]}/events'
            for headers in ({}, {'X-User-ID': '101'}, {'Authorization': 'Bearer invalid'}):
                self.assertEqual(client.get(path, headers=headers).status_code, 401)
            h1 = {'Authorization': 'Bearer one'}
            h2 = {'Authorization': 'Bearer two'}
            self.assertEqual(client.get(path, headers=h1).status_code, 200)
            self.assertEqual(client.get(path, headers=h2).status_code, 404)
            with patch.dict(os.environ, {'GAME_MVP3_TEST_USER_ID': '202'}):
                self.assertEqual(client.get(path, headers=h2).status_code, 404)
                self.assertEqual(client.get('/api/game-foundation/results', headers=h2).json(), [])
            for fields in ({'outcome': 'success'}, {'modality': 'verified_audio'},
                           {'skills': ['speaking']}, {'user_id': 202}, {'support_tracking_complete': True}):
                response = client.post(f'/api/game/attempts/{a["id"]}/turns', headers=h1,
                    json={'request_id': str(uuid4()), 'version': a['version'], 'message': 'Hallo', **fields})
                self.assertEqual(response.status_code, 422)
            self.assertEqual(client.post('/api/game-foundation/results', headers=h1, json={
                'outcome': 'success'}).status_code, 405)
            self.assertEqual(client.delete('/api/game-foundation/data', headers=h2).status_code, 404)
            with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0'}):
                self.assertEqual(client.get(path, headers=h1).status_code, 404)

    def test_mvp2_response_scene_and_dialogue_are_identical_with_flag_on_or_off(self):
        on = self.completed(hints=True)
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0'}):
            off = self.completed(hints=True)
        for key in ('scene', 'history', 'outcome', 'book', 'hint_count',
                    'clarification_count', 'turn_count', 'max_turns', 'version'):
            self.assertEqual(on[key], off[key], key)
        self.assertEqual(set(on), set(off))
        # Preparing memory does not alter the current NPC prompt or use extra AI calls.
        self.assertEqual(self.count(GameCapture), 1)

    def test_two_successes_with_less_help_still_do_not_claim_language_progress(self):
        self.completed(hints=True)
        self.completed()
        later, earlier = self.progress.history(101)
        comparison = self.progress.compare(101, earlier['id'], later['id'])
        self.assertEqual(comparison['status'], 'insufficient_data')
        self.assertEqual(comparison['confidence'], 'insufficient')

    def test_migration_collision_fails_closed(self):
        with self.db.connection_context():
            self.db.drop_tables([GameInteraction])
        with self.assertRaisesRegex(RuntimeError, 'Migration 88 already used'):
            run_migration(self.db)
        with self.db.connection_context():
            self.assertNotIn('tma_game_interaction', self.db.get_tables())

    def test_migration_rejects_a_real_non_cascading_foreign_key(self):
        with self.db.connection_context():
            sql = self.db.execute_sql(
                "SELECT sql FROM sqlite_master WHERE name='tma_npc_memory'").fetchone()[0]
            self.assertIn('ON DELETE CASCADE', sql)
            self.db.drop_tables([NPCMemory])
            self.db.execute_sql(sql.replace('ON DELETE CASCADE', 'ON DELETE RESTRICT'))
        with self.assertRaisesRegex(RuntimeError, 'source cascade missing'):
            run_migration(self.db)

    def test_migration_keeps_outer_connection_and_rolls_back_with_its_caller(self):
        with self.db.connection_context():
            self.db.drop_tables(MODELS)
            self.db.execute_sql('DELETE FROM tma_migration_history WHERE migration_id=88')
            with self.db.atomic() as outer:
                run_migration(self.db)
                self.assertTrue(self.db.in_transaction())
                self.assertIn('tma_game_interaction', self.db.get_tables())
                outer.rollback()
            self.assertNotIn('tma_game_interaction', self.db.get_tables())
            self.assertEqual(self.db.execute_sql(
                'SELECT COUNT(*) FROM tma_migration_history WHERE migration_id=88').fetchone()[0], 0)

    def test_existing_account_delete_route_erases_game_data_in_same_transaction(self):
        from api import models
        from api.routers.auth import router as account_router
        account_models = [models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
                          models.TMAProgress, models.TMAReviewHistory, models.TMA_Collaborator,
                          models.TMACustomPrompt, models.TMALinkedSession, models.TMAUser]
        with self.db.connection_context():
            self.db.create_tables(account_models)
        self.completed()
        self.completed(user=202)
        app = FastAPI()
        app.include_router(account_router, prefix='/api')
        client = TestClient(app)
        self.assertEqual(client.delete('/api/auth/account', headers={'X-User-ID': '101'}).status_code, 401)
        self.assertEqual(self.count(TMAGameAttempt, 101), 1)
        with patch.dict(os.environ, {'GAME_MVP3_ENABLED': '0', 'GAME_MVP3_ISOLATED': '0'}), patch(
                'api.auth.dependencies.authenticate', return_value=SimpleNamespace(account_id=101)):
            response = client.delete('/api/auth/account', headers={'Authorization': 'Bearer one'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['status'], 'ok')
        with self.db.connection_context():
            self.assertIsNone(models.TMAUser.get_or_none(models.TMAUser.user_id == 101))
            self.assertIsNotNone(models.TMAUser.get_or_none(models.TMAUser.user_id == 202))
        for model in [TMAGameAttempt, *MODELS]:
            self.assertEqual(self.count(model, 101), 0)
        self.assertEqual(self.count(TMAGameAttempt, 202), 1)

    def test_previously_authenticated_deleted_account_cannot_start_capture(self):
        with self.db.connection_context():
            TMAUser.delete().where(TMAUser.user_id == 101).execute()
        with self.assertRaises(HTTPException) as caught:
            self.start()
        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(self.count(TMAGameAttempt), 0)
        self.assertEqual(self.count(GameCapture), 0)

    def test_isolated_runners_reject_default_remote_and_non_test_databases(self):
        from scripts.test_game_mvp3_postgres import disposable_database
        for url in ('', 'postgresql://localhost/production',
                    'postgresql://remote.example/lerne_game_mvp3_test_probe',
                    'postgresql://localhost/lerne_game_mvp3_test_probe?options=unsafe',
                    'sqlite:///lerne_game_mvp3_test_probe'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                disposable_database(url)
        db = disposable_database('postgresql://test:synthetic@127.0.0.1:5432/lerne_game_mvp3_test_probe')
        self.assertTrue(db.is_closed())
        self.assertEqual(db.database, 'lerne_game_mvp3_test_probe')

    def test_pilot_preparation_has_no_migrations_ai_or_media_routes(self):
        from api import models
        from api.auth.dependencies import get_authenticated_user_id
        from scripts.run_game_mvp3_pilot import prepare_app
        with self.db.connection_context():
            self.db.create_tables([models.TMAAuthAccount, models.TMAAuthSession, models.TMAAuthToken])
        with patch.object(models, 'create_all_tables', side_effect=AssertionError('startup migration')):
            app = prepare_app(self.db)
        app.dependency_overrides[get_authenticated_user_id] = lambda: 101
        client = TestClient(app)
        self.assertEqual(client.get('/api/game/scene').json()['ai_mode'], 'mock')
        self.assertEqual(client.post('/api/media/generate-audio', json={}).status_code, 404)
        self.assertEqual(client.delete('/api/auth/account').status_code, 404)
        self.assertEqual(self.count(GameCapture), 0)

    def test_recorded_help_cannot_be_hidden_by_zero_counters_or_independent_skills(self):
        from api.game_mvp3.schemas import ServerObservation
        a = self.turn(self.start(), 'Bitte langsam.')
        a = self.turn(a)
        a = self.turn(a, 'Ja bitte.')
        recorded = self.progress.history(101)[0]['objective']['observation']
        kwargs = {'modality': 'text', 'translation_count': 0, 'other_help_count': 0,
                  'support_tracking_complete': True, 'task_event_ids': recorded['task_event_ids'],
                  'help_event_ids': recorded['help_event_ids']}
        for skills in ([], [{'skill_id': 'express_request', 'state': 'independent',
                            'event_ids': recorded['task_event_ids'], 'modality': 'text'}]):
            with self.subTest(skills=bool(skills)), self.assertRaises(HTTPException) as caught:
                self.progress.register_result(101, a['id'], a['situation_id'],
                    expected_version=a['version'], observation=ServerObservation(**kwargs, skills=skills))
            self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.progress.history(101)[0]['objective']['independence'], 'with_help')


if __name__ == '__main__':
    raise SystemExit('Run python scripts/test_game_mvp3.py (isolated entry)')
