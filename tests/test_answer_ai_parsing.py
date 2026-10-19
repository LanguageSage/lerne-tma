import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.answer_ai import evaluate_with_ai  # noqa: E402
from api.services.answer_contract import GradingPolicy  # noqa: E402

BASE = dict(schema_version=1, verdict='correct', accepted=True, error_type=None, severity='none',
            target_relevance='none', evaluator='ai', confidence=0.95)
CONTEXT = {'task': 'Antworte', 'target_language': 'de', 'expected_answers': ['Das ist zu teuer.'],
           'learning_target': None, 'cefr_level': 'B1', 'feedback_language': 'ru', 'user_answer': 'das ist teuer'}


class _Client:
    def __init__(self, raw):
        self.raw, self.calls = raw, []

    async def chat_completion(self, **kwargs):
        self.calls.append(kwargs)
        return self.raw, True


def verdict(raw, **overrides):
    client = _Client(raw if isinstance(raw, str) else json.dumps({**BASE, **raw, **overrides}))
    result = asyncio.run(evaluate_with_ai(dict(CONTEXT), GradingPolicy(mode='open_text'), client, 'm'))
    return result.verdict, client


class TolerantParsingTests(unittest.TestCase):
    def test_formatting_noise_does_not_make_evaluation_unavailable(self):
        body = json.dumps(BASE)
        for raw in (body, '```json\n' + body + '\n```', body + '\nEND_JSON', 'Ergebnis:\n' + body,
                    json.dumps({**BASE, 'reasoning': 'extra field'}), json.dumps({**BASE, 'confidence': 95})):
            with self.subTest(raw=raw[:30]):
                self.assertEqual(verdict(raw)[0], 'correct')

    def test_long_feedback_is_clipped_not_rejected(self):
        result, _ = verdict({}, verdict='needs_retry', accepted=False, error_type='grammar',
                            severity='major', hint='h', explanation='x' * 900)
        self.assertEqual(result, 'needs_retry')

    def test_real_problems_stay_unavailable(self):
        self.assertEqual(verdict('not json at all')[0], 'unavailable')
        self.assertEqual(verdict({}, accepted=False)[0], 'unavailable')  # verdict/accepted mismatch
        self.assertEqual(verdict({}, confidence=0.5)[0], 'unavailable')

    def test_request_leaves_room_for_thinking_models(self):
        _, client = verdict(dict(BASE))
        self.assertGreaterEqual(client.calls[0]['max_output_tokens'], 4096)


if __name__ == '__main__':
    unittest.main()
