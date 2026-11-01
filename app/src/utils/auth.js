import { tr } from '../i18n/locale.js';
import { IS_LOCAL, localStorageKey } from './localMode.js';

const storage = {
  get: (key) => { try { return localStorage.getItem(localStorageKey(key)); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(localStorageKey(key), value); } catch { /* unavailable */ } },
  remove: (key) => { try { localStorage.removeItem(localStorageKey(key)); } catch { /* unavailable */ } },
};

const SESSION_KEY = 'lerne_auth_v2_session';
const PROFILE_KEY = 'lerne_user_profile';

let memorySession = null;
let resetHandled = false;
const sessionListeners = new Set();
let loginRequired = false;
export const subscribeAuthSession = listener => {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
};
export const notifyAuthSession = () => {
  if (getAuthSession()) loginRequired = false;
  sessionListeners.forEach(listener => listener({ loginRequired }));
};
export const getSessionIdentity = (session = getAuthSession()) =>
  session?.client_session_id || session?.session_id || session?.refresh_token || session?.access_token || null;

export const getAuthSession = () => {
  try {
    // Read shared storage on every request: another tab may rotate or clear it.
    const value = localStorage.getItem(localStorageKey(SESSION_KEY));
    const parsed = value ? JSON.parse(value) : null;
    if (parsed?.access_token || parsed?.refresh_token) {
      memorySession = parsed;
      return memorySession;
    }
    memorySession = null;
    return null;
  } catch { return memorySession; }
};

export const getAccessToken = () => getAuthSession()?.access_token || null;

export const saveAuthSession = (session, { previousSession } = {}) => {
  if (!session?.access_token || !session?.refresh_token) throw new Error('Invalid authentication session');
  memorySession = { ...session, client_session_id: previousSession
    ? getSessionIdentity(previousSession)
    : (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`) };
  loginRequired = false;
  storage.set(SESSION_KEY, JSON.stringify(memorySession));
  notifyAuthSession();
};

export const clearAuthSession = ({ preserveProfile = false } = {}) => {
  memorySession = null;
  storage.remove(SESSION_KEY);
  if (!preserveProfile) {
    storage.remove(PROFILE_KEY);
    storage.remove('lerne_user_id');
    storage.remove('lerne_init_cache');
    storage.remove('lerne_last_sync_time');
    storage.remove('lerne_current_deck_id');
  }
  notifyAuthSession();
};

// Compare before clearing: late responses and other tabs cannot log out a newer login.
export const requireAuthSession = (expectedIdentity = getSessionIdentity()) => {
  if (expectedIdentity !== getSessionIdentity() || loginRequired) return;
  loginRequired = true;
  clearAuthSession({ preserveProfile: true });
};

export const parseUserId = (value) => {
  const id = parseInt(value, 10);
  return Number.isNaN(id) || id <= 0 ? null : id;
};

export const getUserProfile = () => {
  try {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const isResetRequested = params?.get('guest') === '1' || params?.get('reset') === '1';

    if (isResetRequested && !resetHandled) {
      resetHandled = true;
      clearAuthSession();
      // Consume this one-shot action in the URL too, so a later reload cannot
      // erase a session established after the reset.
      params.delete('guest');
      params.delete('reset');
      const query = params.toString();
      window.history.replaceState(window.history.state, '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }

    const session = getAuthSession();
    const profile = getSavedUserProfile();
    if (!session || !profile) return null;
    if (session.account_id != null && String(session.account_id) !== String(profile.user_id)) return null;
    return profile;
  } catch {
    return null;
  }
};

// Saved identity selects the offline database; it is never an HTTP credential.
export const getSavedUserProfile = () => {
  try {
    const profile = JSON.parse(storage.get(PROFILE_KEY) || 'null');
    if (profile?.user_id) return profile;
    const userId = parseUserId(storage.get('lerne_user_id'));
    return userId ? { user_id: userId, is_guest: true } : null;
  } catch { return null; }
};
export const getUserId = () => getAuthSession()?.account_id ?? getSavedUserProfile()?.user_id ?? null;

export const saveUserProfile = (profile) => {
  if (!profile?.user_id) return;
  storage.set(PROFILE_KEY, JSON.stringify({ ...profile, is_guest: false }));
  storage.set('lerne_user_id', String(profile.user_id));
  notifyAuthSession();
};

export const resetUserSession = () => {
  clearAuthSession();
  window.location.assign(window.location.origin + window.location.pathname);
};

export const cloudStorage = {
  get: (key) => new Promise((resolve) => {
    if (IS_LOCAL) { resolve(null); return; }
    try {
      const cloud = window.Telegram?.WebApp?.CloudStorage;
      cloud?.getItem ? cloud.getItem(key, (error, value) => resolve(error ? null : value)) : resolve(null);
    } catch { resolve(null); }
  }),
  set: (key, value) => new Promise((resolve) => {
    if (IS_LOCAL) { resolve(false); return; }
    try {
      const cloud = window.Telegram?.WebApp?.CloudStorage;
      cloud?.setItem ? cloud.setItem(key, String(value), (error) => resolve(!error)) : resolve(false);
    } catch { resolve(false); }
  }),
};

export { storage, tr };
