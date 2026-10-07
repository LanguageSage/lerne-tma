import { tr } from '../i18n/locale';
import { useCallback } from 'react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from './useCardActions';

/**
 * Hook for initiating study sessions from deck grids, card lists, and search results.
 */
export function useStudyNavigation() {
  const setView = useUiStore(state => state.setView);
  const setIsOpeningDeck = useUiStore(state => state.setIsOpeningDeck);
  const showToast = useUiStore(state => state.showToast);
  const setCurrentDeck = useDeckStore(state => state.setCurrentDeck);
  const { fetchNextCard, refreshCard } = useCardActions();

  const startStudy = useCallback(async (deck, { reviewContext = 'scheduled' } = {}) => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      useSessionStore.getState().setIsLearningMore(reviewContext === 'forced');
      const state = useDeckStore.getState();
      const hasCards = state.currentDeck?.id === deck.id && state.deckCards && state.deckCards.length > 0;
      if (deck.id === 'duplicates') {
        await state.fetchDuplicates();
      } else if (!hasCards) {
        await state.fetchDeckCards(deck.id);
      }

      setView('study');
      await fetchNextCard(deck.id, true);
    } catch (err) {
      useSessionStore.getState().setApiError(err.response?.data?.detail || err.message);
      setView('study');
    } finally {
      setIsOpeningDeck(false);
    }
  }, [fetchNextCard, setCurrentDeck, setIsOpeningDeck, setView]);

  const startStudyCard = useCallback(async (deck, cardId) => {
    try {
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      
      const deckState = useDeckStore.getState();
      let cards = deck.id === 'duplicates' ? (deckState.duplicateCards || []) : (deckState.deckCards || []);
      let localCard = cards.find(c => String(c.id) === String(cardId));

      // Fast path: card is already in memory -> instant transition (0ms delay)
      if (localCard) {
        if (!localCard.image_url && (localCard.image_path || localCard.media_url)) {
          const raw = localCard.image_path || localCard.media_url;
          const cleanPath = raw.replace(/^(images|audio|videos)\//, '').replace(/^\/lid_images\//, '');
          localCard = { ...localCard, image_url: `/api/media/images/${cleanPath}` };
        }
        useSessionStore.getState().addToHistory(localCard);
        setView('study');
        setIsOpeningDeck(false);

        // Fetch fresh card details/intervals in background without blocking UI
        refreshCard(localCard);
        return;
      }

      // Fallback: card not in memory, fetch with loader
      setIsOpeningDeck(true);
      if (deck.id === 'duplicates') {
        await useDeckStore.getState().fetchDuplicates();
        cards = useDeckStore.getState().duplicateCards || [];
      } else {
        await useDeckStore.getState().fetchDeckCards(deck.id);
        cards = useDeckStore.getState().deckCards || [];
      }

      localCard = cards.find(c => String(c.id) === String(cardId));
      if (localCard) {
        if (!localCard.image_url && (localCard.image_path || localCard.media_url)) {
          const raw = localCard.image_path || localCard.media_url;
          const cleanPath = raw.replace(/^(images|audio|videos)\//, '').replace(/^\/lid_images\//, '');
          localCard = { ...localCard, image_url: `/api/media/images/${cleanPath}` };
        }
        useSessionStore.getState().addToHistory(localCard);
      }

      setView('study');

      if (localCard) {
        refreshCard(localCard);
        return;
      }

      try {
        const revision = useSessionStore.getState().sessionRevision;
        const res = await api.get(`/study/card/${cardId}`);
        if (useSessionStore.getState().sessionRevision !== revision || useDeckStore.getState().currentDeck?.id !== deck.id
          || useUiStore.getState().view !== 'study') return;
        if (res?.data) {
          useSessionStore.getState().addToHistory(res.data);
        }
      } catch (apiErr) {
        console.warn("api.get study card failed in startStudyCard:", apiErr);
        if (!localCard) {
          if (apiErr?.response?.status === 404) {
            const { deckCards } = useDeckStore.getState();
            useDeckStore.setState({ deckCards: (deckCards || []).filter(c => String(c.id) !== String(cardId)) });
            showToast(tr("Карточка была удалена"));
            setView('cards');
          } else {
            showToast(tr("Не удалось загрузить данные с сервера"));
          }
        }
      }
    } catch (err) {
      console.error("startStudyCard Error:", err);
      showToast(tr("Ошибка при открытии карточки"));
      setView('cards');
    } finally {
      setIsOpeningDeck(false);
    }
  }, [setCurrentDeck, setIsOpeningDeck, setView, showToast, refreshCard]);

  return {
    startStudy,
    startStudyCard
  };
}
