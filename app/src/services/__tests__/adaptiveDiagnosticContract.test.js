import { nativeCard } from '../../utils/__tests__/nativeFixture.js';
/**
 * Draft diagnostic semantics, NOT a runtime evaluator or API admission path.
 * The reference below consumes synthetic expert annotations, never parses a
 * learner answer and never scores, persists or allocates a Knowledge Item.
 * Tests marked "current" exercise actual application functions.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { getLocalDb, resetAllDatabases } from '../localDb.js';
import { captureStudyKnowledgeAttempt } from '../knowledgeCaptureService.js';
import { createExerciseEvaluationSession } from '../../utils/exerciseEvaluation.js';
import { evaluateTrainerGaps } from '../../utils/trainerEvaluation.js';
import { createFreeTextEvaluationSession } from '../../utils/freeTextEvaluationState.js';
import { assessmentFreeTextEvidence, recordAssessmentResult, assessmentAttempt } from '../../utils/assessment.js';

globalThis.window = { location: { search: '' } };
globalThis.localStorage = { getItem: key => key === 'lerne_user_id' ? '7001' : null };

// Six synthetic analogues; no real lesson text or production KI IDs.
const units = {
  subjectChoice: { format: 'choice', scaffold: true, targetOpportunity: 'present' },
  objectChoice: { format: 'choice', scaffold: true, targetOpportunity: 'present' },
  governedGap: { format: 'input', scaffold: true, targetOpportunity: 'present' },
  fixedVerbPosition: { format: 'input', scaffold: true, targetOpportunity: 'absent' },
  clauseInFrame: { format: 'input', scaffold: true, targetOpportunity: 'present', requiresConstruction: true },
  wholeQuestion: { format: 'input', scaffold: false, targetOpportunity: 'present', requiresConstruction: true },
};
const reviewed = overrides => ({
  response: 'submitted', verification: 'expert_confirmed', primary: 'pass', errorTarget: null,
  targetUse: 'present', ...overrides,
});
const tracked = overrides => ({ complete: true, hint: 0, translation: 0, reveal: 0, other: 0, ...overrides });

function draftObservation(unit, review, support = {}) {
  let ability = 'unknown';
  if (unit.format === 'choice') ability = 'recognition';
  else if (unit.scaffold || [support.hint, support.translation, support.other].some(count => count > 0)) {
    ability = 'guided_application';
  } else if (unit.format === 'input' && unit.scaffold === false && support.complete === true
    && [support.hint, support.translation, support.reveal, support.other].every(count => count === 0)) {
    ability = 'independent_application';
  }
  const result = (outcome, reason) => ({ ability, outcome, reason });
  if (['skipped', 'abandoned'].includes(review.response)) return result('not_observed', review.response);
  if (review.response !== 'submitted') return result('unverified', 'response_not_established');
  if (support.reveal > 0) {
    ability = 'unknown';
    return result('not_observed', 'answer_exposed_before_submission');
  }
  if (review.verification !== 'expert_confirmed') return result('unverified', 'no_trustworthy_result');
  if (unit.targetOpportunity === 'absent') {
    ability = 'unknown';
    return result('not_observed', 'target_decision_already_supplied');
  }
  if (unit.targetOpportunity !== 'present') return result('unverified', 'unknown_opportunity');
  if (review.targetUse === 'absent') {
    // Explicitly required whole construction: task failure only for its production primary.
    if (unit.requiresConstruction && review.requiredConstructionMissing === true) {
      return result('incorrect', 'required_production_not_fulfilled');
    }
    return result('not_observed', 'target_not_used');
  }
  if (review.targetUse !== 'present') return result('unverified', 'target_use_not_established');
  if (review.primary === 'pass') return result('correct', 'reviewed_target_success');
  if (review.primary === 'fail' && review.errorTarget === 'primary') return result('incorrect', 'reviewed_target_error');
  return result('unverified', 'target_result_not_established');
}

beforeEach(async () => {
  const db = getLocalDb();
  await db.knowledge_items.put({ id: 8101, name: 'Synthetic primary' });
  await db.card_knowledge_items.put({ card_id: 9101, knowledge_item_id: 8101, role: 'primary' });
});
afterEach(async () => {
  const db = getLocalDb();
  await db.delete();
  resetAllDatabases();
});

test('draft: the six task shapes distinguish observation from the mapped target', () => {
  const expected = {
    subjectChoice: ['recognition', 'correct'], objectChoice: ['recognition', 'correct'],
    governedGap: ['guided_application', 'correct'], fixedVerbPosition: ['unknown', 'not_observed'],
    clauseInFrame: ['guided_application', 'correct'], wholeQuestion: ['independent_application', 'correct'],
  };
  for (const [name, unit] of Object.entries(units)) {
    const observation = draftObservation(unit, reviewed(), tracked());
    assert.deepEqual([observation.ability, observation.outcome], expected[name], name);
    assert.deepEqual(Object.keys(observation), ['ability', 'outcome', 'reason']); // No second mastery/score/KI.
  }
});

test('draft: unknown support never becomes observed zero or independent from first try', () => {
  for (const support of [{}, { complete: false, hint: 0 }, tracked({ hint: null }), tracked({ other: null })]) {
    assert.equal(draftObservation(units.wholeQuestion, reviewed({ firstTry: true }), support).ability, 'unknown');
  }
  assert.equal(draftObservation(units.subjectChoice, reviewed(), {}).ability, 'recognition');
  assert.equal(draftObservation(units.clauseInFrame, reviewed(), tracked()).ability, 'guided_application');
});

test('draft: known hint or translation limits a correct free response to guided', () => {
  for (const support of [tracked({ hint: 1 }), tracked({ translation: 1 }), { complete: false, hint: 1 }]) {
    const observation = draftObservation(units.wholeQuestion, reviewed(), support);
    assert.equal(observation.ability, 'guided_application');
    assert.equal(observation.outcome, 'correct');
  }
});

test('draft: revealed answer gives no diagnostic success or failure', () => {
  for (const unit of Object.values(units)) {
    assert.equal(draftObservation(unit, reviewed(), tracked({ reveal: 1 })).outcome, 'not_observed');
  }
});

test('draft: explicit skip and abandonment never mean target error', () => {
  for (const response of ['skipped', 'abandoned']) {
    assert.equal(draftObservation(units.wholeQuestion, reviewed({ response, primary: 'fail' })).outcome, 'not_observed');
  }
});

test('draft: unavailable, provisional AI, doubtful ASR and no result remain unverified', () => {
  for (const verification of [null, 'unavailable', 'ai_provisional', 'asr_uncertain']) {
    assert.equal(draftObservation(units.wholeQuestion, reviewed({ verification, primary: 'fail', errorTarget: 'primary' }), tracked()).outcome, 'unverified');
  }
  assert.equal(draftObservation(units.wholeQuestion, reviewed({ response: null })).outcome, 'unverified');
  assert.equal(draftObservation(units.wholeQuestion, reviewed({ targetUse: null })).outcome, 'unverified');
});

test('draft: other-rule and generic mismatch cannot establish a primary error', () => {
  for (const errorTarget of ['secondary', null, 'unknown']) {
    assert.equal(draftObservation(units.governedGap, reviewed({ primary: 'fail', errorTarget })).outcome, 'unverified');
  }
  assert.equal(draftObservation(units.governedGap, reviewed({ primary: 'fail', errorTarget: 'primary' })).outcome, 'incorrect');
  assert.equal(draftObservation(units.governedGap, reviewed({ primary: 'pass', taskCorrect: false, errorTarget: 'secondary' })).outcome, 'correct');
});

test('draft: fixed verb gap cannot diagnose placement even when its form is wrong', () => {
  const observation = draftObservation(units.fixedVerbPosition, reviewed({ primary: 'fail', errorTarget: 'primary' }));
  assert.equal(observation.outcome, 'not_observed');
  assert.equal(observation.reason, 'target_decision_already_supplied');
});

test('draft: allowed target-preserving alternative and target avoidance are different', () => {
  assert.equal(draftObservation(units.wholeQuestion, reviewed({ alternative: true }), tracked()).outcome, 'correct');
  assert.equal(draftObservation(units.wholeQuestion, reviewed({ verification: 'exact_mismatch', alternative: true }), tracked()).outcome, 'unverified');
  const optional = { ...units.wholeQuestion, requiresConstruction: false };
  assert.equal(draftObservation(optional, reviewed({ targetUse: 'absent' }), tracked()).outcome, 'not_observed');
  assert.equal(draftObservation(units.wholeQuestion, reviewed({ targetUse: 'absent', requiredConstructionMissing: true }), tracked()).outcome, 'incorrect');
});

async function capture(evidence) {
  await captureStudyKnowledgeAttempt({ userId: 7001, card: nativeCard("free_text", { id: 9101 }, {"data": {"prompt": "Synthetic prompt", "sample_answer": "Synthetic answer", "accepted_answers": [], "grading_policy": {"mode": "controlled_text", "typo_tolerance": true, "semantic_equivalence": true, "grammar_requires_retry": true, "case_sensitive": false, "punctuation_sensitive": false, "max_retries": 3}}}),
    grade: 2, exerciseEvidence: evidence });
  return (await getLocalDb().knowledge_attempt_outbox.toArray())[0]?.evaluation_data;
}

test('current v1: grade is self-rating, not an observed objective result or assistance count', async () => {
  const raw = await capture(null);
  assert.equal(raw.schema_version, 1);
  assert.equal(raw.rating, 'good');
  assert.equal(raw.correct, null);
  assert.equal(raw.support, undefined);
  assert.equal(raw.ability, undefined);
});

test('current v2: wrong first check is not emitted; successful retry retains only aggregate history', async () => {
  const session = createExerciseEvaluationSession();
  const gaps = [{ id: 'synthetic-gap', mode: 'input', correctAnswer: 'alpha|beta' }];
  session.check(evaluateTrainerGaps(gaps, { 'synthetic-gap': 'other' }));
  assert.equal(session.evidence(), null);
  session.check(evaluateTrainerGaps(gaps, { 'synthetic-gap': 'beta' }));
  const raw = await capture(session.evidence());
  assert.equal(raw.schema_version, 2);
  assert.equal(raw.exercise_evidence.attempt_count, 2);
  assert.equal(raw.exercise_evidence.first_try_correct, false);
  assert.deepEqual(raw.exercise_evidence.grading_summary.error_codes_seen, ['exercise.input_mismatch']);
  assert.equal(raw.exercise_evidence.hint_count, undefined);
  assert.equal(raw.exercise_evidence.first_check_result, undefined);
});

test('current checker: authored synthetic alternative is accepted, nonauthored equivalent needs external review', () => {
  const gap = [{ id: 'x', mode: 'input', correctAnswer: 'synthetic alpha|synthetic beta' }];
  assert.equal(evaluateTrainerGaps(gap, { x: 'synthetic beta' }).accepted, true);
  assert.equal(evaluateTrainerGaps(gap, { x: 'synthetic equivalent' }).accepted, false);
});

test('current v2: final target relevance survives while confidence/help remain outside raw', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('synthetic response', async () => ({ result: {
    verdict: 'accepted_minor', accepted: true, evaluator: 'ai', confidence: .91,
    target_relevance: 'secondary', error_type: 'typo', error_code: 'synthetic.typo', hint: 'synthetic hint',
  }, grading_policy: { max_retries: 1 } }));
  assert.equal(session.snapshot().result.target_relevance, 'secondary');
  const raw = await capture(session.evidence());
  const summary = raw.exercise_evidence.grading_summary;
  assert.equal(summary.final_evaluator, 'ai');
  assert.equal(summary.final_verdict, 'accepted_minor');
  assert.equal(summary.target_relevance, undefined);
  assert.equal(summary.confidence, undefined);
  assert.equal(raw.target_relevance, undefined);
  assert.equal(summary.final_target_relevance, 'secondary');
  assert.equal(raw.ability, undefined);
});

test('current unavailable: there is no objective evidence; later grade can still produce v1', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('synthetic response', async () => ({ result: { verdict: 'unavailable', accepted: false } }));
  assert.equal(session.snapshot().attemptCount, 0);
  assert.equal(session.evidence(), null);
  assert.equal((await capture(session.evidence())).schema_version, 1);
});

function assessmentSession() {
  return { id: 'synthetic-session', userId: 7001, deckId: 9201, index: 0,
    config: { required_count: 1 }, results: {}, cards: [
      nativeCard("standard", { id: 9101 }, {metadata: { assessment: { competency_ids: ['synthetic-competency'] } }}),
    ] };
}

test('current v3: skipped false is not incorrect; rich result quality is not in the raw event', () => {
  const session = recordAssessmentResult(assessmentSession(), 9101, { skipped: true });
  const raw = assessmentAttempt(session, session.results[9101], 8101).evaluation_data;
  assert.equal(raw.schema_version, 3);
  assert.equal(raw.status, 'skipped');
  assert.equal(raw.correct, false);
  assert.equal(raw.ability, undefined);
  assert.equal(raw.support, undefined);
});

test('current assessment: repeat result does not replace first result or create a new event identity', () => {
  const first = recordAssessmentResult(assessmentSession(), 9101, { isCorrect: false });
  const replay = recordAssessmentResult(first, 9101, { isCorrect: true });
  assert.equal(replay, first);
  assert.equal(replay.results[9101].status, 'incorrect');
  assert.deepEqual(assessmentAttempt(first, first.results[9101], 8101), assessmentAttempt(replay, replay.results[9101], 8101));
});

test('current assessment: checker relevance survives conversion; confidence and support remain unknown', () => {
  const evidence = assessmentFreeTextEvidence({ verdict: 'accepted_minor', accepted: true, evaluator: 'ai',
    confidence: .91, target_relevance: 'secondary', error_type: 'typo', error_code: 'synthetic.typo' });
  const session = recordAssessmentResult(assessmentSession(), 9101, evidence);
  const raw = assessmentAttempt(session, session.results[9101], 8101).evaluation_data;
  assert.deepEqual(raw.error_types_seen, ['typo']);
  assert.equal(raw.target_relevance, 'secondary');
  for (const field of ['confidence', 'final_evaluator', 'support']) assert.equal(raw[field], undefined);
});


test('v2 relevance: only literal allowed values are emitted; missing/null/invalid stay absent', async () => {
  for (const relevance of ['primary', 'secondary', 'none', undefined, null, 'invalid']) {
    const session = createFreeTextEvaluationSession();
    await session.submit('synthetic', async () => ({ result: { verdict: 'correct', accepted: true,
      evaluator: 'rules', ...(relevance === undefined ? {} : { target_relevance: relevance }) } }));
    const summary = session.evidence().gradingSummary;
    if (['primary', 'secondary', 'none'].includes(relevance)) assert.equal(summary.final_target_relevance, relevance);
    else assert.equal(Object.hasOwn(summary, 'final_target_relevance'), false);
  }
});

test('v2 relevance: retry uses final classified result, never earlier primary error', async () => {
  for (const finalRelevance of ['none', undefined]) {
    const session = createFreeTextEvaluationSession();
    await session.submit('first', async () => ({ result: { verdict: 'needs_retry', accepted: false,
      evaluator: 'rules', target_relevance: 'primary', error_type: 'grammar' }, grading_policy: { max_retries: 2 } }));
    await session.submit('second', async () => ({ result: { verdict: 'correct', accepted: true,
      evaluator: 'rules', ...(finalRelevance ? { target_relevance: finalRelevance } : {}) } }));
    const summary = session.evidence().gradingSummary;
    assert.equal(summary.final_target_relevance, finalRelevance);
    assert.deepEqual(summary.error_types_seen, ['grammar']);
  }
  const exhausted = createFreeTextEvaluationSession();
  await exhausted.submit('wrong', async () => ({ result: { verdict: 'incorrect', accepted: false,
    target_relevance: 'primary' }, grading_policy: { max_retries: 1 } }));
  assert.equal(exhausted.evidence().completed, false);
  assert.equal(exhausted.evidence().gradingSummary.final_target_relevance, 'primary');
});

test('v2 relevance: unavailable does not leak prior classification; enqueued payload stays frozen', async () => {
  const session = createFreeTextEvaluationSession();
  await session.submit('first', async () => ({ result: { verdict: 'needs_retry', accepted: false,
    target_relevance: 'primary' }, grading_policy: { max_retries: 3 } }));
  await session.submit('second', async () => ({ result: { verdict: 'unavailable', accepted: false } }));
  assert.equal(session.evidence(), null);
  await session.submit('third', async () => ({ result: { verdict: 'correct', accepted: true,
    target_relevance: 'none' } }));
  const evidence = session.evidence();
  await capture(evidence);
  const db = getLocalDb();
  const frozen = await db.knowledge_attempt_outbox.toArray();
  evidence.gradingSummary.final_target_relevance = 'primary';
  assert.deepEqual(await db.knowledge_attempt_outbox.toArray(), frozen);
  const old = structuredClone(frozen[0]);
  old.client_event_id = 'old-payload';
  delete old.evaluation_data.exercise_evidence.grading_summary.final_target_relevance;
  await db.knowledge_attempt_outbox.add(old);
  session.evidence();
  assert.deepEqual(await db.knowledge_attempt_outbox.get('old-payload'), old);
});
