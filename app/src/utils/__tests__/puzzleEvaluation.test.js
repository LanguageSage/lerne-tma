import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePuzzleOrder } from '../puzzleEvaluation.js';
import { createExerciseEvaluationSession } from '../exerciseEvaluation.js';

const target = [0, 1, 2, 3, 4];
const wrong = [0, 2, 1, 3, 4];
const checkWrong = session => session.check(evaluatePuzzleOrder(target, wrong));
const checkCorrect = session => session.check(evaluatePuzzleOrder(target, target));

test('exact authored token order accepts all directed boundaries', () => {
  const result = evaluatePuzzleOrder(target, target);
  assert.equal(result.verdict, 'correct');
  assert.equal(result.accepted, true);
  assert.deepEqual(result.parts, [0, 1, 2, 3].map(id => ({ id: `puzzle:boundary:${id}-${id + 1}`, status: 'correct' })));
});

test('swapped tokens report only the actual bad directed boundaries', () => {
  const result = evaluatePuzzleOrder(target, wrong);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.parts.slice(0, 3), ['0-2', '2-1', '1-3'].map(pair => ({
    id: `puzzle:boundary:${pair}`, status: 'incorrect', errorType: 'word_order',
    errorCode: 'exercise.word_order', hint: 'Проверь порядок рядом с этим местом.',
  })));
  assert.deepEqual(result.parts[3], { id: 'puzzle:boundary:3-4', status: 'correct' });
});

test('public feedback has no target, expected sentence, next token, or positions', () => {
  const result = evaluatePuzzleOrder(target, wrong);
  assert.deepEqual(Object.keys(result).sort(), ['accepted', 'parts', 'schemaVersion', 'verdict']);
  for (const part of result.parts) {
    assert.deepEqual(Object.keys(part).sort(), part.status === 'correct' ? ['id', 'status']
      : ['errorCode', 'errorType', 'hint', 'id', 'status']);
  }
  assert.ok(!JSON.stringify(result).includes(JSON.stringify(target)));
});

test('duplicate text occurrences remain distinct by ID', () => {
  const words = 'Ich sehe den Mann und den Hund.'.split(' ');
  const ids = words.map((_, index) => index);
  const exchanged = [0, 1, 5, 3, 4, 2, 6];
  assert.equal(exchanged.map(id => words[id]).join(' '), words.join(' '));
  const result = evaluatePuzzleOrder(ids, exchanged);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.parts.filter(part => part.status === 'incorrect').map(part => part.id),
    ['1-5', '5-3', '4-2', '2-6'].map(pair => `puzzle:boundary:${pair}`));
});

test('two words have one boundary and reverse order counts one mistake', () => {
  const session = createExerciseEvaluationSession();
  const result = evaluatePuzzleOrder([0, 1], [1, 0]);
  assert.equal(result.parts.length, 1);
  session.check(result);
  assert.equal(session.snapshot().mistakeCount, 1);
  assert.equal(session.snapshot().attemptCount, 1);
  assert.equal(evaluatePuzzleOrder([0, 1], [0, 1]).accepted, true);
});

test('incomplete, repeated, foreign and empty orders cannot complete; one word can', () => {
  for (const order of [[], [0], [0, 1, 2, 3], [0, 1, 2, 3, 4, 4], [0, 1, 2, 3, 99], [0, 1, 1, 3, 4]]) {
    assert.equal(evaluatePuzzleOrder(target, order).accepted, false);
  }
  assert.equal(evaluatePuzzleOrder([], []).accepted, false);
  assert.equal(evaluatePuzzleOrder([7], [7]).accepted, true);
  assert.equal(evaluatePuzzleOrder([7], [8]).accepted, false);
});

test('first Check success yields 1/0/true and sends no historical errors', () => {
  const session = createExerciseEvaluationSession();
  checkCorrect(session);
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0,
    gradingSummary: { final_verdict: 'correct', error_types_seen: [], error_codes_seen: [],
      incorrect_parts: [], final_evaluator: 'rules' },
  });
});

test('wrong Check + edit + success yields 2/1/false with cumulative evidence', () => {
  const session = createExerciseEvaluationSession();
  checkWrong(session);
  assert.equal(session.evidence(), null);
  session.clearCurrentFeedback();
  checkCorrect(session);
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['word_order'],
      error_codes_seen: ['exercise.word_order'],
      incorrect_parts: ['puzzle:boundary:0-2', 'puzzle:boundary:2-1', 'puzzle:boundary:1-3'],
      final_evaluator: 'rules' },
  });
});

test('clearCurrentFeedback clears all current boundaries but preserves counters and history', () => {
  const session = createExerciseEvaluationSession();
  checkWrong(session);
  const before = session.snapshot();
  session.clearCurrentFeedback();
  assert.deepEqual(session.snapshot(), { ...before, result: null });
  assert.equal(session.part('puzzle:boundary:3-4'), undefined);
  session.clearCurrentFeedback();
  assert.deepEqual(session.snapshot(), { ...before, result: null });
});

test('Reset-style feedback clear and reassembly cannot restore first try', () => {
  const session = createExerciseEvaluationSession();
  checkWrong(session);
  session.clearCurrentFeedback();
  let order = [];
  for (const id of target) order.push(id);
  assert.equal(session.snapshot().attemptCount, 1);
  session.check(evaluatePuzzleOrder(target, order));
  assert.equal(session.evidence().isFirstTry, false);
  assert.equal(session.evidence().mistakeCount, 1);
});

test('repeated wrong Checks each count once and accumulate distinct incorrect parts', () => {
  const session = createExerciseEvaluationSession();
  checkWrong(session);
  checkWrong(session);
  session.check(evaluatePuzzleOrder(target, [1, 0, 2, 3, 4]));
  assert.equal(session.snapshot().attemptCount, 3);
  assert.equal(session.snapshot().mistakeCount, 3);
  checkCorrect(session);
  assert.deepEqual(session.evidence().gradingSummary.incorrect_parts,
    ['0-2', '2-1', '1-3', '1-0'].map(pair => `puzzle:boundary:${pair}`));
});

test('remount restores counters, history and completion; completed clears/checks are harmless', () => {
  const session = createExerciseEvaluationSession();
  checkWrong(session);
  session.clearCurrentFeedback();
  const restored = createExerciseEvaluationSession(session.snapshot());
  assert.deepEqual(restored.snapshot(), session.snapshot());
  checkCorrect(restored);
  const completed = createExerciseEvaluationSession(restored.snapshot());
  completed.clearCurrentFeedback();
  assert.deepEqual(completed.evidence(), restored.evidence());
  assert.equal(checkCorrect(completed), null);
  assert.equal(createExerciseEvaluationSession().snapshot().attemptCount, 0);
});
