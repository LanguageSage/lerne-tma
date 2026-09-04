import { useRef, useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';

export const useStudySession = () => {
  const gradingRef = useRef(false);
  const { setLoading, showToast } = useUiStore();

  const prefetchMedia = useCallback((url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  }, []);

  const fetchNextCard = useCallback(async (deckId, isFirst = false, excludeIds = []) => {
    setLoading(true);
    const session = useSessionStore.getState();
    session.setApiError(null);
    try {
      if (deckId === 'duplicates') {
        const { duplicateCards } = useDeckStore.getState();
        const currentCard = session.card;
        let nextDuplicateCard = null;

        if (isFirst || !currentCard) {
          nextDuplicateCard = duplicateCards[0];
        } else {
          const currentIndex = duplicateCards.findIndex(c => c.id === currentCard.id);
          if (currentIndex >= 0 && currentIndex < duplicateCards.length - 1) {
            nextDuplicateCard = duplicateCards[currentIndex + 1];
          } else {
            nextDuplicateCard = null;
          }
        }

        if (!nextDuplicateCard) {
          session.setIsSessionFinished(true);
          session.setCard(null);
        } else {
          const res = await api.get(`/study/card/${nextDuplicateCard.id}`);
          const newCard = res.data;
          session.addToHistory(newCard);
          prefetchMedia(newCard.image_url);
        }
      } else {
        const { deckCards } = useDeckStore.getState();
        const currentCard = session.card;
        let nextCardInfo = null;

        // If not the first load, try to navigate sequentially in deckCards list if currentCard is set
        if (!isFirst && !session.isLearningMore && currentCard && deckCards && deckCards.length > 0) {
          const currentIndex = deckCards.findIndex(c => String(c.id) === String(currentCard.id));
          if (currentIndex >= 0) {
            if (currentIndex < deckCards.length - 1) {
              nextCardInfo = deckCards[currentIndex + 1];
            } else {
              // Reached end of deck! End session to show finished summary screen
              nextCardInfo = null;
            }
          }
        }

        if (nextCardInfo) {
          try {
            const res = await api.get(`/study/card/${nextCardInfo.id}`);
            const newCard = res.data;
            session.addToHistory(newCard);
            prefetchMedia(newCard.image_url);
          } catch (err) {
            console.warn("api.get study card failed in useStudySession, using nextCardInfo fallback:", err);
            session.addToHistory(nextCardInfo);
            prefetchMedia(nextCardInfo.image_url);
          }
        } else if (!isFirst && !session.isLearningMore && currentCard) {
          // Reached end of sequential deckCards traversal! End session cleanly to show summary screen
          session.setIsSessionFinished(true);
          session.setCard(null);
        } else {
          // Fetch from SRS when starting session (isFirst), or in learn_more mode (early review by next_review asc)
          const effectiveExclude = session.isLearningMore ? (isFirst ? [] : excludeIds) : excludeIds;
          const excludeParam = effectiveExclude.length > 0 ? `exclude_ids=${effectiveExclude.join(',')}` : '';
          const learnMoreParam = session.isLearningMore ? 'learn_more=true' : '';
          const params = [excludeParam, learnMoreParam].filter(Boolean).join('&');
          const queryString = params ? `?${params}` : '';
          const endpoint = `/decks/${deckId}/next${queryString}`;
          const res = await api.get(endpoint);

          if (res.data.error) {
            session.setApiError(res.data.error);
            session.setCard(null);
          } else if (res.data.finished) {
            session.setIsSessionFinished(true);
            session.setCard(null);
          } else {
            const newCard = res.data;
            session.addToHistory(newCard);
            prefetchMedia(newCard.image_url);
          }
        }
      }
    } catch (err) {
      console.error("fetchNextCard Error:", err);
      session.setApiError(err.response?.data?.detail || err.message);
    }
    setLoading(false);
  }, [setLoading, prefetchMedia]);

  const submitGrade = useCallback(async (grade) => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    
    if (!session.card || gradingRef.current || !currentDeck) return;
    gradingRef.current = true;

    session.setIsFlipped(false);
    setLoading(true);

    try {
      const gradedCardId = session.card.id;

      const endpoint = currentDeck.id === 'duplicates' ? '/study/duplicates/grade' : '/study/grade';
      const res = await api.post(endpoint, {
        card_id: gradedCardId,
        deck_id: currentDeck.id,
        grade,
        learn_more: session.isLearningMore
      });

      if (res.data.finished) {
        session.setIsSessionFinished(true);
        session.setCard(null);
      } else {
        const nextCard = res.data;
        session.addToHistory(nextCard);
        prefetchMedia(nextCard.image_url);
      }
    } catch (err) {
      console.error("SubmitGrade Error:", err);
      showToast(`Ошибка при сохранении оценки: ${err.response?.data?.detail || err.message}`);
    } finally {
      gradingRef.current = false;
      setLoading(false);
    }
  }, [setLoading, showToast, prefetchMedia]);

  const goBack = useCallback(async () => {
    const session = useSessionStore.getState();
    const { currentDeck, duplicateCards, deckCards } = useDeckStore.getState();

    if (session.historyIndex > 0) {
      session.goBack();
    } else if (currentDeck?.id === 'duplicates' && session.card) {
      const currentIndex = duplicateCards.findIndex(c => c.id === session.card.id);
      let prevDuplicateCard = null;
      if (currentIndex > 0) {
        prevDuplicateCard = duplicateCards[currentIndex - 1];
      } else if (duplicateCards.length > 0) {
        prevDuplicateCard = duplicateCards[duplicateCards.length - 1]; // Loop to the end
      }

      if (prevDuplicateCard) {
        setLoading(true);
        try {
          const res = await api.get(`/study/card/${prevDuplicateCard.id}`);
          const prevCard = res.data;
          const newHistory = [prevCard, ...session.studyHistory];
          session.setStudyHistory(newHistory);
          session.moveToHistory(0);
          prefetchMedia(prevCard.image_url);
        } catch (err) {
          console.error("goBack Error:", err);
        } finally {
          setLoading(false);
        }
      }
    } else if (currentDeck && session.card && deckCards && deckCards.length > 0) {
      const currentIndex = deckCards.findIndex(c => c.id === session.card.id);
      let prevCardInfo = null;
      if (currentIndex > 0) {
        prevCardInfo = deckCards[currentIndex - 1];
      } else {
        prevCardInfo = deckCards[deckCards.length - 1]; // Loop to the end
      }

      if (prevCardInfo) {
        setLoading(true);
        try {
          const res = await api.get(`/study/card/${prevCardInfo.id}`);
          const prevCard = res.data;
          const newHistory = [prevCard, ...session.studyHistory];
          session.setStudyHistory(newHistory);
          session.moveToHistory(0);
          prefetchMedia(prevCard.image_url);
        } catch (err) {
          console.error("goBack Error:", err);
        } finally {
          setLoading(false);
        }
      }
    }
  }, [setLoading, prefetchMedia]);

  const goNext = useCallback(async () => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    if (session.historyIndex < session.studyHistory.length - 1) {
      session.moveToHistory(session.historyIndex + 1);
    } else if (currentDeck) {
      const historyIds = session.studyHistory.map(c => c.id);
      await fetchNextCard(currentDeck.id, false, historyIds);
    }
  }, [fetchNextCard]);

  return {
    fetchNextCard,
    submitGrade,
    goBack,
    goNext,
    prefetchMedia
  };
};
