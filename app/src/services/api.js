import axios from 'axios';
import { getAccessToken, getAuthSession, saveAuthSession, requireAuthSession, getSessionIdentity, getUserId } from '../utils/auth.js';
import { isOfflineMode, resolveLocalRequest, prepareLocalDb, getLocalDb } from './localDb.js';
import { offlineApi } from './offlineApi.js';
import { API_BASE_URL } from './apiConfig.js';
import { IS_LOCAL } from '../utils/localMode.js';
import { syncService } from './syncService.js';

const baseURL = API_BASE_URL;

const axiosInstance = axios.create({
  baseURL: baseURL,
  timeout: 30000,
});

// Bearer is the only credential. Saved account IDs only select offline storage.
axiosInstance.interceptors.request.use((config) => {
  if (config._retry && config._authIdentity !== getSessionIdentity()) {
    throw new axios.CanceledError('Session changed before retry');
  }
  if (config._expectedUserId !== undefined && config._expectedUserId !== getUserId()) {
    throw new axios.CanceledError('Account changed before request');
  }
  if (IS_LOCAL && (config.baseURL !== '/api' || !config.url?.startsWith('/') || config.url.startsWith('//'))) {
    throw new Error('External API requests disabled in LOCAL');
  }
  const url = config.url || '';
  if (/(?:\/ai\/|\/cards\/ai-)(?:enrich|generate)-batch/.test(url)) {
    config.timeout = 150000;
  } else if (url.includes('/cards/bulk-save')) {
    config.timeout = 120000;
  } else if (url.includes('/ai') || url.includes('/cards/ai-generate') || url.includes('/cards/save')) {
    config.timeout = config.timeout > 45000 ? config.timeout : 45000;
  }
  const token = getAccessToken();
  if (token && !config.headers?.Authorization) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  const userId = getUserId();
  if (!config._retry) {
    config._authUserId = userId;
    config._authIdentity = getSessionIdentity();
  }
  if (config.method && config.method.toLowerCase() === 'get') {
    if (/_t=\d+/.test(config.url)) {
      config.url = config.url.replace(/_t=\d+/, `_t=${Date.now()}`);
    } else {
      const separator = config.url.includes('?') ? '&' : '?';
      config.url = `${config.url}${separator}_t=${Date.now()}`;
    }
  }
  return config;
});

// Flights never share refresh results across credentials.
const refreshFlights = new Map();
// Older WebViews may lack Web Locks. An atomic lease in the existing account
// syncState table serializes them too; no user data or schema is changed.
const withRefreshLease = async (identity, refresh) => {
  const database = getLocalDb();
  const key = 'auth-v2-refresh-lease';
  const owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let acquired = false;
  while (!acquired) {
    if (getSessionIdentity() !== identity) throw new axios.CanceledError('Session changed while waiting for refresh');
    acquired = await database.transaction('rw', database.syncState, async () => {
      const lease = await database.syncState.get(key);
      if (lease && lease.expiresAt > Date.now()) return false;
      await database.syncState.put({ key, owner, expiresAt: Date.now() + 20000 });
      return true;
    });
    if (!acquired) await new Promise(resolve => setTimeout(resolve, 100));
  }
  try {
    return await refresh(async () => {
      const lease = await database.syncState.get(key);
      return lease?.owner === owner && lease.expiresAt > Date.now();
    });
  } finally {
    await database.transaction('rw', database.syncState, async () => {
      if ((await database.syncState.get(key))?.owner === owner) await database.syncState.delete(key);
    }).catch(() => {}); // A switched account may have closed this connection; the lease expires.
  }
};
const refreshSession = (session) => {
  const key = session.refresh_token;
  if (refreshFlights.has(key)) return refreshFlights.get(key);
  const identity = getSessionIdentity(session);
  const account = getUserId();
  const refresh = async (ownsLock = () => true) => {
    const current = getAuthSession();
    if (!current && getUserId() === account) {
      requireAuthSession(null);
      throw Object.assign(new Error('authentication_required'), { response: { status: 401 } });
    }
    if (getSessionIdentity(current) !== identity) throw new axios.CanceledError('Session changed during refresh');
    if (current.refresh_token !== key) return current;
    let data;
    try {
      ({ data } = await axios.post(`${baseURL}/auth/v2/refresh`, { refresh_token: key }, {
        headers: { 'Content-Type': 'application/json' }, timeout: 10000,
      }));
    } catch (error) {
      if (!await ownsLock()) throw new axios.CanceledError('Refresh lease expired');
      if (getSessionIdentity() !== identity) throw new axios.CanceledError('Session changed during refresh');
      // Retire rejected credentials while still holding the cross-tab lock.
      if (error.response?.status === 401 && getAuthSession()?.refresh_token === key) requireAuthSession(identity);
      throw error;
    }
    if (!await ownsLock() || getSessionIdentity() !== identity || getAuthSession()?.refresh_token !== key) {
      throw new axios.CanceledError('Session changed during refresh');
    }
    saveAuthSession(data, { previousSession: current });
    return getAuthSession();
  };
  const flight = (typeof navigator !== 'undefined' && navigator.locks?.request
    ? navigator.locks.request(IS_LOCAL ? 'lerne-local-auth-v2-refresh' : 'lerne-auth-v2-refresh', () => refresh())
    : withRefreshLease(identity, refresh)).finally(() => refreshFlights.delete(key));
  refreshFlights.set(key, flight);
  return flight;
};

axiosInstance.interceptors.response.use(
  (response) => {
    if (response.config?._authIdentity !== getSessionIdentity()) {
      throw new axios.CanceledError('Session changed before response');
    }
    return response;
  },
  async (error) => {
    const originalRequest = error?.config;
    if (!originalRequest) return Promise.reject(error);
    if (getSessionIdentity() !== originalRequest._authIdentity || getUserId() !== originalRequest._authUserId) {
      // Another tab/request already retired this credential for the same owner.
      // Preserve the 401 so an active navigation can retain its login continuation.
      if (error.response?.status === 401 && !getAuthSession() && getUserId() === originalRequest._authUserId) {
        requireAuthSession(null);
        return Promise.reject(error);
      }
      return Promise.reject(new axios.CanceledError('Session changed before response'));
    }

    const is401 = error.response && error.response.status === 401;
    const url = originalRequest.url || '';
    const isAuthEndpoint = 
      url.includes('/auth/v2/refresh') ||
      url.includes('/auth/v2/telegram/mini-app') ||
      url.includes('/auth/v2/email-password/login') ||
      url.includes('/auth/v2/email-password/register') ||
      url.includes('/auth/v2/challenges');

    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      const isAiUrl = url.includes('/ai') || url.includes('/cards/ai-generate');
      const detailMsg = isAiUrl 
        ? `Таймаут ожидания ИИ (${Math.round((originalRequest.timeout || 45000) / 1000)}с): результат запроса пока неизвестен. Повторите тот же запрос.`
        : `Таймаут соединения: сервер не ответил в течение ${originalRequest?.timeout ? Math.round(originalRequest.timeout / 1000) : 30}с.`;
      error.customTimeoutMsg = detailMsg;
      if (!error.response) {
        error.response = { status: 504, data: { detail: detailMsg, error: detailMsg } };
      }
    }

    if (!is401 || isAuthEndpoint) return Promise.reject(error);
    const session = getAuthSession();
    const currentToken = getAccessToken();
    // An older access token may already have been rotated by another request/tab.
    if (currentToken && originalRequest.headers?.Authorization !== `Bearer ${currentToken}`) {
      if (originalRequest._retry) return Promise.reject(new axios.CanceledError('Token rotated again before 401'));
      originalRequest._retry = true;
      originalRequest.headers.Authorization = `Bearer ${currentToken}`;
      return axiosInstance(originalRequest);
    }
    if (originalRequest._retry || !session?.refresh_token) {
      requireAuthSession(originalRequest._authIdentity);
      return Promise.reject(error);
    }
    originalRequest._retry = true;
    try {
      const renewed = await refreshSession(session);
      if (getSessionIdentity() !== originalRequest._authIdentity || getAccessToken() !== renewed.access_token) {
        throw new axios.CanceledError('Session changed before retry');
      }
      originalRequest.headers.Authorization = `Bearer ${renewed.access_token}`;
      return axiosInstance(originalRequest);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  }
);

// Проксируем методы Axios для поддержки офлайн-режима и автоматического фоллбека
const api = new Proxy(axiosInstance, {
  get(target, propKey, receiver) {
    if (['get', 'post', 'put', 'delete', 'patch'].includes(propKey)) {
      return async (url, ...args) => {
        const requestIdentity = getSessionIdentity();
        const requestAccount = getUserId();
        if (url.startsWith('/card-notes/')) return offlineApi.handle(propKey, url, ...args);
        if (isOfflineMode()) {
          await prepareLocalDb();
          const resolved = await resolveLocalRequest(url, args[0]);
          url = resolved.url;
          if (args.length) args[0] = resolved.body;
        }
        const isOfflineEndpoint = 
          url.startsWith('/decks') || 
          url.startsWith('/folders') ||
          url.startsWith('/cards') || 
          url.startsWith('/study') || 
          url.startsWith('/trash') ||
          url.startsWith('/init');

        const forceOffline = isOfflineMode() || (typeof navigator !== 'undefined' && !navigator.onLine);
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
          const needsRefresh = isOfflineMode() && isOfflineEndpoint && propKey !== 'get';
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
            } catch {
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
