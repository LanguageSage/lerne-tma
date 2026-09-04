import { create } from 'zustand';

export const useUiStore = create((set) => ({
  view: 'decks',
  setView: (view) => set({ view }),
  
  loading: false,
  setLoading: (loading) => set({ loading }),
  
  hasInitialized: false,
  setHasInitialized: (hasInitialized) => set({ hasInitialized }),
  
  toast: null,
  showToast: (message, type = 'error') => {
    set({ toast: { message, type } });
    setTimeout(() => set({ toast: null }), 6000);
  },
  
  // Modals state
  isSettingsOpen: false,
  settingsTab: 'general',
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  openSettings: (tab = 'general') => set({ isSettingsOpen: true, settingsTab: tab }),
  setIsSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  
  isNewDeckModalOpen: false,
  setIsNewDeckModalOpen: (isOpen) => set({ isNewDeckModalOpen: isOpen }),
  
  isRenameModalOpen: false,
  setIsRenameModalOpen: (isOpen) => set({ isRenameModalOpen: isOpen }),
  deckToRename: null,
  setDeckToRename: (deck) => set({ deckToRename: deck }),

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

  lastSelectedCardId: null,
  setLastSelectedCardId: (id) => set({ lastSelectedCardId: id }),

  cardsScrollTop: 0,
  setCardsScrollTop: (top) => set({ cardsScrollTop: top }),

  userProfile: null,
  setUserProfile: (profile) => set({ userProfile: profile }),

  isAuthModalOpen: false,
  authModalTitle: 'Требуется авторизация',
  setIsAuthModalOpen: (isOpen, title = 'Требуется авторизация') => set({ isAuthModalOpen: isOpen, authModalTitle: title }),
  
  activeFolderId: null,
  setActiveFolderId: (id) => set({ activeFolderId: id }),

  isCollaboratorsModalOpen: false,
  setIsCollaboratorsModalOpen: (isOpen) => set({ isCollaboratorsModalOpen: isOpen }),
  collaboratorsTarget: null, // { type: 'folder'|'deck', id: number, name: string }
  setCollaboratorsTarget: (target) => set({ collaboratorsTarget: target }),

  isBatchModalOpen: false,
  setIsBatchModalOpen: (isOpen) => set({ isBatchModalOpen: isOpen }),

  importShareId: null,
  setImportShareId: (shareId) => set({ importShareId: shareId }),
  clearImportShareId: () => set({ importShareId: null }),
}));

