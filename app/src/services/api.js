import axios from 'axios';
import { getSessionIdentity, getUserId } from '../utils/auth.js';
import { isOfflineMode, resolveLocalRequest, prepareLocalDb } from './localDb.js';
import { offlineApi } from './offlineApi.js';
import { networkApi as axiosInstance } from './networkApi.js';
import { keepLocalCard, syncService } from './syncService.js';

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
        const isCurrent = () => requestIdentity === getSessionIdentity() && requestAccount === getUserId();
        const assertCurrent = () => {
          if (!isCurrent()) throw new axios.CanceledError('Session changed');
        };
        const localRequest = async (...params) => {
          assertCurrent();
          const response = await offlineApi.handle(propKey, url, ...params);
          assertCurrent();
          return response;
        };
        if (url.startsWith('/card-notes/')) return localRequest(...args);
        if (propKey === 'patch' && /^\/cards\/\d+$/.test(url) && args[1]?.offlineStandardEdit) {
          return localRequest(...args);
        }
        const requestStartedAt = Date.now();
        const standardCreate = propKey === 'post' && url === '/cards/save' && args[0]?.content_v2?.card?.type === 'standard';
        const configIndex = ['get', 'delete'].includes(propKey) ? 0 : 1;
        args[configIndex] = {
          _expectedUserId: requestAccount, _expectedSessionIdentity: requestIdentity, ...args[configIndex],
        };
        if (isOfflineMode() || /\/-\d+(?:\/|\?|$)/.test(url) || (standardCreate && args[0]?.after_card_id < 0)) {
          await prepareLocalDb();
          const resolved = await resolveLocalRequest(url, args[0]);
          url = resolved.url;
          if (configIndex === 1) args[0] = resolved.body;
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

        const cardMatch = propKey === 'get' && url.match(/^\/cards\/(\d+)$/);
        if (requestAccount && cardMatch) {
          const db = await prepareLocalDb();
          if (!isCurrent()) throw new axios.CanceledError('Session changed before offline routing');
          const local = await db.cards.get(Number(cardMatch[1]));
          if (local?.offline_edit) return localRequest(...args);
          assertCurrent();
        }
        const forceOffline = (!standardCreate && !(cardMatch && args[0]?.freshCard) && isOfflineMode())
          || !navigator.onLine || /^\/cards\/-\d+$/.test(url);
        const isLibraryRead = propKey === 'get' && /^\/(init|decks|folders)(?:\?|$)/.test(url);

        if (forceOffline && isOfflineEndpoint) {
          try {
            const response = await localRequest(...args);
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

        if (standardCreate && requestAccount && !args[1]?.offlineCreateFlag) {
          // Persist the same operation before the first HTTP attempt when the
          // destination supports offline creation.
          const local = await localRequest(args[0], { offlineCreateIfAvailable: true });
          if (!isCurrent()) throw new axios.CanceledError('Session changed before card delivery');
          if (local) {
            const db = await prepareLocalDb();
            assertCurrent();
            await syncService.sync({ pendingNativeOnly: true, skipPull: true });
            const card = await db.transaction('r', db.cards, db.syncState, async () => {
              const aliases = (await db.syncState.get('aliases'))?.mappings.cards;
              return db.cards.get(aliases?.[local.data.id] ?? local.data.id);
            });
            if (!isCurrent()) throw new axios.CanceledError('Session changed during card delivery');
            return { data: card ?? local.data };
          }
        }

        // Try online server request first
        try {
          const needsRefresh = !standardCreate && isOfflineMode() && isOfflineEndpoint && propKey !== 'get';
          if (needsRefresh) {
            const synced = await syncService.sync();
            if (!synced.success) throw new Error(synced.reason);
            assertCurrent();
            const resolved = await resolveLocalRequest(url, args[0]);
            url = resolved.url;
            if (configIndex === 1) args[0] = resolved.body;
          }
          const response = await Reflect.get(target, propKey, receiver).call(target, url, ...args);
          assertCurrent();
          if (needsRefresh) {
            await syncService.sync();
            assertCurrent();
          }
          const deckMatch = propKey === 'get' && url.match(/^\/decks\/(\d+)\/cards$/);
          if (requestAccount && (isLibraryRead || deckMatch || cardMatch)
              && requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
            try {
              const db = await prepareLocalDb();
              if (requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
                if (deckMatch || cardMatch) {
                  const cards = deckMatch ? response.data : [response.data];
                  if (!Array.isArray(cards)) return response;
                  const merged = await db.transaction('rw', db.cards, db.syncState, async () => {
                    const [local, lastSync] = await Promise.all([
                      db.cards.bulkGet(cards.map(card => card.id)), db.syncState.get('lastSync'),
                    ]);
                    if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
                    const visible = cards.map((card, index) => {
                      const cached = local[index];
                      if (keepLocalCard(cached, requestStartedAt)) return cached;
                      return card;
                    });
                    await db.cards.bulkPut(cards.filter((card, index) => visible[index] === card
                      && card.content_v2?.card?.type === 'standard' && card.revision
                      && (local[index] ? local[index].content_v2 && !local[index].is_dirty
                        : !(lastSync?.readStartedAt > requestStartedAt)))
                      .map(card => ({ ...card, offline_read_started_at: requestStartedAt, is_dirty: 0 })));
                    if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
                    if (deckMatch) {
                      const ids = new Set(cards.map(card => card.id));
                      const pending = await db.cards.where('deck_id').equals(Number(deckMatch[1]))
                        .filter(card => !ids.has(card.id) && (card.offline_create_status
                          || card.offline_edit || (!card.is_deleted && keepLocalCard(card, requestStartedAt)))).toArray();
                      return [...visible, ...pending];
                    }
                    return visible[0];
                  });
                  if (isCurrent()) return { ...response, data: merged };
                } else {
                  const library = url.startsWith('/init') ? response.data
                    : { [url.startsWith('/decks') ? 'decks' : 'folders']: response.data };
                  await db.transaction('rw', db.decks, db.folders, async () => {
                    assertCurrent();
                    for (const name of ['folders', 'decks']) {
                      if (!Array.isArray(library?.[name])) continue;
                      const items = library[name].filter(item => item.id > 0);
                      const existing = await db[name].bulkGet(items.map(item => item.id));
                      await db[name].bulkAdd(items.filter((_item, index) => !existing[index]));
                    }
                    assertCurrent();
                  });
                }
              }
            } catch (error) {
              if (!isCurrent()) throw new axios.CanceledError('Session changed during offline cache update');
              console.warn('Offline library unavailable', error.name);
            }
          }
          assertCurrent();
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
              const response = await localRequest(...args);
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
