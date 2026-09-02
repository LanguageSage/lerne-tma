import api from '../../services/api';

export const createLibrarySlice = (set, get) => ({
  libraryCategories: [],
  externalDecks: [],
  communityDecks: [],

  setLibraryCategories: (categories) => set({ libraryCategories: categories }),
  setExternalDecks: (decks) => set({ externalDecks: decks }),
  setCommunityDecks: (decks) => set({ communityDecks: decks }),

  fetchExternalDecks: async () => {
    try {
      const { useLanguageStore } = await import('../useLanguageStore');
      const activeLang = useLanguageStore.getState().activeLanguage || 'de';
      const res = await api.get(`/decks/external?target_language=${activeLang}`);
      set({ externalDecks: res.data });
    } catch (err) {
      console.error('Fetch External Decks Error:', err);
      throw err;
    }
  },

  importDeck: async (deckId, mode = 'merge', forceTrash = false) => {
    try {
      const res = await api.post(`/decks/external/import/${deckId}?mode=${mode}&force_trash=${forceTrash}`);
      if (res.data?.status === 'in_trash') {
        return res.data;
      }
      const { fetchDecks } = get();
      await fetchDecks(true);
      return res.data;
    } catch (err) {
      console.error('Import Deck Error:', err);
      throw err;
    }
  },

  importDecksBatch: async (deckIds, mode = 'merge', forceTrash = false) => {
    try {
      const res = await api.post('/decks/external/import-batch', { deck_ids: deckIds, mode, force_trash: forceTrash });
      const { fetchDecks } = get();
      await fetchDecks(true);
      return res.data;
    } catch (err) {
      console.error('Import Decks Batch Error:', err);
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

  fetchLibraryCategories: async () => {
    try {
      const res = await api.get('/decks/external/categories');
      set({ libraryCategories: res.data });
    } catch (err) {
      console.error('Fetch Library Categories Error:', err);
    }
  },
});
