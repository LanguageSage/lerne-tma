import api from '../../services/api';

export const createTrashSlice = (set, get) => ({
  trashItems: { decks: [], cards: [] },

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
});
