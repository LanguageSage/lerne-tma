import { createSupportSession, captureSupportEvidence } from './supportEvidence.js';

/** One owner of educational attempts. Transport failures and duplicate submits never count. */
export const isValidAnswerEvaluationResult = result => (
  ['correct', 'accepted_minor', 'needs_retry', 'incorrect', 'unavailable'].includes(result?.verdict)
  && result.accepted === ['correct', 'accepted_minor'].includes(result.verdict)
);

export const canRevealFreeTextAnswer = state => Boolean(!state?.loading && (
  state?.result?.accepted === true
  || (state?.gradingPolicy && state.attemptCount >= state.gradingPolicy.max_retries)
));

export function createFreeTextEvaluationSession(initial = {}, {
  trackSupport = false, assessmentMode = false, taskSupport, supportHistoryUnknown = false,
} = {}) {
  // Legacy/restored progress has an unobserved prefix. Never synthesize zeroes for it.
  const restored = initial && Object.keys(initial).length > 0;
  const support = trackSupport ? createSupportSession(initial?.supportState,
    restored || supportHistoryUnknown ? [] : ['hint_count', 'answer_reveal_count']) : null;
  let state = {
    attemptCount: 0, mistakeCount: 0, result: null, lastAnswer: null,
    gradingPolicy: null, errors: [], ...structuredClone(initial), loading: false,
  };
  const snapshot = () => structuredClone({ ...state, errors: [...state.errors],
    ...(support ? { supportState: support.snapshot() } : {}) });
  const supportFields = () => state.answerSupportEvidence ? {
    supportEvidence: structuredClone(state.answerSupportEvidence),
    ...(state.taskSupport ? { taskSupport: structuredClone(state.taskSupport) } : {}),
  } : {};
  return {
    snapshot,
    recordSupport(kind) { support?.record(kind); },
    supportFields,
    async submit(answer, evaluate) {
      if (state.loading || state.result?.accepted
        || (typeof answer === 'string' && !answer.trim())
        || (state.gradingPolicy && state.attemptCount >= state.gradingPolicy.max_retries)
        || (answer === state.lastAnswer && state.result?.verdict !== 'unavailable')) return null;
      const supportBeforeAnswer = support?.snapshot();
      state = { ...state, loading: true };
      try {
        if (typeof answer !== 'string') throw new TypeError('Invalid answer');
        const response = await evaluate(answer);
        const result = response.result;
        if (!isValidAnswerEvaluationResult(result)) {
          throw new Error('Invalid answer evaluation response');
        }
        if (result.verdict === 'unavailable') {
          state = { ...state, result, gradingPolicy: response.grading_policy || state.gradingPolicy };
        } else {
          state = {
            ...state, result, lastAnswer: answer,
            gradingPolicy: response.grading_policy || state.gradingPolicy,
            attemptCount: state.attemptCount + 1,
            mistakeCount: state.mistakeCount + (result.accepted ? 0 : 1),
            errors: result.error_type ? [...state.errors, {
              type: result.error_type, code: result.error_code,
              minor: result.verdict === 'accepted_minor',
            }] : state.errors,
          };
          // Freeze before this check's feedback is displayed. Later help cannot rewrite it.
          const terminal = result.accepted || (state.gradingPolicy
            && state.attemptCount >= state.gradingPolicy.max_retries);
          if (supportBeforeAnswer && (assessmentMode ? !state.answerSupportEvidence : terminal)) state = { ...state,
            answerSupportEvidence: captureSupportEvidence(supportBeforeAnswer,
              assessmentMode ? 'first_assessment_result' : 'exercise_completion', state.attemptCount),
            taskSupport: structuredClone(taskSupport),
          };
        }
      } catch (error) {
        const reason = error?.code === 'ECONNABORTED' ? 'timeout'
          : error?.response?.status === 401 ? 'authentication'
          : error?.response?.status === 403 ? 'access_denied'
          : error?.response?.status === 422 ? 'invalid_card' : 'network';
        state = { ...state, result: { verdict: 'unavailable', accepted: false,
          error_code: `evaluator.${reason}` } };
      } finally {
        state = { ...state, loading: false };
      }
      return snapshot();
    },
    evidence() {
      if (state.result?.accepted) {
        return {
          isCorrect: true,
          isFirstTry: state.attemptCount === 1,
          attemptCount: state.attemptCount,
          mistakeCount: state.mistakeCount,
          completed: true,
          ...supportFields(),
          gradingSummary: {
            final_verdict: state.result.verdict,
            error_types_seen: [...new Set(state.errors.map(e => e.type))],
            error_codes_seen: [...new Set(state.errors.map(e => e.code).filter(Boolean))],
            minor_errors: [...new Set(state.errors.filter(e => e.minor).map(e => e.type))],
            final_evaluator: state.result.evaluator,
            ...(['primary', 'secondary', 'none'].includes(state.result.target_relevance)
              ? { final_target_relevance: state.result.target_relevance } : {}),
          },
        };
      }
      const maxRetries = state.gradingPolicy?.max_retries;
      const isExhausted = Boolean(
        maxRetries != null
        && state.attemptCount >= maxRetries
        && state.result
        && state.result.verdict !== 'unavailable'
      );
      if (isExhausted) {
        return {
          isCorrect: false,
          isFirstTry: false,
          attemptCount: state.attemptCount,
          mistakeCount: state.mistakeCount,
          completed: false,
          ...supportFields(),
          gradingSummary: {
            final_verdict: state.result.verdict,
            error_types_seen: [...new Set(state.errors.map(e => e.type))],
            error_codes_seen: [...new Set(state.errors.map(e => e.code).filter(Boolean))],
            minor_errors: [...new Set(state.errors.filter(e => e.minor).map(e => e.type))],
            final_evaluator: state.result.evaluator,
            ...(['primary', 'secondary', 'none'].includes(state.result.target_relevance)
              ? { final_target_relevance: state.result.target_relevance } : {}),
          },
        };
      }
      return null;
    },
  };
}
