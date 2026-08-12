import { create } from 'zustand';
import api from '../services/api';
import { getPublicShareUrl, executeShare } from '../utils/share';
import { storage } from '../utils/auth';

let reorderTimeout = null;
let cardReorderTimeout = null;
let pendingFetchCardsPromise = null;
let pendingFetchCardsDeckId = null;

export const useDeckStore = create((set, get) => ({
  decks: [],
  folders: [],
  libraryCategories: [],
  currentDeck: null,
  externalDecks: [],
  communityDecks: [],
  deckCards: [],
  duplicateCards: [],
  lastDuplicateCardId: null,
  syncModalOpen: false,
  deckToSync: null,
  trashItems: { decks: [], cards: [] },
  cardsLoading: false,

  
  setDecks: (decks) => set({ decks }),
  setFolders: (folders) => set({ folders }),
  setLibraryCategories: (categories) => set({ libraryCategories: categories }),
  setCurrentDeck: (deck) => {
    const prevDeck = get().currentDeck;
    if (deck?.id) {
      storage.set('lerne_current_deck_id', String(deck.id));
    }
    if (!prevDeck || prevDeck.id !== deck?.id) {
      set({ currentDeck: deck, cardsLoading: true });
    } else {
      set({ currentDeck: deck });
    }
  },
  setExternalDecks: (decks) => set({ externalDecks: decks }),
  setCommunityDecks: (decks) => set({ communityDecks: decks }),
  setDeckCards: (cards) => set({ deckCards: cards }),
  setDuplicateCards: (cards) => set({ duplicateCards: cards }),
  setLastDuplicateCardId: (id) => set({ lastDuplicateCardId: id }),
  setSyncModalOpen: (isOpen) => set({ syncModalOpen: isOpen }),
  setDeckToSync: (deck) => set({ deckToSync: deck }),
  setTrashItems: (items) => set({ trashItems: items }),

  fetchTrash: async () => {
    try {
      const res = await api.get('/trash');
      set({ trashItems: res.data });
    } catch (err) {
      console.error('Fetch Trash Error:', err);
    }
  },

  restoreTrashDeck: async (deckId) => {
    try {
      await api.post(`/trash/deck/${deckId}/restore`);
      const { fetchTrash, fetchDecks } = get();
      await fetchTrash();
      await fetchDecks(true);
    } catch (err) {
      console.error('Restore Trash Deck Error:', err);
      throw err;
    }
  },

  restoreTrashCard: async (cardId) => {
    try {
      await api.post(`/trash/card/${cardId}/restore`);
      const { fetchTrash, fetchDecks } = get();
      await fetchTrash();
      await fetchDecks(true);
    } catch (err) {
      console.error('Restore Trash Card Error:', err);
      throw err;
    }
  },

  clearTrash: async () => {
    try {
      await api.delete('/trash/clear');
      set({ trashItems: { decks: [], cards: [] } });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Clear Trash Error:', err);
      throw err;
    }
  },

  fetchDuplicates: async () => {
    try {
      const res = await api.get('/cards/duplicates');
      set({ duplicateCards: res.data });
    } catch (err) {
      console.error('Fetch Duplicates Error:', err);
    }
  },

  fetchDecks: async (force = false, attempts = 3) => {
    const { decks } = get();
    if (!force && decks.length > 0) return;
    
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await api.get('/decks');
        const newDecks = res.data || [];
        const state = get();
        const updatedCurrentDeck = state.currentDeck 
          ? newDecks.find(d => d.id === state.currentDeck.id) || state.currentDeck 
          : null;
        set({ decks: newDecks, currentDeck: updatedCurrentDeck });
        if (force) {
          get().fetchFolders();
        }
        return;
      } catch (err) {
        lastError = err;
        if (attempt < attempts) {
          await new Promise(r => setTimeout(r, 400 * attempt));
        }
      }
    }
    console.error('Fetch Decks Error:', lastError);
    throw lastError;
  },

  fetchDeckCards: async (deckId, attempts = 3, forceLoading = false) => {
    if (pendingFetchCardsDeckId === deckId && pendingFetchCardsPromise) {
      return pendingFetchCardsPromise;
    }

    const state = get();
    const isSameDeck = state.currentDeck?.id === deckId;
    const hasCards = state.deckCards && state.deckCards.length > 0;
    
    if (forceLoading || !isSameDeck || !hasCards) {
      set({ cardsLoading: true });
    }

    const fetchPromise = (async () => {
      try {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const endpoint = `/decks/${deckId}/cards`;
            const res = await api.get(endpoint);
            set({ deckCards: res.data });
            return res.data;
          } catch (err) {
            lastError = err;
            if (attempt < attempts) {
              await new Promise(r => setTimeout(r, 150 * attempt));
            }
          }
        }
        console.error('Fetch Deck Cards Error after retries:', lastError);
        throw lastError;
      } finally {
        if (pendingFetchCardsDeckId === deckId) {
          pendingFetchCardsPromise = null;
          pendingFetchCardsDeckId = null;
        }
        set({ cardsLoading: false });
      }
    })();

    pendingFetchCardsPromise = fetchPromise;
    pendingFetchCardsDeckId = deckId;

    return fetchPromise;
  },

  handleDeleteDeck: async (deckId) => {
    try {
      await api.delete(`/decks/${deckId}`);
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Delete Deck Error:', err);
      throw err;
    }
  },

  handleSyncDeck: async (deckId, mode = 'merge') => {
    try {
      await api.post(`/decks/${deckId}/sync`, { mode });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Sync Deck Error:', err);
      throw err;
    }
  },

  handleResetProgress: async (deckId) => {
    try {
      await api.post(`/decks/${deckId}/reset`);
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Reset Progress Error:', err);
      throw err;
    }
  },

  createDeck: async (name, folderId = null, targetLang = null, deckType = 'standard') => {
    try {
      const { useLanguageStore } = await import('./useLanguageStore');
      const targetLanguage = targetLang || useLanguageStore.getState().activeLanguage || 'de';
      await api.post('/decks', { name, folder_id: folderId, target_language: targetLanguage, deck_type: deckType });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Create Deck Error:', err);
      throw err;
    }
  },

  renameDeck: async (deckId, newName) => {
    try {
      await api.post(`/decks/${deckId}/rename`, { name: newName });
      const { fetchDecks, currentDeck } = get();
      await fetchDecks(true);
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, name: newName } });
      }
    } catch (err) {
      console.error('Rename Deck Error:', err);
      throw err;
    }
  },
  
  updateDeckMetadata: async (deckId, metadata) => {
    try {
      const res = await api.post(`/decks/${deckId}/metadata`, metadata);
      const { fetchDecks, currentDeck, decks } = get();
      const updatedMeta = res.data.metadata;
      const updatedDecks = (decks || []).map(d => d.id === deckId ? { ...d, metadata: updatedMeta } : d);
      set({ decks: updatedDecks });
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, metadata: updatedMeta } });
      }
      storage.remove('lerne_init_cache');
      await fetchDecks(true);
      return updatedMeta;
    } catch (err) {
      console.error('Update Deck Metadata Error:', err);
      throw err;
    }
  },


  fetchExternalDecks: async () => {
    try {
      const { useLanguageStore } = await import('./useLanguageStore');
      const activeLang = useLanguageStore.getState().activeLanguage || 'de';
      const res = await api.get(`/decks/external?target_language=${activeLang}`);
      set({ externalDecks: res.data });
    } catch (err) {
      console.error('Fetch External Decks Error:', err);
      throw err;
    }
  },

  importDeck: async (deckId) => {
    try {
      await api.post(`/decks/external/import/${deckId}`);
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Import Deck Error:', err);
      throw err;
    }
  },

  toggleDefaultDeck: async (deckId) => {
    try {
      const res = await api.post(`/decks/external/${deckId}/toggle-default`);
      if (res.data.status === 'success') {
        const { externalDecks } = get();
        const updated = externalDecks.map(d =>
          d.id === deckId ? { ...d, is_default: res.data.is_default } : d
        );
        set({ externalDecks: updated });
      }
    } catch (err) {
      console.error('Toggle Default Deck Error:', err);
      throw err;
    }
  },

  handleFileUpload: async (event, callback) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/decks/import-json', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const { fetchDecks } = get();
      await fetchDecks(true);
      if (callback) callback();
    } catch (err) {
      console.error('Upload JSON Error:', err);
      throw err;
    }
  },

  handleShareDeck: async (deckId) => {
    try {
      const res = await api.post(`/share/generate/deck/${deckId}`);
      if (res.data.status === 'ok') {
        const link = getPublicShareUrl(res.data.share_id);
        return await executeShare({
          title: 'Колода Lerne',
          text: 'Посмотри эту колоду в Lerne!',
          link
        });
      }
      return { success: false };
    } catch (err) {
      console.error('Share Deck Error:', err);
      throw err;
    }
  },

  handleShareFolder: async (folderId) => {
    try {
      const res = await api.post(`/share/generate/folder/${folderId}`);
      if (res.data.status === 'ok') {
        const link = getPublicShareUrl(res.data.share_id);
        return await executeShare({
          title: 'Папка Lerne',
          text: 'Посмотри эту папку с колодами в Lerne!',
          link
        });
      }
      return { success: false };
    } catch (err) {
      console.error('Share Folder Error:', err);
      throw err;
    }
  },

  fetchCollaborators: async (targetType, targetId) => {
    try {
      const res = await api.get(`/collaborative/${targetType}/${targetId}/collaborators`);
      return res.data;
    } catch (err) {
      console.error('Fetch Collaborators Error:', err);
      throw err;
    }
  },

  addCollaborator: async (targetType, targetId, userIdentifier, role = 'viewer') => {
    try {
      const res = await api.post(`/collaborative/${targetType}/${targetId}/add`, {
        user_identifier: userIdentifier,
        role
      });
      return res.data;
    } catch (err) {
      console.error('Add Collaborator Error:', err);
      throw err;
    }
  },

  updateCollaboratorRole: async (targetType, targetId, collaboratorUserId, role) => {
    try {
      const res = await api.put(`/collaborative/${targetType}/${targetId}/role`, {
        user_id_to_update: collaboratorUserId,
        role
      });
      return res.data;
    } catch (err) {
      console.error('Update Collaborator Role Error:', err);
      throw err;
    }
  },

  removeCollaborator: async (targetType, targetId, collaboratorUserId) => {
    try {
      const res = await api.delete(`/collaborative/${targetType}/${targetId}/remove/${collaboratorUserId}`);
      return res.data;
    } catch (err) {
      console.error('Remove Collaborator Error:', err);
      throw err;
    }
  },

  removeAllCollaborators: async (targetType, targetId) => {
    try {
      const res = await api.delete(`/collaborative/${targetType}/${targetId}/remove-all`);
      await get().fetchDecks(true);
      await get().fetchFolders();
      return res.data;
    } catch (err) {
      console.error('Remove All Collaborators Error:', err);
      throw err;
    }
  },


  fetchGroupProgress: async (folderId) => {
    try {
      const res = await api.get(`/collaborative/folder/${folderId}/group-progress`);
      return res.data;
    } catch (err) {
      console.error('Fetch Group Progress Error:', err);
      throw err;
    }
  },

  joinCollaborativeItem: async (shareId) => {
    try {
      const res = await api.post(`/collaborative/join/${shareId}`);
      await get().fetchDecks(true);
      await get().fetchFolders();
      return res.data;
    } catch (err) {
      console.error('Join Collaborative Item Error:', err);
      throw err;
    }
  },


  fetchFolders: async () => {
    try {
      const res = await api.get('/folders');
      const folders = res.data;
      const storedOrderStr = localStorage.getItem('lerne_folder_order');
      if (storedOrderStr) {
        const storedOrder = JSON.parse(storedOrderStr);
        folders.sort((a, b) => {
          const idxA = storedOrder.indexOf(a.id);
          const idxB = storedOrder.indexOf(b.id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.id - b.id;
        });
      }
      set({ folders });
    } catch (err) {
      console.error('Fetch Folders Error:', err);
    }
  },

  createFolder: async (name, parentId = null, color = null, targetLang = null) => {
    try {
      const { useLanguageStore } = await import('./useLanguageStore');
      const targetLanguage = targetLang || useLanguageStore.getState().activeLanguage || 'de';
      await api.post('/folders', { name, parent_id: parentId, color, target_language: targetLanguage });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Create Folder Error:', err);
      throw err;
    }
  },

  renameFolder: async (folderId, newName) => {
    try {
      await api.post(`/folders/${folderId}/rename`, { name: newName });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Rename Folder Error:', err);
      throw err;
    }
  },

  changeFolderColor: async (folderId, color) => {
    try {
      await api.post(`/folders/${folderId}/color`, { color });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Change Folder Color Error:', err);
      throw err;
    }
  },

  moveFolder: async (folderId, parentId) => {
    try {
      await api.post(`/folders/${folderId}/move`, { parent_id: parentId });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Move Folder Error:', err);
      throw err;
    }
  },

  deleteFolder: async (folderId) => {
    try {
      await api.delete(`/folders/${folderId}`);
      const { fetchFolders, fetchDecks } = get();
      await fetchFolders();
      await fetchDecks(true);
    } catch (err) {
      console.error('Delete Folder Error:', err);
      throw err;
    }
  },

  moveDeckToFolder: async (deckId, folderId) => {
    try {
      await api.post(`/decks/${deckId}/move`, { folder_id: folderId });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Move Deck to Folder Error:', err);
      throw err;
    }
  },

  copyDeckToFolder: async (deckId, folderId) => {
    try {
      await api.post(`/decks/${deckId}/copy`, { folder_id: folderId });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Copy Deck to Folder Error:', err);
      throw err;
    }
  },

  togglePinDeck: async (deckId) => {
    const { decks } = get();
    // Optimistic update
    const updated = decks.map(d =>
      d.id === deckId ? { ...d, is_pinned: !d.is_pinned } : d
    );
    const sorted = [...updated].sort((a, b) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aInbox = a.is_inbox ? 1 : 0;
      const bInbox = b.is_inbox ? 1 : 0;
      if (aInbox !== bInbox) return bInbox - aInbox;
      const aPos = a.position ?? 0;
      const bPos = b.position ?? 0;
      if (aPos !== bPos) return aPos - bPos;
      return b.id - a.id;
    });
    set({ decks: sorted });

    try {
      const res = await api.post(`/decks/${deckId}/pin`);
      if (res.data.status === 'success') {
        const serverDecks = await api.get('/decks');
        set({ decks: serverDecks.data });
      }
    } catch (err) {
      console.error('Toggle Pin Deck Error:', err);
      const serverDecks = await api.get('/decks');
      set({ decks: serverDecks.data });
      throw err;
    }
  },

  reorderDecks: async (orderedIds) => {
    const { decks } = get();
    // Optimistic update positions
    const updated = decks.map(d => {
      const idx = orderedIds.indexOf(d.id);
      if (idx !== -1) {
        return { ...d, position: idx };
      }
      return d;
    });
    const sorted = [...updated].sort((a, b) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aInbox = a.is_inbox ? 1 : 0;
      const bInbox = b.is_inbox ? 1 : 0;
      if (aInbox !== bInbox) return bInbox - aInbox;
      const idxA = orderedIds.indexOf(a.id);
      const idxB = orderedIds.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      const aPos = a.position ?? 0;
      const bPos = b.position ?? 0;
      if (aPos !== bPos) return aPos - bPos;
      return b.id - a.id;
    });
    set({ decks: sorted });

    if (reorderTimeout) {
      clearTimeout(reorderTimeout);
    }

    reorderTimeout = setTimeout(async () => {
      try {
        await api.post('/decks/reorder', { deck_ids: orderedIds });
      } catch (err) {
        console.error('Reorder Decks Error:', err);
        try {
          const serverDecks = await api.get('/decks');
          set({ decks: serverDecks.data });
        } catch (fetchErr) {
          console.error('Fetch decks failed after reorder error:', fetchErr);
        }
      }
    }, 400);
  },

  reorderFolders: (orderedIds) => {
    const { folders } = get();
    const updated = [...folders].sort((a, b) => {
      const idxA = orderedIds.indexOf(a.id);
      const idxB = orderedIds.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.id - b.id;
    });
    set({ folders: updated });
    localStorage.setItem('lerne_folder_order', JSON.stringify(orderedIds));
  },

  reorderCards: async (orderedIds) => {
    const { deckCards } = get();
    // Optimistic update positions
    const updated = [...deckCards].sort((a, b) => {
      const aIdx = orderedIds.indexOf(a.id);
      const bIdx = orderedIds.indexOf(b.id);
      return aIdx - bIdx;
    }).map((c, idx) => ({ ...c, position: idx }));
    set({ deckCards: updated });

    if (cardReorderTimeout) {
      clearTimeout(cardReorderTimeout);
    }

    cardReorderTimeout = setTimeout(async () => {
      try {
        await api.post('/cards/reorder', { card_ids: orderedIds });
      } catch (err) {
        console.error('Reorder Cards Error:', err);
      }
    }, 400);
  },

  fetchLibraryCategories: async () => {
    try {
      const res = await api.get('/decks/external/categories');
      set({ libraryCategories: res.data });
    } catch (err) {
      console.error('Fetch Library Categories Error:', err);
    }
  }
}));
