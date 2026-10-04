import test from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseEvaluation, createExerciseEvaluationSession } from '../exerciseEvaluation.js';
import { evaluateTrainerGaps } from '../trainerEvaluation.js';
import { parseClozeData } from '../clozeParser.js';
import { checkWordBankAssignments, assignWordBankOption, removeWordBankOption } from '../wordBankState.js';

const gaps = Array.from({ length: 5 }, (_, index) => ({ id: `gap-${index + 1}`, correctAnswer: `word${index + 1}` }));
const options = [...gaps.map((gap, index) => ({ id: `option-${index + 1}`, value: gap.correctAnswer })), { id: 'wrong', value: 'distractor' }];
const correct = Object.fromEntries(gaps.map((gap, index) => [gap.id, options[index].id]));

test('public contract works with arbitrary part IDs and never exposes solutions or typed values', () => {
  const result = createExerciseEvaluation([{ id: 'pair-a', status: 'incorrect', correctAnswer: 'secret', value: 'typed',
    errorType: 'other', errorCode: 'exercise.input_mismatch', hint: 'Check here.' }]);
  assert.deepEqual(result, { schemaVersion: 1, verdict: 'needs_retry', accepted: false,
    parts: [{ id: 'pair-a', status: 'incorrect', errorType: 'other', errorCode: 'exercise.input_mismatch', hint: 'Check here.' }] });
  assert.equal(createExerciseEvaluation([]).accepted, false);
});

test('first-check success has no historical errors and counts exactly one educational attempt', () => {
  const session = createExerciseEvaluationSession();
  session.check(checkWordBankAssignments(gaps, options, correct).evaluation);
  assert.equal(session.evidence().isFirstTry, true);
  assert.equal(session.evidence().attemptCount, 1);
  assert.equal(session.evidence().mistakeCount, 0);
  assert.deepEqual(session.evidence().gradingSummary.incorrect_parts, []);
  assert.deepEqual(session.evidence().gradingSummary.error_codes_seen, []);
});

test('Word Bank: five gaps, one mistake, preserved assignments, local retry and cumulative evidence', () => {
  const session = createExerciseEvaluationSession();
  let assignments = { ...correct, 'gap-2': 'wrong' };
  const first = checkWordBankAssignments(gaps, options, assignments);
  session.check(first.evaluation);
  assert.equal(session.evidence(), null);
  assert.equal(session.snapshot().attemptCount, 1);
  assert.equal(session.snapshot().mistakeCount, 1);
  assert.deepEqual(assignments, { ...correct, 'gap-2': 'wrong' });
  for (const gap of gaps) assert.equal(session.isLocked(gap.id), gap.id !== 'gap-2');
  const snapshot = session.snapshot();
  session.edit('gap-1');
  assert.deepEqual(session.snapshot(), snapshot, 'confirmed gaps cannot lose their feedback');
  assignments = removeWordBankOption(assignments, 'gap-2');
  session.edit('gap-2');
  assert.equal(session.part('gap-2'), undefined);
  assert.equal(session.snapshot().attemptCount, 1, 'edits are not attempts');
  assignments = assignWordBankOption(assignments, 'gap-2', 'option-2');
  session.check(checkWordBankAssignments(gaps, options, assignments).evaluation);
  assert.deepEqual(assignments, correct);
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['word_choice'],
      error_codes_seen: ['exercise.wrong_choice'], incorrect_parts: ['gap-2'], final_evaluator: 'rules' },
  });
  assert.equal(session.check(first.evaluation), null, 'completed exercises cannot report again');
});

test('each failed check adds one mistake even with several wrong gaps and repeated checks', () => {
  const session = createExerciseEvaluationSession();
  const assignments = { ...correct, 'gap-2': 'wrong', 'gap-3': 'option-2' };
  const result = checkWordBankAssignments(gaps, options, assignments).evaluation;
  session.check(result);
  session.check(result);
  assert.equal(session.snapshot().attemptCount, 2);
  assert.equal(session.snapshot().mistakeCount, 2);
  assert.deepEqual(session.snapshot().incorrectParts, ['gap-2', 'gap-3']);
  assert.equal(session.isLocked('gap-1'), true);
  assert.equal(assignments['gap-1'], correct['gap-1']);
});

test('Trainer: one input remains editable, no answer is revealed, second check completes', () => {
  const { gaps } = parseClozeData({ front: 'Ich [[hatte]] meine Freunde [[angerufen]].' }, 'trainer');
  const session = createExerciseEvaluationSession();
  const values = { 0: 'hatte', 1: 'telefoniert' };
  const result = evaluateTrainerGaps(gaps, values);
  session.check(result);
  assert.equal(session.isLocked(0), true);
  assert.equal(session.isLocked(1), false);
  assert.equal(session.evidence(), null);
  assert.equal(session.part(1).hint, 'Проверь введённую форму в этом месте.');
  assert.equal(session.part(1).errorCode, 'exercise.input_mismatch');
  assert.ok(!JSON.stringify(result).includes('angerufen'));
  values[1] = 'angerufen';
  session.edit(1);
  session.check(evaluateTrainerGaps(gaps, values));
  assert.equal(values[0], 'hatte');
  assert.equal(session.evidence().attemptCount, 2);
  assert.equal(session.evidence().mistakeCount, 1);
  assert.deepEqual(session.evidence().gradingSummary.incorrect_parts, ['1']);
});

test('Trainer: affix, choice and typed mismatches use only reliable deterministic metadata', () => {
  const { gaps } = parseClozeData({ front: 'klein[[en]] {*Der|Den} [[Hund]]' }, 'trainer');
  const result = evaluateTrainerGaps(gaps, { 0: 'er', 1: 'Den', 2: 'Katze' });
  assert.deepEqual(result.parts.map(part => [part.errorType, part.errorCode, part.hint]), [
    ['other', 'exercise.affix_mismatch', 'Проверь окончание.'],
    ['word_choice', 'exercise.wrong_choice', 'Проверь этот вариант.'],
    ['other', 'exercise.input_mismatch', 'Проверь введённую форму в этом месте.'],
  ]);
  assert.equal(evaluateTrainerGaps([{ id: 0, mode: 'input', correctAnswer: 'hatte|habe' }], { 0: ' HABE. ' }).accepted, true);
});

test('remount restores partial results, counters and history, while another review starts clean', () => {
  const first = createExerciseEvaluationSession();
  const assignments = { ...correct, 'gap-2': 'wrong' };
  first.check(checkWordBankAssignments(gaps, options, assignments).evaluation);
  const restored = createExerciseEvaluationSession(first.snapshot());
  assert.deepEqual(restored.snapshot(), first.snapshot());
  assert.equal(restored.isLocked('gap-1'), true);
  assert.equal(restored.isLocked('gap-2'), false);
  restored.check(checkWordBankAssignments(gaps, options, correct).evaluation);
  assert.equal(restored.evidence().attemptCount, 2);
  assert.deepEqual(restored.evidence().gradingSummary.incorrect_parts, ['gap-2']);
  const completed = createExerciseEvaluationSession(restored.snapshot());
  assert.equal(completed.isLocked('gap-2'), true);
  assert.equal(completed.check(checkWordBankAssignments(gaps, options, correct).evaluation), null);
  const newReview = createExerciseEvaluationSession();
  assert.equal(newReview.snapshot().attemptCount, 0);
  assert.equal(newReview.snapshot().mistakeCount, 0);
  assert.equal(newReview.snapshot().completed, false);
  assert.deepEqual(newReview.snapshot().incorrectParts, []);
});
