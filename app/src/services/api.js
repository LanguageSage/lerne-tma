import axios from 'axios';
import { getSessionIdentity, getUserId } from '../utils/auth.js';
import { isOfflineMode, resolveLocalRequest, prepareLocalDb } from './localDb.js';
import { offlineApi } from './offlineApi.js';
import { networkApi as axiosInstance } from './networkApi.js';
import { syncService } from './syncService.js';

// Проксируем методы Axios для поддержки офлайн-режима и автоматического фоллбека
const api = new Proxy(axiosInstance, {
  get(target, propKey, receiver) {
    if (['get', 'post', 'put', 'delete', 'patch'].includes(propKey)) {
      return async (url, ...args) => {
        if (propKey === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)) {
          args[0] = { ...args[0], action_id: args[0]?.action_id || crypto.randomUUID() };
        }
        const requestIdentity = getSessionIdentity();
        const requestAccount = getUserId();
        if (url.startsWith('/card-notes/')) return offlineApi.handle(propKey, url, ...args);
        const standardCreate = propKey === 'post' && url === '/cards/save' && args[0]?.content_v2?.card?.type === 'standard';
        if (isOfflineMode() || /\/-\d+(?:\/|\?|$)/.test(url) || (standardCreate && args[0]?.after_card_id < 0)) {
          await prepareLocalDb();
          const resolved = await resolveLocalRequest(url, args[0]);
          url = resolved.url;
          if (args.length) args[0] = resolved.body;
          if (requestIdentity !== getSessionIdentity() || requestAccount !== getUserId()) {
            throw new axios.CanceledError('Session changed before offline routing');
          }
        }
        const isOfflineEndpoint = 
          url.startsWith('/decks') || 
          url.startsWith('/folders') ||
          url.startsWith('/cards') || 
          url.startsWith('/study') || 
          url.startsWith('/trash') ||
          url.startsWith('/init');

        const forceOffline = (!standardCreate && isOfflineMode()) || !navigator.onLine || /^\/cards\/-\d+$/.test(url);
        const isLibraryRead = propKey === 'get' && /^\/(init|decks|folders)(?:\?|$)/.test(url);

        if (forceOffline && isOfflineEndpoint) {
          try {
            const response = await offlineApi.handle(propKey, url, ...args);
            // A browser without a downloaded library must not turn a failed
            // network request into an authoritative empty-account response.
            if (isLibraryRead && !isOfflineMode()) {
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (!items?.length) throw new Error('Library unavailable offline');
            }
            return isLibraryRead ? { ...response, dataSource: isOfflineMode() ? 'local' : 'cache' } : response;
          } catch (err) {
            if (err.code !== 'OFFLINE_UNSUPPORTED' || !navigator.onLine) throw err;
          }
        }

        // Try online server request first
        try {
          const needsRefresh = !standardCreate && isOfflineMode() && isOfflineEndpoint && propKey !== 'get';
          if (needsRefresh) {
            const synced = await syncService.sync();
            if (!synced.success) throw new Error(synced.reason);
            const resolved = await resolveLocalRequest(url, args[0]);
            url = resolved.url;
            if (args.length) args[0] = resolved.body;
          }
          const response = await Reflect.get(target, propKey, receiver).call(target, url, ...args);
          if (needsRefresh) {
            await syncService.sync();
          }
          const deckMatch = propKey === 'get' && url.match(/^\/decks\/(\d+)\/cards$/);
          if (requestAccount && (isLibraryRead || deckMatch)
              && requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
            try {
              const db = await prepareLocalDb();
              if (requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
                if (deckMatch && Array.isArray(response.data)) {
                  const local = await db.cards.where('deck_id').equals(Number(deckMatch[1]))
                    .filter(card => Boolean(card.offline_create_status)).toArray();
                  if (local.length) return { ...response, data: [...response.data, ...local] };
                } else {
                  const library = url.startsWith('/init') ? response.data
                    : { [url.startsWith('/decks') ? 'decks' : 'folders']: response.data };
                  await db.transaction('rw', db.decks, db.folders, async () => {
                    for (const name of ['folders', 'decks']) {
                      if (!Array.isArray(library?.[name])) continue;
                      const items = library[name].filter(item => item.id > 0);
                      const existing = await db[name].bulkGet(items.map(item => item.id));
                      await db[name].bulkAdd(items.filter((_item, index) => !existing[index]));
                    }
                  });
                }
              }
            } catch (error) {
              console.warn('Offline library unavailable', error.name);
            }
          }
          return response;
        } catch (networkErr) {
          // Automatic fallback to local Dexie DB when network is disconnected or server unavailable
          const isNetworkFailure = 
            !navigator?.onLine || 
            networkErr.code === 'ERR_NETWORK' || 
            !networkErr.response || 
            networkErr.message?.includes('Network Error');

          if (isNetworkFailure && (requestIdentity !== getSessionIdentity() || requestAccount !== getUserId())) {
            throw new axios.CanceledError('Session changed before offline fallback');
          }

          if (isOfflineEndpoint && isNetworkFailure && !axios.isCancel(networkErr)) {
            console.log(`[Network Unavailable] Falling back to local offline DB for ${propKey.toUpperCase()} ${url}`);
            try {
              const response = await offlineApi.handle(propKey, url, ...args);
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (isLibraryRead && !items?.length) throw networkErr;
              return isLibraryRead ? { ...response, dataSource: 'cache' } : response;
            } catch (localError) {
              if (standardCreate) throw localError;
              console.warn('Offline fallback unavailable', { method: propKey.toUpperCase() });
            }
          }
          throw networkErr;
        }
      };
    }
    return Reflect.get(target, propKey, receiver);
  },
  
  apply(target, thisArg, argumentsList) {
    return Reflect.apply(target, thisArg, argumentsList);
  }
});

export default api;
export { axiosInstance as networkApi };
