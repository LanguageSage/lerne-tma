import { useRef, useCallback } from 'react';

/**
 * useSessionVoice — stores the user's voice choice for the current study session,
 * scoped to a deck. The selection survives card navigation but resets when the
 * deck changes or the component unmounts.
 *
 * Usage: instantiate once in StudyView, pass `sessionVoice` down to useVoicePicker.
 */
export const useSessionVoice = () => {
  // Map<deckId, voiceValue>
  const voiceByDeckRef = useRef(new Map());

  const getSessionVoice = useCallback((deckId) => {
    return voiceByDeckRef.current.get(deckId) || null;
  }, []);

  const setSessionVoice = useCallback((deckId, voiceValue) => {
    voiceByDeckRef.current.set(deckId, voiceValue);
  }, []);

  const clearSessionVoice = useCallback((deckId) => {
    if (deckId) {
      voiceByDeckRef.current.delete(deckId);
    } else {
      voiceByDeckRef.current.clear();
    }
  }, []);

  return { getSessionVoice, setSessionVoice, clearSessionVoice };
};
