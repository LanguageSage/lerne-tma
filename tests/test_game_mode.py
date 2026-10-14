"""Isolated Game Mode behavior/permissions/storage tests. No live DB, AI or TTS."""
import asyncio
import datetime
import json
import sqlite3
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from peewee import SqliteDatabase

from api.ai_clients import AIService
from api.auth.dependencies import get_authenticated_user_id
from api.game_migration import run_game_migration
from api.models import TMAGameAttempt, tma_db
from api.routers.game import router, TurnRequest
from api.services import game_dialogue as dialogue, game_service as service
from api.services.game_scene import CATALOG, initial_scene, advance_scene, LIBRARY


def intent(action='search', **kwargs):
    return dialogue.Intent(action=action, confidence=1, **kwargs)


class SceneTests(unittest.TestCase):
    def test_free_chat_and_user_initiated_return_to_original_search(self):
        state, _ = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening', 'setting': 'balcony'}))
        catalog_before = json.dumps(LIBRARY['catalog'])
        for _ in range(3):
            next_state, event = advance_scene(state, intent('chat'))
            self.assertEqual(next_state, state)
            self.assertEqual(event['kind'], 'chat')
            state = next_state
        state, event = advance_scene(state, intent(criteria={'audience': 'beginner'}))
        self.assertEqual(event['kind'], 'offered')
        self.assertEqual(state['offered_book_id'], 'balcony_first_steps')
        self.assertIsNone(state['borrowed_book_id'])
        self.assertEqual(json.dumps(LIBRARY['catalog']), catalog_before)

    def test_unknown_book_topic_cannot_reuse_gardening_offer_or_change_catalog(self):
        state, _ = advance_scene(initial_scene(), intent(requested_title='Mein erster Balkongarten'))
        before = json.dumps(LIBRARY['catalog'])
        state, event = advance_scene(state, intent('borrow', criteria={'subject': 'automotive'}))
        self.assertEqual(event['kind'], 'not_found')
        self.assertEqual(state['criteria'], {'subject': 'automotive'})
        self.assertIsNone(state['offered_book_id'])
        self.assertIsNone(state['borrowed_book_id'])
        self.assertEqual(state['outcome'], 'ongoing')
        self.assertEqual(advance_scene(state, intent('confirm'))[1]['kind'], 'clarify')
        self.assertEqual(json.dumps(LIBRARY['catalog']), before)

    def test_topic_change_keeps_world_but_does_not_force_book_search(self):
        state, _ = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening', 'setting': 'balcony'}))
        chatting, event = advance_scene(state, intent('chat'))
        self.assertEqual(event['kind'], 'chat')
        self.assertEqual(chatting, state)
        state, event = advance_scene(chatting, intent(criteria={'subject': 'travel'}))
        self.assertEqual(event['kind'], 'offered')
        self.assertEqual(state['criteria'], {'subject': 'travel'})
        state, _ = advance_scene(state, intent('confirm'))
        chatting, event = advance_scene(state, intent('chat'))
        self.assertEqual(event['kind'], 'chat')
        self.assertEqual(chatting['borrowed_book_id'], 'city_travel')

    def test_unclear_speech_asks_for_meaning_without_assuming_balcony_task(self):
        state, event = advance_scene(initial_scene(), dialogue.Intent(action='search', confidence=.2))
        self.assertEqual(state, initial_scene())
        self.assertEqual(event['questions'], ['Entschuldigung, können Sie das bitte anders sagen?'])

    def test_catalog_resolution_confirmation_and_success(self):
        state, event = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening'}))
        self.assertEqual(event['kind'], 'clarify')
        state, event = advance_scene(state, intent(criteria={'setting': 'balcony'}))
        self.assertEqual(event['kind'], 'clarify')
        state, event = advance_scene(state, intent(criteria={'audience': 'beginner'}))
        self.assertEqual(event['kind'], 'offered')
        self.assertEqual(state['outcome'], 'ongoing')
        state, event = advance_scene(state, intent('confirm'))
        self.assertEqual(state['outcome'], 'success')
        self.assertEqual(event['kind'], 'borrowed')

    def test_absent_unavailable_wrong_book_and_no_offer(self):
        for request, expected in [
            (intent('borrow', requested_title='Harry Potter'), 'not_found'),
            (intent('borrow', requested_title='Einfach kochen jeden Tag'), 'unavailable'),
            (intent('confirm'), 'clarify'),
            (intent('borrow'), 'clarify'),
        ]:
            state, event = advance_scene(initial_scene(), request)
            self.assertEqual(event['kind'], expected)
            self.assertIsNone(state['borrowed_book_id'])
        state, event = advance_scene(initial_scene(), intent('borrow', criteria={'subject': 'travel'}))
        self.assertEqual(event['kind'], 'borrowed')
        self.assertEqual(state['outcome'], 'other_book')

    def test_uncertainty_and_decline_cannot_issue_books(self):
        state, _ = advance_scene(initial_scene(), intent(requested_title='Mein erster Balkongarten'))
        uncertain = dialogue.Intent(action='confirm', confidence=.4)
        self.assertEqual(advance_scene(state, uncertain)[1]['kind'], 'clarify')
        state, _ = advance_scene(state, intent('decline'))
        self.assertIsNone(state['offered_book_id'])
        self.assertEqual(advance_scene(state, intent('confirm'))[1]['kind'], 'clarify')

    def test_unknown_request_does_not_reuse_previous_preferences(self):
        state, _ = advance_scene(initial_scene(), intent(requested_title='Mein erster Balkongarten'))
        state, event = advance_scene(state, intent())
        self.assertEqual(event['kind'], 'clarify')
        self.assertIsNone(state['offered_book_id'])

    def test_preferences_can_arrive_in_any_order_and_questions_use_catalog(self):
        state = initial_scene()
        for criteria in [{'audience': 'beginner'}, {'subject': 'gardening'}, {'setting': 'balcony'}]:
            state, event = advance_scene(state, intent(criteria=criteria))
        self.assertEqual(event['kind'], 'offered')
        self.assertEqual(state['offered_book_id'], 'balcony_first_steps')
        _, event = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening', 'setting': 'balcony'}))
        self.assertEqual(event['questions'], ['Sind Sie Anfänger oder haben Sie schon Erfahrung?'])


class DialogueTests(unittest.IsolatedAsyncioTestCase):
    async def test_cars_work_and_return_follow_current_intent_without_loan(self):
        state, _ = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening', 'setting': 'balcony'}))
        history = [{'role': 'npc', 'text': 'Sind Sie Anfänger oder haben Sie schon Erfahrung?'}]
        client = AIService('google', 'test-key')
        for message, reply in [
            ('Was wissen Sie über Autoreparatur?', 'Darüber weiß ich wenig. Kleine Reparaturen können schwierig sein.'),
            ('Was mögen Sie an Ihrer Arbeit?', 'Ich mag die Ruhe zwischen den Regalen.'),
        ]:
            client.chat_completion = AsyncMock(side_effect=[
                (intent('chat').model_dump_json(), True), (json.dumps({'text': reply}), True)])
            new_state, event, text, _ = await dialogue.create_turn(message, state, history, advance_scene, ('live', (client, 'test-model')))
            self.assertEqual(new_state, state)
            self.assertEqual(event['kind'], 'chat')
            self.assertEqual(text, reply)
            payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
            self.assertEqual(payload['npc'], LIBRARY['npc'])
            self.assertEqual(payload['suggested_topic'], LIBRARY['scene']['suggested_topic'])
            self.assertNotIn('criteria', payload['state'])
            self.assertNotIn('target_book_id', payload)
            history += [{'role': 'user', 'text': message}, {'role': 'npc', 'text': text}]
        message = 'Zurück zum Balkongarten: Ich bin Anfänger.'
        client.chat_completion = AsyncMock(return_value=(intent(criteria={'audience': 'beginner'}, evidence=message).model_dump_json(), True))
        state, event, text, _ = await dialogue.create_turn(message, state, history, advance_scene, ('live', (client, 'test-model')))
        self.assertEqual(event['kind'], 'offered')
        self.assertIn('Mein erster Balkongarten', text)
        self.assertIsNone(state['borrowed_book_id'])

    async def test_unknown_book_topic_is_a_server_catalog_fact(self):
        client = AIService('google', 'test-key')
        message = 'Ich möchte ein Buch über Autoreparatur ausleihen.'
        client.chat_completion = AsyncMock(return_value=(intent('borrow', criteria={'subject': 'automotive'}, evidence=message).model_dump_json(), True))
        state, event, reply, _ = await dialogue.create_turn(message, initial_scene(), [], advance_scene, ('live', (client, 'test-model')))
        self.assertEqual(event['kind'], 'not_found')
        self.assertIsNone(state['borrowed_book_id'])
        self.assertIn('Katalog', reply)
        self.assertEqual(client.chat_completion.await_count, 1)

    def test_mock_casual_topics_do_not_become_book_search(self):
        for message in ['Ich mag Musik.', 'Was denken Sie über Autos?', 'Warum mögen Sie Gemüse?']:
            self.assertEqual(dialogue.mock_intent(message).action, 'chat')
        self.assertEqual(dialogue.mock_intent('Ich suche ein Buch über Autos.').criteria.subject, 'automotive')

    async def test_chat_after_partial_search_uses_conversation_context(self):
        state, _ = advance_scene(initial_scene(), intent(criteria={'subject': 'gardening'}))
        history = [{'role': 'npc', 'text': 'Möchten Sie Gemüse auf dem Balkon oder im Garten anbauen?'}]
        client = AIService('google', 'test-key')
        message = 'Ich mag Musik. Was hören Sie gern?'
        client.chat_completion = AsyncMock(side_effect=[
            (intent('chat').model_dump_json(), True), ('{"text":"Ich höre gern Jazz, besonders am Abend."}', True)])
        result, event, reply, _ = await dialogue.create_turn(message, state, history, advance_scene, ('live', (client, 'test-model')))
        self.assertEqual(result, state)
        self.assertEqual(event['kind'], 'chat')
        self.assertEqual(reply, 'Ich höre gern Jazz, besonders am Abend.')
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertEqual(payload['history'], history)
        self.assertEqual(payload['user_message'], message)

    async def test_correct_and_imperfect_requests_use_semantics(self):
        for message in ['Ich möchte ein Buch über Gemüse auf dem Balkon für Anfänger ausleihen.',
                        'Ich wollen Buch Gemüse Balkon. Ich Anfänger. Ausleihen bitte.']:
            client = AIService('google', 'test-key')
            extracted = intent('borrow', criteria={'subject': 'gardening', 'setting': 'balcony', 'audience': 'beginner'}, evidence=message)
            client.chat_completion = AsyncMock(return_value=(extracted.model_dump_json(), True))
            state, event, reply, mode = await dialogue.create_turn(message, initial_scene(),
                [{'role': 'npc', 'text': LIBRARY['scene']['opening']}], advance_scene, ('live', (client, 'test-model')))
            self.assertEqual(state['outcome'], 'success')
            self.assertEqual(event['kind'], 'borrowed')
            self.assertIn('Mein erster Balkongarten', reply)
            self.assertEqual(client.chat_completion.await_count, 1)

    async def test_off_topic_and_simplify_are_generated_in_role(self):
        for action in ['chat', 'simplify']:
            client = AIService('google', 'test-key')
            client.chat_completion = AsyncMock(side_effect=[
                (intent(action).model_dump_json(), True), ('{"text":"Gern. Was möchten Sie wissen?"}', True)])
            state, event, reply, _ = await dialogue.create_turn('Bitte einfacher.' if action == 'simplify' else 'Warum mögen Sie Bücher?',
                initial_scene(), [{'role': 'npc', 'text': LIBRARY['scene']['opening']}], advance_scene, ('live', (client, 'test-model')))
            self.assertEqual(state['outcome'], 'ongoing')
            self.assertEqual(event['kind'], action)
            self.assertEqual(reply, 'Gern. Was möchten Sie wissen?')
            self.assertEqual(client.chat_completion.await_count, 2)

    async def test_model_cannot_invent_world_fields_or_unavailable_loan(self):
        client = AIService('google', 'test-key')
        client.chat_completion = AsyncMock(return_value=('{"action":"confirm","confidence":1,"success":true}', True))
        with self.assertRaises(dialogue.DialogueUnavailable):
            await dialogue.interpret('Ja', initial_scene(), [], ('live', (client, 'test-model')))
        message = 'Bitte Einfach kochen jeden Tag ausleihen'
        client.chat_completion = AsyncMock(return_value=(intent('borrow', requested_title='Einfach kochen jeden Tag', evidence=message).model_dump_json(), True))
        state, event, reply, _ = await dialogue.create_turn(message, initial_scene(), [], advance_scene, ('live', (client, 'test-model')))
        self.assertEqual(event['kind'], 'unavailable')
        self.assertIsNone(state['borrowed_book_id'])
        self.assertIn('bereits ausgeliehen', reply)
        client.chat_completion = AsyncMock(return_value=(intent('borrow', requested_title='Mein erster Balkongarten', evidence='Hallo').model_dump_json(), True))
        extracted = await dialogue.interpret('Hallo', initial_scene(), [], ('live', (client, 'test-model')))
        self.assertLess(extracted.confidence, .75)

    async def test_failure_timeout_bad_json_and_invented_evidence(self):
        client = AIService('google', 'test-key')
        for result in [('provider secret error', False), ('not json', True)]:
            client.chat_completion = AsyncMock(return_value=result)
            with self.assertRaises(dialogue.DialogueUnavailable):
                await dialogue.create_turn('Hallo', initial_scene(), [], advance_scene, ('live', (client, 'test-model')))
        client.chat_completion = AsyncMock(return_value=(intent('confirm', evidence='made up').model_dump_json(), True))
        result = await dialogue.interpret('Nein', initial_scene(), [], ('live', (client, 'test-model')))
        self.assertLess(result.confidence, .75)
        async def slow(**kwargs):
            await asyncio.sleep(.1)
        client.chat_completion = slow
        with patch.object(dialogue, 'AI_TIMEOUT', .01), self.assertRaises(dialogue.DialogueUnavailable):
            await dialogue.create_turn('Hallo', initial_scene(), [], advance_scene, ('live', (client, 'test-model')))

    async def test_slower_and_repeat_do_not_change_outcome(self):
        history = [{'role': 'npc', 'text': 'Guten Tag!'}]
        for action in ['slow', 'repeat']:
            client = AIService('google', 'test-key')
            client.chat_completion = AsyncMock(return_value=(intent(action).model_dump_json(), True))
            state, _, reply, _ = await dialogue.create_turn('Bitte', initial_scene(), history, advance_scene, ('live', (client, 'test-model')))
            self.assertEqual(state['outcome'], 'ongoing')
            self.assertEqual(state['slow_speech'], action == 'slow')
            if action == 'repeat':
                self.assertEqual(reply, 'Guten Tag!')

    async def test_transport_token_limits_for_each_existing_provider(self):
        for provider, model, response in [
            ('google', 'gemini-test', {'candidates': [{'content': {'parts': [{'text': 'OK'}]}}]}),
            ('groq', 'test', {'choices': [{'message': {'content': 'OK'}}]}),
            ('openrouter', 'test', {'choices': [{'message': {'content': 'OK'}}]}),
            ('ollama', 'test', {'message': {'content': 'OK'}}),
        ]:
            client = AIService(provider, 'test-key')
            client._make_request = AsyncMock(return_value=(response, True))
            self.assertEqual(await client.chat_completion('system', 'message', model, max_output_tokens=250), ('OK', True))
            payload = client._make_request.call_args.kwargs['json_data']
            value = payload['generationConfig']['maxOutputTokens'] if provider == 'google' else payload['options']['num_predict'] if provider == 'ollama' else payload['max_completion_tokens'] if provider == 'groq' else payload['max_tokens']
            self.assertEqual(value, 250)


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        uri = f'file:game-test-{uuid4()}?mode=memory&cache=shared'
        self.keeper = sqlite3.connect(uri, uri=True)
        self.db = SqliteDatabase(uri, uri=True, check_same_thread=False)
        self.previous_db = tma_db.obj
        tma_db.initialize(self.db)
        run_game_migration(self.db)
        self.config = patch.object(service, 'configuration', return_value=('mock', None))
        self.config.start()
        self.app = FastAPI()
        self.app.include_router(router, prefix='/api')
        self.app.dependency_overrides[get_authenticated_user_id] = lambda: 1
        self.client = TestClient(self.app)

    def tearDown(self):
        self.config.stop()
        self.client.close()
        self.db.close()
        tma_db.initialize(self.previous_db)
        self.keeper.close()

    def start(self, user_id=1):
        return service.start_attempt(str(uuid4()), user_id, LIBRARY['scene']['situation_id'])

    def turn(self, data, message, action='message', request_id=None):
        with patch.object(service, 'MIN_REQUEST_INTERVAL', 0):
            return asyncio.run(service.send_turn(data['id'], 1,
                TurnRequest(request_id=request_id or uuid4(), version=data['version'], message=message, action=action)))

    def test_restart_is_clean_and_previous_attempt_is_linked(self):
        first = self.start()
        first = self.turn(first, '', 'hint')
        second = self.start()
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(second['hint_count'], 0)
        self.assertEqual(second['turn_count'], 0)
        self.assertEqual(second['outcome'], 'ongoing')
        self.assertIsNotNone(second['previous_attempt_at'])
        self.assertEqual(len(second['history']), 1)

    def test_duplicate_requests_are_replayed_and_conflicts_rejected(self):
        data = self.start()
        request_id = uuid4()
        result = self.turn(data, 'Hallo', request_id=request_id)
        replay = self.turn(data, 'Hallo', request_id=request_id)
        self.assertEqual(result, replay)
        self.assertEqual(result['turn_count'], 1)
        with self.assertRaises(HTTPException) as raised:
            self.turn(data, 'Andere Nachricht', request_id=request_id)
        self.assertEqual(raised.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            self.turn(data, 'Hallo wieder')

    def test_unavailable_ai_preserves_history_and_releases_reservation(self):
        data = self.start()
        with patch.object(service, 'create_turn', new=AsyncMock(side_effect=dialogue.DialogueUnavailable())), self.assertRaises(HTTPException) as raised:
            self.turn(data, 'Hallo')
        self.assertEqual(raised.exception.detail, 'game_ai_unavailable')
        unchanged = service.load_attempt(data['id'], 1)
        self.assertEqual(unchanged['history'], data['history'])
        self.assertEqual(unchanged['version'], 0)
        with self.db.connection_context():
            self.assertIsNone(TMAGameAttempt.get_by_id(data['id']).inflight_id)
        self.assertEqual(self.turn(data, 'Hallo')['turn_count'], 1)

    def test_strict_auth_owner_and_client_cannot_set_scene_or_result(self):
        data = self.start(2)
        response = self.client.get(f'/api/game/attempts/{data["id"]}')
        self.assertEqual(response.status_code, 404)
        response = self.client.post('/api/game/attempts', json={'attempt_id': data['id']})
        self.assertEqual(response.status_code, 404)
        data = self.start()
        response = self.client.post(f'/api/game/attempts/{data["id"]}/turns', json={
            'request_id': str(uuid4()), 'version': 0, 'message': 'Hallo', 'outcome': 'success'})
        self.assertEqual(response.status_code, 422)
        self.app.dependency_overrides.clear()
        response = self.client.get(f'/api/game/attempts/{data["id"]}', headers={'X-User-ID': '1'})
        self.assertEqual(response.status_code, 401)

    def test_budget_rate_limit_history_bound_and_turn_limit(self):
        data = self.start()
        request = TurnRequest(request_id=uuid4(), version=0, message='Hallo')
        with self.db.connection_context():
            TMAGameAttempt.update(last_request_at=service.utcnow(), api_requests=120).where(TMAGameAttempt.id == data['id']).execute()
        with self.assertRaises(HTTPException) as raised:
            service.reserve_turn(data['id'], 1, request, 'live')
        self.assertEqual(raised.exception.detail, 'game_daily_limit')
        with self.assertRaises(HTTPException) as raised:
            service.reserve_turn(data['id'], 1, request, 'mock')
        self.assertEqual(raised.exception.detail, 'game_rate_limit')
        with self.db.connection_context():
            TMAGameAttempt.update(last_request_at=None, api_requests=0).execute()
        for _ in range(40):
            data = self.turn(data, '', 'hint')
        self.assertLessEqual(len(data['history']), 24)
        self.assertTrue(any(m['role'] == 'npc' for m in data['history']))
        with self.assertRaises(HTTPException) as raised:
            self.turn(data, 'Hallo')
        self.assertEqual(raised.exception.detail, 'game_turn_limit')

    def test_budget_resets_at_midnight_for_attempts_created_yesterday(self):
        data = self.start()
        yesterday = service.utcnow() - datetime.timedelta(days=1)
        with self.db.connection_context():
            TMAGameAttempt.update(created_at=yesterday, last_request_at=yesterday, api_requests=120).execute()
        prepared = service.reserve_turn(data['id'], 1, TurnRequest(request_id=uuid4(), version=0, message='Hallo'), 'live')
        self.assertIn('state', prepared)
        with self.db.connection_context():
            self.assertEqual(TMAGameAttempt.get_by_id(data['id']).api_requests, 2)

    def test_inflight_guard_and_migration_rerun(self):
        data = self.start()
        request = TurnRequest(request_id=uuid4(), version=0, message='Hallo')
        service.reserve_turn(data['id'], 1, request, 'mock')
        with self.assertRaises(HTTPException) as raised:
            service.reserve_turn(data['id'], 1, request, 'mock')
        self.assertEqual(raised.exception.detail, 'game_request_in_progress')
        run_game_migration(self.db)
        with self.db.connection_context():
            self.assertEqual(self.db.execute_sql('SELECT COUNT(*) FROM tma_migration_history WHERE migration_id=87').fetchone()[0], 1)
            self.assertEqual(TMAGameAttempt.select().count(), 1)


if __name__ == '__main__':
    unittest.main()
