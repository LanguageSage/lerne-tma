import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportSession, captureSupportEvidence, freeTextTaskSupport } from '../supportEvidence.js';
import { createFreeTextEvaluationSession } from '../freeTextEvaluationState.js';
import { assessmentFreeTextEvidence, recordAssessmentResult, assessmentAttempt } from '../assessment.js';

const taskSupport = freeTextTaskSupport({ front: '::options\nA | B\n\n::source\nSynthetic source\n\n::exercise\n@free\nWrite.' });
const options = { trackSupport: true, taskSupport };
const check = (verdict, max = 3) => ({ result: { verdict, accepted: verdict === 'correct', evaluator: 'rules' },
  grading_policy: { max_retries: max } });

test('no observed help is zero only for covered sources; never independent or complete', async () => {
  const session = createFreeTextEvaluationSession(undefined, options);
  await session.submit('synthetic', async () => check('correct'));
  assert.deepEqual(session.evidence().supportEvidence, {
    tracking_complete: false, hint_count: 0, translation_view_count: null,
    answer_reveal_count: 0, other_help_count: null,
    capture_point: 'exercise_completion', answer_attempt_count: 1,
  });
  assert.deepEqual(session.evidence().taskSupport, taskSupport);
  assert.equal(taskSupport.answer_options_present, true);
  assert.equal(taskSupport.source_text_present, true);
  assert.equal(taskSupport.sentence_frame_present, null);
  assert.equal(taskSupport.source_vocabulary_present, null);
});

test('registered hint before answer is captured, snapshots cannot mutate the owner', async () => {
  const session = createFreeTextEvaluationSession(undefined, options);
  session.recordSupport('hint_count');
  await session.submit('answer', async () => check('correct'));
  const frozen = session.evidence();
  assert.equal(frozen.supportEvidence.hint_count, 1);
  frozen.supportEvidence.hint_count = 99;
  session.snapshot().answerSupportEvidence.hint_count = 99;
  session.recordSupport('hint_count');
  assert.equal(session.evidence().supportEvidence.hint_count, 1);
});

test('translation action is countable when connected; Free Text outer translation remains unknown', () => {
  const support = createSupportSession(undefined, ['translation_view_count']);
  support.record('translation_view_count');
  assert.equal(captureSupportEvidence(support.snapshot(), 'exercise_completion', 1).translation_view_count, 1);
  const unknown = createSupportSession();
  unknown.record('translation_view_count');
  assert.equal(unknown.snapshot().translation_view_count, null);
  assert.equal(unknown.snapshot().tracking_complete, false);
});

test('reveal before answer counts; reveal after completion cannot rewrite the answer snapshot', async () => {
  const session = createFreeTextEvaluationSession(undefined, options);
  session.recordSupport('answer_reveal_count');
  await session.submit('answer', async () => check('incorrect', 1));
  assert.equal(session.evidence().supportEvidence.answer_reveal_count, 1);
  session.recordSupport('answer_reveal_count');
  assert.equal(session.snapshot().supportState.answer_reveal_count, 2);
  assert.equal(session.evidence().supportEvidence.answer_reveal_count, 1);
});

test('help between retries belongs to the next answer; failures do not manufacture help', async () => {
  const session = createFreeTextEvaluationSession(undefined, options);
  await session.submit('first', async () => check('needs_retry'));
  assert.equal(session.evidence(), null);
  session.recordSupport('hint_count'); // The UI has displayed informative feedback.
  await session.submit('second', async () => check('unavailable'));
  assert.equal(session.snapshot().supportState.hint_count, 1);
  await session.submit('second', async () => check('correct'));
  assert.equal(session.evidence().supportEvidence.hint_count, 1);
  assert.equal(session.evidence().supportEvidence.answer_attempt_count, 2);
});

test('restored progress without support is unknown, old completed evidence is not backfilled', async () => {
  const old = createFreeTextEvaluationSession();
  await old.submit('first', async () => check('needs_retry'));
  const restored = createFreeTextEvaluationSession(old.snapshot(), options);
  restored.recordSupport('hint_count');
  await restored.submit('second', async () => check('correct'));
  for (const key of ['hint_count', 'translation_view_count', 'answer_reveal_count', 'other_help_count']) {
    assert.equal(restored.evidence().supportEvidence[key], null);
  }
  await old.submit('second', async () => check('correct'));
  assert.equal(createFreeTextEvaluationSession(old.snapshot(), options).evidence().supportEvidence, undefined);
});

test('interrupted assessment without a saved live history never resets help to zero', async () => {
  const restored = createFreeTextEvaluationSession(undefined, { ...options, assessmentMode: true, supportHistoryUnknown: true });
  await restored.submit('first after reload', async () => check('correct'));
  assert.equal(restored.supportFields().supportEvidence.hint_count, null);
  assert.equal(restored.supportFields().supportEvidence.answer_reveal_count, null);
  assert.equal(restored.supportFields().supportEvidence.tracking_complete, false);
  const partial = createSupportSession({ hint_count: 2, tracking_complete: true });
  assert.deepEqual(partial.snapshot(), { tracking_complete: false, hint_count: 2,
    translation_view_count: null, answer_reveal_count: null, other_help_count: null });
  const unsupportedCompleteness = createSupportSession({ tracking_complete: true,
    hint_count: 0, translation_view_count: 0, answer_reveal_count: 0, other_help_count: 0 }, ['hint_count']);
  assert.equal(unsupportedCompleteness.snapshot().tracking_complete, false);
});

test('reload with saved state preserves help and frozen completion', async () => {
  const session = createFreeTextEvaluationSession(undefined, options);
  session.recordSupport('hint_count');
  const restored = createFreeTextEvaluationSession(structuredClone(session.snapshot()), options);
  await restored.submit('answer', async () => check('correct'));
  const frozen = restored.evidence();
  const completed = createFreeTextEvaluationSession(structuredClone(restored.snapshot()), options);
  completed.recordSupport('answer_reveal_count');
  assert.deepEqual(completed.evidence(), frozen);
});

test('Assessment freezes first classified result before feedback, unavailable and skip have none', async () => {
  const checker = createFreeTextEvaluationSession(undefined, { ...options, assessmentMode: true });
  await checker.submit('first', async () => check('unavailable'));
  assert.deepEqual(checker.supportFields(), {});
  await checker.submit('first', async () => check('needs_retry'));
  const firstEvidence = assessmentFreeTextEvidence(checker.snapshot().result, checker.supportFields());
  const start = { id: 'support-exam', userId: 1, deckId: 5, index: 0, config: { required_count: 1 }, results: {},
    cards: [{ id: 10, metadata: { assessment: { competency_ids: ['synthetic'] } } }] };
  const first = recordAssessmentResult(start, 10, firstEvidence);
  const frozen = assessmentAttempt(first, first.results[10], 7);
  checker.recordSupport('hint_count');
  await checker.submit('second', async () => check('correct'));
  assert.deepEqual(checker.supportFields().supportEvidence, firstEvidence.supportEvidence);
  const later = recordAssessmentResult(structuredClone(first), 10,
    assessmentFreeTextEvidence(checker.snapshot().result, checker.supportFields()));
  assert.deepEqual(assessmentAttempt(later, later.results[10], 7), frozen);
  assert.equal(frozen.evaluation_data.support_evidence.hint_count, 0);
  assert.equal(frozen.evaluation_data.support_evidence.capture_point, 'first_assessment_result');
  firstEvidence.supportEvidence.hint_count = 99;
  assert.equal(first.results[10].supportEvidence.hint_count, 0);
  const skipped = recordAssessmentResult(start, 10, { skipped: true, ...checker.supportFields() });
  assert.equal(assessmentAttempt(skipped, skipped.results[10], 7).evaluation_data.support_evidence, undefined);
});
