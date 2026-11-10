import { useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { isOfflineMode } from '../services/localDb';
import { syncService } from '../services/syncService';
import { getSessionIdentity, getUserId } from '../utils/auth';

const POLL_INTERVAL_MS = 60000; // 60 seconds (was 15s — reduced to cut DB load)

/**
 * useCollaborativeSync
 * Polls the server every 60 seconds for changes made by other collaborators.
 * Pauses automatically when the app is in the background (Page Visibility API).
 * On resume, immediately checks for changes without waiting for the interval.
 * Skips polling entirely if the user has no collaborative content.
 */
export const useCollaborativeSync = () => {
  const lastSyncRef = useRef(null);
  const accessVersionRef = useRef(undefined);
  const intervalRef = useRef(null);
  const isRunningRef = useRef(false);
  const ownerRef = useRef(null);

  const poll = useCallback(async () => {
    if (isRunningRef.current || isOfflineMode()) return;
    isRunningRef.current = true;
    const owner = getUserId();
    const identity = getSessionIdentity();
    const isCurrent = () => owner === getUserId() && identity === getSessionIdentity();
    if (owner !== ownerRef.current?.owner || identity !== ownerRef.current?.identity) {
      ownerRef.current = { owner, identity };
      lastSyncRef.current = new Date().toISOString();
      accessVersionRef.current = undefined;
    }
    try {
      const params = lastSyncRef.current ? { since: lastSyncRef.current } : {};
      const res = await api.get('/sync/collab-pull', { params });
      if (res.data && isCurrent()) {

        if (res.data.access_version !== accessVersionRef.current) {
          const hadVersion = accessVersionRef.current !== undefined;
          accessVersionRef.current = res.data.access_version;
          // Grants do not change folder/deck timestamps, so refresh the index.
          if (hadVersion) {
            const store = useDeckStore.getState();
            await Promise.all([store.fetchDecks(true), store.fetchFolders()]);
          }
        }
        if (res.data.has_changes) {
          const result = await syncService.sync({ pullOnly: true });
          if (!result.pull_success || !isCurrent()) return;
          const store = useDeckStore.getState();
          await Promise.all([store.fetchDecks(true), store.fetchFolders(), store.fetchDeckCards()]);
        }
        if (res.data.server_time) lastSyncRef.current = res.data.server_time;
      }
    } catch (err) {
      console.debug('[CollabSync] Poll error (will retry):', err?.message);
    } finally {
      isRunningRef.current = false;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    // Skip polling entirely for users with no collaborative content — saves ~80% DB load
    const { decks, folders } = useDeckStore.getState();
    const hasCollab = decks.some(d => d.role && d.role !== 'owner')
      || folders.some(f => f.role && f.role !== 'owner');
    if (!hasCollab) return;
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [poll]);

  useEffect(() => {
    ownerRef.current = { owner: getUserId(), identity: getSessionIdentity() };
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
