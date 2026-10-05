import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreeTextEvaluationSession, canRevealFreeTextAnswer } from '../freeTextEvaluationState.js';

const response = (verdict, error_type = null, error_code = null) => ({
  result: { verdict, error_type, error_code, evaluator: 'rules', accepted: ['correct', 'accepted_minor'].includes(verdict) },
  grading_policy: { max_retries: 3 },
});

test('answer reveal policy applies equally to the example and card flip', () => {
  assert.equal(Boolean(canRevealFreeTextAnswer()), false);
  assert.equal(Boolean(canRevealFreeTextAnswer({ attemptCount: 1, gradingPolicy: { max_retries: 2 } })), false);
  assert.equal(canRevealFreeTextAnswer({ attemptCount: 2, gradingPolicy: { max_retries: 2 } }), true);
  assert.equal(canRevealFreeTextAnswer({ result: { accepted: true } }), true);
  assert.equal(canRevealFreeTextAnswer({ loading: true, attemptCount: 3, gradingPolicy: { max_retries: 2 } }), false);
});

test('accepted_minor is one successful first try with no mastery penalty', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('Hudn', async () => response('accepted_minor', 'typo', 'typo.single_token'));
  const evidence = session.evidence();
  assert.equal(evidence.attemptCount, 1);
  assert.equal(evidence.isFirstTry, true);
  assert.equal(evidence.mistakeCount, 0);
  assert.deepEqual(evidence.gradingSummary.minor_errors, ['typo']);
});

test('grammar correction is the second educational attempt and keeps structured error history', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('ein Hund', async () => response('needs_retry', 'grammar', 'grammar.article_case'));
  assert.equal(session.evidence(), null);
  await session.submit('einen Hund', async () => response('correct'));
  assert.equal(session.evidence().attemptCount, 2);
  assert.equal(session.evidence().isFirstTry, false);
  assert.equal(session.evidence().mistakeCount, 1);
  assert.deepEqual(session.evidence().gradingSummary.error_codes_seen, ['grammar.article_case']);
});

test('duplicate submit during a request and after a classified answer produces one request', async () => {
  const session = createFreeTextEvaluationSession();
  let finish;
  let calls = 0;
  const evaluate = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = session.submit('ein Hund', evaluate);
  assert.equal(await session.submit('ein Hund', evaluate), null);
  finish(response('needs_retry', 'grammar'));
  await first;
  assert.equal(await session.submit('ein Hund', evaluate), null);
  assert.equal(calls, 1);
  assert.equal(session.snapshot().attemptCount, 1);
});

test('timeout/network/malformed response and repeating evaluation never count as mistakes', async () => {
  const session = createFreeTextEvaluationSession();
  for (const evaluate of [async () => response('unavailable'), async () => { throw Error('timeout'); }, async () => ({})]) {
    await session.submit('Hund', evaluate);
    assert.equal(session.snapshot().attemptCount, 0);
    assert.equal(session.snapshot().mistakeCount, 0);
    assert.equal(session.evidence(), null);
  }
  await session.submit('Hund', async () => response('correct'));
  assert.equal(session.evidence().isFirstTry, true);
});

test('first evaluator call catches synchronous throws, rejected Promises and invalid evaluators', async () => {
  for (const evaluate of [() => { throw Error('initialization failed'); },
    () => Promise.reject(Error('provider failed')), null,
    async () => ({ result: { verdict: 'correct', accepted: false } }),
    async () => ({ result: { verdict: 'unknown', accepted: false } })]) {
    const session = createFreeTextEvaluationSession();
    const state = await session.submit('main Nachbar ist ruhig', evaluate);
    assert.equal(state.result.verdict, 'unavailable');
    assert.equal(state.attemptCount, 0);
    assert.equal(state.mistakeCount, 0);
    assert.equal(state.loading, false);
    assert.equal(state.lastAnswer, null);
    assert.equal(session.evidence(), null);
    await session.submit('main Nachbar ist ruhig', async () => response('accepted_minor', 'typo'));
    assert.equal(session.evidence().attemptCount, 1);
    assert.equal(session.evidence().mistakeCount, 0);
    assert.equal(session.evidence().isFirstTry, true);
  }
});

test('unavailable after a learner mistake preserves counts and history', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('ein Hund', async () => response('needs_retry', 'grammar'));
  const before = session.snapshot();
  const after = await session.submit('einen Hund', () => Promise.reject(Error('network')));
  assert.equal(after.result.verdict, 'unavailable');
  assert.equal(after.attemptCount, before.attemptCount);
  assert.equal(after.mistakeCount, before.mistakeCount);
  assert.equal(after.lastAnswer, before.lastAnswer);
  assert.deepEqual(after.errors, before.errors);
  assert.equal(session.evidence(), null);
});

test('flip restoration preserves educational history and discards transport loading state', async () => {
  const first = createFreeTextEvaluationSession();
  await first.submit('ein Hund', async () => response('needs_retry', 'grammar'));
  const restored = createFreeTextEvaluationSession({ ...first.snapshot(), loading: true });
  assert.equal(restored.snapshot().loading, false);
  await restored.submit('einen Hund', async () => response('correct'));
  assert.equal(restored.evidence().attemptCount, 2);
});

test('grammar error -> grammar error -> incorrect -> max_retries preserves failed evidence', async () => {
  const session = createFreeTextEvaluationSession();
  // 1st attempt: grammar error
  await session.submit('ein Hund', async () => response('needs_retry', 'grammar', 'grammar.article_case'));
  assert.equal(session.evidence(), null);
  assert.equal(session.snapshot().attemptCount, 1);
  assert.equal(session.snapshot().mistakeCount, 1);

  // 2nd attempt: another grammar error
  await session.submit('dem Hund', async () => response('needs_retry', 'grammar', 'grammar.article_case'));
  assert.equal(session.evidence(), null);
  assert.equal(session.snapshot().attemptCount, 2);
  assert.equal(session.snapshot().mistakeCount, 2);

  // 3rd attempt: incorrect (word_choice) -> max_retries (3) reached!
  await session.submit('eine Katze', async () => response('incorrect', 'word_choice', 'word_choice.wrong_word'));
  const evidence = session.evidence();
  assert.notEqual(evidence, null);
  assert.equal(evidence.isCorrect, false);
  assert.equal(evidence.isFirstTry, false);
  assert.equal(evidence.completed, false);
  assert.equal(evidence.attemptCount, 3);
  assert.equal(evidence.mistakeCount, 3);
  assert.deepEqual(evidence.gradingSummary.error_types_seen, ['grammar', 'word_choice']);
  assert.deepEqual(evidence.gradingSummary.error_codes_seen, ['grammar.article_case', 'word_choice.wrong_word']);
  assert.deepEqual(evidence.gradingSummary.minor_errors, []);
  assert.equal(evidence.gradingSummary.final_verdict, 'incorrect');
  assert.equal(evidence.gradingSummary.final_evaluator, 'rules');

  // After max_retries, extra submit is blocked and does not increment count
  assert.equal(await session.submit('ein Vogel', async () => response('correct')), null);
  assert.equal(session.snapshot().attemptCount, 3);
});

