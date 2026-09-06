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
  const { fetchNextCard } = useCardActions();

  const startStudy = useCallback(async (deck) => {
    setIsOpeningDeck(true);
    try {
      if (deck && deck.id !== 'duplicates' && !deck.is_learning) {
        useDeckStore.getState().toggleDeckLearning(deck.id, true).catch(err => {
          console.warn('Auto-mark deck learning failed:', err);
        });
      }
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      const state = useDeckStore.getState();
      const hasCards = state.currentDeck?.id === deck.id && state.deckCards && state.deckCards.length > 0;
      if (deck.id === 'duplicates') {
        await state.fetchDuplicates();
      } else if (!hasCards) {
        await state.fetchDeckCards(deck.id);
      }

      setView('study');
      await fetchNextCard(deck.id, true);
    } finally {
      setIsOpeningDeck(false);
    }
  }, [fetchNextCard, setCurrentDeck, setIsOpeningDeck, setView]);

  const startStudyCard = useCallback(async (deck, cardId) => {
    try {
      if (deck && deck.id !== 'duplicates' && !deck.is_learning) {
        useDeckStore.getState().toggleDeckLearning(deck.id, true).catch(err => {
          console.warn('Auto-mark deck learning failed:', err);
        });
      }
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      
      const deckState = useDeckStore.getState();
      let cards = deck.id === 'duplicates' ? (deckState.duplicateCards || []) : (deckState.deckCards || []);
      let localCard = cards.find(c => String(c.id) === String(cardId));

      // Fast path: card is already in memory -> instant transition (0ms delay)
      if (localCard) {
        useSessionStore.getState().addToHistory(localCard);
        setView('study');
        setIsOpeningDeck(false);

        // Fetch fresh card details/intervals in background without blocking UI
        api.get(`/study/card/${cardId}`).then((res) => {
          if (res?.data) {
            useSessionStore.getState().setCard(res.data);
            const history = useSessionStore.getState().studyHistory;
            if (history.length > 0) {
              const updatedHistory = [...history];
              updatedHistory[history.length - 1] = res.data;
              useSessionStore.getState().setStudyHistory(updatedHistory);
            }
          }
        }).catch((err) => {
          console.warn("Background study card refresh:", err);
        });
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
        useSessionStore.getState().addToHistory(localCard);
      }

      setView('study');

      try {
        const res = await api.get(`/study/card/${cardId}`);
        if (res?.data) {
          if (localCard) {
            useSessionStore.getState().setCard(res.data);
            const history = useSessionStore.getState().studyHistory;
            if (history.length > 0) {
              const updatedHistory = [...history];
              updatedHistory[history.length - 1] = res.data;
              useSessionStore.getState().setStudyHistory(updatedHistory);
            }
          } else {
            useSessionStore.getState().addToHistory(res.data);
          }
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
  }, [setCurrentDeck, setIsOpeningDeck, setView, showToast]);

  return {
    startStudy,
    startStudyCard
  };
}
