import { useEffect, useRef, useState } from 'react';
import { createFreeTextEvaluationSession } from '../utils/freeTextEvaluationState.js';
import { evaluateFreeTextAnswer } from '../services/answerEvaluationService.js';

export function useFreeTextEvaluation(cardId, savedState) {
  const [session] = useState(() => createFreeTextEvaluationSession(savedState));
  const [state, setState] = useState(session.snapshot);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async answer => {
    const promise = session.submit(answer, text => evaluateFreeTextAnswer(cardId, text));
    setState(session.snapshot());
    const next = await promise;
    if (!mounted.current || !next) return null;
    setState(next);
    return { evidence: session.evidence(), result: next.result };
  };
  return { state, submit, evidence: session.evidence() };
}
