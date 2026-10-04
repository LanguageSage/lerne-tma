import test from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseEvaluationSession } from '../exerciseEvaluation.js';
import { evaluateMatchPair, matchPartId } from '../matchEvaluation.js';
import { evaluateQuizOption } from '../quizEvaluation.js';
import { parseMatchData } from '../matchParser.js';
import { parseQuizData } from '../quizParser.js';

const pairs = parseMatchData({ front: '@match\nA => eins\nB => zwei\nC => drei' }).pairs;
const quiz = parseQuizData({ front: 'Choose\n\n- Wrong\n* Right\n- Also wrong' }).options;

function pair(session, matches, left, right) {
  const attempt = evaluateMatchPair(pairs, matches, left, right);
  if (!attempt) return null;
  const next = session.check(attempt.result, attempt);
  if (next && attempt.interactionCorrect) matches[left] = right;
  return next;
}

test('Match confirms and locks correct pairs independently without completing early or adding mistakes', () => {
  const session = createExerciseEvaluationSession();
  const matches = {};
  pair(session, matches, 2, 2);
  assert.deepEqual(matches, { 2: 2 });
  assert.equal(session.isLocked(matchPartId(2)), true);
  assert.equal(session.isLocked(matchPartId(0)), false);
  assert.equal(session.evidence(), null);
  assert.equal(session.snapshot().mistakeCount, 0);
  pair(session, matches, 0, 0);
  assert.equal(session.evidence(), null);
  pair(session, matches, 1, 1);
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0,
    gradingSummary: { final_verdict: 'correct', error_types_seen: [], error_codes_seen: [],
      incorrect_parts: [], final_evaluator: 'rules', interaction_count: 3 },
  });
});

test('Match wrong pair remains available, safe feedback gives no solution, retry completes with cumulative history', () => {
  const session = createExerciseEvaluationSession();
  const matches = {};
  pair(session, matches, 0, 0);
  pair(session, matches, 1, 2);
  assert.deepEqual(matches, { 0: 0 });
  assert.equal(session.isLocked(matchPartId(1)), false);
  assert.equal(session.evidence(), null);
  assert.deepEqual(session.part(matchPartId(1)), {
    id: 'match:left-2', status: 'incorrect', errorType: 'other',
    errorCode: 'exercise.wrong_match', hint: 'Эти элементы не образуют правильную пару.',
  });
  assert.equal(JSON.stringify(session.snapshot().result).includes('zwei'), false);
  pair(session, matches, 1, 1);
  pair(session, matches, 2, 2);
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['other'],
      error_codes_seen: ['exercise.wrong_match'], incorrect_parts: ['match:left-2'],
      final_evaluator: 'rules', interaction_count: 4 },
  });
});

test('Match rejects invalid IDs, confirmed left parts and reused physical tiles without counting interactions', () => {
  const session = createExerciseEvaluationSession();
  const matches = {};
  assert.equal(pair(session, matches, 9, 0), null);
  assert.equal(pair(session, matches, 0, 9), null);
  pair(session, matches, 0, 0);
  const before = session.snapshot();
  assert.equal(pair(session, matches, 0, 1), null);
  assert.equal(pair(session, matches, 1, 0), null);
  assert.deepEqual(session.snapshot(), before);
});

test('Match duplicate right values are interchangeable after whitespace normalization, each tile used once', () => {
  const duplicates = parseMatchData({ front: '@match\nA => same value\nB => same   value' }).pairs;
  const first = evaluateMatchPair(duplicates, {}, 0, 1);
  assert.equal(first.interactionCorrect, true);
  assert.equal(first.result.accepted, false);
  assert.equal(evaluateMatchPair(duplicates, { 0: 1 }, 1, 1), null);
  assert.equal(evaluateMatchPair(duplicates, { 0: 1 }, 1, 0).result.accepted, true);
});

test('Match restored partial session keeps locks and cumulative counters; completed session ignores repeats', () => {
  const first = createExerciseEvaluationSession();
  const matches = {};
  pair(first, matches, 0, 1);
  pair(first, matches, 0, 0);
  const restored = createExerciseEvaluationSession(first.snapshot());
  assert.equal(restored.isLocked(matchPartId(0)), true);
  pair(restored, matches, 1, 1);
  pair(restored, matches, 2, 2);
  assert.equal(restored.evidence().attemptCount, 2);
  assert.equal(restored.evidence().mistakeCount, 1);
  assert.equal(restored.evidence().gradingSummary.interaction_count, 4);
  const completed = createExerciseEvaluationSession(restored.snapshot());
  const before = completed.snapshot();
  assert.equal(completed.check(evaluateMatchPair(pairs, { 0: 0, 1: 1 }, 2, 2).result), null);
  assert.deepEqual(completed.snapshot(), before);
  assert.equal(createExerciseEvaluationSession().snapshot().interactionCount, 0);
});

test('Quiz wrong option gives only local feedback and remains active until a correct retry', () => {
  const session = createExerciseEvaluationSession();
  session.check(evaluateQuizOption(quiz, 0));
  assert.equal(session.snapshot().completed, false);
  assert.equal(session.evidence(), null);
  assert.deepEqual(session.snapshot().result.parts, [{ id: 'option-0', status: 'incorrect',
    errorType: 'word_choice', errorCode: 'exercise.wrong_choice', hint: 'Попробуй другой вариант.' }]);
  assert.equal(JSON.stringify(session.snapshot().result).includes('Right'), false);
  session.check(evaluateQuizOption(quiz, 1));
  assert.deepEqual(session.evidence(), {
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['word_choice'],
      error_codes_seen: ['exercise.wrong_choice'], incorrect_parts: ['option-0'], final_evaluator: 'rules' },
  });
});

test('Quiz first try succeeds once; invalid option and completed repeat cannot create additional checks', () => {
  const session = createExerciseEvaluationSession();
  assert.equal(evaluateQuizOption(quiz, 99), null);
  assert.equal(session.snapshot().attemptCount, 0);
  session.check(evaluateQuizOption(quiz, 1));
  assert.equal(session.evidence().isFirstTry, true);
  assert.equal(session.evidence().attemptCount, 1);
  assert.equal(session.evidence().mistakeCount, 0);
  assert.equal(session.check(evaluateQuizOption(quiz, 1)), null);
  assert.equal(session.evidence().attemptCount, 1);
});

test('Quiz shuffled option IDs and restored history stay stable across two different wrong options', () => {
  const session = createExerciseEvaluationSession();
  session.check(evaluateQuizOption([...quiz].reverse(), 2));
  const restored = createExerciseEvaluationSession(session.snapshot());
  restored.check(evaluateQuizOption(quiz, 0));
  restored.check(evaluateQuizOption(quiz, 1));
  assert.equal(restored.evidence().attemptCount, 3);
  assert.equal(restored.evidence().mistakeCount, 2);
  assert.deepEqual(restored.evidence().gradingSummary.incorrect_parts, ['option-2', 'option-0']);
  assert.deepEqual(restored.evidence().gradingSummary.error_codes_seen, ['exercise.wrong_choice']);
  assert.deepEqual(createExerciseEvaluationSession().snapshot().incorrectParts, []);
});

test('Quiz retains multiple starred alternatives as accepted single-choice answers, not a multi-select requirement', () => {
  const data = parseQuizData({ front: 'Choose\n\n* First accepted\n* Second accepted\n- Wrong' });
  for (const id of [0, 1]) {
    const session = createExerciseEvaluationSession();
    session.check(evaluateQuizOption(data.options, id));
    assert.equal(session.evidence().isFirstTry, true);
  }
  assert.equal(evaluateQuizOption(data.options, 2).accepted, false);
});
