/** One owner of educational attempts. Transport failures and duplicate submits never count. */
export const canRevealFreeTextAnswer = state => Boolean(!state?.loading && (
  state?.result?.accepted === true
  || (state?.gradingPolicy && state.attemptCount >= state.gradingPolicy.max_retries)
));

export function createFreeTextEvaluationSession(initial = {}) {
  let state = {
    attemptCount: 0, mistakeCount: 0, result: null, lastAnswer: null,
    gradingPolicy: null, errors: [], ...initial, loading: false,
  };
  const snapshot = () => ({ ...state, errors: [...state.errors] });
  return {
    snapshot,
    async submit(answer, evaluate) {
      if (state.loading || state.result?.accepted || !answer.trim()
        || (answer === state.lastAnswer && state.result?.verdict !== 'unavailable')) return null;
      state = { ...state, loading: true };
      try {
        const response = await evaluate(answer);
        const result = response.result;
        if (result.verdict === 'unavailable') {
          state = { ...state, result, gradingPolicy: response.grading_policy || state.gradingPolicy };
        } else {
          state = {
            ...state, result, lastAnswer: answer,
            gradingPolicy: response.grading_policy,
            attemptCount: state.attemptCount + 1,
            mistakeCount: state.mistakeCount + (result.accepted ? 0 : 1),
            errors: result.error_type ? [...state.errors, {
              type: result.error_type, code: result.error_code,
              minor: result.verdict === 'accepted_minor',
            }] : state.errors,
          };
        }
      } catch {
        state = { ...state, result: { verdict: 'unavailable', accepted: false } };
      } finally {
        state = { ...state, loading: false };
      }
      return snapshot();
    },
    evidence() {
      if (!state.result?.accepted) return null;
      return {
        isCorrect: true, isFirstTry: state.attemptCount === 1,
        attemptCount: state.attemptCount, mistakeCount: state.mistakeCount,
        gradingSummary: {
          final_verdict: state.result.verdict,
          error_types_seen: [...new Set(state.errors.map(e => e.type))],
          error_codes_seen: [...new Set(state.errors.map(e => e.code).filter(Boolean))],
          minor_errors: [...new Set(state.errors.filter(e => e.minor).map(e => e.type))],
          final_evaluator: state.result.evaluator,
        },
      };
    },
  };
}
