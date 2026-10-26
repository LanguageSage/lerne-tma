"""Single Quiz contract: mocked providers and disposable DB setup, no live services."""
import asyncio
import atexit
import copy
import importlib
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import AsyncMock, patch

fixture = runpy.run_path(str(Path(__file__).with_name('test_bulk_import_idempotency.py')))


def cleanup_database():
    # Keep a file DB for the existing batch tests' worker-thread connections.
    fixture['database'].close()
    database_path = fixture['database_path']
    for path in (database_path, Path(f'{database_path}-wal'), Path(f'{database_path}-shm')):
        if path.parent.resolve() == fixture['ROOT'].resolve():
            path.unlink(missing_ok=True)


atexit.register(cleanup_database)
ai = importlib.import_module('api.ai_service')
router = importlib.import_module('api.routers.ai')
from api.ai_clients import AIService
from api.services.input_parser import parse_quiz_options, parse_exercise_content
from api.services.prompt_builders import build_quiz_prompt


FRONT = ('  ::task\nWählen Sie die richtige Antwort.\n\n'
         '::source\nAnna fährt mit dem Bus.\n\n::exercise\n'
         'Womit fährt Anna?\n\nA) Mit dem Auto\n*B) Mit dem Bus\nC) Mit dem Zug\n')
LESSON = {
    'back': 'Выберите верный ответ.\nАнна едет на автобусе.\nНа чём едет Анна?\n\n'
            '1. На машине\n2. ✅ На автобусе\n3. На поезде',
    'context': '🎯 **Объяснение**:\n1. Машина не упоминается в источнике.\n'
               '2. В источнике прямо указан автобус.\n3. Поезд не упоминается в источнике.\n\n'
               '📖 **Словарный запас**:\n- der Bus — автобус\n- fahren — ехать\n- womit — на чём\n\n'
               '💡 **Грамматика**:\nПосле mit используется Dativ: mit dem Bus.',
}


class SingleQuizTests(unittest.TestCase):
    def setUp(self):
        self.config = patch.object(ai, 'get_ai_config', return_value=('google', 'fake', 'selected-model'))
        self.setting = patch.object(ai.TMASetting, 'get_or_none', return_value=None)
        self.prompt = patch.object(ai.TMACustomPrompt, 'get_or_none', side_effect=AssertionError('Unrelated custom prompt selected'))
        self.chat = patch.object(ai.AIService, 'chat_completion', new_callable=AsyncMock)
        for item in (self.config, self.setting, self.prompt):
            item.start()
            self.addCleanup(item.stop)
        self.mock_chat = self.chat.start()
        self.addCleanup(self.chat.stop)
        self.mock_chat.return_value = (json.dumps(LESSON, ensure_ascii=False), True)

    def generate(self, action='quiz_analysis', front=FRONT):
        return asyncio.run(ai.generate_card_fields(1, front, native_language='ru', action_type=action))

    def test_complete_analysis_only_returns_back_context_and_keeps_all_source(self):
        # Even an unsolicited model front must never reach the editable draft.
        self.mock_chat.return_value = (json.dumps({**LESSON, 'front': r'broken\n*B) rewritten'}), True)
        result = self.generate()
        self.assertEqual(set(result), {'back', 'context'})
        self.assertIn('2. ✅ На автобусе', result['back'])
        self.assertEqual(result, LESSON)
        for section in ('Объяснение', 'Словарный запас', 'Грамматика'):
            self.assertIn(section, result['context'])
        self.assertNotIn(r'\n', result['back'] + result['context'])
        call = self.mock_chat.call_args.kwargs
        self.assertEqual(call['user_message'], FRONT)
        self.assertEqual(call['model'], 'selected-model')
        self.assertEqual(call['temperature'], 0.1)
        self.assertEqual(call['max_output_tokens'], 8192)
        self.assertEqual(call['system_prompt'], build_quiz_prompt(FRONT, 'de', 'ru', detect_level=False))
        self.assertEqual(self.mock_chat.await_count, 1)

    def test_legacy_full_card_on_authored_quiz_uses_same_contract(self):
        self.assertEqual(set(self.generate('full_card')), {'back', 'context'})

    def test_library_quiz_accepts_original_letter_labels_and_leading_checkmark(self):
        front = ('::task\nЗапись в библиотеку: конструкция «nicht ... sondern»\n::exercise\n'
                 'A: «Wir gehen nicht morgen, sondern erst nächste Woche zur Bibliothek.»\n\n'
                 'A) Morgen gehen wir also zur Bibliothek.\n'
                 '*B) Alles klar, wir gehen erst nächste Woche. Welcher Tag passt dir?\n'
                 'C) Morgen ist die Bibliothek nächste Woche geschlossen.')
        back = ('A: «Мы идем не завтра, а только на следующей неделе в библиотеку.»\n\n'
                'A) Значит, завтра мы идем в библиотеку.\n'
                '✅ B) Всё понятно, мы пойдем только на следующей неделе. Какой день тебе подходит?\n'
                'C) Завтра библиотека закрыта на следующей неделе.')
        lesson = {**LESSON, 'back': back}
        self.mock_chat.return_value = (json.dumps(lesson), True)
        self.assertEqual(self.generate(front=front), lesson)
        self.assertEqual(self.mock_chat.await_count, 1)
        for incomplete in (back.replace('C) Завтра библиотека закрыта на следующей неделе.', ''),
                           back.replace('C)', 'B)'), back.split('\n\n', 1)[1]):
            with self.subTest(back=incomplete):
                self.mock_chat.return_value = (json.dumps({**lesson, 'back': incomplete}), True)
                self.assertEqual(set(self.generate(front=front)), {'error'})

    def test_openrouter_keeps_existing_short_model_name_resolution(self):
        with patch.object(ai, 'get_ai_config', return_value=('openrouter', 'fake', 'gemini-test')):
            self.generate()
        self.assertEqual(self.mock_chat.call_args.kwargs['model'], 'google/gemini-test')

    def test_one_retry_recovers_invalid_json(self):
        # Invalid JSON escape plus raw newline was previously salvaged by regex.
        broken = '{"front":"Frage\n\\*B) Bus", "back":"kurz", "context":"kurz"}'
        self.mock_chat.side_effect = [(broken, True), (json.dumps(LESSON), True)]
        result = self.generate()
        self.assertIn('Словарный запас', result['context'])
        self.assertEqual(self.mock_chat.await_count, 2)
        self.assertEqual(self.mock_chat.call_args_list[0].kwargs['system_prompt'],
                         self.mock_chat.call_args_list[1].kwargs['system_prompt'])

    def test_incomplete_or_doubly_escaped_results_fail_after_two_calls(self):
        cases = [
            {'back': 'Короткий ответ', 'context': 'Только объяснение'},
            {**LESSON, 'back': ''},
            {**LESSON, 'context': ''},
            {**LESSON, 'context': LESSON['context'].split('📖')[0]},
            {**LESSON, 'context': LESSON['context'].rsplit('\n', 1)[0]},
            {**LESSON, 'context': LESSON['context'].replace(' — ', ' ')},
            {**LESSON, 'back': LESSON['back'].replace('3. На поезде', '')},
            {**LESSON, 'back': LESSON['back'].split('\n\n')[1]},
            {**LESSON, 'back': LESSON['back'].replace('\n', r'\n')},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                self.mock_chat.reset_mock()
                self.mock_chat.return_value = (json.dumps(payload), True)
                self.assertEqual(set(self.generate()), {'error'})
                self.assertEqual(self.mock_chat.await_count, 2)

    def test_both_http_aliases_surface_failure_without_fields(self):
        from fastapi import FastAPI
        import httpx
        app = FastAPI()
        app.include_router(router.router, prefix='/api')
        app.dependency_overrides[router.get_user_id] = lambda: 1
        self.mock_chat.return_value = ('{"back":"cut off', True)

        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                for url in ('/api/ai/generate', '/api/cards/ai-generate'):
                    result = await client.post(url, json={'phrase': FRONT, 'native_language': 'ru', 'action_type': 'quiz_analysis'})
                    self.assertEqual(set(result.json()), {'error'})
        asyncio.run(check())

    def test_new_standard_card_generation_still_uses_existing_flow(self):
        self.prompt.stop()
        with patch.object(ai.TMACustomPrompt, 'get_or_none', return_value=None):
            self.mock_chat.return_value = ('{"front":"Guten Tag","back":"Добрый день","context":"Приветствие","level":"A1"}', True)
            result = self.generate('full_card', 'Добрый день')
        self.assertEqual(result['front'], 'Guten Tag')
        self.assertNotIn('max_output_tokens', self.mock_chat.call_args.kwargs)

    def test_input_options_keep_starred_b_and_original_order(self):
        self.assertEqual(parse_quiz_options(parse_exercise_content(FRONT)['exercise']),
                         [(False, 'Mit dem Auto'), (True, 'Mit dem Bus'), (False, 'Mit dem Zug')])
        self.assertEqual(parse_quiz_options('Womit?\nA)Auto\n*B)Bus\nC)Zug'),
                         [(False, 'Auto'), (True, 'Bus'), (False, 'Zug')])

    def test_question_paragraphs_are_not_counted_as_options(self):
        question = 'Anna reist.\n\nSie nimmt ein Verkehrsmittel.\nWomit?\n\n'
        self.assertEqual(parse_quiz_options(question + 'A) Auto\n*B) Bus\nC) Zug'),
                         [(False, 'Auto'), (True, 'Bus'), (False, 'Zug')])
        self.assertEqual(parse_quiz_options(question + 'Auto\n*Bus\nZug'),
                         [(False, 'Auto'), (True, 'Bus'), (False, 'Zug')])

    def test_numbered_conditions_do_not_inflate_ai_answer_count_or_change_front(self):
        fixtures = json.loads((fixture['ROOT'] / 'local/test-data/fixtures/quiz_boundaries.json').read_text(encoding='utf-8'))
        for example in fixtures['examples']:
            with self.subTest(example=example['name']):
                front = example['preamble'] + example['question'] + example['gap'] + '\n'.join(
                    f"{'[*]' if i == example['correct'] else '[ ]'} {text}"
                    for i, text in enumerate(example['answers']))
                self.mock_chat.reset_mock()
                self.assertEqual(self.generate(front=front), LESSON)
                self.assertEqual(self.mock_chat.await_count, 1)
                self.assertEqual(self.mock_chat.call_args.kwargs['user_message'], front)

    def test_ambiguous_quiz_is_rejected_before_contacting_ai(self):
        fixtures = json.loads((fixture['ROOT'] / 'local/test-data/fixtures/quiz_boundaries.json').read_text(encoding='utf-8'))
        for front in fixtures['ambiguous']:
            with self.subTest(front=front):
                self.mock_chat.reset_mock()
                self.assertEqual(set(self.generate(front=front)), {'error'})
                self.mock_chat.assert_not_awaited()

    def test_provider_error_is_retried_only_once(self):
        self.mock_chat.return_value = ('Output token limit', False)
        self.assertEqual(set(self.generate()), {'error'})
        self.assertEqual(self.mock_chat.await_count, 2)


class StrictJsonTests(unittest.TestCase):
    def test_existing_quiz_prompt_has_valid_text_field_json_template(self):
        prompt = build_quiz_prompt(FRONT + '\n"quoted" \\literal', detect_level=False)
        template = prompt.split('Return ONLY a JSON object in this format:\n', 1)[1].removesuffix('\nEND_JSON')
        result = json.loads(template)
        self.assertEqual(set(result), {'front', 'back', 'context'})
        self.assertTrue(all(isinstance(value, str) for value in result.values()))

    def test_broken_json_is_never_salvaged(self):
        for payload in ('{"front":"test\\*B)","back":"answer"}',
                        '{"front":"a\nb","back":"answer"}',
                        '{"back":"answer","context":"partial"', 'plain answer', '[]'):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                ai.extract_json_from_text(payload, 'original')

    def test_valid_json_decodes_newlines_quotes_and_optional_fence(self):
        payload = json.dumps({'front': 'Question\n*B) "Bus"', 'back': 'Перевод\nОтвет', 'context': ''})
        result = ai.extract_json_from_text('```json\n' + payload + '\n```\nEND_JSON', 'original')
        self.assertEqual(result['front'], 'Question\n*B) "Bus"')
        self.assertEqual(result['back'], 'Перевод\nОтвет')


class ProviderLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_token_limit_and_truncation_for_every_provider(self):
        cases = [
            ('google', {'candidates': [{'finishReason': 'MAX_TOKENS', 'content': {'parts': [{'text': '{}'}]}}]}, 'generationConfig', 'maxOutputTokens'),
            ('groq', {'choices': [{'finish_reason': 'length', 'message': {'content': '{}'}}]}, None, 'max_completion_tokens'),
            ('openrouter', {'choices': [{'finish_reason': 'length', 'message': {'content': '{}'}}]}, None, 'max_tokens'),
            ('ollama', {'done_reason': 'length', 'message': {'content': '{}'}}, 'options', 'num_predict'),
        ]
        for provider, response, section, key in cases:
            with self.subTest(provider=provider):
                client = AIService(provider=provider, api_key='fake')
                client._make_request = AsyncMock(return_value=(copy.deepcopy(response), True))
                _, success = await client.chat_completion('system', 'quiz', 'gemini-test', temperature=0.1, max_output_tokens=8192)
                self.assertFalse(success)
                payload = client._make_request.call_args.kwargs['json_data']
                self.assertEqual((payload[section] if section else payload)[key], 8192)


if __name__ == '__main__':
    unittest.main()
