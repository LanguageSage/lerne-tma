import api, { networkApi } from '../../services/api';
import { storage, getSessionIdentity, getUserId } from '../../utils/auth';
import { getInitialCachedData, saveToInitCache, sortFolders, sortDecks } from './initCacheHelper';
import { useUiStore } from '../useUiStore';
import { tr } from '../../i18n/locale';
import { useLanguageStore } from '../useLanguageStore';

let reorderTimeout = null;

export const createDeckSlice = (set, get) => {
  const pendingLoads = new Map();
  const pendingLearning = new Map();
  let pendingFetchCards = null;
  return ({
  libraryRequestId: 0,
  getPendingLibraryLoad: (kind) => {
    const pending = pendingLoads.get(kind);
    return pending?.isCurrent() ? pending.promise : null;
  },
  runLibraryLoad: (kind, load) => {
    const pending = get().getPendingLibraryLoad(kind);
    if (pending) return pending;
    const account = getUserId();
    const identity = getSessionIdentity();
    const requestId = get().libraryRequestId + 1;
    set({ libraryRequestId: requestId });
    const isCurrent = () => account === getUserId() && identity === getSessionIdentity()
      && requestId === get().libraryRequestId;
    const entry = { isCurrent };
    entry.promise = Promise.resolve().then(() => isCurrent() ? load(isCurrent) : undefined).finally(() => {
      if (pendingLoads.get(kind) === entry) pendingLoads.delete(kind);
      if (isCurrent()) set({ isFetchingDecks: false });
    });
    pendingLoads.set(kind, entry);
    return entry.promise;
  },
  decks: getInitialCachedData().decks,
  currentDeck: null,
  deckCards: [],
  cardsByDeck: {},
  duplicateCards: [],
  lastDuplicateCardId: null,
  syncModalOpen: false,
  deckToSync: null,
  cardsLoading: false,
  isFetchingDecks: false,
  libraryStatus: getInitialCachedData().decks.length || getInitialCachedData().folders.length ? 'cached' : 'idle',
  libraryError: null,

  setLibraryLoadError: (error) => set({
    libraryStatus: get().decks.length || get().folders.length ? 'cached' : 'error',
    libraryError: { status: error?.response?.status || error?.status || 0 },
    isFetchingDecks: false,
  }),

  setDecks: (decks) => {
    const sortedDecks = sortDecks(decks);
    set({ decks: sortedDecks });
    saveToInitCache({ decks: sortedDecks });
  },

  setDecksAndFolders: (decks, folders, source = 'server') => {
    const state = get();
    if (source === 'cache') {
      // A partial cache must not prevent the missing collection from hydrating.
      decks = state.decks.length ? state.decks : decks;
      folders = state.folders.length ? state.folders : folders;
    }
    const sortedFolders = sortFolders(folders);
    const sortedDecks = sortDecks(decks);
    const updatedCurrentDeck = state.currentDeck 
      ? sortedDecks.find(d => d.id === state.currentDeck.id) || state.currentDeck 
      : null;
    set({ 
      decks: sortedDecks, 
      folders: sortedFolders, 
      currentDeck: updatedCurrentDeck,
      isFetchingDecks: false,
      libraryStatus: source === 'server' ? 'ready' : 'cached',
      libraryError: null,
    });
    if (source === 'server') saveToInitCache({ decks: sortedDecks, folders: sortedFolders });
  },

  setCurrentDeck: (deck) => {
    const prevDeck = get().currentDeck;
    if (deck?.id) {
      storage.set('lerne_current_deck_id', String(deck.id));
    }
    const cached = deck?.id ? get().cardsByDeck[deck.id] : null;
    if (cached && cached.length > 0) {
      set({ currentDeck: deck, deckCards: cached, cardsLoading: false });
    } else if (!prevDeck || prevDeck.id !== deck?.id) {
      set({ currentDeck: deck, deckCards: [], cardsLoading: true });
    } else {
      set({ currentDeck: deck });
    }
  },

  setDeckCards: (cards) => {
    const currentId = get().currentDeck?.id;
    set((prev) => ({
      deckCards: cards,
      cardsByDeck: currentId ? { ...prev.cardsByDeck, [currentId]: cards } : prev.cardsByDeck
    }));
  },
  updateCardLocal: (cardId, fields) => {
    const { deckCards, duplicateCards, currentDeck, cardsByDeck } = get();
    const updated = (deckCards || []).map(c => String(c.id) === String(cardId) ? { ...c, ...fields } : c);
    const updatedDuplicates = (duplicateCards || []).map(c => String(c.id) === String(cardId) ? { ...c, ...fields } : c);
    const currentId = currentDeck?.id;
    set({
      deckCards: updated,
      duplicateCards: updatedDuplicates,
      cardsByDeck: currentId ? { ...cardsByDeck, [currentId]: updated } : cardsByDeck
    });
  },
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

  fetchDecks: async (force = false, attempts = 3) => {
    const { decks, libraryStatus } = get();
    if (!force && decks.length > 0 && libraryStatus === 'ready') return;
    return get().runLibraryLoad('decks', async (isCurrent) => {
      set({ isFetchingDecks: true });
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (!isCurrent()) return;
        try {
          const [decksRes, foldersRes] = await Promise.all([
            api.get('/decks'),
            api.get('/folders')
          ]);
          if (!isCurrent()) return;
          if (!Array.isArray(decksRes.data) || !Array.isArray(foldersRes.data)) throw new Error('Invalid library response');
          const source = decksRes.dataSource === 'cache' || foldersRes.dataSource === 'cache' ? 'cache'
            : decksRes.dataSource === 'local' || foldersRes.dataSource === 'local' ? 'local' : 'server';
          get().setDecksAndFolders(decksRes.data, foldersRes.data, source);
          return;
        } catch (err) {
          lastError = err;
          if (!isCurrent()) return;
          const status = err?.response?.status || err?.status;
          if (status === 401 || status === 403) {
            break;
          }
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 400 * attempt));
          }
        }
      }
      if (!isCurrent()) return;
      get().setLibraryLoadError(lastError);
      console.warn('Library load failed', { status: lastError?.response?.status || 0 });
      throw lastError;
    });
  },

  fetchDeckCards: async (deckId, attempts = 3, forceLoading = false) => {
    if (pendingFetchCards?.deckId === deckId && pendingFetchCards.isCurrent()) {
      return pendingFetchCards.promise;
    }

    const state = get();
    const account = getUserId();
    const identity = getSessionIdentity();
    const requestId = state.libraryRequestId;
    const isCurrent = () => account === getUserId() && identity === getSessionIdentity()
      && requestId === get().libraryRequestId;
    const entry = { deckId, isCurrent };
    const isSameDeck = state.currentDeck?.id === deckId;
    const cached = state.cardsByDeck[deckId];
    const hasCards = (isSameDeck && state.deckCards && state.deckCards.length > 0) || (cached && cached.length > 0);
    
    if (forceLoading || (!hasCards && !isSameDeck)) {
      set({ cardsLoading: true });
    }

    const fetchPromise = (async () => {
      try {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          if (!isCurrent()) return;
          try {
            const endpoint = `/decks/${deckId}/cards`;
            const res = await api.get(endpoint);
            if (!isCurrent()) return;
            const newCards = res.data || [];
            set((prev) => ({
              deckCards: prev.currentDeck?.id === deckId ? newCards : prev.deckCards,
              cardsByDeck: {
                ...prev.cardsByDeck,
                [deckId]: newCards
              }
            }));
            return newCards;
          } catch (err) {
            if (!isCurrent()) return;
            lastError = err;
            if (err.code === 'ERR_CANCELED' || [401, 403].includes(err.response?.status)) break;
            if (attempt < attempts) {
              await new Promise(r => setTimeout(r, 150 * attempt));
            }
          }
        }
        console.error('Fetch Deck Cards Error after retries:', lastError);
        throw lastError;
      } finally {
        // An obsolete request must not release a newer request or its loader.
        if (pendingFetchCards === entry) {
          pendingFetchCards = null;
          if (isCurrent()) set({ cardsLoading: false });
        }
      }
    })();

    entry.promise = fetchPromise;
    pendingFetchCards = entry;

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
      const { currentDeck, decks } = get();
      const updatedDecks = (decks || []).map(d => d.id === deckId ? { ...d, name: newName } : d);
      set({ decks: updatedDecks });
      saveToInitCache({ decks: updatedDecks });
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, name: newName } });
      }
      get().fetchDecks(true).catch(() => {});
    } catch (err) {
      console.error('Rename Deck Error:', err);
      throw err;
    }
  },

  toggleDeckLearning: async (deckId, explicitStatus = null) => {
    const account = getUserId();
    const key = `${account}:${deckId}`;
    if (pendingLearning.has(key)) return pendingLearning.get(key);
    const { decks, currentDeck } = get();
    const targetDeck = decks.find(d => d.id === deckId);
    if (!targetDeck) return;
    
    const nextStatus = explicitStatus !== null ? explicitStatus : !targetDeck.is_learning;
    
    // Optimistic update
    const updatedDecks = decks.map(d => {
      if (d.id === deckId) {
        return {
          ...d,
          is_learning: nextStatus
        };
      }
      return d;
    });
    
    set({ decks: updatedDecks });
    saveToInitCache({ decks: updatedDecks });
    
    if (currentDeck && currentDeck.id === deckId) {
      set({ 
        currentDeck: { 
          ...currentDeck, 
          is_learning: nextStatus
        } 
      });
    }

    const request = api.post(`/decks/${deckId}/toggle-learning`, { is_learning: nextStatus });
    pendingLearning.set(key, request);
    try {
      await request;
    } catch (err) {
      console.error('Toggle Deck Learning Error:', err);
      if (getUserId() !== account) throw err;
      // Revert on failure
      const revertedDecks = get().decks.map(d => d.id === deckId ? { ...d, is_learning: targetDeck.is_learning } : d);
      const selected = get().currentDeck;
      set({ decks: revertedDecks, ...(selected?.id === deckId
        ? { currentDeck: { ...selected, is_learning: targetDeck.is_learning } } : {}) });
      saveToInitCache({ decks: revertedDecks });
      throw err;
    } finally {
      pendingLearning.delete(key);
    }
  },
  
  updateDeckMetadata: async (deckId, metadata) => {
    try {
      const res = await api.post(`/decks/${deckId}/metadata`, metadata);
      const { fetchDecks, currentDeck, decks } = get();
      const updatedMeta = res.data.metadata;
      const updatedDecks = (decks || []).map(d => d.id === deckId ? { ...d, metadata: updatedMeta } : d);
      set({ decks: updatedDecks });
      saveToInitCache({ decks: updatedDecks });
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, metadata: updatedMeta } });
      }
      await fetchDecks(true);
      return updatedMeta;
    } catch (err) {
      console.error('Update Deck Metadata Error:', err);
      throw err;
    }
  },

  handleFileUpload: async (event, callback) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const payload = /\.json$/i.test(file.name) ? { document: JSON.parse(text.replace(/^\uFEFF/, '')) }
        : { codex: text, default_deck_name: file.name.replace(/\.[^.]+$/, '') };
      await networkApi.post('/decks/import-json', { import_id: crypto.randomUUID(), ...payload });
      const { fetchDecks } = get();
      await fetchDecks(true);
      if (callback) callback();
    } catch (err) {
      console.error('Upload JSON Error:', err);
      throw err;
    }
  },

  moveDeckToFolder: async (deckId, folderId) => {
    try {
      await api.post(`/decks/${deckId}/move`, { folder_id: folderId });
      const { currentDeck, decks } = get();
      const updatedDecks = (decks || []).map(d => d.id === deckId ? { ...d, folder_id: folderId } : d);
      set({ decks: updatedDecks });
      saveToInitCache({ decks: updatedDecks });
      if (currentDeck && currentDeck.id === deckId) {
        set({ currentDeck: { ...currentDeck, folder_id: folderId } });
      }
      get().fetchDecks(true).catch(() => {});
    } catch (err) {
      console.error('Move Deck to Folder Error:', err);
      throw err;
    }
  },

  copyDeckToFolder: async (deckId, folderId) => {
    try {
      await networkApi.post(`/decks/${deckId}/copy`, { folder_id: folderId, request_id: crypto.randomUUID() });
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
    if (!orderedIds || orderedIds.length === 0) return;

    const posMap = new Map();
    orderedIds.forEach((id, idx) => posMap.set(id, idx));

    const updated = [...decks];
    const reorderedItems = [];
    const positions = [];

    updated.forEach((d, idx) => {
      if (posMap.has(d.id)) {
        reorderedItems.push(d);
        positions.push(idx);
      }
    });

    reorderedItems.sort((a, b) => posMap.get(a.id) - posMap.get(b.id));

    positions.forEach((pos, i) => {
      const item = reorderedItems[i];
      updated[pos] = { ...item, position: posMap.get(item.id) };
    });

    set({ decks: updated });
    saveToInitCache({ decks: updated });

    if (reorderTimeout) {
      clearTimeout(reorderTimeout);
    }

    reorderTimeout = setTimeout(async () => {
      try {
        await api.post('/decks/reorder', { deck_ids: orderedIds });
      } catch (err) {
        console.error('Reorder Decks Error:', err);
      }
    }, 400);
  },

  reorderCards: async (orderedIds, targetDeckId = null) => {
    const state = get();
    const effectiveDeckId = targetDeckId != null ? targetDeckId : state.currentDeck?.id;
    const isCurrentDeck = state.currentDeck && String(state.currentDeck.id) === String(effectiveDeckId);
    const baseCards = (isCurrentDeck && state.deckCards && state.deckCards.length > 0)
      ? state.deckCards
      : ((effectiveDeckId && state.cardsByDeck[effectiveDeckId]) || state.deckCards || []);

    if (!orderedIds || orderedIds.length === 0 || baseCards.length === 0) return;

    const identity = getSessionIdentity();
    const account = getUserId();
    const isCurrent = () => identity === getSessionIdentity() && account === getUserId();
    try {
      const { data } = await api.post('/cards/reorder', {
        request_id: crypto.randomUUID(), card_ids: orderedIds.map(Number),
        revisions: Object.fromEntries(orderedIds.map(id => [id, baseCards.find(card => String(card.id) === String(id))?.revision])),
      });
      if (!isCurrent()) return;
      const changes = new Map(data.cards.map(card => [card.id, card]));
      const updated = baseCards.map(card => changes.get(card.id) || card)
        .sort((a, b) => a.position - b.position || a.id - b.id);
      set(prev => ({
        deckCards: String(prev.currentDeck?.id) === String(effectiveDeckId) ? updated : prev.deckCards,
        cardsByDeck: { ...prev.cardsByDeck, [effectiveDeckId]: updated },
      }));
      const pending = data.cards.find(card => card.offline_lifecycle);
      if (pending) useUiStore.getState().showToast(tr(pending.offline_list_error === 409 ? 'Конфликт версий'
        : pending.offline_list_error ? 'Ошибка синхронизации. Карточка сохранена на устройстве.' : 'Ожидает синхронизации'), pending.offline_list_error ? 'error' : 'info');
    } catch (error) {
      if (isCurrent()) useUiStore.getState().showToast(error.message, 'error');
    }

  },
  });
};
