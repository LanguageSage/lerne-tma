import { create } from 'zustand';

export const useSessionStore = create((set, get) => ({
  card: null,
  studyHistory: [],
  historyIndex: -1,
  isFlipped: false,
  apiError: null,
  editingCard: null,
  editorSourceView: 'cards', // 'cards' | 'study'
  isLearningMore: false,
  autoplayState: 'stopped', // 'stopped' | 'playing' | 'paused'
  favoritesQueue: [],

  setIsLearningMore: (val) => set({ isLearningMore: val }),
  setAutoplayState: (autoplayState) => set({ autoplayState }),
  pauseAutoplay: () => set({ autoplayState: 'paused' }),
  stopAutoplay: () => set({ autoplayState: 'stopped' }),
  setFavoritesQueue: (favoritesQueue) => set({ favoritesQueue }),

  setCard: (updater) => set((state) => ({ 
    card: typeof updater === 'function' ? updater(state.card) : (updater ? { ...updater } : null) 
  })),
  setStudyHistory: (history) => set({ studyHistory: history }),
  setHistoryIndex: (index) => set({ historyIndex: index }),
  setIsFlipped: (isFlipped) => set({ isFlipped }),
  setApiError: (error) => set({ apiError: error }),
  setEditingCard: (updater) => set((state) => ({ 
    editingCard: typeof updater === 'function' ? updater(state.editingCard) : updater 
  })),
  setEditorSourceView: (source) => set({ editorSourceView: source }),

  addToHistory: (card) => {
    const { studyHistory, historyIndex } = get();
    const newCard = card ? { ...card } : null;
    set({
      studyHistory: [...studyHistory, newCard],
      historyIndex: historyIndex + 1,
      card: newCard,
      isFlipped: false
    });
  },

  moveToHistory: (index) => {
    const { studyHistory } = get();
    if (index >= 0 && index < studyHistory.length) {
      const cardFromHistory = studyHistory[index];
      set({
        historyIndex: index,
        card: cardFromHistory ? { ...cardFromHistory } : null,
        isFlipped: false
      });
    }
  },

  goBack: () => {
    const { historyIndex } = get();
    get().moveToHistory(historyIndex - 1);
  },

  removeCardFromSession: (cardId) => {
    const { studyHistory, favoritesQueue, card, historyIndex } = get();
    const newHistory = studyHistory.filter(c => c && c.id !== cardId);
    const newFavQueue = favoritesQueue.filter(c => c && c.id !== cardId);
    
    let nextIndex = historyIndex;
    let nextCard = card;
    
    if (card && card.id === cardId) {
      if (historyIndex < newHistory.length) {
        nextCard = newHistory[historyIndex];
      } else {
        nextCard = null;
        nextIndex = newHistory.length - 1;
      }
    } else {
      nextIndex = newHistory.findIndex(c => c && c.id === card?.id);
    }
    
    set({
      studyHistory: newHistory,
      favoritesQueue: newFavQueue,
      card: nextCard,
      historyIndex: nextIndex
    });
  },

  resetSession: () => {
    set({
      card: null,
      studyHistory: [],
      historyIndex: -1,
      isFlipped: false,
      apiError: null,
      isLearningMore: false,
      autoplayState: 'stopped',
      favoritesQueue: []
    });
  }
}
));
