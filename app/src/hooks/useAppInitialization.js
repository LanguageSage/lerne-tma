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
  const { setUserProfile, showToast } = useUiStore();
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

      // Instant UI restore from cache if available (synchronous)
      loadCachedInitData();

      // CloudStorage language restoration in background (non-blocking)
      (async () => {
        try {
          const [cloudHasSelected, cloudLang, cloudNativeSel, cloudNativeLang] = await Promise.all([
            cloudStorage.get('lerne_has_selected_language'),
            cloudStorage.get('lerne_target_language'),
            cloudStorage.get('lerne_native_language_selected'),
            cloudStorage.get('lerne_native_language')
          ]);
          if (cloudHasSelected === 'true' && cloudLang) {
            const { useLanguageStore } = await import('../store/useLanguageStore');
            useLanguageStore.getState().syncLanguageFromExternal(cloudLang, true);
          }
          if (cloudNativeSel === 'true' && cloudNativeLang) {
            localStorage.setItem('native_language', cloudNativeLang);
            localStorage.setItem('native_language_selected', 'true');
          }
        } catch (e) {
          console.warn("CloudStorage language restore failed:", e);
        }
      })();

      // 1. Fetch fresh init data from backend immediately
      const initPromise = fetchInitData();

      // 2. Sync profile in parallel
      syncProfile(profile).catch(e => console.error("Profile sync error:", e));

      // 3. Perform background sync in offline mode if online
      if (isOfflineMode() && navigator.onLine) {
        syncService.sync().catch(e => console.error("Startup sync failed:", e));
      }

      await initPromise;
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

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      clearInterval(syncInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        const { setDecks, setFolders, setCurrentDeck } = useDeckStore.getState();
        if (data.decks && data.decks.length > 0) {
          setDecks(data.decks);
          const savedDeckId = storage.get('lerne_current_deck_id');
          if (savedDeckId) {
            const cachedCurrent = data.decks.find(d => String(d.id) === String(savedDeckId));
            if (cachedCurrent) {
              setCurrentDeck(cachedCurrent);
            }
          }
        }
        if (data.folders && Array.isArray(data.folders)) {
          const sortedFolders = [...data.folders];
          const storedFolderOrderStr = localStorage.getItem('lerne_folder_order');
          const storedOrder = storedFolderOrderStr ? JSON.parse(storedFolderOrderStr) : null;
          sortedFolders.sort((a, b) => {
            if (storedOrder && Array.isArray(storedOrder)) {
              const idxA = storedOrder.indexOf(a.id);
              const idxB = storedOrder.indexOf(b.id);
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
            }
            const aPos = a.position ?? 0;
            const bPos = b.position ?? 0;
            if (aPos !== bPos) return aPos - bPos;
            return a.id - b.id;
          });
          setFolders(sortedFolders);
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
        const freshFolders = [...res.data.folders];
        const storedFolderOrderStr = localStorage.getItem('lerne_folder_order');
        const storedOrder = storedFolderOrderStr ? JSON.parse(storedFolderOrderStr) : null;
        freshFolders.sort((a, b) => {
          if (storedOrder && Array.isArray(storedOrder)) {
            const idxA = storedOrder.indexOf(a.id);
            const idxB = storedOrder.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
          }
          const aPos = a.position ?? 0;
          const bPos = b.position ?? 0;
          if (aPos !== bPos) return aPos - bPos;
          return a.id - b.id;
        });
        setFolders(freshFolders);
        res.data.folders = freshFolders;
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

      // If user opened a deck or refreshed, re-sync currentDeck & cards for current deck
      const uiState = useUiStore.getState();
      const savedDeckId = storage.get('lerne_current_deck_id');
      const currDeck = useDeckStore.getState().currentDeck 
        || (savedDeckId ? freshDecks.find(d => String(d.id) === String(savedDeckId)) : null);

      if (currDeck) {
        const freshCurrentDeck = freshDecks.find(d => d.id === currDeck.id)
          || freshDecks.find(d => d.name === currDeck.name && d.stats?.total > 0)
          || freshDecks.find(d => d.name === currDeck.name)
          || currDeck;
        useDeckStore.getState().setCurrentDeck(freshCurrentDeck);
        if (uiState.view === 'cards') {
          useDeckStore.getState().fetchDeckCards(freshCurrentDeck.id);
        }
      } else if (uiState.view === 'cards') {
        useUiStore.setState({ view: 'decks' });
      }
    } catch (err) {
      console.error("Init Data Error:", err);
      const decksNow = useDeckStore.getState().decks;
      if (!decksNow || decksNow.length === 0) {
        showToast("Ошибка загрузки данных.");
      }
    } finally {
      useUiStore.setState({ loading: false, hasInitialized: true });
    }
  };

  const syncProfile = async (currentProfile) => {
    try {
      const { useLanguageStore } = await import('../store/useLanguageStore');
      const langState = useLanguageStore.getState();

      const syncPayload = {
        first_name: currentProfile.first_name && currentProfile.first_name !== 'Пользователь' ? currentProfile.first_name : (currentProfile.first_name || undefined),
        last_name: currentProfile.last_name || undefined,
        username: currentProfile.username || undefined,
        photo_url: currentProfile.photo_url || undefined,
        is_guest: Boolean(currentProfile.is_guest),
        active_language: langState.activeLanguage,
        native_language: localStorage.getItem('native_language') || 'uk'
      };
      if (langState.hasSelectedLanguage) {
        syncPayload.has_selected_language = true;
      }

      // Always perform sync to ensure backend has the latest Telegram profile info
      const res = await requestWithRetry(() => api.post('/auth/sync', syncPayload), 'Profile sync');

      if (res.data.status === 'ok' && res.data.user) {
        const serverUser = res.data.user;
        const validLocalName = currentProfile.first_name && currentProfile.first_name !== 'Пользователь' ? currentProfile.first_name : null;
        const validServerName = serverUser.first_name && serverUser.first_name !== 'Пользователь' ? serverUser.first_name : null;
        const fallbackName = validServerName || validLocalName || serverUser.username || currentProfile.username || null;

        const mergedProfile = {
          ...currentProfile,
          ...serverUser,
          first_name: fallbackName,
          photo_url: serverUser.photo_url || currentProfile.photo_url || null,
          is_guest: Boolean(serverUser.is_guest)
        };

        setUserProfile(mergedProfile);
        storage.set('lerne_user_profile', JSON.stringify(mergedProfile));

        if (mergedProfile.has_selected_language || mergedProfile.active_language) {
          langState.syncLanguageFromExternal(
            mergedProfile.active_language || 'de',
            Boolean(mergedProfile.has_selected_language)
          );
        }

        if (mergedProfile.native_language) {
          localStorage.setItem('native_language', mergedProfile.native_language);
          localStorage.setItem('native_language_selected', 'true');
          cloudStorage.set('lerne_native_language', mergedProfile.native_language);
          cloudStorage.set('lerne_native_language_selected', 'true');
        }
      }
    } catch (err) {
      console.error("Profile sync error:", err);
    }
  };
};
