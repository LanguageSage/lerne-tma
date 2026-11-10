import { tr } from '../i18n/locale';
import { useCallback, useEffect } from 'react';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useCardActions } from './useCardActions';
import { createAssessment, canResumeAssessment } from '../utils/assessment.js';
import { prepareAssessmentKnowledge, saveAssessment, loadAssessment } from '../services/assessmentService.js';
import { useAuthStore } from '../store/useAuthStore';
import { getUserId, getSessionIdentity } from '../utils/auth.js';
import { prepareDeckKnowledge } from '../services/knowledgeContentService.js';
import { prepareLocalDb } from '../services/localDb.js';
import { readFavoriteCards } from '../services/cardFavorites.js';

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
    const identity = getSessionIdentity();
    const userId = getUserId();
    setIsOpeningDeck(true);
    try {
      const currentView = useUiStore.getState().view;
      if (currentView !== 'study' && currentView !== 'trainer') {
        useUiStore.getState().setStudySourceView(currentView);
      }
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      const revision = useSessionStore.getState().sessionRevision;
      useSessionStore.getState().setIsLearningMore(deck.id === 'favorites' || reviewContext === 'forced');
      const state = useDeckStore.getState();
      const hasCards = state.currentDeck?.id === deck.id && state.deckCards && state.deckCards.length > 0;
      if (deck.id === 'favorites') {
        const cards = await readFavoriteCards(await prepareLocalDb(), userId, deck.target_language);
        if (identity !== getSessionIdentity() || userId !== getUserId() || useSessionStore.getState().sessionRevision !== revision) return;
        state.setDeckCards(cards);
      } else if (deck.id === 'duplicates') {
        await state.fetchDuplicates();
      } else if (!hasCards) {
        await state.fetchDeckCards(deck.id);
      }

      if (identity !== getSessionIdentity() || getUserId() !== userId || useSessionStore.getState().sessionRevision !== revision) return;
      setView('study');
      const assessment = createAssessment(deck, useDeckStore.getState().deckCards || [], getUserId());
      if (assessment) {
        await prepareAssessmentKnowledge(deck.id);
        const saved = await loadAssessment(assessment.userId, deck.id);
        const resume = canResumeAssessment(saved, assessment);
        // An unfinished card's in-memory help history did not survive leaving the view.
        const active = resume ? { ...saved, supportHistoryUnknownCardId: saved.cards[saved.index]?.id } : assessment;
        await saveAssessment(active);
        useSessionStore.getState().setAssessment(active);
        return;
      }
      const knowledgeDecks = deck.id === 'favorites'
        ? [...new Set(useDeckStore.getState().deckCards.map(card => card.deck_id))] : [deck.id];
      await Promise.all(knowledgeDecks.map(id => prepareDeckKnowledge(id).catch(err => console.warn('[Knowledge] Content unavailable:', err))));
      if (identity !== getSessionIdentity() || getUserId() !== userId || useSessionStore.getState().sessionRevision !== revision) return;
      await fetchNextCard(deck.id, true);
    } catch (err) {
      if (err.code === 'ERR_CANCELED') return;
      if (err.response?.status === 401) {
        useAuthStore.getState().deferNavigation({ deckId: deck.id, reviewContext });
      } else {
        useSessionStore.getState().setApiError(err.response?.data?.detail || err.message);
        setView('study');
      }
    } finally {
      setIsOpeningDeck(false);
    }
  }, [fetchNextCard, setCurrentDeck, setIsOpeningDeck, setView]);

  const startStudyCard = useCallback(async (deck, cardId) => {
    const identity = getSessionIdentity();
    const userId = getUserId();
    try {
      const currentView = useUiStore.getState().view;
      if (currentView !== 'study' && currentView !== 'trainer') {
        useUiStore.getState().setStudySourceView(currentView);
      }
      setCurrentDeck(deck);
      useSessionStore.getState().resetSession();
      const revision = useSessionStore.getState().sessionRevision;
      useSessionStore.getState().setIsLearningMore(deck.id === 'favorites');
      const sourceDeckId = deck.id === 'favorites'
        ? useDeckStore.getState().deckCards.find(card => String(card.id) === String(cardId))?.deck_id : deck.id;
      await prepareDeckKnowledge(sourceDeckId).catch(err => console.warn('[Knowledge] Content unavailable:', err));
      if (identity !== getSessionIdentity() || getUserId() !== userId || useSessionStore.getState().sessionRevision !== revision) return;
      
      const deckState = useDeckStore.getState();
      if (deck.id === 'favorites') {
        const favorites = await readFavoriteCards(await prepareLocalDb(), userId, deck.target_language);
        if (identity !== getSessionIdentity() || userId !== getUserId() || useSessionStore.getState().sessionRevision !== revision) return;
        deckState.setDeckCards(favorites);
      }
      let cards = deck.id === 'duplicates' ? (deckState.duplicateCards || []) : (useDeckStore.getState().deckCards || []);
      let localCard = cards.find(c => String(c.id) === String(cardId));

      // Fast path: card is already in memory -> instant transition (0ms delay)
      if (localCard) {
        if (deck.id === 'favorites') useSessionStore.getState().markForcedSeen(localCard.id);
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

      if (identity !== getSessionIdentity() || getUserId() !== userId || useSessionStore.getState().sessionRevision !== revision) return;
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
        const fetchRevision = useSessionStore.getState().sessionRevision;
        const res = await api.get(`/study/card/${cardId}`);
        if (identity !== getSessionIdentity() || getUserId() !== userId
          || useSessionStore.getState().sessionRevision !== fetchRevision
          || useDeckStore.getState().currentDeck?.id !== deck.id
          || useUiStore.getState().view !== 'study') return;
        if (res?.data) {
          useSessionStore.getState().addToHistory(res.data);
        }
      } catch (apiErr) {
        if (apiErr.code === 'ERR_CANCELED') return;
        if (apiErr.response?.status === 401) {
          useAuthStore.getState().deferNavigation({ deckId: deck.id, cardId });
          return;
        }
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
      if (err.code === 'ERR_CANCELED') return;
      if (err.response?.status === 401) {
        useAuthStore.getState().deferNavigation({ deckId: deck.id, cardId });
        return;
      }
      console.error("startStudyCard Error:", err);
      showToast(tr("Ошибка при открытии карточки"));
      setView('cards');
    } finally {
      setIsOpeningDeck(false);
    }
  }, [setCurrentDeck, setIsOpeningDeck, setView, showToast, refreshCard]);

  useEffect(() => {
    const resume = (state) => {
      if (state.status !== 'authenticated' || state.isPolling) return;
      const action = state.takePendingNavigation();
      if (!action) return;
      const deck = useDeckStore.getState().decks.find(item => String(item.id) === String(action.deckId));
      if (!deck) return; // Another account or a removed/inaccessible deck is never opened.
      if (action.view === 'deck_intro') {
        setCurrentDeck(deck);
        setView('deck_intro');
        useDeckStore.getState().fetchDeckCards(deck.id).catch(error => {
          if (error.response?.status === 401) state.deferNavigation(action);
          else if (error.code !== 'ERR_CANCELED') showToast(tr('Не удалось загрузить данные с сервера'));
        });
      } else if (action.cardId) startStudyCard(deck, action.cardId);
      else startStudy(deck, { reviewContext: action.reviewContext });
    };
    // Login fetches the library before incrementing its completion revision.
    return useAuthStore.subscribe((state, previous) => {
      if (state.sessionRevision !== previous.sessionRevision && state.status === 'authenticated') resume(state);
    });
  }, [startStudy, startStudyCard, setCurrentDeck, setView, showToast]);

  return {
    startStudy,
    startStudyCard
  };
}
