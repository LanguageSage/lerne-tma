import { useState } from 'react';
import { createExerciseEvaluationSession } from '../utils/exerciseEvaluation.js';

// Lifecycle is owned by StudyCard's reviewKey and ExerciseRenderer's component key.
export function useExerciseEvaluation(initial) {
  const [session] = useState(() => createExerciseEvaluationSession(initial));
  const [state, setState] = useState(session.snapshot);
  return {
    state,
    part: session.part,
    isLocked: session.isLocked,
    clearCurrentFeedback() {
      session.clearCurrentFeedback();
      setState(session.snapshot());
    },
    edit(id) {
      session.edit(id);
      setState(session.snapshot());
    },
    check(result, options) {
      const next = session.check(result, options);
      if (!next) return null;
      setState(next);
      return { state: next, evidence: session.evidence() };
    },
  };
}
