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
    edit(id) {
      session.edit(id);
      setState(session.snapshot());
    },
    check(result) {
      const next = session.check(result);
      if (!next) return null;
      setState(next);
      return { state: next, evidence: session.evidence() };
    },
  };
}
