import axios from 'axios';
import { getSessionIdentity, getUserId } from '../utils/auth.js';
import { isOfflineMode, resolveLocalRequest, prepareLocalDb } from './localDb.js';
import { offlineApi } from './offlineApi.js';
import { networkApi as axiosInstance } from './networkApi.js';
import { syncService } from './syncService.js';
import { handleLocalFirstRequest, tryLocalFirstNativeCreate, reconcileOnlineResponse } from './apiCacheSync.js';
import { IS_STANDALONE } from '../utils/standaloneMode.js';

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
        const fetchFreshCard = id => api.get(`/cards/${id}`, { freshCard: true });
        const localFirst = await handleLocalFirstRequest({
          propKey, url, args, requestAccount, isCurrent, assertCurrent, localRequest, fetchFreshCard,
        });
        if (localFirst) return localFirst;

        const requestStartedAt = Date.now();
        const nativeCreate = propKey === 'post' && url === '/cards/save' && Object.hasOwn(args[0] ?? {}, 'content_v2');
        const configIndex = ['get', 'delete'].includes(propKey) ? 0 : 1;
        args[configIndex] = {
          _expectedUserId: requestAccount, _expectedSessionIdentity: requestIdentity, ...args[configIndex],
        };
        if (isOfflineMode() || /\/-\d+(?:\/|\?|$)/.test(url) || (nativeCreate && args[0]?.after_card_id < 0)) {
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
        const studyCardMatch = propKey === 'get' && url.match(/^\/study\/card\/(\d+)$/);
        if (requestAccount && (cardMatch || studyCardMatch)) {
          const local = await prepareLocalDb().then(db => db.cards.get(Number((cardMatch || studyCardMatch)[1])))
            .catch(error => { if (cardMatch) throw error; });
          assertCurrent();
          if (local?.offline_lifecycle || (cardMatch && (local?.offline_edit || local?.offline_move))) {
            return localRequest(...args);
          }
        }
        const forceOffline = (!nativeCreate && !(cardMatch && args[0]?.freshCard) && isOfflineMode())
          || !navigator.onLine || /^\/cards\/-\d+$/.test(url);
        const isLibraryRead = propKey === 'get' && /^\/(init|decks|folders)(?:\?|$)/.test(url);
        const isDeckCardsRead = propKey === 'get' && /^\/decks\/-?\d+\/cards(?:\?|$)/.test(url);

        if (typeof IS_STANDALONE !== 'undefined' && IS_STANDALONE) {
          if (isOfflineEndpoint) {
            const response = await localRequest(...args);
            return (isLibraryRead || isDeckCardsRead) ? { ...response, dataSource: 'local' } : response;
          }
          const err = new Error('Offline standalone mode: server endpoint unavailable');
          err.code = 'ERR_STANDALONE_OFFLINE';
          throw err;
        }

        if (forceOffline && isOfflineEndpoint) {
          try {
            const response = await localRequest(...args);
            // A browser without a downloaded library must not turn a failed
            // network request into an authoritative empty-account response.
            if (isLibraryRead && !isOfflineMode()) {
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (!items?.length) throw new Error('Library unavailable offline');
            }
            return (isLibraryRead || isDeckCardsRead)
              ? { ...response, dataSource: isOfflineMode() ? 'local' : 'cache' }
              : response;
          } catch (err) {
            if (err.code !== 'OFFLINE_UNSUPPORTED' || !navigator.onLine) throw err;
          }
        }

        const created = await tryLocalFirstNativeCreate({
          nativeCreate, requestAccount, args, isCurrent, assertCurrent, localRequest,
        });
        if (created) return created;

        // Try online server request first
        try {
          const needsRefresh = !nativeCreate && isOfflineMode() && isOfflineEndpoint && propKey !== 'get';
          if (needsRefresh) {
            const synced = await syncService.sync();
            if (!(synced.entities_success ?? synced.success)) throw new Error(synced.reason);
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
          return await reconcileOnlineResponse({
            propKey, url, args, response, requestAccount, requestIdentity, requestStartedAt,
            isLibraryRead, cardMatch, studyCardMatch, isCurrent, assertCurrent, localRequest, fetchFreshCard,
          });
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

          if (!networkErr?.skipOfflineFallback && isOfflineEndpoint && isNetworkFailure && !axios.isCancel(networkErr)) {
            console.log(`[Network Unavailable] Falling back to local offline DB for ${propKey.toUpperCase()} ${url}`);
            try {
              const response = await localRequest(...args);
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (isLibraryRead && !items?.length) throw networkErr;
              return (isLibraryRead || isDeckCardsRead) ? { ...response, dataSource: 'cache' } : response;
            } catch (localError) {
              if (nativeCreate) throw localError;
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
