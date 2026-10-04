import { useEffect, useRef, useState } from 'react';
import { createFreeTextEvaluationSession } from '../utils/freeTextEvaluationState.js';

let defaultEvaluator = null;
async function resolveEvaluator(customEvaluator) {
  if (customEvaluator) return customEvaluator;
  if (!defaultEvaluator) {
    const mod = await import('../services/answerEvaluationService.js');
    defaultEvaluator = mod.evaluateFreeTextAnswer;
  }
  return defaultEvaluator;
}

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
    const evaluateFn = await resolveEvaluator(evaluateAnswer);
    const promise = activeSession.submit(answer, text => evaluateFn(cardId, text));
    setSessionState(prev => prev.key === activeKey ? { ...prev, state: activeSession.snapshot() } : prev);
    const next = await promise;
    if (!mounted.current || !next) return null;
    if (currentKeyRef.current !== activeKey) return null;
    setSessionState(prev => prev.key === activeKey ? { ...prev, state: next } : prev);
    return { evidence: activeSession.evidence(), result: next.result };
  };

  return { state: effectiveState, submit, evidence: effectiveSession.evidence() };
}
