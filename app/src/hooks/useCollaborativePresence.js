import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { getSessionIdentity, getUserId, subscribeAuthSession } from '../utils/auth';

const POLL_INTERVAL_MS = 4000;

export const useCollaborativePresence = (targetType, target, enabled) => {
  const identity = useSyncExternalStore(subscribeAuthSession, getSessionIdentity);
  const account = useSyncExternalStore(subscribeAuthSession, getUserId);
  // Older cached library entries still carry the server's effective sharing flag.
  const targetId = enabled && target?.id > 0 && (target.presence_enabled ?? target.is_shared) ? target.id : null;
  const role = targetId ? target.role : null;
  const scope = useMemo(() => (identity && account && targetId ? { targetType, targetId, identity, account, role } : null),
    [targetType, targetId, identity, account, role]);
  const [presence, setPresence] = useState(null);

  useEffect(() => {
    if (!scope) return;
    const { targetType, targetId, identity, account } = scope;
    let active = true;
    let timer;
    let pending;
    let denied = false;
    let lastUpdatedAt;
    const isCurrent = () => active && identity === getSessionIdentity() && account === getUserId();
    const canPoll = () => isCurrent() && document.visibilityState === 'visible' && navigator.onLine;

    const pause = () => {
      clearInterval(timer);
      timer = undefined;
      pending?.abort();
      pending = undefined;
    };

    const poll = async () => {
      if (pending || !canPoll()) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const { data } = await api.get(`/collaborative/${targetType}/${targetId}/presence`, {
          signal: controller.signal,
          _expectedUserId: account,
          _expectedSessionIdentity: identity,
        });
        if (!canPoll() || controller.signal.aborted) return;

        setPresence({ scope, data });
        const updatedAt = data.updated_at;
        const changed = lastUpdatedAt !== undefined && lastUpdatedAt !== updatedAt;
        lastUpdatedAt = updatedAt;
        if (!changed) return;

        const store = useDeckStore.getState();
        if (targetType === 'deck') {
          store.fetchDeckCards(targetId, 1, true).catch(error => {
            if (isCurrent()) console.warn('[CollaborativeSync] Card refresh failed:', error);
          });
        } else {
          store.fetchDecks(true).catch(error => {
            if (isCurrent()) console.warn('[CollaborativeSync] Library refresh failed:', error);
          });
        }
      } catch (error) {
        if (!isCurrent() || controller.signal.aborted) return;
        if ([401, 403, 404].includes(error.response?.status)) {
          denied = true;
          pause();
          setPresence(null);
        }
      } finally {
        if (pending === controller) pending = undefined;
      }
    };

    const updatePolling = () => {
      if (denied || !canPoll()) {
        pause();
      } else if (timer === undefined) {
        timer = setInterval(poll, POLL_INTERVAL_MS);
        void poll();
      }
    };

    const onVisibilityChange = () => {
      pause();
      updatePolling();
    };

    queueMicrotask(updatePolling);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', updatePolling);
    window.addEventListener('offline', updatePolling);
    return () => {
      active = false;
      pause();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', updatePolling);
      window.removeEventListener('offline', updatePolling);
    };
  }, [scope]);

  const data = scope && presence?.scope === scope ? presence.data : null;
  const collaborators = data?.collaborators ?? [];
  return {
    collaborators,
    onlineCount: data?.online_count ?? 0,
    isShared: collaborators.length > 1,
  };
};
