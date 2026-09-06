import { tr } from '../i18n/locale';
import { create } from 'zustand';
import api from '../services/api';
import { getUserProfile, getUserId, storage } from '../utils/auth';
import { openExternalLink } from '../utils/platform';
import { useUiStore } from './useUiStore';
import { useDeckStore } from './useDeckStore';

let pollingInterval = null;
let visibilityListenerAttached = false;

export const useAuthStore = create((set, get) => ({
  userProfile: getUserProfile(),
  isPolling: false,
  isVerifyingCode: false,
  pendingGuestId: (() => {
    try { return sessionStorage.getItem('lerne_pending_guest_id'); } catch { return null; }
  })(),
  authModalOpen: false,
  authModalTab: 'telegram', // 'telegram' | 'code'
  authError: null,

  setAuthModalOpen: (isOpen, tab = 'telegram') => {
    set({ authModalOpen: isOpen, authModalTab: tab, authError: null });
    useUiStore.getState().setIsAuthModalOpen(isOpen, tab === 'code' ? tr("Вход по коду") : tr("Вход в аккаунт"));
  },

  setAuthModalTab: (tab) => set({ authModalTab: tab, authError: null }),

  setUserProfile: (profile) => {
    set({ userProfile: profile });
    if (profile?.user_id) {
      storage.set('lerne_user_id', profile.user_id);
      storage.set('lerne_user_profile', JSON.stringify(profile));
    }
    useUiStore.setState({ userProfile: profile });
  },

  // Start polling & open Telegram bot link for linking
  startTelegramLinking: async () => {
    const currentProfile = get().userProfile || getUserProfile();
    const guestId = currentProfile?.user_id || getUserId();
    const botUrl = `https://t.me/LerneDeutsch287_bot?start=link_${guestId}`;

    try {
      await api.post(`/auth/session?guest_id=${guestId}`);
      try { sessionStorage.setItem('lerne_pending_guest_id', String(guestId)); } catch { /* ignore */ }
      set({ isPolling: true, pendingGuestId: String(guestId), authError: null });

      // Start polling
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = setInterval(async () => {
        const completed = await get().checkPendingSession(guestId);
        if (completed && pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      }, 2000);

      // Automatically timeout polling after 2 minutes
      setTimeout(() => {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        set({ isPolling: false });
      }, 120000);

      // Open Telegram bot
      openExternalLink(botUrl);
    } catch (err) {
      console.error("Failed to initiate Telegram link session:", err);
      useUiStore.getState().showToast(tr("Не удалось подключиться к Telegram"), "error");
      set({ isPolling: false });
    }
  },

  // Check pending session status (called on timer, button, or when app returns to foreground)
  checkPendingSession: async (targetGuestId = null) => {
    let guestId = targetGuestId || get().pendingGuestId;
    if (!guestId) {
      try { guestId = sessionStorage.getItem('lerne_pending_guest_id'); } catch { /* ignore */ }
    }
    if (!guestId) return false;

    try {
      const res = await api.get(`/auth/session/${guestId}`);
      if (res.data?.status === 'completed' && res.data?.user) {
        const newUser = res.data.user;
        try { sessionStorage.removeItem('lerne_pending_guest_id'); } catch { /* ignore */ }
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }

        get().setUserProfile(newUser);
        set({ isPolling: false, pendingGuestId: null, authModalOpen: false, authError: null });

        storage.remove('lerne_last_sync_time');
        storage.remove('lerne_last_sync_user_id');
        storage.remove('lerne_init_cache');

        useUiStore.getState().showToast(tr("Добро пожаловать, {{p0}}!", { p0: newUser.first_name || tr("друг") }), "success");

        // Reload fresh decks & folders for newly authenticated user
        try {
          await useDeckStore.getState().fetchDecks(true);
          await useDeckStore.getState().fetchFolders();
        } catch { /* ignore */ }

        return true;
      }
    } catch (e) {
      console.warn("Error checking pending session:", e);
    }
    return false;
  },

  // Enter and verify 6-digit code from Telegram bot
  loginWithCode: async (code) => {
    const cleanCode = (code || '').replace(/\s+/g, '').replace(/-/g, '').trim();
    if (!cleanCode || cleanCode.length !== 6 || !/^\d+$/.test(cleanCode)) {
      const msg = tr("Код должен состоять из 6 цифр");
      set({ authError: msg });
      return { success: false, error: msg };
    }

    set({ isVerifyingCode: true, authError: null });
    const currentProfile = get().userProfile || getUserProfile();
    const guestId = currentProfile?.is_guest ? currentProfile.user_id : null;

    try {
      const res = await api.post('/auth/code/verify', {
        code: cleanCode,
        guest_id: guestId
      });

      if (res.data?.status === 'ok' && res.data?.user) {
        const user = res.data.user;
        get().setUserProfile(user);
        set({ isVerifyingCode: false, authModalOpen: false, authError: null });

        try { sessionStorage.removeItem('lerne_pending_guest_id'); } catch { /* ignore */ }
        storage.remove('lerne_last_sync_time');
        storage.remove('lerne_last_sync_user_id');
        storage.remove('lerne_init_cache');

        useUiStore.getState().showToast(tr("Вход выполнен! Привет, {{p0}}!", { p0: user.first_name || tr("друг") }), "success");

        // Refresh decks & folders for newly authenticated user
        try {
          await useDeckStore.getState().fetchDecks(true);
          await useDeckStore.getState().fetchFolders();
        } catch { /* ignore */ }

        return { success: true, user };
      } else {
        const msg = res.data?.message || tr("Неверный код");
        set({ isVerifyingCode: false, authError: msg });
        return { success: false, error: msg };
      }
    } catch (err) {
      const msg = err.response?.data?.detail || tr("Ошибка проверки кода. Проверьте код или запросите новый в боте.");
      set({ isVerifyingCode: false, authError: msg });
      return { success: false, error: msg };
    }
  },

  // Listen for visibility and focus to resume polling / check session
  initListeners: () => {
    if (visibilityListenerAttached || typeof window === 'undefined') return;
    visibilityListenerAttached = true;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        let pending = null;
        try { pending = sessionStorage.getItem('lerne_pending_guest_id'); } catch { /* ignore */ }
        if (pending || get().pendingGuestId || get().userProfile?.is_guest) {
          get().checkPendingSession();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
  }
}));
