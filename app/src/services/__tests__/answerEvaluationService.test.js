import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let calls = 0;
let resolveRequest;
mock.module('../api.js', { defaultExport: {
  post: () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); },
} });
mock.module('../../utils/auth.js', { namedExports: { getUserId: () => '123' } });
mock.module('../../i18n/locale.js', { namedExports: { getInterfaceLanguage: () => 'ru' } });
const { evaluateFreeTextAnswer } = await import('../answerEvaluationService.js');

test('concurrent evaluation requests for the same account/card/answer share transport', async () => {
  const first = evaluateFreeTextAnswer(1, 'Hund');
  const second = evaluateFreeTextAnswer(1, 'Hund');
  assert.equal(calls, 1);
  const data = { result: { verdict: 'correct', accepted: true }, grading_policy: { max_retries: 3 } };
  resolveRequest({ data });
  assert.deepEqual(await first, data);
  assert.deepEqual(await second, data);
});

test('malformed result is rejected and subsequent transport is allowed', async () => {
  const first = evaluateFreeTextAnswer(1, 'Hund');
  resolveRequest({ data: { result: { verdict: 'unavailable', accepted: true } } });
  await assert.rejects(first, /Invalid answer evaluation response/);
  const second = evaluateFreeTextAnswer(1, 'Hund');
  resolveRequest({ data: { result: { verdict: 'unavailable', accepted: false } } });
  assert.equal((await second).result.verdict, 'unavailable');
  assert.equal(calls, 3);
});
