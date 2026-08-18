import { useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';

const POLL_INTERVAL_MS = 15000; // 15 seconds

/**
 * useCollaborativeSync
 * Polls the server every 15 seconds for changes made by other collaborators.
 * Pauses automatically when the app is in the background (Page Visibility API).
 * On resume, immediately checks for changes without waiting for the interval.
 */
export const useCollaborativeSync = () => {
  const lastSyncRef = useRef(null);
  const intervalRef = useRef(null);
  const isRunningRef = useRef(false);

  const applyCollabChanges = useCallback((data) => {
    if (!data.has_changes) return;

    const store = useDeckStore.getState();
    const { decks, folders, deckCards, currentDeck } = store;

    let decksUpdated = false;
    let foldersUpdated = false;
    let cardsUpdated = false;

    // Apply deck changes
    let updatedDecks = [...decks];
    for (const incoming of (data.decks || [])) {
      const idx = updatedDecks.findIndex(d => d.id === incoming.id);
      if (idx !== -1) {
        updatedDecks[idx] = { ...updatedDecks[idx], ...incoming };
        decksUpdated = true;
      } else if (!incoming.is_deleted) {
        updatedDecks.push(incoming);
        decksUpdated = true;
      }
    }

    // Apply folder changes
    let updatedFolders = [...folders];
    for (const incoming of (data.folders || [])) {
      const idx = updatedFolders.findIndex(f => f.id === incoming.id);
      if (idx !== -1) {
        updatedFolders[idx] = { ...updatedFolders[idx], ...incoming };
        foldersUpdated = true;
      } else if (!incoming.is_deleted) {
        updatedFolders.push(incoming);
        foldersUpdated = true;
      }
    }

    // Apply card changes — only for currently viewed deck
    let updatedCards = [...(deckCards || [])];
    for (const incoming of (data.cards || [])) {
      if (currentDeck && incoming.deck_id !== currentDeck.id) continue;

      if (incoming.is_deleted) {
        const idx = updatedCards.findIndex(c => c.id === incoming.id);
        if (idx !== -1) { updatedCards.splice(idx, 1); cardsUpdated = true; }
      } else {
        const idx = updatedCards.findIndex(c => c.id === incoming.id);
        if (idx !== -1) {
          updatedCards[idx] = { ...updatedCards[idx], ...incoming };
          cardsUpdated = true;
        } else {
          updatedCards.push(incoming);
          cardsUpdated = true;
        }
      }
    }

    const nextState = {};
    if (decksUpdated) nextState.decks = updatedDecks;
    if (foldersUpdated) nextState.folders = updatedFolders;
    if (cardsUpdated) nextState.deckCards = updatedCards;

    if (Object.keys(nextState).length > 0) {
      useDeckStore.setState(nextState);
      console.log('[CollabSync] Applied changes:', {
        decks: (data.decks || []).length,
        folders: (data.folders || []).length,
        cards: (data.cards || []).length,
      });
    }
  }, []);

  const poll = useCallback(async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    try {
      const params = lastSyncRef.current ? { since: lastSyncRef.current } : {};
      const res = await api.get('/sync/collab-pull', { params });
      if (res.data) {
        if (res.data.server_time) lastSyncRef.current = res.data.server_time;
        applyCollabChanges(res.data);
      }
    } catch (err) {
      console.debug('[CollabSync] Poll error (will retry):', err?.message);
    } finally {
      isRunningRef.current = false;
    }
  }, [applyCollabChanges]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [poll]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    lastSyncRef.current = new Date().toISOString();
    startPolling();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
        poll(); // Immediate check on resume
      } else {
        stopPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [startPolling, stopPolling, poll]);
};
