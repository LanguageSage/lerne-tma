import { create } from 'zustand';
import api from '../services/api';

let reorderTimeout = null;
let cardReorderTimeout = null;

export const useDeckStore = create((set, get) => ({
  decks: [],
  folders: [],
  libraryCategories: [],
  currentDeck: null,
  externalDecks: [],
  communityDecks: [],
  deckCards: [],
  duplicateCards: [],
  favoriteCards: [],
  lastDuplicateCardId: null,
  syncModalOpen: false,
  deckToSync: null,
  trashItems: { decks: [], cards: [] },
  cardsLoading: false,

  
  setDecks: (decks) => set({ decks }),
  setFolders: (folders) => set({ folders }),
  setLibraryCategories: (categories) => set({ libraryCategories: categories }),
  setCurrentDeck: (deck) => set({ currentDeck: deck }),
  setExternalDecks: (decks) => set({ externalDecks: decks }),
  setCommunityDecks: (decks) => set({ communityDecks: decks }),
  setDeckCards: (cards) => set({ deckCards: cards }),
  setDuplicateCards: (cards) => set({ duplicateCards: cards }),
  setFavoriteCards: (cards) => set({ favoriteCards: cards }),
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

  fetchFavorites: async () => {
    try {
      const res = await api.get('/cards/favorites');
      set({ favoriteCards: res.data });
    } catch (err) {
      console.error('Fetch Favorites Error:', err);
    }
  },

  fetchDecks: async (force = false) => {
    const { decks } = get();
    if (!force && decks.length > 0) return;
    
    try {
      const res = await api.get('/decks');
      set({ decks: res.data });
      if (force) {
        get().fetchFolders();
      }
    } catch (err) {
      console.error('Fetch Decks Error:', err);
      throw err;
    }
  },

  fetchDeckCards: async (deckId) => {
    set({ cardsLoading: true });
    try {
      if (deckId === 'favorites') {
        const res = await api.get('/cards/favorites');
        set({ deckCards: res.data });
      } else {
        const res = await api.get(`/decks/${deckId}/cards`);
        set({ deckCards: res.data });
      }
    } catch (err) {
      console.error('Fetch Deck Cards Error:', err);
      throw err;
    } finally {
      set({ cardsLoading: false });
    }
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

  createDeck: async (name, folderId = null) => {
    try {
      await api.post('/decks', { name, folder_id: folderId });
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
      const { fetchDecks, currentDeck } = get();
      await fetchDecks(true);
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, metadata: res.data.metadata } });
      }
      return res.data.metadata;
    } catch (err) {
      console.error('Update Deck Metadata Error:', err);
      throw err;
    }
  },


  fetchExternalDecks: async () => {
    try {
      const res = await api.get('/decks/external');
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
        const shareId = res.data.share_id;
        // Используем веб-ссылку для красивого превью (OpenGraph)
        const link = `${window.location.origin}/api/share/v/${shareId}`;
        const text = 'Посмотри эту колоду в Lerne!';
        
        // 1. Пробуем системное меню Share (Web Share API)
        if (navigator.share) {
          try {
            await navigator.share({
              title: 'Колода Lerne',
              text: text,
              url: link,
            });
            return { success: true, type: 'share' };
          } catch (shareErr) {
            // Если пользователь просто закрыл меню, ничего не делаем
            if (shareErr.name === 'AbortError') return { success: false };
            // В случае ошибки (например, запрет в iframe) переходим к другим способам
          }
        }

        // 2. Пробуем нативный Share внутри Telegram
        const tg = window.Telegram?.WebApp;
        if (tg) {
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
          tg.openTelegramLink(shareUrl);
          return { success: true, type: 'telegram' };
        }

        // 3. Фолбэк на буфер обмена
        await navigator.clipboard.writeText(link);
        return { success: true, type: 'copy' };
      }
      return { success: false };
    } catch (err) {
      console.error('Share Deck Error:', err);
      throw err;
    }
  },

  fetchFolders: async () => {
    try {
      const res = await api.get('/folders');
      set({ folders: res.data });
    } catch (err) {
      console.error('Fetch Folders Error:', err);
    }
  },

  createFolder: async (name, parentId = null, color = null) => {
    try {
      await api.post('/folders', { name, parent_id: parentId, color });
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

  reorderCards: async (orderedIds) => {
    const { deckCards } = get();
    // Optimistic update positions
    const updated = [...deckCards].sort((a, b) => {
      const aIdx = orderedIds.indexOf(a.id);
      const bIdx = orderedIds.indexOf(b.id);
      return aIdx - bIdx;
    });
    set({ deckCards: updated });

    if (cardReorderTimeout) {
      clearTimeout(cardReorderTimeout);
    }

    cardReorderTimeout = setTimeout(async () => {
      try {
        await api.post('/cards/reorder', { card_ids: orderedIds });
      } catch (err) {
        console.error('Reorder Cards Error:', err);
        const { currentDeck } = get();
        if (currentDeck) {
          try {
            const res = await api.get(`/decks/${currentDeck.id}/cards`);
            set({ deckCards: res.data });
          } catch (fetchErr) {
            console.error('Fetch cards failed after reorder error:', fetchErr);
          }
        }
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
