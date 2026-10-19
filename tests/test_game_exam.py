"""Disposable SQLite and mocked provider; no live AI, database or media calls."""
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from fastapi import HTTPException

from api.models import TMAGameAttempt
from api.routers.game import TurnRequest
from api.services import game_dialogue as dialogue, game_service as service
from api.services.game_exam import ExamReply, ExamReview, exam_review, initial_exam
from api.services.game_scene import EXAM, NEIGHBOR, advance_scene
from tests import test_game_mode as legacy

TOPIC = 'Sie organisieren ein Fest. Planen Sie: Wann? Wo? Essen? Wer macht was?'


class ExamDialogueTests(unittest.IsolatedAsyncioTestCase):
    async def turn(self, output, state=None, message='Ich schlage Samstag vor.'):
        client = Mock(chat_completion=AsyncMock(return_value=(ExamReply(**output).model_dump_json(), True)))
        result = await dialogue.create_turn(message, state or initial_exam(TOPIC),
            [{'role': 'npc', 'text': 'Wann treffen wir uns?'}], advance_scene, ('live', (client, 'test')))
        return result, client

    async def test_partner_receives_topic_and_history_without_neighbor_passport(self):
        (state, event, text, _), client = await self.turn({'text': 'Samstag passt mir nicht. Geht Sonntag?'})
        self.assertFalse(state['ended'])
        self.assertIn('Sonntag', text)
        self.assertEqual(event['kind'], 'chat')
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertEqual(payload['topic'], TOPIC)
        self.assertEqual(len(payload['history']), 1)
        self.assertNotIn('npc', payload)
        self.assertEqual(client.chat_completion.await_count, 1)

    async def test_agreement_closes_after_minimum_with_no_new_question(self):
        state = {**initial_exam(TOPIC), 'exchange_count': 5}
        (state, _, reply, _), _ = await self.turn({'text': 'Dann Samstag im Park. Was noch?', 'plan_agreed': True}, state)
        self.assertTrue(state['ended'])
        self.assertEqual(state['end_reason'], 'agreement')
        self.assertNotIn('?', reply)
        self.assertTrue(reply.endswith(EXAM['scene']['farewell']))
        (state, _, _, _), _ = await self.turn({'text': 'Gut.', 'plan_agreed': True})
        self.assertFalse(state['ended'])

    async def test_duration_and_request_cap_finish_even_if_model_does_not(self):
        for extra in ({'exchange_count': 15}, {'_request_limit': True}):
            (state, _, text, _), client = await self.turn({'text': 'Wir haben noch nicht alles geklärt. Wo?'},
                {**initial_exam(TOPIC), **extra})
            self.assertTrue(state['ended'])
            self.assertNotIn('?', text)
            self.assertTrue(json.loads(client.chat_completion.call_args.kwargs['user_message'])['closing_required'])

    async def test_goodbye_requires_current_message_evidence(self):
        (state, _, _, _), _ = await self.turn({'text': 'Danke.', 'action': 'end', 'end_evidence': 'Tschüss'})
        self.assertFalse(state['ended'])
        (state, _, _, _), _ = await self.turn({'text': 'Danke.', 'action': 'end', 'end_evidence': 'Tschüss'}, message='Tschüss!')
        self.assertTrue(state['ended'])

    async def test_support_persists_and_does_not_end_on_agreement(self):
        for action, field in [('slow', 'slow_speech'), ('simplify', 'simple_language')]:
            (state, _, _, _), _ = await self.turn({'text': 'Einfacher gesagt …', 'action': action, 'plan_agreed': True},
                {**initial_exam(TOPIC), 'exchange_count': 7})
            self.assertTrue(state[field])
            self.assertFalse(state['ended'])
        (_, _, text, _), _ = await self.turn({'text': 'ignored', 'action': 'repeat'})
        self.assertEqual(text, 'Wann treffen wir uns?')

    async def test_review_grounds_findings_in_user_not_partner_or_hint(self):
        review = ExamReview(task_completion='Обсудили дату; место не согласовано.',
            grammar=[{'evidence': 'Ich kommen', 'correction': 'Ich komme', 'explanation': 'Первое лицо.'},
                     {'evidence': 'NPC error', 'correction': 'other', 'explanation': 'Не ученик.'}],
            vocabulary=[{'evidence': 'hint text', 'correction': 'other', 'explanation': 'Не ученик.'}],
            useful_expressions=['Wie wäre es mit …? — Как насчёт …?'], recommendations='Обоснуйте выбор места.')
        call = AsyncMock(return_value=review)
        result = await exam_review(initial_exam(TOPIC), [{'role': 'user', 'text': 'Ich kommen am Samstag.'},
            {'role': 'npc', 'text': 'NPC error'}, {'role': 'hint', 'text': 'hint text'}], ('live', (None, 'test')), call)
        self.assertEqual(len(result['grammar']), 1)
        self.assertEqual(result['vocabulary'], [])
        self.assertEqual(result['kind'], 'b1_exam')
        self.assertEqual(result['language'], 'ru')

    async def test_invalid_model_response_fails_instead_of_mock_success(self):
        client = Mock(chat_completion=AsyncMock(return_value=('not JSON', True)))
        with self.assertRaises(dialogue.DialogueUnavailable):
            await dialogue.create_turn('Hallo', initial_exam(TOPIC), [], advance_scene, ('live', (client, 'test')))


class ExamPersistenceTests(unittest.TestCase):
    setUp = legacy.PersistenceTests.setUp
    tearDown = legacy.PersistenceTests.tearDown
    turn = legacy.PersistenceTests.turn

    def start(self):
        return service.start_attempt(str(uuid4()), 1, EXAM['scene']['situation_id'], TOPIC)

    def test_contract_topic_validation_and_default_neighbor(self):
        for payload in ({'mode': 'b1_exam'}, {'mode': 'b1_exam', 'topic': ' '},
                        {'mode': 'b1_exam', 'topic': 'a' * 6001}, {'mode': 'unknown'}, {'topic': TOPIC}):
            response = self.client.post('/api/game/attempts', json={'attempt_id': str(uuid4()), **payload})
            self.assertEqual(response.status_code, 422)
        response = self.client.post('/api/game/attempts', json={'attempt_id': str(uuid4())})
        self.assertEqual(response.json()['situation_id'], NEIGHBOR['scene']['situation_id'])
        response = self.client.post('/api/game/attempts', json={'attempt_id': str(uuid4()), 'mode': 'b1_exam', 'topic': TOPIC})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['scene']['exam_topic'], TOPIC)

    def test_full_history_result_replay_and_repeat_are_preserved(self):
        data = self.start()
        first_id = data['id']
        self.assertEqual(service.start_attempt(first_id, 1, EXAM['scene']['situation_id'], TOPIC)['id'], first_id)
        for _ in range(16):
            data = self.turn(data, 'Ich komme am Samstag.')
        self.assertTrue(data['ended'])
        self.assertEqual(len(data['history']), 33)
        self.assertIsNone(data['learning_result'])
        request_id = uuid4()
        reviewed = self.turn(data, '', 'review', request_id)
        replay = self.turn(data, '', 'review', request_id)
        self.assertEqual(reviewed, replay)
        self.assertEqual(reviewed['turn_count'], 16)
        self.assertEqual(reviewed['history'], data['history'])
        self.assertEqual(service.load_attempt(first_id, 1), reviewed)
        second = self.start()
        self.assertNotEqual(second['id'], first_id)
        self.assertEqual(len(second['history']), 1)
        self.assertIsNone(second['learning_result'])
        self.assertIsNotNone(second['previous_attempt_at'])
        self.assertEqual(len(service.list_exam_attempts(1)), 2)
        self.assertEqual(service.list_exam_attempts(2), [])
        with self.assertRaises(HTTPException) as error:
            service.load_attempt(first_id, 2)
        self.assertEqual(error.exception.status_code, 404)

    def test_review_only_after_end_and_button_end_is_not_user_speech(self):
        data = self.start()
        with self.assertRaises(HTTPException) as error:
            self.turn(data, '', 'review')
        self.assertEqual(error.exception.detail, 'game_review_not_ready')
        ended = self.turn(data, '', 'end')
        self.assertFalse(any(m['role'] == 'user' for m in ended['history']))
        self.assertTrue(ended['ended'])
        self.assertEqual(self.turn(ended, '', 'review')['learning_result']['kind'], 'b1_exam')

    def test_review_failure_preserves_completed_conversation_and_releases_lease(self):
        ended = self.turn(self.start(), '', 'end')
        with patch.object(service, 'exam_review', AsyncMock(side_effect=dialogue.DialogueUnavailable())):
            with self.assertRaises(HTTPException) as error:
                self.turn(ended, '', 'review')
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(service.load_attempt(ended['id'], 1), ended)
        self.assertIsNone(TMAGameAttempt.get_by_id(ended['id']).inflight_id)
        self.assertIsNotNone(self.turn(ended, '', 'review')['learning_result'])

    def test_review_can_run_at_request_cap_and_reserves_one_live_call(self):
        data = self.start()
        TMAGameAttempt.update(turn_count=39).where(TMAGameAttempt.id == data['id']).execute()
        data = self.turn(data, '', 'hint')
        self.assertTrue(data['ended'])
        client = Mock(chat_completion=AsyncMock(return_value=(ExamReview(task_completion='Недостаточно реплик.',
            grammar=[], vocabulary=[], useful_expressions=[], recommendations='Попробуйте ещё раз.').model_dump_json(), True)))
        with patch.object(service, 'configuration', return_value=('live', (client, 'test'))):
            reviewed = self.turn(data, '', 'review')
        self.assertEqual(reviewed['turn_count'], 40)
        self.assertEqual(TMAGameAttempt.get_by_id(data['id']).api_requests, 1)
        self.assertEqual(client.chat_completion.await_count, 1)
        with self.assertRaises(HTTPException):
            self.turn(reviewed, 'Hallo')


if __name__ == '__main__':
    unittest.main()
