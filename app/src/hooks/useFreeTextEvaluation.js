import { useEffect, useRef, useState } from 'react';
import { createFreeTextEvaluationSession } from '../utils/freeTextEvaluationState.js';
import { evaluateFreeTextAnswer } from '../services/answerEvaluationService.js';

export function useFreeTextEvaluation(cardId, savedState, reviewKey, evaluateAnswer = null) {
  const currentKey = reviewKey ?? cardId;
  const [sessionState, setSessionState] = useState(() => {
    const session = createFreeTextEvaluationSession(savedState);
    return { key: currentKey, session, state: session.snapshot() };
  });

  let effectiveSession = sessionState.session;
  let effectiveState = sessionState.state;

  if (sessionState.key !== currentKey) {
    effectiveSession = createFreeTextEvaluationSession(savedState);
    effectiveState = effectiveSession.snapshot();
    setSessionState({ key: currentKey, session: effectiveSession, state: effectiveState });
  }

  const currentKeyRef = useRef(currentKey);
  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async answer => {
    const activeSession = effectiveSession;
    const activeKey = currentKey;
    // Resolve and invoke inside the session's error boundary, including the first submit.
    const promise = activeSession.submit(answer, text => (evaluateAnswer ?? evaluateFreeTextAnswer)(cardId, text));
    setSessionState(prev => prev.key === activeKey ? { ...prev, state: activeSession.snapshot() } : prev);
    const next = await promise;
    if (!mounted.current || !next) return null;
    if (currentKeyRef.current !== activeKey) return null;
    setSessionState(prev => prev.key === activeKey ? { ...prev, state: next } : prev);
    return { evidence: activeSession.evidence(), result: next.result };
  };

  return { state: effectiveState, submit, evidence: effectiveSession.evidence() };
}
