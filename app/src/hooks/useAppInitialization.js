import { useEffect } from 'react';
import { getUserId, getUserProfile, storage, cloudStorage } from '../utils/auth';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DESIGN_PRESETS } from '../constants/appConstants';
import { isOfflineMode } from '../services/localDb';
import { syncService } from '../services/syncService';

const SETTINGS_VERSION = '6';

export const useAppInitialization = (checkStartParam) => {
  const { setUserProfile, showToast, setActiveTutorial } = useUiStore();
  const { setAdminSettings, setUserPrompts, applyDesignPreset } = useSettingsStore();

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      console.log("Telegram WebApp Ready");
    }

    const init = async () => {
      const profile = getUserProfile();
      setUserProfile(profile);

      // 0. Attempt Telegram CloudStorage language restoration
      try {
        const cloudHasSelected = await cloudStorage.get('lerne_has_selected_language');
        const cloudLang = await cloudStorage.get('lerne_target_language');
        if (cloudHasSelected === 'true' && cloudLang) {
          const { useLanguageStore } = await import('../store/useLanguageStore');
          useLanguageStore.getState().syncLanguageFromExternal(cloudLang, true);
        }

        const cloudNativeSel = await cloudStorage.get('lerne_native_language_selected');
        const cloudNativeLang = await cloudStorage.get('lerne_native_language');
        if (cloudNativeSel === 'true' && cloudNativeLang) {
          localStorage.setItem('native_language', cloudNativeLang);
          localStorage.setItem('native_language_selected', 'true');
        }
      } catch (e) {
        console.warn("CloudStorage language restore failed:", e);
      }

      // Instant UI restore from cache if available
      loadCachedInitData();

      // 1. Await profile sync FIRST to guarantee user exists in backend DB before fetching initial decks
      await syncProfile(profile);

      // 2. Perform auto-sync in offline mode if online
      if (isOfflineMode() && navigator.onLine) {
        try {
          await syncService.sync();
        } catch (e) {
          console.error("Startup sync failed:", e);
        }
      }

      // 3. Fetch fresh init data from backend
      await fetchInitData();
    };

    init();

    // Check start param on mount
    checkStartParam();

    // Listen for visibility changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("App became visible, re-checking parameters...");
        setTimeout(checkStartParam, 500);
        if (isOfflineMode() && navigator.onLine) {
          syncService.sync().catch(e => console.error("Visibility sync failed:", e));
        }
      }
    };

    // Listen for online event (reconnection)
    const handleOnline = () => {
      console.log("[Sync] Network online detected. Triggering auto-sync...");
      if (isOfflineMode()) {
        syncService.sync().catch(e => console.error("Online event sync failed:", e));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    // Periodic background sync every 60 seconds
    const syncInterval = setInterval(() => {
      if (isOfflineMode() && navigator.onLine) {
        syncService.sync().catch(e => console.error("Periodic sync failed:", e));
      }
    }, 60000);

    const USER_ID = getUserId();
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || USER_ID === 642478257) {
      useSettingsStore.setState({ isAdmin: true });
    }

    const currentVersion = storage.get('lerne_settings_version');
    if (currentVersion !== SETTINGS_VERSION) {
      console.log(`Migrating settings to v${SETTINGS_VERSION}...`);
      const defaultSettings = DESIGN_PRESETS.find(p => p.id === 'lerne_2026')?.settings;
      if (defaultSettings) {
        applyDesignPreset({ name: 'Lerne 2026', settings: defaultSettings });
      }
      storage.set('lerne_settings_version', SETTINGS_VERSION);
    }

    const welcomed = storage.get('lerne_welcome_seen');
    if (!welcomed) {
      setTimeout(() => {
        setActiveTutorial('welcome');
        storage.set('lerne_welcome_seen', 'true');
      }, 1500);
    } else {
      setTimeout(async () => {
        const { useLanguageStore } = await import('../store/useLanguageStore');
        const langState = useLanguageStore.getState();
        if (langState.hasSelectedLanguage) return;

        // Double check CloudStorage
        const cloudHasSelected = await cloudStorage.get('lerne_has_selected_language');
        const cloudLang = await cloudStorage.get('lerne_target_language');
        if (cloudHasSelected === 'true' && cloudLang) {
          langState.syncLanguageFromExternal(cloudLang, true);
          return;
        }

        // Double check LocalStorage
        if (localStorage.getItem('lerne_has_selected_language') === 'true') {
          langState.syncLanguageFromExternal(localStorage.getItem('lerne_target_language') || 'de', true);
          return;
        }

        if (!langState.hasSelectedLanguage) {
          langState.setLanguageModalOpen(true);
        }
      }, 1200);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      clearInterval(syncInterval);
    };
  }, []);

  const CACHE_VERSION = '3'; // bump to invalidate cached deck ids after cloud DB migration

  const loadCachedInitData = () => {
    try {
      const cacheVer = storage.get('lerne_init_cache_version');
      if (cacheVer !== CACHE_VERSION) {
        // Stale cache — wipe it so we always get fresh data from server
        storage.remove('lerne_init_cache');
        storage.set('lerne_init_cache_version', CACHE_VERSION);
        return;
      }
      const cachedRaw = storage.get('lerne_init_cache');
      if (cachedRaw) {
        const data = JSON.parse(cachedRaw);
        const { setDecks, setFolders } = useDeckStore.getState();
        if (data.decks && data.decks.length > 0) {
          setDecks(data.decks);
        }
        if (data.folders) {
          setFolders(data.folders);
        }
        if (data.settings) setAdminSettings(data.settings);
        if (data.prompts) setUserPrompts(data.prompts);
      }
    } catch (e) {
      console.error("Failed to load cached init data:", e);
    }
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // ⚠️ CRITICAL NETWORK STABILITY GUARANTEE: DO NOT REMOVE OR BYPASS RETRY LOGIC (requestWithRetry).
  // Required to protect against Supabase cloud DB cold starts, TCP disconnects, and backend reboots!
  const requestWithRetry = async (requestFn, label, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await requestFn();
      } catch (err) {
        lastError = err;
        if (attempt === attempts) break;
        console.warn(`${label} failed on attempt ${attempt}, retrying...`, err);
        await sleep(400 * attempt);
      }
    }
    throw lastError;
  };

  const fetchInitData = async () => {
    const { setDecks, setFolders, fetchDuplicates } = useDeckStore.getState();
    const currentDecks = useDeckStore.getState().decks;
    if (!currentDecks || currentDecks.length === 0) {
      useUiStore.setState({ loading: true });
    }
    try {
      const res = await requestWithRetry(() => api.get('/init'), 'Init data load');
      const freshDecks = res.data.decks || [];
      setDecks(freshDecks);
      if (res.data.folders) {
        setFolders(res.data.folders);
      }
      setAdminSettings(res.data.settings);
      setUserPrompts(res.data.prompts);

      if (res.data.user_info?.has_selected_language || res.data.user_info?.active_language) {
        const { useLanguageStore } = await import('../store/useLanguageStore');
        useLanguageStore.getState().syncLanguageFromExternal(
          res.data.user_info.active_language || 'de',
          Boolean(res.data.user_info.has_selected_language)
        );
      }

      if (res.data.user_info?.native_language) {
        localStorage.setItem('native_language', res.data.user_info.native_language);
        localStorage.setItem('native_language_selected', 'true');
        cloudStorage.set('lerne_native_language', res.data.user_info.native_language);
        cloudStorage.set('lerne_native_language_selected', 'true');
      }

      // Cache init response for instant future starts
      storage.set('lerne_init_cache', JSON.stringify(res.data));
      storage.set('lerne_init_cache_version', CACHE_VERSION);
      fetchDuplicates();

      // If user opened a deck while startup init was running, re-sync cards for current deck
      const uiState = useUiStore.getState();
      const currDeck = useDeckStore.getState().currentDeck;
      if (uiState.view === 'cards' && currDeck?.id) {
        const freshCurrentDeck = freshDecks.find(d => d.id === currDeck.id)
          || freshDecks.find(d => d.name === currDeck.name && d.stats?.total > 0)
          || freshDecks.find(d => d.name === currDeck.name);
        if (freshCurrentDeck) {
          useDeckStore.getState().setCurrentDeck(freshCurrentDeck);
          useDeckStore.getState().fetchDeckCards(freshCurrentDeck.id);
        } else {
          useDeckStore.getState().fetchDeckCards(currDeck.id);
        }
      }
    } catch (err) {
      console.error("Init Data Error:", err);
      const decksNow = useDeckStore.getState().decks;
      if (!decksNow || decksNow.length === 0) {
        showToast("Ошибка загрузки данных.");
      }
    } finally {
      useUiStore.setState({ loading: false });
    }
  };

  const syncProfile = async (currentProfile) => {
    try {
      const { useLanguageStore } = await import('../store/useLanguageStore');
      const langState = useLanguageStore.getState();

      // 1. Пытаемся получить существующий профиль из БД сервера
      try {
        const meRes = await api.get('/auth/me');
        if (meRes.data && meRes.data.user_id) {
          const dbProfile = meRes.data;
          setUserProfile(dbProfile);
          storage.set('lerne_user_profile', JSON.stringify(dbProfile));

          if (dbProfile.has_selected_language || dbProfile.active_language) {
            langState.syncLanguageFromExternal(
              dbProfile.active_language || 'de',
              Boolean(dbProfile.has_selected_language)
            );
          }

          if (dbProfile.native_language) {
            localStorage.setItem('native_language', dbProfile.native_language);
            localStorage.setItem('native_language_selected', 'true');
            cloudStorage.set('lerne_native_language', dbProfile.native_language);
            cloudStorage.set('lerne_native_language_selected', 'true');
          }

          if (currentProfile.is_guest && !dbProfile.is_guest) {
            console.log("Found real user profile in DB. Fetching data...");
            await fetchInitData();
          }
          return;
        }
      } catch {
        // Запись в БД еще не создана
      }

      // 2. Если профиля в БД еще нет, выполняем синхронизацию
      const syncPayload = {
        first_name: currentProfile.first_name,
        last_name: currentProfile.last_name,
        username: currentProfile.username,
        photo_url: currentProfile.photo_url,
        is_guest: currentProfile.is_guest,
        active_language: langState.activeLanguage,
        native_language: localStorage.getItem('native_language') || 'uk'
      };
      if (langState.hasSelectedLanguage) {
        syncPayload.has_selected_language = true;
      }

      const res = await requestWithRetry(() => api.post('/auth/sync', syncPayload), 'Profile sync');

      if (res.data.status === 'ok' && res.data.user) {
        const newProfile = res.data.user;
        setUserProfile(newProfile);
        storage.set('lerne_user_profile', JSON.stringify(newProfile));

        if (newProfile.has_selected_language || newProfile.active_language) {
          langState.syncLanguageFromExternal(
            newProfile.active_language || 'de',
            Boolean(newProfile.has_selected_language)
          );
        }

        if (newProfile.native_language) {
          localStorage.setItem('native_language', newProfile.native_language);
          localStorage.setItem('native_language_selected', 'true');
          cloudStorage.set('lerne_native_language', newProfile.native_language);
          cloudStorage.set('lerne_native_language_selected', 'true');
        }
      }
    } catch (err) {
      console.error("Profile sync error:", err);
    }
  };
};
