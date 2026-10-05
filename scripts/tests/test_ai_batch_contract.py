"""AI batch checks: real router/service/parser and disposable SQLite; no provider calls."""
import asyncio
import importlib
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from fastapi import FastAPI, HTTPException
import httpx

fixture = runpy.run_path(str(Path(__file__).with_name('test_bulk_import_idempotency.py')))
models, cards_service, database = (fixture[k] for k in ('models', 'cards', 'database'))
ai_service = importlib.import_module('api.ai_service')
router = importlib.import_module('api.routers.ai')
router.services.bulk_save_cards = cards_service.bulk_save_cards
TABLES = fixture['TABLES'] + [models.TMASetting, models.TMACustomPrompt]


class AiBatchTests(unittest.TestCase):
    def setUp(self):
        database.create_tables(TABLES)
        models.TMAUser.create(user_id=1)
        self.deck = models.TMA_Deck.create(user_id=1, name='AI batch', target_language='de')
        self.input = [{'front': '::task\nWähle.\n::exercise\nWo?\nHier\n*Dort',
                       'back': '', 'context': '', 'card_type': 'quiz'},
                      {'front': 'Hallo', 'back': '', 'context': '', 'card_type': 'standard'}]
        self.output = [{'front': 'Wo?\nHier\n*Dort', 'back': 'Где?', 'context': 'Объяснение'},
                       {'front': 'Hallo', 'back': 'Привет', 'context': 'Приветствие'}]
        self.config = patch.object(ai_service, 'get_ai_config', return_value=('google', 'fake', 'fake'))
        self.config.start()
        self.chat = patch.object(ai_service.AIService, 'chat_completion', new_callable=AsyncMock)
        self.mock_chat = self.chat.start()
        self.mock_chat.return_value = (json.dumps(self.output), True)
        self.classifier = patch.object(ai_service, 'classify_phrases_batch',
                                       new=AsyncMock(return_value=['A1', 'A1']))
        self.classifier.start()

    def tearDown(self):
        self.chat.stop()
        self.config.stop()
        self.classifier.stop()
        database.drop_tables(TABLES)

    def test_enrich_response_is_array_after_database_save(self):
        result = asyncio.run(router.enrich_batch_cards(router.EnrichBatchRequest(
            cards=self.input, deck_id=str(self.deck.id), native_language='ru'), user_id=1))
        self.assertEqual(models.TMA_Card.select().count(), 2)
        self.assertIsInstance(result['saved_cards'], list)
        self.assertEqual(result['save_result']['created_count'], 2)
        self.assertTrue(result['saved_cards'][0]['front'].startswith('::task\nWähle.\n::exercise'))
        self.assertEqual(result['saved_cards'][1]['front'], 'Hallo')

    def test_plain_generation_with_deck(self):
        result = asyncio.run(router.generate_batch_cards(router.BatchRequest(
            text='Hallo\nWo?', deck_id=str(self.deck.id), native_language='ru'), user_id=1))
        self.assertEqual(len(result['saved_cards']), 2)

    def request(self, **changes):
        return router.EnrichBatchRequest(cards=self.input, deck_id=self.deck.id,
                                        native_language='ru', **changes)

    def test_http_contract_both_endpoint_aliases(self):
        app = FastAPI()
        app.include_router(router.router, prefix='/api')
        app.dependency_overrides[router.get_user_id] = lambda: 1

        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                request = self.request(import_id=uuid4()).model_dump(mode='json')
                first = await client.post('/api/ai/enrich-batch', json=request)
                retry = await client.post('/api/cards/ai-enrich-batch', json=request)
                self.assertEqual(first.status_code, 200)
                self.assertEqual(retry.json(), first.json())
                self.assertEqual(len(first.json()['saved_cards']), 2)
                self.assertEqual(first.json()['save_result']['failed'], [])
        asyncio.run(check())
        self.assertEqual(self.mock_chat.await_count, 1)
        self.assertEqual(models.TMA_Card.select().count(), 2)

    def test_provider_failure_never_saves_original_cards(self):
        self.mock_chat.return_value = ('Provider unavailable (503)', False)
        for mode in ('enrich', 'generate'):
            with self.subTest(mode=mode), self.assertRaises(HTTPException) as error:
                request = self.request(import_id=uuid4()) if mode == 'enrich' else router.BatchRequest(
                    text='Hallo\nWo?', deck_id=self.deck.id, native_language='ru', import_id=uuid4())
                asyncio.run(router._run_ai_batch(request, 1, mode))
            self.assertEqual(error.exception.status_code, 502)
            self.assertIn('Provider unavailable', error.exception.detail)
        self.assertEqual(models.TMA_Card.select().count(), 0)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_invalid_model_response_does_not_save(self):
        for response in ('not JSON', '', '[]', '[{}]', json.dumps(self.output[:1]),
                         json.dumps([self.output[0], {**self.output[1], 'front': 5}]),
                         json.dumps(self.output + self.output)):
            for mode in ('enrich', 'generate'):
                with self.subTest(response=response, mode=mode):
                    self.mock_chat.return_value = (response, True)
                    request = self.request(import_id=uuid4()) if mode == 'enrich' else router.BatchRequest(
                        text='Hallo\nWo?', deck_id=self.deck.id, native_language='ru', import_id=uuid4())
                    with self.assertRaises(HTTPException) as error:
                        asyncio.run(router._run_ai_batch(request, 1, mode))
                    self.assertEqual(error.exception.status_code, 502)
                    self.assertEqual(models.TMA_Card.select().count(), 0)

    def test_partial_save_is_reported_and_replayed_after_lost_response(self):
        original = cards_service.save_card

        def fail_second(payload, *args, **kwargs):
            if payload.get('front') == 'Hallo':
                raise ValueError('Simulated storage rejection')
            return original(payload, *args, **kwargs)

        request = self.request(import_id=uuid4())
        with patch.object(cards_service, 'save_card', side_effect=fail_second):
            first = asyncio.run(router.enrich_batch_cards(request, user_id=1))
        self.assertEqual(first['status'], 'partial')
        self.assertEqual(len(first['saved_cards']), 1)
        self.assertEqual(first['save_result']['failed_count'], 1)
        self.assertEqual(first['save_result']['failed'][0]['index'], 1)
        retry = asyncio.run(router.enrich_batch_cards(request, user_id=1))
        self.assertEqual(retry, first)
        self.assertEqual(models.TMA_Card.select().count(), 1)
        self.assertEqual(self.mock_chat.await_count, 1)

    def test_lost_response_retry_and_changed_request_conflict(self):
        request = self.request(import_id=uuid4())
        first = asyncio.run(router.enrich_batch_cards(request, user_id=1))
        self.mock_chat.return_value = ('different output', True)
        self.assertEqual(asyncio.run(router.enrich_batch_cards(request, user_id=1)), first)
        self.assertEqual(models.TMA_Card.select().count(), 2)
        self.assertEqual(self.mock_chat.await_count, 1)
        request.cards = [self.input[1]]
        with self.assertRaises(HTTPException) as error:
            asyncio.run(router.enrich_batch_cards(request, user_id=1))
        self.assertEqual(error.exception.status_code, 409)

    def test_concurrent_requests_save_once_even_if_model_answers_differ(self):
        started = asyncio.Event()
        count = 0

        async def simultaneous_provider(**kwargs):
            nonlocal count
            count += 1
            current = count
            if count == 2:
                started.set()
            await started.wait()
            output = [{**card, 'back': f'Answer {current}'} for card in self.output]
            return json.dumps(output), True

        self.mock_chat.side_effect = simultaneous_provider
        request = self.request(import_id=uuid4())

        async def check():
            return await asyncio.gather(router.enrich_batch_cards(request, user_id=1),
                                        router.enrich_batch_cards(request, user_id=1))

        first, second = asyncio.run(check())
        self.assertEqual(first, second)
        self.assertEqual(models.TMA_Card.select().count(), 2)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 1)

    def test_plain_generation_retry_uses_receipt_without_provider_call(self):
        request = router.BatchRequest(text='Hallo\nWo?', deck_id=self.deck.id,
                                      native_language='ru', import_id=uuid4(), placement='start')
        first = asyncio.run(router.generate_batch_cards(request, user_id=1))
        self.assertEqual(asyncio.run(router.generate_batch_cards(request, user_id=1)), first)
        self.assertEqual(self.mock_chat.await_count, 1)
        self.assertEqual(models.TMA_Card.select().count(), 2)

    def test_timeout_has_no_database_side_effects(self):
        original_timeout = asyncio.timeout

        async def slow_provider(**kwargs):
            await asyncio.sleep(0.1)
            return json.dumps(self.output), True

        self.mock_chat.side_effect = slow_provider
        with patch.object(router.asyncio, 'timeout', side_effect=lambda _: original_timeout(0.01)):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(router.enrich_batch_cards(self.request(import_id=uuid4()), user_id=1))
        self.assertEqual(error.exception.status_code, 504)
        self.assertEqual(models.TMA_Card.select().count(), 0)
        self.assertEqual(models.TMAOfflineBatch.select().count(), 0)

    def test_disabled_level_detection_keeps_cards_unclassified(self):
        models.TMASetting.create(key='AI_DETECT_LEVEL', value='false')
        request = router.BatchRequest(text='Hallo\nWo?', deck_id=self.deck.id, native_language='ru')
        result = asyncio.run(router.generate_batch_cards(request, user_id=1))
        self.assertTrue(all(card['level'] is None for card in result['saved_cards']))
        self.assertTrue(all(card['tags'] is None for card in result['saved_cards']))

    def test_unauthorized_deck_does_not_call_provider(self):
        models.TMAUser.create(user_id=2)
        self.deck.user_id = 2
        self.deck.save()
        with self.assertRaises(HTTPException) as error:
            asyncio.run(router.enrich_batch_cards(self.request(), user_id=1))
        self.assertEqual(error.exception.status_code, 403)
        self.mock_chat.assert_not_awaited()

    def test_interactive_syntax_and_answer_keys_are_preserved(self):
        syntax = [('word_bank', '@wordbank\nIch <<1>> hier.\n@options\nbin | bist', '1=bin'),
                  ('trainer', 'Ich [[bin]] hier.', 'bin'),
                  ('match', '@match\nBerlin => Deutschland', 'Berlin=Deutschland'),
                  ('puzzle', '@puzzle\nIch bin hier.', 'Ich bin hier.'),
                  ('free_text', '@free\nWo wohnst du?', 'In Berlin')]
        for card_type, exercise, back in syntax:
            with self.subTest(card_type=card_type):
                front = '::task\nAntworte.\n::source\nText\n::exercise\n' + exercise
                self.mock_chat.return_value = (json.dumps([{
                    'front': 'Changed front', 'back': 'Translation', 'context': 'Explanation'}]), True)
                request = router.EnrichBatchRequest(cards=[{'front': front, 'back': back,
                                                          'card_type': card_type}], native_language='ru')
                result = asyncio.run(router.enrich_batch_cards(request, user_id=1))
                self.assertEqual(result['cards'][0]['front'], front)
                self.assertEqual(result['cards'][0]['back'], 'Translation' if card_type == 'free_text' else back)
                prompt = self.mock_chat.call_args.kwargs['user_message']
                self.assertEqual(json.loads(prompt)[0]['task'], 'Antworte.')
                self.assertEqual(json.loads(prompt)[0]['source'], 'Text')

    def test_later_chunk_failure_discards_earlier_generation(self):
        self.mock_chat.side_effect = [(json.dumps(self.output * 2 + self.output[:1]), True), ('503', False)]
        request = router.EnrichBatchRequest(cards=self.input * 3, deck_id=self.deck.id, native_language='ru')
        with patch.object(ai_service.asyncio, 'sleep', new=AsyncMock()):
            with self.assertRaises(HTTPException):
                asyncio.run(router.enrich_batch_cards(request, user_id=1))
        self.assertEqual(models.TMA_Card.select().count(), 0)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        database.close()
        path = fixture['database_path']
        for file in (path, Path(f'{path}-wal'), Path(f'{path}-shm')):
            file.unlink(missing_ok=True)
