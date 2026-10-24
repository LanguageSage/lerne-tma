import { create } from 'zustand';
import { tr } from '../i18n/locale';
import api from '../services/api';
import { getAccessToken, getUserProfile, saveUserProfile, saveAuthSession, clearAuthSession, getUserId, storage } from '../utils/auth';
import { closeLocalDb, resetAllDatabases } from '../services/localDb';
import { getPlatform, openExternalLink, prepareExternalLink } from '../utils/platform';
import { useUiStore } from './useUiStore';
import { useDeckStore } from './useDeckStore';
import { IS_LOCAL, localStorageKey } from '../utils/localMode.js';

const PENDING_KEY = localStorageKey('lerne_auth_v2_pending');
let pollTimer = null;
let listenersReady = false;
let exchangeInFlight = false;
let restoration = null;
let authGeneration = 0;
let telegramPreparation = null;
const challengeIsFresh = (challenge, purpose, margin = 0) => challenge?.purpose === purpose
  && Date.parse(challenge.expiresAt) > Date.now() + margin;
const requestChallenge = async (provider, purpose) => {
  if (IS_LOCAL) throw new Error('Social login is unavailable in LOCAL');
  const { data } = await api.post('/auth/v2/challenges', { provider, purpose });
  return { id: data.challenge_id, secret: data.secret, provider, purpose,
    expiresAt: data.expires_at, authUrl: data.authorization_url };
};
const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const pendingAuth = () => {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const savePending = (value) => {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch { /* unavailable */ }
};
const clearPending = () => {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* unavailable */ }
};
const authMessage = (error, fallback) => {
  const messages = {
    provider_not_configured: tr('Этот способ входа пока не настроен. Используйте email и пароль.'),
    reauthentication_required: tr('Войдите заново через привязанный Telegram или Google и повторите в течение 5 минут.'),
    invalid_credentials: tr('Неверный email или пароль.'),
    identity_conflict: tr('Этот способ входа уже принадлежит другому аккаунту. Аккаунты не объединены.'),
    email_unavailable: tr('Этот email недоступен для регистрации. Попробуйте войти.'),
    too_many_attempts: tr('Слишком много попыток. Повторите через 15 минут.'),
  };
  return messages[error.response?.data?.detail] || fallback;
};

export const useAuthStore = create((set, get) => ({
  userProfile: getUserProfile(),
  isRestoring: true,
  sessionRevision: 0,
  isPolling: false,
  isVerifyingCode: false,
  pendingGuestId: null,
  authModalOpen: false,
  authModalTab: 'telegram',
  authError: null,
  isStarting: false,
  authMethods: null,
  passwordSettings: null,
  lerneSso: null,
  showTelegramPrompt: false,
  // URL opened for the current pending challenge; shown as a fallback link
  // in AuthRequiredModal when the browser blocked the automatic popup.
  authUrl: null,
  // Preflight stays in memory; only an explicit click persists/starts polling it.
  preparedTelegramChallenge: null,

  prepareTelegramChallenge: (purpose = 'login') => {
    if (getPlatform() !== 'web' || get().isPolling || pendingAuth()) return Promise.resolve(null);
    const cached = get().preparedTelegramChallenge;
    if (challengeIsFresh(cached, purpose, 10000)) return Promise.resolve(cached);
    if (telegramPreparation?.purpose === purpose) return telegramPreparation.promise;
    set({ preparedTelegramChallenge: null });
    const generation = authGeneration;
    const preparation = { purpose };
    telegramPreparation = preparation;
    preparation.promise = requestChallenge('telegram', purpose).then(challenge => {
      if (telegramPreparation !== preparation || generation !== authGeneration) return null;
      set({ preparedTelegramChallenge: challenge });
      return challenge;
    }).finally(() => {
      if (telegramPreparation === preparation) telegramPreparation = null;
    });
    return preparation.promise;
  },

  waitForChallenge: (pending) => {
    savePending(pending);
    set({ isPolling: true, authError: null, authUrl: pending.authUrl });
    get().beginPolling();
  },

  activatePreparedTelegram: (id, purpose = 'login', recovery = false) => {
    const challenge = get().preparedTelegramChallenge;
    if (get().isStarting || get().isPolling || challenge?.id !== id || !challengeIsFresh(challenge, purpose)) return false;
    // Synchronous: the anchor's default navigation follows this click handler.
    get().waitForChallenge({ ...challenge, recovery });
    return true;
  },

  restoreSession: () => {
    if (restoration) return restoration;
    const generation = authGeneration;
    set({ isRestoring: true });
    restoration = (async () => {
      try {
        if (getAccessToken()) {
          const response = await api.get('/auth/v2/me');
          if (generation !== authGeneration) return;
          if (response.config?.headers?.Authorization && response.config.headers.Authorization !== `Bearer ${getAccessToken()}`) return;
          get().setUserProfile(response.data);
        } else if (IS_LOCAL) {
          const response = await api.post('/auth/local/login');
          if (generation !== authGeneration) return;
          await get().finishLogin(response.data);
        } else if (window.Telegram?.WebApp?.initData && storage.get('lerne_force_guest') !== 'true') {
          // A pending bot/OAuth challenge owns this round trip, including reloads.
          if (!pendingAuth()) await get().startProvider('telegram');
        }
        if (pendingAuth()) {
          const pending = pendingAuth();
          set({ isPolling: true, authUrl: pending.authUrl || null });
          get().setAuthModalOpen(true);
          get().beginPolling();
          await get().checkPendingSession();
        }
      } catch { /* Shared API handles invalid sessions; transient failures may retry. */ }
      finally { set({ isRestoring: false }); }
    })().finally(() => { restoration = null; });
    return restoration;
  },

  loadLerneSso: async () => {
    try {
      const response = await api.get('/auth/v2/lerne/config');
      set({ lerneSso: response.data });
      return response.data;
    } catch {
      set({ lerneSso: { role: null } });
      return { role: null };
    }
  },

  refreshAuthMethods: async () => {
    const generation = authGeneration;
    const userId = getUserId();
    try {
      const [identities, settings] = await Promise.all([
        api.get('/auth/v2/identities'), api.get('/auth/v2/password-settings'),
      ]);
      if (generation !== authGeneration || userId !== getUserId()) return null;
      set({ authMethods: identities.data.providers, passwordSettings: settings.data });
      return identities.data.providers;
    } catch {
      if (generation !== authGeneration || userId !== getUserId()) return null;
      set({ authMethods: null, passwordSettings: null });
      return null;
    }
  },

  setAuthModalOpen: (isOpen, tab = 'telegram') => {
    set({ authModalOpen: isOpen, authModalTab: tab, authError: null });
    useUiStore.getState().setIsAuthModalOpen(isOpen, tr('Вход в аккаунт'));
  },
  setAuthModalTab: (tab) => set({ authModalTab: tab, authError: null }),
  setUserProfile: (profile) => {
    set({ userProfile: profile });
    if (profile) saveUserProfile(profile);
    useUiStore.setState({ userProfile: profile });
  },

  finishLogin: async (tokens, { recovery = false, suggestTelegram = false } = {}) => {
    const generation = ++authGeneration;
    telegramPreparation = null;
    set({ preparedTelegramChallenge: null });
    const prevUserId = getUserId();
    saveAuthSession(tokens);
    const response = await api.get('/auth/v2/me');
    if (generation !== authGeneration) return null;
    const profile = response.data;
    if (prevUserId && String(prevUserId) !== String(profile.user_id)) {
      useDeckStore.getState().resetDeckStore?.();
      closeLocalDb(prevUserId);
    }
    get().setUserProfile(profile);
    storage.remove('lerne_init_cache');
    storage.remove('lerne_last_sync_time');
    storage.remove('lerne_force_guest');
    clearPending();
    stopPolling();
    const methods = await get().refreshAuthMethods();
    if (generation !== authGeneration) return null;
    const prompt = suggestTelegram && methods && !methods.includes('telegram');
    set(state => ({ sessionRevision: state.sessionRevision + 1, isPolling: false, authModalOpen: Boolean(prompt), showTelegramPrompt: Boolean(prompt), authError: null, authUrl: null }));
    useUiStore.getState().setIsAuthModalOpen(Boolean(prompt));
    if (recovery) useUiStore.getState().openSettings('profile');
    useUiStore.getState().showToast(tr('Вход выполнен. Ваши колоды и прогресс доступны.'), 'success');
    try {
      await useDeckStore.getState().fetchDecks(true);
      await useDeckStore.getState().fetchFolders();
    } catch { /* the authenticated UI may retry */ }
    return profile;
  },

  startProvider: async (provider, purpose = 'login', recovery = false) => {
    if (IS_LOCAL) return { success: false, error: 'Social login is unavailable in LOCAL' };
    if (get().isStarting || get().isPolling) return { success: false };
    set({ isStarting: true, authError: null });
    const generation = authGeneration;
    // Preserve the click's user activation before the challenge request.
    const miniAppData = window.Telegram?.WebApp?.initData;
    const directMiniApp = provider === 'telegram' && purpose === 'login' && miniAppData && !recovery;
    const preparedWindow = directMiniApp ? null : prepareExternalLink();
    try {
      if (directMiniApp) {
        let tokens;
        try {
          const response = await api.post('/auth/v2/telegram/mini-app', { init_data: miniAppData, purpose });
          tokens = response.data;
        } catch (error) {
          // Telegram keeps initData across reloads. It may be expired or already
          // consumed; use a fresh bot proof without relaxing server verification.
          if (!['invalid_provider_proof', 'provider_proof_replayed'].includes(error.response?.data?.detail)) throw error;
        }
        if (generation !== authGeneration) return { success: false };
        if (tokens) {
          const profile = await get().finishLogin(tokens);
          return { success: Boolean(profile) };
        }
      }
      const challenge = provider === 'telegram' && getPlatform() === 'web'
        ? await get().prepareTelegramChallenge(purpose)
        : await requestChallenge(provider, purpose);
      if (generation !== authGeneration) { preparedWindow?.close?.(); return { success: false }; }
      if (!challenge || !challengeIsFresh(challenge, purpose)) {
        preparedWindow?.close?.();
        return { success: false };
      }
      get().waitForChallenge({ ...challenge, recovery });
      // Never retry window.open after a request. A blocked/closed reservation
      // navigates this tab; sessionStorage preserves the exchange on return.
      if (!await openExternalLink(challenge.authUrl, preparedWindow, { allowPopup: false, sameTabFallback: true })) {
        set({ authError: tr('Окно входа не открылось. Нажмите ссылку ниже, подтвердите вход и вернитесь в приложение.') });
      }
      if (directMiniApp) get().setAuthModalOpen(true);
      return { success: true };
    } catch (error) {
      try {
        if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
      } catch { /* ignore popup cleanup errors */ }
      const message = authMessage(error, tr('Не удалось начать вход. Попробуйте ещё раз.'));
      set({ isPolling: false, authError: message, authUrl: null });
      useUiStore.getState().showToast(message, 'error');
      return { success: false, error: message };
    } finally {
      set({ isStarting: false });
    }
  },

  startTelegramLinking: () => get().startProvider('telegram'),
  startGoogleLogin: () => get().startProvider('google'),
  linkProvider: (provider) => get().startProvider(provider, 'link'),
  startPasswordRecovery: (provider = 'telegram') => get().startProvider(provider, 'login', true),
  cancelPendingAuth: () => {
    authGeneration++;
    telegramPreparation = null;
    clearPending();
    stopPolling();
    set({ isPolling: false, authError: null, authUrl: null, preparedTelegramChallenge: null });
  },

  loginWithEmailPassword: async (email, password, register = false) => {
    const generation = authGeneration;
    try {
      const path = register ? '/auth/v2/email-password/register' : '/auth/v2/email-password/login';
      const response = await api.post(path, { email, password });
      if (generation !== authGeneration) return { success: false };
      const profile = await get().finishLogin(response.data, { suggestTelegram: register });
      return { success: Boolean(profile) };
    } catch (error) {
      const message = authMessage(error, tr('Не удалось выполнить вход по email.'));
      set({ authError: message });
      useUiStore.getState().showToast(message, 'error');
      return { success: false, error: message };
    }
  },
  linkEmailPassword: async (email, password) => {
    try {
      const reset = get().passwordSettings?.email;
      await api.post(reset ? '/auth/v2/email-password/set' : '/auth/v2/email-password/link', { email, password });
      await get().refreshAuthMethods();
      useUiStore.getState().showToast(tr('Email и пароль сохранены как способ входа.'), 'success');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.detail === 'reauthentication_required'
        ? tr('Войдите заново через привязанный Telegram или Google и повторите в течение 5 минут.')
        : tr('Не удалось сохранить пароль. Проверьте данные и подключение.');
      useUiStore.getState().showToast(message, 'error');
      return { success: false, error: message };
    }
  },

  checkPendingSession: async () => {
    if (exchangeInFlight) return false;
    const pending = pendingAuth();
    if (!pending?.id || !pending?.secret) {
      get().cancelPendingAuth();
      return false;
    }
    const expiresAt = Date.parse(pending.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearPending();
      stopPolling();
      set({ isPolling: false, authError: tr('Время подтверждения истекло. Начните вход ещё раз.'), authUrl: null, preparedTelegramChallenge: null });
      return false;
    }
    exchangeInFlight = true;
    try {
      const response = await api.post(`/auth/v2/challenges/${pending.id}/exchange`, { secret: pending.secret });
      if (pendingAuth()?.id !== pending.id) return false;
      if (pending.purpose === 'link') {
        clearPending();
        stopPolling();
        await get().refreshAuthMethods();
        set({ isPolling: false, authModalOpen: false, showTelegramPrompt: false, authUrl: null, preparedTelegramChallenge: null });
        useUiStore.getState().setIsAuthModalOpen(false);
        useUiStore.getState().showToast(tr('Способ входа привязан.'), 'success');
      } else {
        await get().finishLogin(response.data, { recovery: pending.recovery });
      }
      return true;
    } catch (error) {
      // A challenge is expected to be unconfirmed while the app polls.
      if (pendingAuth()?.id !== pending.id) return false;
      const detail = error.response?.data?.detail;
      if (detail === 'invalid_challenge' || !error.response || error.response.status >= 500) return false;
      clearPending();
      stopPolling();
      set({ isPolling: false, authUrl: null, preparedTelegramChallenge: null });
      const message = authMessage(error, tr('Не удалось завершить вход.'));
      set({ authError: message });
      useUiStore.getState().showToast(message, 'error');
      return false;
    } finally {
      exchangeInFlight = false;
    }
  },

  beginPolling: () => {
    stopPolling();
    pollTimer = setInterval(() => get().checkPendingSession(), 2000);
  },

  // Kept as a clear UI response for obsolete controls in older cached bundles.
  loginWithCode: async () => ({ success: false, error: tr('Вход по коду больше не поддерживается.') }),
  logout: () => {
    authGeneration++;
    telegramPreparation = null;
    const currentUserId = getUserId();
    useDeckStore.getState().resetDeckStore?.();
    if (currentUserId) {
      closeLocalDb(currentUserId);
    }
    resetAllDatabases();
    clearAuthSession();
    storage.set('lerne_force_guest', 'true');
    clearPending();
    stopPolling();
    set({ userProfile: null, isPolling: false, authMethods: null, passwordSettings: null, showTelegramPrompt: false, authUrl: null, preparedTelegramChallenge: null });
    useUiStore.setState({ userProfile: null });
  },
  initListeners: () => {
    if (listenersReady || typeof window === 'undefined') return;
    listenersReady = true;
    const resume = () => {
      if (!document.hidden && pendingAuth()) {
        set({ isPolling: true, authUrl: pendingAuth().authUrl || null });
        get().beginPolling();
        get().checkPendingSession();
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('storage', event => {
      if (event.key !== localStorageKey('lerne_auth_v2_session') && event.key !== localStorageKey('lerne_user_profile') && event.key !== null) return;
      const previous = get().userProfile?.user_id;
      const profile = getAccessToken() ? getUserProfile() : null;
      if (event.key === localStorageKey('lerne_auth_v2_session') && previous === profile?.user_id) return;
      if (previous !== profile?.user_id) {
        authGeneration++;
        telegramPreparation = null;
        set({ preparedTelegramChallenge: null });
        useDeckStore.getState().resetDeckStore?.();
        if (previous) closeLocalDb(previous);
      }
      set(state => ({ userProfile: profile, sessionRevision: state.sessionRevision + 1 }));
      useUiStore.setState({ userProfile: profile });
    });
  },
}));
