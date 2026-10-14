"""Neighbor scenario contracts; isolated SQLite and mocked AI, no network or microphone."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

from api.routers.game import TurnRequest
from api.services import game_dialogue as dialogue, game_service as service
from api.services.game_scene import NEIGHBOR, advance_scene, MAX_TURNS
from api.services.game_conversation import (
    SocialIntent, advance_conversation, initial_conversation, finish_reply, end_conversation,
)
from tests import test_game_mode as legacy_tests


class NeighborDialogueTests(unittest.IsolatedAsyncioTestCase):
    async def run_turn(self, message, observation, reply, state=None, history=None):
        client = unittest.mock.Mock()
        client.chat_completion = AsyncMock(side_effect=[
            (SocialIntent(confidence=1, **observation).model_dump_json(), True),
            (json.dumps(reply), True)])
        result = await dialogue.create_turn(message, state or initial_conversation(),
            history or [{'role': 'npc', 'text': NEIGHBOR['scene']['opening']}],
            advance_scene, ('live', (client, 'test-model')))
        return result, client

    async def test_normal_meeting_remembers_only_explicit_current_facts(self):
        message = 'Guten Tag! Ich heiße Anna. Ich komme aus Polen. Und Sie?'
        (state, event, text, _), client = await self.run_turn(message, {
            'goals': [{'goal': 'greet', 'evidence': 'Guten Tag!'},
                      {'goal': 'introduce_self', 'evidence': 'Ich heiße Anna.'},
                      {'goal': 'share_about_self', 'evidence': 'Ich komme aus Polen.'},
                      {'goal': 'ask_neighbor', 'evidence': 'Und Sie?'}],
            'facts': [{'key': 'name', 'evidence': 'Ich heiße Anna.'},
                      {'key': 'origin', 'evidence': 'Ich komme aus Polen.'},
                      {'key': 'work', 'evidence': 'Ich bin Ärztin.'}],
        }, {'text': 'Freut mich, Anna. Ich wohne auch in diesem Haus.'})
        self.assertFalse(state['ended'])
        self.assertEqual(event['kind'], 'chat')
        self.assertIn('Anna', text)
        self.assertNotIn('work', state['known_facts'])
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertEqual(payload['npc']['profession'], 'Nachbarin')
        self.assertIn('seit acht Jahren', payload['npc']['background'])
        self.assertEqual(payload['known_facts']['origin'], 'Ich komme aus Polen.')
        self.assertIsNone(payload['learner_level'])
        self.assertEqual(client.chat_completion.await_count, 2)

    async def test_grammar_candidates_are_private_unconfirmed_and_evidenced(self):
        message = 'Ich kommen aus Polen.'
        (state, _, text, _), _ = await self.run_turn(message, {
            'goals': [{'goal': 'share_about_self', 'evidence': message}],
            'review': [{'kind': 'grammar', 'evidence': 'Ich kommen', 'suggestion': 'Ich komme'},
                       {'kind': 'vocabulary', 'evidence': 'invented', 'suggestion': 'nicht speichern'}],
        }, {'text': 'Das ist schön. Wie gefällt es Ihnen hier?', 'question_topic': 'settling'})
        self.assertNotIn('Ich komme', text)
        self.assertEqual(len(state['review_candidates']), 1)
        final, _, _ = end_conversation(state)
        result = final['learning_result']
        self.assertFalse(result['review_candidates'][0]['confirmed'])
        self.assertEqual(result['level_assessment'], None)
        self.assertEqual(result['listening_comprehension'], 'not_assessed')

    async def test_not_understanding_simplifies_previous_question_and_persists(self):
        state = initial_conversation()
        (state, event, text, _), client = await self.run_turn('Ich verstehe nicht.', {'action': 'simplify'},
            {'text': 'Sie sind neu hier?', 'question_topic': 'move'}, state)
        self.assertTrue(state['simple_language'])
        self.assertEqual(event['kind'], 'simplify')
        self.assertIn('?', text)  # Requested rephrasing may repeat a topic.
        (state, _, _, _), client = await self.run_turn('Ja.', {}, {'text': 'Willkommen im Haus.'}, state)
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertTrue(payload['simple_language'])
        self.assertEqual(state['difficulties'][0]['kind'], 'simplify')

    async def test_topic_detour_and_short_response_use_history_without_invented_goals(self):
        history = [{'role': 'npc', 'text': 'Sind Sie gerade eingezogen?'},
                   {'role': 'user', 'text': 'Ja.'}, {'role': 'npc', 'text': 'Willkommen im Haus.'}]
        (state, event, reply, _), client = await self.run_turn('Mögen Sie Autos?', {},
            {'text': 'Davon weiß ich wenig. Haben Sie beim Umzug ein Auto benutzt?', 'question_topic': 'other'},
            history=history)
        self.assertEqual(event['kind'], 'chat')
        self.assertFalse(state['ended'])
        self.assertEqual(state['goals_observed'], {})
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertEqual(payload['history'], history)
        self.assertIn('Umzug', reply)

    async def test_goodbye_has_evidence_and_completes_with_no_new_question(self):
        (state, _, reply, _), client = await self.run_turn('Ich muss jetzt los. Bis bald!',
            {'action': 'end', 'evidence': 'Bis bald!',
             'goals': [{'goal': 'polite_goodbye', 'evidence': 'Bis bald!'}]},
            {'text': 'Es hat mich gefreut. Wo arbeiten Sie?', 'question_topic': 'work'})
        self.assertTrue(state['ended'])
        self.assertEqual(state['end_reason'], 'user')
        self.assertNotIn('?', reply)
        self.assertTrue(reply.endswith(NEIGHBOR['scene']['farewell']))
        self.assertTrue(json.loads(client.chat_completion.call_args.kwargs['user_message'])['closing'])
        state, event = advance_conversation(initial_conversation(),
            SocialIntent(action='end', confidence=1, evidence='invented'), 'Hallo')
        self.assertFalse(event['closing'])

    async def test_semantically_repeated_question_is_suppressed_but_requested_repeat_allowed(self):
        (state, _, text, _), _ = await self.run_turn('Ja, gerade gestern.', {},
            {'text': 'Willkommen. Sind Sie neu eingezogen?', 'question_topic': 'move'})
        self.assertEqual(text, 'Willkommen.')
        history = [{'role': 'npc', 'text': 'Sind Sie gerade eingezogen?'}]
        client = unittest.mock.Mock()
        client.chat_completion = AsyncMock(return_value=(SocialIntent(action='repeat', confidence=1).model_dump_json(), True))
        result = await dialogue.create_turn('Bitte wiederholen.', state, history, advance_scene, ('live', (client, 'test')))
        self.assertEqual(result[2], history[0]['text'])
        self.assertEqual(client.chat_completion.await_count, 1)

    async def test_history_and_facts_survive_beyond_old_twelve_message_window(self):
        state = initial_conversation()
        state['known_facts']['name'] = 'Ich heiße Anna.'
        state['asked_topics'].append('name')
        history = [{'role': 'user', 'text': 'Ich heiße Anna.'}] + [
            {'role': 'npc' if i % 2 else 'user', 'text': f'Replik {i}.'} for i in range(17)]
        (state, _, _, _), client = await self.run_turn('Danke.', {}, {'text': 'Gern, Anna.'}, state, history)
        payload = json.loads(client.chat_completion.call_args.kwargs['user_message'])
        self.assertEqual(payload['history'], history)
        self.assertIn('name', payload['asked_topics'])

    async def test_bad_json_and_provider_failure_do_not_return_fake_success(self):
        client = unittest.mock.Mock()
        for output in [('not JSON', True), ('error', False)]:
            client.chat_completion = AsyncMock(return_value=output)
            with self.assertRaises(dialogue.DialogueUnavailable):
                await dialogue.create_turn('Hallo', initial_conversation(), [], advance_scene, ('live', (client, 'test')))


class NeighborStateTests(unittest.TestCase):
    def test_goal_based_closing_waits_six_exchanges_and_never_requires_every_goal(self):
        state = initial_conversation()
        message = 'Ich heiße Anna. Ich komme aus Polen. Und Sie? Ja.'
        intent = SocialIntent(confidence=1, goals=[
            {'goal': g, 'evidence': message} for g in NEIGHBOR['scene']['closing_goals']])
        for number in range(1, 7):
            state, event = advance_conversation(state, intent, message)
            self.assertEqual(event['closing'], number == 6)
        reply = finish_reply(state, event, 'Danke. Mögen Sie Musik?', 'hobby')
        self.assertEqual(state['end_reason'], 'goals')
        self.assertNotIn('?', reply)
        self.assertIn('greet', state['learning_result']['not_achieved_goals'])

    def test_tenth_exchange_closes_even_if_model_never_finishes(self):
        state = initial_conversation()
        for number in range(1, 11):
            state, event = advance_conversation(state, SocialIntent(confidence=1), 'Ja.')
            reply = finish_reply(state, event, 'Das verstehe ich. Was machen Sie gern?', 'hobby')
            self.assertEqual(state['ended'], number == 10)
        self.assertEqual(state['learning_result']['exchange_count'], 10)
        self.assertEqual(state['end_reason'], 'duration')
        self.assertNotIn('?', reply)

    def test_uncertain_intent_cannot_claim_goals_facts_or_force_departure(self):
        state, event = advance_conversation(initial_conversation(), SocialIntent(
            action='end', confidence=.2, evidence='Hallo',
            goals=[{'goal': 'introduce_self', 'evidence': 'Hallo'}],
            facts=[{'key': 'name', 'evidence': 'Hallo'}]), 'Hallo')
        self.assertEqual(state['known_facts'], {})
        self.assertEqual(state['goals_observed'], {})
        self.assertFalse(event['closing'])
        self.assertEqual(event['kind'], 'clarify')

    def test_support_at_sixth_exchange_does_not_interrupt_unfinished_question(self):
        state = initial_conversation()
        state['exchange_count'] = 5
        state['goals_observed'] = {g: {'evidence': 'Ja.', 'exchange': 1}
                                   for g in NEIGHBOR['scene']['closing_goals']}
        state, event = advance_conversation(state, SocialIntent(action='simplify', confidence=1), 'Bitte einfacher.')
        self.assertFalse(event['closing'])
        self.assertIn('?', finish_reply(state, event, 'Sie sind neu hier?', 'move'))

    def test_exact_duplicate_question_is_suppressed_even_without_topic_annotation(self):
        state = initial_conversation()
        event = {'kind': 'chat', 'closing': False}
        reply = finish_reply(state, event, 'Schön. Sind Sie gerade eingezogen?')
        self.assertEqual(reply, 'Schön.')

    def test_volunteered_name_is_not_asked_again(self):
        state = initial_conversation()
        state['known_facts']['name'] = 'Ich heiße Anna.'
        self.assertEqual(finish_reply(state, {'kind': 'chat', 'closing': False},
            'Freut mich. Wie heißen Sie?', 'name'), 'Freut mich.')


class NeighborPersistenceTests(unittest.TestCase):
    setUp = legacy_tests.PersistenceTests.setUp
    tearDown = legacy_tests.PersistenceTests.tearDown
    turn = legacy_tests.PersistenceTests.turn

    def start(self):
        return service.start_attempt(str(uuid4()), 1)

    def test_api_defaults_to_neighbor_and_old_library_attempt_can_resume(self):
        response = self.client.post('/api/game/attempts', json={'attempt_id': str(uuid4())})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['situation_id'], 'neighbor_introduction_v1')
        info = self.client.get('/api/game/scene').json()
        self.assertEqual(info['npc']['profession'], 'Nachbarin')
        old = service.start_attempt(str(uuid4()), 1, 'library_balcony_book_v1')
        restored = service.load_attempt(old['id'], 1)
        self.assertEqual(restored['scenario']['scene']['name'], 'Stadtbibliothek')
        self.assertFalse(restored['ended'])

    def test_end_without_ai_persists_result_replays_and_blocks_followup(self):
        data = self.start()
        data = self.turn(data, '', 'hint')
        request_id = uuid4()
        with patch.object(service, 'configuration', side_effect=AssertionError('No AI needed')):
            final = self.turn(data, '', 'end', request_id=request_id)
            self.assertEqual(final, self.turn(data, '', 'end', request_id=request_id))
        self.assertTrue(final['ended'])
        self.assertEqual(final['scene']['exchange_count'], 0)
        self.assertEqual(final['history'][-1]['role'], 'npc')
        self.assertEqual(final, service.load_attempt(data['id'], 1))
        self.assertEqual(final['learning_result']['achieved_goals'], [])
        self.assertEqual(final['learning_result']['difficulties'][0]['kind'], 'hint')
        with self.assertRaises(HTTPException) as raised:
            self.turn(final, 'Hallo')
        self.assertEqual(raised.exception.detail, 'game_conversation_ended')

    def test_duration_and_hints_have_separate_counters_and_reset_is_clean(self):
        data = self.start()
        for _ in range(3):
            data = self.turn(data, '', 'hint')
        for _ in range(10):
            data = self.turn(data, 'Ja.')
        self.assertTrue(data['ended'])
        self.assertEqual(data['turn_count'], 13)
        self.assertEqual(data['learning_result']['exchange_count'], 10)
        self.assertLessEqual(len(data['history']), 24)
        new = self.start()
        self.assertFalse(new['ended'])
        self.assertIsNone(new['learning_result'])
        self.assertEqual(new['scene']['known_facts'], {})

    def test_request_cap_with_hints_also_has_npc_farewell(self):
        data = self.start()
        for _ in range(MAX_TURNS):
            data = self.turn(data, '', 'hint')
        self.assertTrue(data['ended'])
        self.assertEqual(data['learning_result']['end_reason'], 'request_limit')
        self.assertEqual(data['history'][-1], {'role': 'npc', 'text': NEIGHBOR['scene']['farewell']})

    def test_failed_turn_keeps_history_evidence_and_counts_for_retry(self):
        data = self.start()
        with patch.object(service, 'create_turn', new=AsyncMock(side_effect=dialogue.DialogueUnavailable())):
            with self.assertRaises(HTTPException):
                self.turn(data, 'Ich heiße Anna.')
        restored = service.load_attempt(data['id'], 1)
        self.assertEqual(restored['scene'], data['scene'])
        self.assertEqual(restored['history'], data['history'])
        self.assertEqual(self.turn(restored, 'Hallo')['scene']['exchange_count'], 1)

    def test_last_request_with_message_closes_before_formulation(self):
        data = self.start()
        for _ in range(MAX_TURNS - 1):
            data = self.turn(data, '', 'hint')
        data = self.turn(data, 'Hallo')
        self.assertTrue(data['ended'])
        self.assertEqual(data['learning_result']['end_reason'], 'request_limit')
        self.assertEqual(data['learning_result']['exchange_count'], 1)
        self.assertNotIn('_request_limit', data['scene'])

    def test_social_observations_do_not_create_unreviewed_foundation_skills(self):
        from api.game_mvp3.integration import begin_capture
        row = unittest.mock.Mock(user_id=1, situation_id='neighbor_introduction_v1')
        with patch('api.game_mvp3.integration.enabled_for', return_value=True), patch(
                'api.game_mvp3.integration._in_transaction', side_effect=AssertionError('Must skip')):
            begin_capture(row)

    def test_evidenced_result_persists_on_same_attempt_and_not_in_npc_speech(self):
        data = self.start()
        message = 'Guten Tag! Ich heißen Anna. Bis bald!'
        client = unittest.mock.Mock()
        client.chat_completion = AsyncMock(side_effect=[
            (SocialIntent(action='end', confidence=1, evidence='Bis bald!',
                goals=[{'goal': 'greet', 'evidence': 'Guten Tag!'},
                       {'goal': 'introduce_self', 'evidence': 'Ich heißen Anna.'},
                       {'goal': 'polite_goodbye', 'evidence': 'Bis bald!'}],
                facts=[{'key': 'name', 'evidence': 'Ich heißen Anna.'}],
                review=[{'kind': 'grammar', 'evidence': 'Ich heißen', 'suggestion': 'Ich heiße'}]
             ).model_dump_json(), True), ('{"text":"Freut mich, Anna."}', True)])
        with patch.object(service, 'configuration', return_value=('live', (client, 'test'))):
            final = self.turn(data, message)
        result = final['learning_result']
        self.assertEqual([g['goal'] for g in result['achieved_goals']], ['greet', 'introduce_self', 'polite_goodbye'])
        self.assertEqual(result['review_candidates'][0]['suggestion'], 'Ich heiße')
        self.assertEqual(result['assessment_status'], 'provisional')
        self.assertNotIn('Ich heiße', final['history'][-1]['text'])
        self.assertEqual(service.load_attempt(data['id'], 1)['learning_result'], result)


if __name__ == '__main__':
    unittest.main()
