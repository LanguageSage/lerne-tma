"""Real HTTP/services over disposable SQLite; all AI/network calls are mocked."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import test_material_permissions as fixture
from api import ai_service, models
from api.routers import ai
from api.services import reclassification as service


class ReclassificationTests(unittest.TestCase):
    setUp = fixture.MaterialPermissionTests.setUp
    cleanup = fixture.MaterialPermissionTests.cleanup
    call = fixture.MaterialPermissionTests.call

    def payload(self, **extra):
        return {'deck_id': self.deck.id, 'operation_id': str(uuid4()), **extra}

    def post(self, payload, user=101):
        response = self.call('POST', '/cards/classify-batch', user, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_hundred_cards_progress_and_committed_replay(self):
        for i in range(99):
            models.TMA_Card.create(deck=self.deck, front_text=f'Card {i}', back_text='')
        payload = self.payload(target_language='en')
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['B2'] * 10)) as provider:
            first = self.post(payload)
            self.assertEqual((first['complete'], first['completed_count'], first['remaining_count']), (False, 10, 90))
            self.assertEqual(first['status'], 'more')
            self.assertEqual(self.post(payload), first)  # simulate a lost HTTP response
            self.assertEqual(provider.await_count, 1)
            for index in range(1, 10):
                result = self.post({**payload, 'batch_index': index})
            self.assertEqual(provider.await_count, 10)
        self.assertEqual((result['status'], result['complete'], result['completed_count']), ('ok', True, 100))
        self.assertEqual(models.TMA_Card.select().where(models.TMA_Card.deck == self.deck).count(), 100)
        for card in models.TMA_Card.select().where(models.TMA_Card.deck == self.deck):
            self.assertEqual(card.tags.split(',').count('B2'), 1)
        self.assertEqual(self.post({**payload, 'batch_index': 10})['complete'], True)

    def test_partial_local_result_ai_error_then_explicit_resume(self):
        second = models.TMA_Card.create(deck=self.deck, front_text='Ambiguous', back_text='')
        payload = self.payload()
        with patch.object(service, 'classify_sentence_fast', side_effect=lambda text, _: {'level': 'A2', 'confidence': 1 if text == 'Haus' else 0}), \
                patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(side_effect=ValueError('private provider error'))):
            result = self.post(payload)
        self.assertEqual((result['status'], result['complete'], result['completed_count']), ('partial', False, 1))
        self.assertNotIn('private provider', json.dumps(result))
        self.assertIsNone(models.TMA_Card.get_by_id(second.id).tags)
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['C1'])) as provider:
            result = self.post({**payload, 'batch_index': result['next_batch']})
        self.assertEqual(provider.call_args.args[0], ['Ambiguous'])
        self.assertTrue(result['complete'])

    def test_hundred_cards_interrupted_at_halfway_continue_without_repeating_completed_work(self):
        for i in range(99):
            models.TMA_Card.create(deck=self.deck, front_text=f'Card {i}', back_text='')
        payload = self.payload(target_language='en')
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['B2'] * 10)) as provider:
            for index in range(5):
                result = self.post({**payload, 'batch_index': index})
            completed_phrases = {phrase for call in provider.call_args_list for phrase in call.args[0]}
        self.assertEqual((result['completed_count'], result['complete']), (50, False))
        interrupted = {**payload, 'batch_index': 5}
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(side_effect=asyncio.CancelledError())):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(ai.classify_cards_batch_endpoint(ai.ClassifyBatchRequest(**interrupted), 101))
        self.assertEqual(self.post(interrupted)['completed_count'], 50)
        with patch.object(service.time, 'time', return_value=service.time.time() + 61), \
                patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['B2'] * 10)) as resumed:
            for index in range(5, 10):
                result = self.post({**payload, 'batch_index': index})
        resumed_phrases = {phrase for call in resumed.call_args_list for phrase in call.args[0]}
        self.assertFalse(completed_phrases & resumed_phrases)
        self.assertEqual((result['completed_count'], result['complete']), (100, True))

    def test_cancellation_keeps_receipt_and_lease_then_resumes(self):
        payload = self.payload(target_language='en')
        async def cancel(*args, **kwargs):
            raise asyncio.CancelledError()
        with patch.object(ai_service, 'classify_phrases_batch', side_effect=cancel):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(ai.classify_cards_batch_endpoint(ai.ClassifyBatchRequest(**payload), 101))
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['B1'])) as provider:
            self.assertEqual(self.post(payload)['status'], 'busy')
            provider.assert_not_called()
            with patch.object(service.time, 'time', return_value=service.time.time() + 61):
                self.assertTrue(self.post(payload)['complete'])
        self.assertEqual(provider.await_count, 1)

    def test_concurrent_retry_has_no_second_provider_call(self):
        payload = self.payload(target_language='en')
        async def during_call(*args, **kwargs):
            retry = await ai.classify_cards_batch_endpoint(ai.ClassifyBatchRequest(**payload), 101)
            self.assertEqual(retry['status'], 'busy')
            return ['B2']
        with patch.object(ai_service, 'classify_phrases_batch', side_effect=during_call) as provider:
            self.assertTrue(self.post(payload)['complete'])
        self.assertEqual(provider.await_count, 1)

    def test_timeout_is_partial_and_never_writes_fallback(self):
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(side_effect=TimeoutError())):
            result = self.post(self.payload(target_language='en'))
        self.assertEqual((result['status'], result['complete'], result['updated_count']), ('partial', False, 0))
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')

    def test_retries_are_bounded_and_cooldown_allows_continuation(self):
        payload = self.payload(target_language='en')
        with patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(side_effect=ValueError())) as provider:
            for index in range(3):
                self.post({**payload, 'batch_index': index})
            result = self.post({**payload, 'batch_index': 3})
            self.assertEqual(result['error_code'], 'classification.attempt_limit')
            self.assertEqual(provider.await_count, 3)
        with patch.object(service.time, 'time', return_value=service.time.time() + 301), \
                patch.object(ai_service, 'classify_phrases_batch', new=AsyncMock(return_value=['C2'])):
            self.assertTrue(self.post({**payload, 'batch_index': 3})['complete'])

    def test_request_id_cannot_be_reused_with_different_scope(self):
        payload = self.payload()
        with patch.object(service, 'classify_sentence_fast', return_value={'level': 'A1', 'confidence': 1}):
            self.post(payload)
        response = self.call('POST', '/cards/classify-batch', json={**payload, 'target_language': 'en'})
        self.assertEqual(response.status_code, 409)

    def test_edited_card_is_not_overwritten_after_ai(self):
        async def edit(*args, **kwargs):
            models.TMA_Card.update(front_text='Changed', tags='manual', metadata='{"keep":true}').where(models.TMA_Card.id == self.card.id).execute()
            return ['B2']
        with patch.object(ai_service, 'classify_phrases_batch', side_effect=edit):
            result = self.post(self.payload(target_language='en'))
        self.assertEqual(result['error_code'], 'classification.card_changed')
        card = models.TMA_Card.get_by_id(self.card.id)
        self.assertEqual((card.front_text, card.tags), ('Changed', 'manual'))

    def test_metadata_and_non_cefr_tags_are_preserved(self):
        models.TMA_Card.update(metadata='{"custom":42}', tags='topic,A1,A2').where(models.TMA_Card.id == self.card.id).execute()
        with patch.object(service, 'classify_sentence_fast', return_value={'level': 'C1', 'confidence': 1}):
            self.assertTrue(self.post(self.payload())['complete'])
        card = models.TMA_Card.get_by_id(self.card.id)
        self.assertEqual(card.tags, 'topic,C1')
        self.assertEqual(json.loads(card.metadata)['custom'], 42)

    def test_expired_worker_cannot_commit_after_a_new_claim(self):
        operation_id = str(uuid4())
        scope = {'deck_id': self.deck.id, 'card_ids': [], 'target_language': 'en'}
        first = service._claim(scope, 101, operation_id, 0)
        with patch.object(service.time, 'time', return_value=service.time.time() + 61):
            second = service._claim(scope, 101, operation_id, 0)
        with self.assertRaises(fixture.HTTPException) as error:
            service._finish(first, [(first['cards'][0], service.build_ai_cefr_payload('C2'))], None, 101, operation_id)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')
        result = service._finish(second, [(second['cards'][0], service.build_ai_cefr_payload('B1'))], None, 101, operation_id)
        self.assertTrue(result['complete'])

    def test_actual_request_deadline_cancels_slow_provider(self):
        async def slow(*args, **kwargs):
            await asyncio.sleep(10)
            return ['C2']
        with patch.object(service, 'AI_TIMEOUT', .01), patch.object(ai_service, 'classify_phrases_batch', side_effect=slow):
            result = self.post(self.payload(target_language='en'))
        self.assertFalse(result['complete'])
        self.assertEqual(result['error_code'], 'classification.ai_unavailable')
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')

    def test_concurrent_metadata_edit_without_timestamp_is_preserved(self):
        async def edit(*args, **kwargs):
            models.TMA_Card.update(metadata='{"custom":99}').where(models.TMA_Card.id == self.card.id).execute()
            return ['B2']
        with patch.object(ai_service, 'classify_phrases_batch', side_effect=edit):
            result = self.post(self.payload(target_language='en'))
        self.assertFalse(result['complete'])
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).metadata, '{"custom":99}')

    def test_receipt_and_card_writes_rollback_together(self):
        payload = self.payload()
        with patch.object(service, 'classify_sentence_fast', return_value={'level': 'A1', 'confidence': 1}), \
                patch.object(service, '_dump', side_effect=lambda x: (_ for _ in ()).throw(RuntimeError('disk full')) if 'last_result' in x else json.dumps(x)):
            with self.assertRaises(RuntimeError):
                self.post(payload)
        self.assertEqual(models.TMA_Card.get_by_id(self.card.id).tags, 'old')
        state = json.loads(models.TMAOfflineBatch.get().response)
        self.assertEqual(state['next_batch'], 0)


class StrictProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_errors_short_invalid_or_unconfigured_result_raise(self):
        for response, success in [('secret error', False), ('["A1"]', True), ('["A1", "oops"]', True), ('truncated [', True)]:
            with self.subTest(response=response), patch.object(ai_service, 'get_ai_config', return_value=('google', 'fixture', 'gemini-fixture')), \
                    patch.object(ai_service, 'AIService') as client:
                client.return_value.chat_completion = AsyncMock(return_value=(response, success))
                with self.assertRaises(ValueError):
                    await ai_service.classify_phrases_batch(['One', 'Two'], 'en', strict=True)
                self.assertEqual(client.return_value.request_attempts, 1)
                self.assertEqual(client.return_value.key_attempts, 1)
        with patch.object(ai_service, 'get_ai_config', return_value=('google', '', '')):
            with self.assertRaises(ValueError):
                await ai_service.classify_phrases_batch(['One'], 'en', strict=True)

    async def test_success_is_validated_without_changing_legacy_fallback(self):
        with patch.object(ai_service, 'get_ai_config', return_value=('google', 'fixture', 'gemini-fixture')), \
                patch.object(ai_service, 'AIService') as client:
            client.return_value.chat_completion = AsyncMock(return_value=('["B2", "C1"]', True))
            self.assertEqual(await ai_service.classify_phrases_batch(['One', 'Two'], 'en', strict=True), ['B2', 'C1'])
            client.return_value.chat_completion = AsyncMock(return_value=('error', False))
            self.assertEqual(await ai_service.classify_phrases_batch(['One'], 'en'), ['A1'])
