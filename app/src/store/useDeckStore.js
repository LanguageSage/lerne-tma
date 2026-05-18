import { create } from 'zustand';
import api from '../services/api';

export const useDeckStore = create((set, get) => ({
  decks: [],
  currentDeck: null,
  externalDecks: [],
  communityDecks: [],
  deckCards: [],
  duplicateCards: [],
  lastDuplicateCardId: null,
  syncModalOpen: false,
  deckToSync: null,
  
  setDecks: (decks) => set({ decks }),
  setCurrentDeck: (deck) => set({ currentDeck: deck }),
  setExternalDecks: (decks) => set({ externalDecks: decks }),
  setCommunityDecks: (decks) => set({ communityDecks: decks }),
  setDeckCards: (cards) => set({ deckCards: cards }),
  setDuplicateCards: (cards) => set({ duplicateCards: cards }),
  setLastDuplicateCardId: (id) => set({ lastDuplicateCardId: id }),
  setSyncModalOpen: (isOpen) => set({ syncModalOpen: isOpen }),
  setDeckToSync: (deck) => set({ deckToSync: deck }),

  fetchDuplicates: async () => {
    try {
      const res = await api.get('/cards/duplicates');
      set({ duplicateCards: res.data });
    } catch (err) {
      console.error('Fetch Duplicates Error:', err);
    }
  },

  fetchDecks: async (force = false) => {
    const { decks } = get();
    if (!force && decks.length > 0) return;
    
    try {
      const res = await api.get('/decks');
      set({ decks: res.data });
    } catch (err) {
      console.error('Fetch Decks Error:', err);
      throw err;
    }
  },

  fetchDeckCards: async (deckId) => {
    try {
      const res = await api.get(`/decks/${deckId}/cards`);
      set({ deckCards: res.data });
    } catch (err) {
      console.error('Fetch Deck Cards Error:', err);
      throw err;
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

  createDeck: async (name) => {
    try {
      await api.post('/decks', { name });
      const { fetchDecks } = get();
      await fetchDecks(true);
    } catch (err) {
      console.error('Create Deck Error:', err);
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
  }
}));
