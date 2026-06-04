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
}));
