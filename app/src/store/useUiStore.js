import { create } from 'zustand';

export const useUiStore = create((set) => ({
  view: 'decks',
  setView: (view) => set({ view }),
  
  loading: false,
  setLoading: (loading) => set({ loading }),
  
  toast: null,
  showToast: (message, type = 'error') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 6000);
  },
  
  // Modals state
  isSettingsOpen: false,
  setIsSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  
  isNewDeckModalOpen: false,
  setIsNewDeckModalOpen: (isOpen) => set({ isNewDeckModalOpen: isOpen }),
  
  deckModalMode: 'choice',
  setDeckModalMode: (mode) => set({ deckModalMode: mode }),
  
  syncModalOpen: false,
  setSyncModalOpen: (isOpen) => set({ syncModalOpen: isOpen }),
  
  activeTutorial: null,
  setActiveTutorial: (tutorial) => set({ activeTutorial: tutorial }),
  
  isOpeningDeck: false,
  setIsOpeningDeck: (isOpening) => set({ isOpeningDeck: isOpening }),

  isCardActionModalOpen: false,
  setIsCardActionModalOpen: (isOpen) => set({ isCardActionModalOpen: isOpen }),
  
  actionCard: null,
  setActionCard: (card) => set({ actionCard: card }),

  editorSourceView: 'cards', // 'cards' | 'study' | 'decks'
  setEditorSourceView: (source) => set({ editorSourceView: source }),

  userProfile: null,
  setUserProfile: (profile) => set({ userProfile: profile }),
}));
