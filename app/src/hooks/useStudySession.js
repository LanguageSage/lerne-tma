import { useRef } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';

export const useStudySession = () => {
  const gradingRef = useRef(false);
  const { setLoading, showToast } = useUiStore();

  const prefetchMedia = (url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  };

  const fetchNextCard = async (deckId, isFirst = false, excludeIds = []) => {
    setLoading(true);
    const session = useSessionStore.getState();
    session.setApiError(null);
    try {
      const excludeParam = excludeIds.length > 0 ? `exclude_ids=${excludeIds.join(',')}` : '';
      const learnMoreParam = session.isLearningMore ? 'learn_more=true' : '';
      const params = [excludeParam, learnMoreParam].filter(Boolean).join('&');
      const queryString = params ? `?${params}` : '';
      const res = await api.get(`/decks/${deckId}/next${queryString}`);

      if (res.data.error) {
        session.setApiError(res.data.error);
        session.setCard(null);
      } else if (res.data.finished) {
        session.setCard(null);
      } else {
        const newCard = res.data;
        session.addToHistory(newCard);
        prefetchMedia(newCard.image_url);
      }
    } catch (err) {
      console.error("fetchNextCard Error:", err);
      session.setApiError(err.response?.data?.detail || err.message);
    }
    setLoading(false);
  };

  const submitGrade = async (grade, playAudio) => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    
    if (!session.card || gradingRef.current || !currentDeck) return;
    gradingRef.current = true;

    session.setIsFlipped(false);
    setLoading(true);

    try {
      const gradedCardId = session.card.id;
      const res = await api.post('/study/grade', {
        card_id: gradedCardId,
        deck_id: currentDeck.id,
        grade,
        learn_more: session.isLearningMore
      });

      if (res.data.finished) {
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
  };

  const goBack = () => {
    useSessionStore.getState().goBack();
  };

  const goNext = async () => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    if (session.historyIndex < session.studyHistory.length - 1) {
      session.moveToHistory(session.historyIndex + 1);
    } else if (currentDeck) {
      const historyIds = session.studyHistory.map(c => c.id);
      await fetchNextCard(currentDeck.id, false, historyIds);
    }
  };

  return {
    fetchNextCard,
    submitGrade,
    goBack,
    goNext,
    prefetchMedia
  };
};
