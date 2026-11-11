import { nativeCard } from './nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentFreeTextEvidence, recordAssessmentResult, assessmentAttempt } from '../assessment.js';

const start = () => ({ id: 'synthetic-exam', userId: 1, deckId: 5, index: 0,
  config: { required_count: 1 }, results: {},
  cards: [nativeCard("standard", { id: 10 }, {metadata: { assessment: { competency_ids: ['synthetic'] } }})] });
const check = (verdict, relevance) => ({ verdict, accepted: ['correct', 'accepted_minor'].includes(verdict),
  evaluator: 'ai', target_relevance: relevance, error_type: 'grammar', error_code: 'synthetic.grammar' });
const capture = evidence => {
  const session = recordAssessmentResult(start(), 10, evidence);
  return { session, attempt: assessmentAttempt(session, session.results[10], 7) };
};

test('every classified Free Text verdict preserves only checker-provided relevance in v3', () => {
  for (const verdict of ['correct', 'accepted_minor', 'needs_retry', 'incorrect']) {
    for (const relevance of ['primary', 'secondary', 'none']) {
      const { session, attempt } = capture(assessmentFreeTextEvidence(check(verdict, relevance)));
      assert.equal(session.results[10].targetRelevance, relevance);
      assert.equal(attempt.evaluation_data.target_relevance, relevance);
      assert.equal(attempt.evaluation_data.correct, ['correct', 'accepted_minor'].includes(verdict));
      assert.equal(attempt.client_event_id, 'synthetic-exam:10');
    }
  }
});

test('missing and unknown relevance remains absent, including Trainer and legacy results', () => {
  for (const relevance of [undefined, null, '', 'unknown', 'PRIMARY', true, [], {}]) {
    const evidence = assessmentFreeTextEvidence(check('incorrect', relevance));
    assert.equal(Object.hasOwn(evidence.gradingSummary, 'final_target_relevance'), false);
    const { session, attempt } = capture(evidence);
    assert.equal(Object.hasOwn(session.results[10], 'targetRelevance'), false);
    assert.equal(Object.hasOwn(attempt.evaluation_data, 'target_relevance'), false);
    // Also filter malformed/restored local result values at serialization.
    assert.equal(Object.hasOwn(assessmentAttempt(session, { ...session.results[10], targetRelevance: relevance }, 7)
      .evaluation_data, 'target_relevance'), false);
  }
  for (const evidence of [{ isCorrect: true }, { isCorrect: false, gradingSummary: {
    final_verdict: 'incorrect', error_types_seen: ['grammar'] } }]) {
    assert.equal(Object.hasOwn(capture(evidence).attempt.evaluation_data, 'target_relevance'), false);
  }
});

test('first classified result survives later checks and reload without being enriched', () => {
  for (const relevance of ['secondary', undefined]) {
    const { session, attempt } = capture(assessmentFreeTextEvidence(check('needs_retry', relevance)));
    const reloaded = structuredClone(session);
    const later = recordAssessmentResult(reloaded, 10, assessmentFreeTextEvidence(check('correct', 'primary')));
    assert.equal(later, reloaded);
    assert.deepEqual(assessmentAttempt(later, later.results[10], 7), attempt);
  }
});

test('unavailable never becomes incorrect evidence; skip remains undiagnosed', () => {
  const session = start();
  assert.equal(assessmentFreeTextEvidence(check('unavailable', 'primary')), null);
  assert.equal(assessmentFreeTextEvidence(check('future', 'primary')), null);
  assert.equal(recordAssessmentResult(session, 10, { isCorrect: false,
    gradingSummary: { final_verdict: 'unavailable', final_target_relevance: 'primary' } }), session);
  const { session: skipped, attempt } = capture({ skipped: true,
    gradingSummary: { final_target_relevance: 'primary' } });
  assert.equal(attempt.evaluation_data.status, 'skipped');
  assert.equal(Object.hasOwn(attempt.evaluation_data, 'target_relevance'), false);
  assert.equal(Object.hasOwn(skipped.results[10], 'targetRelevance'), false);
});
