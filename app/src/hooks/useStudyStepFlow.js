import { useCallback, useState } from 'react';
import { completeStudyStep, getStudyStepState, reconcileStudyStepFlow } from '../utils/studySteps.js';

export function useStudyStepFlow({ cardId, historyIndex, sessionRevision, studyMode, requiredActions }) {
  // Configuration is internal, serializable review data; it is not card import syntax.
  const identityKey = JSON.stringify([sessionRevision, cardId ?? null, historyIndex, studyMode, requiredActions ?? null]);
  const [saved, setFlow] = useState(() => ({
    identityKey, generation: 0,
    flow: reconcileStudyStepFlow(null, JSON.stringify([identityKey, 0]), requiredActions),
  }));
  let state = saved;
  if (saved.identityKey !== identityKey) {
    const generation = saved.generation + 1;
    state = { identityKey, generation, flow: reconcileStudyStepFlow(null, JSON.stringify([identityKey, generation]), requiredActions) };
    setFlow(state);
  }
  const { flow } = state;
  const { reviewKey } = flow;

  const { currentStep, isFinished, blockedAction } = getStudyStepState(flow);
  const stepId = currentStep?.id;
  const completeStep = useCallback((evidence = null) => {
    setFlow(previous => {
      const next = completeStudyStep(previous.flow, { reviewKey, stepId, evidence });
      return next === previous.flow ? previous : { ...previous, flow: next };
    });
  }, [reviewKey, stepId]);

  return { ...flow, currentStep, isFinished, blockedAction, completeStep, hasRequiredActions: requiredActions != null };
}
