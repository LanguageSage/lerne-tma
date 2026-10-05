import { tr } from '../i18n/locale';
import { captureStudyKnowledgeAttempt } from '../services/knowledgeCaptureService.js';
import { getUserId } from '../utils/auth.js';
import { useRef, useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';

export const useStudySession = () => {
  const gradingRef = useRef(false);
  const refreshEpochRef = useRef(0);
  const refreshRequestsRef = useRef(new Map());
  const { setLoading, showToast } = useUiStore();

  const prefetchMedia = useCallback((url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  }, []);

  const refreshCard = useCallback((card) => {
    const session = useSessionStore.getState();
    const sessionRevision = session.sessionRevision;
    const requestKey = String(card.id);
    const requestToken = {};
    refreshRequestsRef.current.set(requestKey, requestToken);
    const epoch = refreshEpochRef.current;
    api.get(`/study/card/${card.id}`).then(({ data }) => {
      const latest = useSessionStore.getState();
      // A reset, newer refresh, or grade invalidates this snapshot. Never navigate on refresh.
      if (!data?.id || String(data.id) !== String(card.id) || epoch !== refreshEpochRef.current
        || latest.sessionRevision !== sessionRevision
        || refreshRequestsRef.current.get(requestKey) !== requestToken) return;
      const current = latest.studyHistory.find(item => String(item.id) === String(card.id));
      if (!current) return;
      const patch = { ...data };
      // Client TTS can finish while the GET is in flight; preserve its newer result.
      for (const field of ['audio_path', 'audio_url', 'audio_back_path', 'audio_back_url', 'audio_is_generating']) {
        if (current[field] !== card[field]) delete patch[field];
      }
      latest.updateCardInSession(card.id, patch);
      useDeckStore.getState().updateCardLocal(card.id, patch);
    }).catch(err => console.warn('Background study card refresh:', err));
  }, []);

  const showLocalCard = useCallback((card, prepend = false) => {
    const session = useSessionStore.getState();
    if (prepend) {
      session.setStudyHistory([card, ...session.studyHistory]);
      session.moveToHistory(0);
    } else {
      session.addToHistory(card);
    }
    prefetchMedia(card.image_url);
    refreshCard(card);
  }, [prefetchMedia, refreshCard]);

  const fetchNextCard = useCallback(async (deckId, isFirst = false, excludeIds = []) => {
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
          showLocalCard(nextDuplicateCard);
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
          showLocalCard(nextCardInfo);
        } else if (!isFirst && !session.isLearningMore && currentCard) {
          // Reached end of sequential deckCards traversal! End session cleanly to show summary screen
          session.setIsSessionFinished(true);
          session.setCard(null);
        } else {
          // Fetch from SRS when starting session (isFirst), or in learn_more mode (early review by next_review asc)
          const effectiveExclude = session.isLearningMore ? session.forcedSeenIds : excludeIds;
          const excludeParam = effectiveExclude.length > 0 ? `exclude_ids=${effectiveExclude.join(',')}` : '';
          const learnMoreParam = session.isLearningMore ? 'review_context=forced' : '';
          const params = [excludeParam, learnMoreParam].filter(Boolean).join('&');
          const queryString = params ? `?${params}` : '';
          const endpoint = `/decks/${deckId}/next${queryString}`;
          setLoading(true);
          const res = await api.get(endpoint);

          if (res.data.error) {
            session.setApiError(res.data.error);
            session.setCard(null);
          } else if (res.data.finished) {
            session.setIsSessionFinished(true);
            session.setCard(null);
          } else {
            const newCard = res.data;
            if (session.isLearningMore) session.markForcedSeen(newCard.id);
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
  }, [setLoading, prefetchMedia, showLocalCard]);

  const submitGrade = useCallback(async (grade, isExtended = false, exerciseEvidence = null) => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    
    if (!session.card || gradingRef.current || !currentDeck) return;
    gradingRef.current = true;
    refreshEpochRef.current += 1;

    session.setIsFlipped(false);
    setLoading(true);

    try {
      const gradedCardId = session.card.id;

      const endpoint = currentDeck.id === 'duplicates' ? '/study/duplicates/grade' : '/study/grade';
      const res = await api.post(endpoint, {
        card_id: gradedCardId,
        deck_id: currentDeck.id,
        grade,
        is_extended: Boolean(isExtended),
        review_context: session.isLearningMore ? 'forced' : 'scheduled',
        exclude_ids: session.isLearningMore ? session.forcedSeenIds : []
      });

        captureStudyKnowledgeAttempt({
            userId: getUserId(),
            card: session.card,
            grade,
            isExtended: Boolean(isExtended),
            eventTime: new Date().toISOString(),
            exerciseEvidence
        });

      if (res.data.error) {
        session.setApiError(res.data.error);
        return;
      }
      if (res.data.finished) {
        session.setIsSessionFinished(true);
        session.setCard(null);
      } else {
        const nextCard = res.data;
        if (session.isLearningMore) session.markForcedSeen(nextCard.id);
        session.addToHistory(nextCard);
        prefetchMedia(nextCard.image_url);
      }
    } catch (err) {
      console.error("SubmitGrade Error:", err);
      showToast(tr("Ошибка при сохранении оценки: {{p0}}", { p0: err.response?.data?.detail || err.message }));
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
      if (!session.isLearningMore) refreshCard(useSessionStore.getState().card);
    } else if (session.isLearningMore) {
      // A forced pass only navigates its own history; do not wrap to unseen cards.
      return;
    } else if (currentDeck?.id === 'duplicates' && session.card) {
      const currentIndex = duplicateCards.findIndex(c => c.id === session.card.id);
      let prevDuplicateCard = null;
      if (currentIndex > 0) {
        prevDuplicateCard = duplicateCards[currentIndex - 1];
      } else if (duplicateCards.length > 0) {
        prevDuplicateCard = duplicateCards[duplicateCards.length - 1]; // Loop to the end
      }

      if (prevDuplicateCard) {
        showLocalCard(prevDuplicateCard, true);
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
        showLocalCard(prevCardInfo, true);
      }
    }
  }, [showLocalCard, refreshCard]);

  const goNext = useCallback(async () => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    if (session.historyIndex < session.studyHistory.length - 1) {
      session.moveToHistory(session.historyIndex + 1);
      if (!session.isLearningMore) refreshCard(useSessionStore.getState().card);
    } else if (currentDeck) {
      const historyIds = session.studyHistory.map(c => c.id);
      await fetchNextCard(currentDeck.id, false, historyIds);
    }
  }, [fetchNextCard, refreshCard]);

  return {
    fetchNextCard,
    submitGrade,
    goBack,
    goNext,
    prefetchMedia
  };
};


