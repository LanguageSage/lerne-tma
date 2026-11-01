import { useState } from 'react';
import { createExerciseEvaluationSession } from '../utils/exerciseEvaluation.js';

// Lifecycle is owned by StudyCard's reviewKey and ExerciseRenderer's component key.
export function useExerciseEvaluation(initial, supportOptions) {
  const [session] = useState(() => createExerciseEvaluationSession(initial, supportOptions));
  const [state, setState] = useState(session.snapshot);
  return {
    state,
    part: session.part,
    isLocked: session.isLocked,
    recordSupport(kind) {
      session.recordSupport(kind);
      setState(session.snapshot());
    },
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
      return { state: next, evidence: session.evidence(), ...session.supportFields() };
    },
  };
}
