import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';

/**
 * Custom hook for live collaborative presence and auto-syncing cards when changes occur.
 * 
 * @param {string} targetType - 'deck' or 'folder'
 * @param {number|string} targetId - ID of deck or folder
 * @param {boolean} enabled - whether live sync is active
 */
export const useCollaborativePresence = (targetType, targetId, enabled = true) => {
  const [collaborators, setCollaborators] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isShared, setIsShared] = useState(false);
  const lastUpdatedAtRef = useRef(null);

  const checkPresence = useCallback(async () => {
    if (!targetId || !enabled) return;

    try {
      const endpoint = `/collaborative/${targetType}/${targetId}/presence`;
      const res = await api.get(endpoint);
      if (res.data) {
        const { collaborators: colList, online_count, updated_at } = res.data;
        
        setCollaborators(colList || []);
        setOnlineCount(online_count || 0);
        setIsShared((colList || []).length > 1);

        // Check if target updated_at timestamp changed on server
        if (updated_at) {
          if (lastUpdatedAtRef.current && lastUpdatedAtRef.current !== updated_at) {
            console.log(`[CollaborativeSync] Server update detected (${lastUpdatedAtRef.current} -> ${updated_at}). Auto-refreshing cards...`);
            if (targetType === 'deck') {
              // Silently refresh deck cards in Zustand store
              useDeckStore.getState().fetchDeckCards(targetId, 1, true).catch(err => {
                console.warn("[CollaborativeSync] Card auto-refresh failed:", err);
              });
            }
          }
          lastUpdatedAtRef.current = updated_at;
        }
      }
    } catch (err) {
      console.warn("[CollaborativeSync] Presence check error:", err);
    }
  }, [targetType, targetId, enabled]);

  useEffect(() => {
    if (!targetId || !enabled) return;

    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) checkPresence();
    });

    // Heartbeat & presence polling every 4 seconds
    const interval = setInterval(() => {
      checkPresence();
    }, 4000);

    // Also check on window focus
    const handleFocus = () => {
      checkPresence();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [targetId, enabled, checkPresence]);

  return {
    collaborators,
    onlineCount,
    isShared,
    checkPresence
  };
};
