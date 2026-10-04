import { createExerciseEvaluation } from './exerciseEvaluation.js';

export const puzzleBoundaryId = (leftId, rightId) => `puzzle:boundary:${leftId}-${rightId}`;

/** Token identity is authored occurrence identity, including repeated words. */
export function evaluatePuzzleOrder(targetOrder, userOrder) {
  const successors = new Map(targetOrder.slice(0, -1).map((id, index) => [id, targetOrder[index + 1]]));
  const parts = userOrder.slice(0, -1).map((id, index) => {
    const nextId = userOrder[index + 1];
    return {
      id: puzzleBoundaryId(id, nextId),
      status: successors.has(id) && successors.get(id) === nextId ? 'correct' : 'incorrect',
      errorType: 'word_order', errorCode: 'exercise.word_order',
      hint: 'Проверь порядок рядом с этим местом.',
    };
  });
  // Exact membership/length guards incomplete orders and the zero-boundary (one-token) case.
  const accepted = targetOrder.length > 0 && userOrder.length === targetOrder.length
    && targetOrder.every((id, index) => id === userOrder[index]);
  return { ...createExerciseEvaluation(parts), verdict: accepted ? 'correct' : 'needs_retry', accepted };
}
