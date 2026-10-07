import { tr } from '../i18n/locale';
import { captureStudyKnowledgeAttempt } from '../services/knowledgeCaptureService.js';
import { getUserId } from '../utils/auth.js';
import { useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';

const reviewKey = session => `${session.sessionRevision}:${session.historyIndex}:${session.card?.id}`;
// Opening a card and studying it use separate hook instances.
const refreshRequests = new Map();

// Remember invalidation even when the user leaves and returns to the same deck/card.
const watchRequest = (trackNavigation = false, onInvalidate = () => {}) => {
  const initial = useSessionStore.getState();
  const deckId = useDeckStore.getState().currentDeck?.id;
  const view = useUiStore.getState().view;
  const userId = getUserId();
  let valid = true;
  const isCurrent = () => valid && getUserId() === userId;
  const check = () => {
    const latest = useSessionStore.getState();
    if (valid && (latest.sessionRevision !== initial.sessionRevision
      || useDeckStore.getState().currentDeck?.id !== deckId || useUiStore.getState().view !== view
      || (trackNavigation && reviewKey(latest) !== reviewKey(initial)))) {
      valid = false;
      onInvalidate();
    }
  };
  const unsubscribe = [useSessionStore.subscribe(check), useDeckStore.subscribe(check), useUiStore.subscribe(check)];
  return { isCurrent, dispose: () => unsubscribe.forEach(stop => stop()) };
};

export const useStudySession = () => {
  const renderedReviewKey = useSessionStore(reviewKey);
  const { setLoading, showToast } = useUiStore();

  const prefetchMedia = useCallback((url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  }, []);

  const refreshCard = useCallback((card) => {
    const session = useSessionStore.getState();
    const gradeRevision = session.gradeRevision;
    const requestKey = `${getUserId()}:${card.id}`;
    if (session.pendingGrades[requestKey]) return;
    const scope = watchRequest();
    const requestToken = {};
    refreshRequests.set(requestKey, requestToken);
    api.get(`/study/card/${card.id}`).then(({ data }) => {
      const latest = useSessionStore.getState();
      // A reset, newer refresh, or grade invalidates this snapshot. Never navigate on refresh.
      if (!data?.id || String(data.id) !== String(card.id) || !scope.isCurrent()
        || latest.gradeRevision !== gradeRevision
        || refreshRequests.get(requestKey) !== requestToken) return;
      const current = latest.studyHistory.find(item => String(item.id) === String(card.id));
      if (!current) return;
      const patch = { ...data };
      // Client TTS can finish while the GET is in flight; preserve its newer result.
      for (const field of ['audio_path', 'audio_url', 'audio_back_path', 'audio_back_url', 'audio_is_generating']) {
        if (current[field] !== card[field]) delete patch[field];
      }
      latest.updateCardInSession(card.id, patch);
      useDeckStore.getState().updateCardLocal(card.id, patch);
    }).catch(err => console.warn('Background study card refresh:', err)).finally(() => {
      scope.dispose();
      if (refreshRequests.get(requestKey) === requestToken) refreshRequests.delete(requestKey);
    });
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
          const scope = watchRequest(true, () => setLoading(false));
          setLoading(true);
          let res;
          try {
            res = await api.get(endpoint);
            if (!scope.isCurrent()) return;
          } catch (err) {
            if (scope.isCurrent()) session.setApiError(err.response?.data?.detail || err.message);
            return;
          } finally {
            if (scope.isCurrent()) setLoading(false);
            scope.dispose();
          }

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
    const { currentDeck, deckCards, duplicateCards } = useDeckStore.getState();
    if (!session.card || !currentDeck || reviewKey(session) !== renderedReviewKey) return;

    const userId = getUserId();
    const card = { ...session.card };
    const key = `${userId}:${card.id}`;
    let complete;
    const request = { card, userId, deckId: currentDeck.id, done: new Promise(resolve => { complete = resolve; }) };
    // Synchronous store lock protects against other hook instances and revisiting a pending card.
    if (!session.startGrade(key, request)) return;
    const previousGrades = Object.values(session.pendingGrades)
      .filter(item => item.userId === userId && item.deckId === currentDeck.id).map(item => item.done);
    const nextHistoryIndex = session.historyIndex + 1;
    let localNext = session.studyHistory[nextHistoryIndex];
    if (!localNext && !session.isLearningMore) {
      const cards = currentDeck.id === 'duplicates' ? duplicateCards : deckCards;
      const index = cards.findIndex(item => String(item.id) === String(card.id));
      if (index >= 0) localNext = cards[index + 1];
    }
    const eventTime = new Date().toISOString();
    const payload = {
      card_id: card.id, deck_id: currentDeck.id, grade, is_extended: Boolean(isExtended),
      review_context: session.isLearningMore ? 'forced' : 'scheduled',
      exclude_ids: session.isLearningMore ? [...session.forcedSeenIds] : [],
      return_next: !localNext
    };
    // Background success may patch progress, but must never navigate after a local transition.
    const scope = watchRequest(!localNext);
    if (localNext) {
      if (nextHistoryIndex < session.studyHistory.length) {
        session.moveToHistory(nextHistoryIndex);
        if (!session.isLearningMore) refreshCard(localNext);
      } else {
        showLocalCard(localNext);
      }
    }

    let failure = null;
    try {
      // At the end of the cache, let earlier writes settle before asking SRS for its choice.
      if (!localNext) await Promise.all(previousGrades);
      if (getUserId() !== userId) throw new Error(tr('Пользователь изменился до отправки оценки'));
      const endpoint = currentDeck.id === 'duplicates' ? '/study/duplicates/grade' : '/study/grade';
      const res = await api.post(endpoint, payload);
      if (res.data.error) throw new Error(res.data.error);
      if (getUserId() === userId) captureStudyKnowledgeAttempt({ userId, card, grade, isExtended: Boolean(isExtended), eventTime, exerciseEvidence });

      if (!localNext && scope.isCurrent()) {
        if (res.data.finished) {
          session.setIsSessionFinished(true);
          session.setCard(null);
        } else {
          if (!res.data.id) throw new Error(tr('Не удалось загрузить данные с сервера'));
          if (session.isLearningMore) session.markForcedSeen(res.data.id);
          session.addToHistory(res.data);
          prefetchMedia(res.data.image_url);
        }
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      failure = { card, grade, isExtended, exerciseEvidence, message: typeof detail === 'string' ? detail : JSON.stringify(detail) };
      if (useUiStore.getState().view !== 'study' && getUserId() === userId) {
        showToast(tr('Оценка карточки №{{p0}} не подтверждена: {{p1}}. Проверьте прогресс перед повторной оценкой.', { p0: card.id, p1: failure.message }));
      }
    } finally {
      session.finishGrade(key, request, failure);
      complete();
      // Refresh the graded card after the commit; never copy the grade response over currentCard.
      if (scope.isCurrent() && !session.isLearningMore) refreshCard(card);
      scope.dispose();
    }
  }, [renderedReviewKey, showToast, prefetchMedia, refreshCard, showLocalCard]);

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
    refreshCard,
    prefetchMedia
  };
};


