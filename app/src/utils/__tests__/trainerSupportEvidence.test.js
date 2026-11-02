import test from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseEvaluationSession } from '../exerciseEvaluation.js';
import { evaluateTrainerGaps } from '../trainerEvaluation.js';
import { parseClozeData } from '../clozeParser.js';
import { trainerTaskSupport } from '../supportEvidence.js';
import { assessmentTrainerEvidence, recordAssessmentResult, assessmentAttempt } from '../assessment.js';
import fs from 'node:fs';
import process from 'node:process';

const card = { id: 10, front: '::source\nSynthetic vocabulary\n::exercise\nVisible {*A|B} [[form]].',
  metadata: { assessment: { competency_ids: ['synthetic'] } } };
const cloze = parseClozeData(card, 'classic');
const opts = { trackSupport: true, taskSupport: trainerTaskSupport(card, cloze) };
const correct = { 0: 'A', 1: 'form' };
const check = (session, values) => {
  const state = session.check(evaluateTrainerGaps(cloze.gaps, values));
  return { state, evidence: session.evidence(), ...session.supportFields() };
};

test('choice/input: fixed frame and vocabulary are static facts, not actions or KI mastery', () => {
  const session = createExerciseEvaluationSession(undefined, opts);
  const result = check(session, correct).evidence;
  assert.deepEqual(result.supportEvidence, { tracking_complete: false, hint_count: 0, translation_view_count: 0,
    answer_reveal_count: null, other_help_count: null, capture_point: 'exercise_completion', answer_attempt_count: 1 });
  assert.deepEqual(result.taskSupport, { answer_options_present: true, source_text_present: true,
    authored_example_present: false, sentence_frame_present: true, source_vocabulary_present: true });
  const allInput = { front: '[[one]] [[two]]' };
  assert.deepEqual(trainerTaskSupport(allInput, parseClozeData(allInput, 'classic')), {
    answer_options_present: false, source_text_present: false, authored_example_present: false,
    sentence_frame_present: true, source_vocabulary_present: false,
  });
  assert.equal(Object.hasOwn(result, 'independent'), false);
});

test('translation before answer and hints between checks survive edit/remount and freeze before final feedback', () => {
  const first = createExerciseEvaluationSession(undefined, opts);
  first.recordSupport('translation_view_count');
  assert.equal(check(first, { 0: 'B', 1: 'wrong' }).evidence, null);
  assert.deepEqual(first.supportFields(), {});
  first.recordSupport('hint_count');
  first.recordSupport('hint_count');
  const saved = first.snapshot();
  const restored = createExerciseEvaluationSession(saved, opts);
  restored.edit(0); restored.edit(1);
  restored.recordSupport('translation_view_count');
  const evidence = check(restored, correct).evidence;
  assert.equal(evidence.supportEvidence.hint_count, 2);
  assert.equal(evidence.supportEvidence.translation_view_count, 2);
  assert.equal(evidence.supportEvidence.answer_attempt_count, 2);
  const frozen = structuredClone(evidence);
  restored.recordSupport('hint_count'); restored.recordSupport('translation_view_count');
  const after = createExerciseEvaluationSession(restored.snapshot(), opts);
  assert.deepEqual(after.evidence(), frozen);
  saved.supportState.hint_count = 999;
  after.snapshot().answerSupportEvidence.hint_count = 999;
  evidence.supportEvidence.hint_count = 999;
  assert.deepEqual(after.evidence(), frozen);
});

test('legacy progress and interrupted Assessment have unknown history; old events remain absent', () => {
  const legacy = createExerciseEvaluationSession();
  check(legacy, { 0: 'B', 1: 'wrong' });
  const restored = createExerciseEvaluationSession(legacy.snapshot(), opts);
  restored.recordSupport('translation_view_count');
  const evidence = check(restored, correct).evidence;
  for (const key of ['hint_count', 'translation_view_count', 'answer_reveal_count', 'other_help_count']) {
    assert.equal(evidence.supportEvidence[key], null);
  }
  const oldDone = createExerciseEvaluationSession();
  check(oldDone, correct);
  assert.equal(createExerciseEvaluationSession(oldDone.snapshot(), opts).evidence().supportEvidence, undefined);
  const interrupted = createExerciseEvaluationSession(undefined, { ...opts, assessmentMode: true, supportHistoryUnknown: true });
  assert.equal(check(interrupted, correct).supportEvidence.hint_count, null);
});

test('Assessment first wrong result freezes before hints; later correct check and reload cannot replace it', () => {
  const session = createExerciseEvaluationSession(undefined, { ...opts, assessmentMode: true });
  const first = assessmentTrainerEvidence(check(session, { 0: 'B', 1: 'wrong' }));
  const start = { id: 'trainer-support', userId: 1, deckId: 5, index: 0, cards: [card],
    results: {}, config: { required_count: 1 } };
  const stored = recordAssessmentResult(start, 10, first);
  const frozen = assessmentAttempt(stored, stored.results[10], 7);
  session.recordSupport('hint_count');
  const later = assessmentTrainerEvidence(check(session, correct));
  assert.deepEqual(later.supportEvidence, first.supportEvidence);
  const reloaded = structuredClone(stored);
  assert.equal(recordAssessmentResult(reloaded, 10, later), reloaded);
  assert.deepEqual(assessmentAttempt(reloaded, reloaded.results[10], 7), frozen);
  assert.equal(frozen.evaluation_data.status, 'incorrect');
  assert.equal(frozen.evaluation_data.support_evidence.hint_count, 0);
  assert.equal(frozen.evaluation_data.support_evidence.answer_attempt_count, 1);
});

test('other exercise sessions retain their old evidence shape and checks', () => {
  const session = createExerciseEvaluationSession();
  const evidence = check(session, correct).evidence;
  assert.equal(Object.hasOwn(evidence, 'supportEvidence'), false);
  assert.equal(Object.hasOwn(session.snapshot(), 'supportState'), false);
  assert.equal(session.check(evaluateTrainerGaps(cloze.gaps, correct)), null);
});

if (process.env.LERNE_D14_SUPPORT === '1') {
  test('local D14 choice and inputs retain authored scaffolding without claiming independent word order', () => {
    const snapshot = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/lesson-qa/corrected.json', import.meta.url), 'utf8'));
    for (const id of [20003, 20013, 20023]) {
      const current = snapshot.cards.find(card => card.id === id);
      assert.ok(current);
      const cloze = parseClozeData(current, 'classic');
      const taskSupport = trainerTaskSupport(current, cloze);
      const session = createExerciseEvaluationSession(undefined, { trackSupport: true, taskSupport });
      session.check(evaluateTrainerGaps(cloze.gaps, Object.fromEntries(cloze.gaps.map(gap => [gap.id, gap.correctAnswer]))));
      assert.equal(session.evidence().isCorrect, true);
      assert.equal(taskSupport.answer_options_present, id === 20003);
      assert.equal(taskSupport.source_text_present, id === 20023);
      assert.equal(taskSupport.sentence_frame_present, true);
      assert.equal(taskSupport.source_vocabulary_present, true);
      assert.equal(session.evidence().supportEvidence.tracking_complete, false);
      assert.equal(Object.hasOwn(session.evidence(), 'independent'), false);
      if (id === 20023) {
        assert.equal(cloze.gaps[0].correctAnswer, 'spricht');
        assert.match(cloze.maskedText, /___GAP_0___\.$/);
      }
    }
  });
}
