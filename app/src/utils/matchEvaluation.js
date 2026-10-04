import { normalizeMatchValue } from './matchParser.js';
import { createExerciseEvaluation } from './exerciseEvaluation.js';

export const matchPartId = id => `match:left-${id + 1}`;

// Duplicate right values remain interchangeable, but each physical tile is single-use.
export const evaluateMatchPair = (pairs, matches, leftId, rightId) => {
  const left = pairs.find(pair => pair.id === leftId);
  const right = pairs.find(pair => pair.id === rightId);
  if (!left || !right || matches[leftId] !== undefined || Object.values(matches).includes(rightId)) return null;
  const correct = normalizeMatchValue(left.right) === normalizeMatchValue(right.right);
  const parts = pairs.filter(pair => matches[pair.id] !== undefined)
    .map(pair => ({ id: matchPartId(pair.id), status: 'correct' }));
  parts.push({ id: matchPartId(leftId), status: correct ? 'correct' : 'incorrect',
    errorType: 'other', errorCode: 'exercise.wrong_match',
    hint: 'Эти элементы не образуют правильную пару.' });
  const result = createExerciseEvaluation(parts, { requiredPartIds: pairs.map(pair => matchPartId(pair.id)) });
  return { result, interactionCorrect: correct, countAttempt: !correct || result.accepted };
};
