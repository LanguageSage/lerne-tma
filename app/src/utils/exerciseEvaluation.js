/** Public part feedback deliberately excludes solutions and submitted values. */
export const createExerciseEvaluation = (parts = [], { requiredPartIds = [] } = {}) => {
  const feedback = parts.map(({ id, status, errorType, errorCode, hint }) => (
    status === 'correct' ? { id: String(id), status } : {
      id: String(id), status: 'incorrect', errorType, errorCode, hint,
    }
  ));
  const accepted = feedback.length > 0 && feedback.every(part => part.status === 'correct')
    && requiredPartIds.every(id => feedback.some(part => part.id === String(id)));
  return { schemaVersion: 1, verdict: accepted ? 'correct' : 'needs_retry', accepted, parts: feedback };
};

/** Checks count attempts; successful incremental progress can defer the attempt until completion. */
export function createExerciseEvaluationSession(initial = {}) {
  let state = {
    result: null, attemptCount: 0, mistakeCount: 0, completed: false,
    incorrectParts: [], errorTypesSeen: [], errorCodesSeen: [], ...initial,
    interactionCount: initial.interactionCount ?? initial.attemptCount ?? 0,
  };
  const snapshot = () => structuredClone(state);
  const part = id => state.result?.parts.find(item => item.id === String(id));
  const isLocked = id => state.completed || part(id)?.status === 'correct';
  const union = (previous, next) => [...new Set([...previous, ...next].filter(Boolean))];
  return {
    snapshot, part, isLocked,
    clearCurrentFeedback() {
      // Completed feedback is also the final verdict used by evidence().
      if (!state.completed) state = { ...state, result: null };
    },
    edit(id) {
      if (isLocked(id)) return;
      if (state.result) state = { ...state, result: {
        ...state.result, parts: state.result.parts.filter(item => item.id !== String(id)),
      } };
    },
    check(result, { interactionCorrect = result.accepted, countAttempt = true } = {}) {
      if (state.completed) return null;
      const wrong = result.parts.filter(item => item.status === 'incorrect');
      state = {
        ...state, result, completed: result.accepted,
        interactionCount: state.interactionCount + 1,
        attemptCount: state.attemptCount + (countAttempt || !interactionCorrect ? 1 : 0),
        mistakeCount: state.mistakeCount + (interactionCorrect ? 0 : 1),
        incorrectParts: union(state.incorrectParts, wrong.map(item => item.id)),
        errorTypesSeen: union(state.errorTypesSeen, wrong.map(item => item.errorType)),
        errorCodesSeen: union(state.errorCodesSeen, wrong.map(item => item.errorCode)),
      };
      return snapshot();
    },
    evidence() {
      if (!state.completed) return null;
      return {
        isCorrect: true, completed: true, isFirstTry: state.attemptCount === 1,
        attemptCount: state.attemptCount, mistakeCount: state.mistakeCount,
        gradingSummary: {
          final_verdict: state.result.verdict,
          error_types_seen: [...state.errorTypesSeen],
          error_codes_seen: [...state.errorCodesSeen],
          incorrect_parts: [...state.incorrectParts],
          final_evaluator: 'rules',
          ...(state.interactionCount !== state.attemptCount
            ? { interaction_count: state.interactionCount } : {}),
        },
      };
    },
  };
}
