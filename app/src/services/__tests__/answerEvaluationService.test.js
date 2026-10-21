import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let calls = 0;
let resolveRequest;
const requests = [];
mock.module('../api.js', { defaultExport: {
  post: (...args) => { calls++; requests.push(args); return new Promise(resolve => { resolveRequest = resolve; }); },
} });
mock.module('../../utils/auth.js', { namedExports: { getUserId: () => '123' } });
mock.module('../../i18n/locale.js', { namedExports: { getInterfaceLanguage: () => 'ru' } });
const { evaluateFreeTextAnswer } = await import('../answerEvaluationService.js');

test('concurrent evaluation requests for the same account/card/answer share transport', async () => {
  const first = evaluateFreeTextAnswer(1, 'Hund');
  const second = evaluateFreeTextAnswer(1, 'Hund');
  assert.equal(calls, 1);
  assert.deepEqual(requests[0], ['/ai/evaluate-answer', {
    card_id: 1, answer: 'Hund', feedback_language: 'ru',
  }, { timeout: 65000 }]);
  const data = { result: { verdict: 'correct', accepted: true }, grading_policy: { max_retries: 3 } };
  resolveRequest({ data });
  assert.deepEqual(await first, data);
  assert.deepEqual(await second, data);
});

test('admin diagnostic transport stays separate from an ordinary evaluation', async () => {
  const ordinary = evaluateFreeTextAnswer(2, 'Hund');
  const resolveOrdinary = resolveRequest;
  const diagnostic = evaluateFreeTextAnswer(2, 'Hund', { diagnostics: true });
  const resolveDiagnostic = resolveRequest;
  assert.equal(requests.at(-1)[1].diagnostics, true);
  assert.equal(requests.at(-2)[1].diagnostics, undefined);
  const data = { result: { verdict: 'unavailable', accepted: false, error_code: 'evaluator.timeout' } };
  resolveOrdinary({ data });
  resolveDiagnostic({ data: { ...data, diagnostics: { ai_called: true } } });
  assert.equal((await ordinary).diagnostics, undefined);
  assert.equal((await diagnostic).diagnostics.ai_called, true);
});

test('malformed result is rejected and subsequent transport is allowed', async () => {
  const before = calls;
  const first = evaluateFreeTextAnswer(1, 'Hund');
  resolveRequest({ data: { result: { verdict: 'unavailable', accepted: true } } });
  await assert.rejects(first, /Invalid answer evaluation response/);
  const second = evaluateFreeTextAnswer(1, 'Hund');
  resolveRequest({ data: { result: { verdict: 'unavailable', accepted: false } } });
  assert.equal((await second).result.verdict, 'unavailable');
  assert.equal(calls, before + 2);
});
