/** Exercise type selects an evaluator; actions describe the review's sequence. */
export const STUDY_ACTION = Object.freeze({
  ANSWER: 'answer', LISTEN: 'listen', SPEAK: 'speak', QUESTION: 'question', FEEDBACK: 'feedback',
});

const supportedActions = new Set(Object.values(STUDY_ACTION));

/** Strings are shorthand. Descriptors give repeated dialogue actions stable IDs/context. */
export function normalizeStudySteps(requiredActions) {
  const actions = requiredActions ?? [STUDY_ACTION.ANSWER];
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new TypeError('requiredActions must be a non-empty array');
  }
  const ids = new Set();
  return actions.map((value, index) => {
    const step = typeof value === 'string' ? { action: value } : value;
    if (!step || typeof step.action !== 'string' || !step.action.trim()) {
      throw new TypeError('Each study step needs an action');
    }
    const id = step.id ?? `step:${index}`;
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new TypeError('Study step IDs must be unique non-empty strings');
    }
    ids.add(id);
    return { ...step, id };
  });
}

/** @typedef {{id: string, action: string, pedagogicalRole?: string, audioRole?: string}} StudyStep */
export function createStudyStepFlow(reviewKey, requiredActions) {
  return { reviewKey, steps: normalizeStudySteps(requiredActions), completedSteps: [] };
}

export function getStudyStepState(flow) {
  const currentStep = flow.steps[flow.completedSteps.length] ?? null;
  const blockedAction = currentStep && !supportedActions.has(currentStep.action) ? currentStep.action : null;
  return { currentStep, isFinished: currentStep === null, blockedAction };
}

/** An evaluator reports success for one captured step ID, never for "the current action". */
export function completeStudyStep(flow, { reviewKey, stepId, evidence = null }) {
  const { currentStep, blockedAction } = getStudyStepState(flow);
  if (flow.reviewKey !== reviewKey || !currentStep || blockedAction || currentStep.id !== stepId) return flow;
  return { ...flow, completedSteps: [...flow.completedSteps, { id: stepId, evidence }] };
}

/** New card/review/mode/configuration resets synchronously, before children see old completion. */
export function reconcileStudyStepFlow(flow, reviewKey, requiredActions) {
  const next = createStudyStepFlow(reviewKey, requiredActions);
  return flow?.reviewKey === reviewKey && JSON.stringify(flow.steps) === JSON.stringify(next.steps) ? flow : next;
}

/** Legacy false/failed evidence is still captured for grading, but cannot complete answer. */
export function isSuccessfulStudyAnswer(evidence) {
  return evidence === true || evidence?.isCorrect === true;
}

/** Manual grading stays available for unconfigured cards; explicit flows require all steps. */
export function canGradeStudyFlow(flow, hasRequiredActions) {
  return !hasRequiredActions || getStudyStepState(flow).isFinished;
}
