import { useEffect } from 'react';
import { getUserId, getUserProfile, storage } from '../utils/auth';
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
      
      // Выполняем авто-синхронизацию при наличии сети перед загрузкой данных
      if (isOfflineMode() && navigator.onLine) {
        try {
          await syncService.sync();
        } catch (e) {
          console.error("Startup sync failed:", e);
        }
      }
      
      syncProfile(profile);
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
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const fetchInitData = async () => {
    const { setDecks, setFolders, fetchDuplicates, fetchFavorites } = useDeckStore.getState();
    useUiStore.setState({ loading: true });
    try {
      const res = await api.get('/init');
      setDecks(res.data.decks);
      if (res.data.folders) {
        setFolders(res.data.folders);
      }
      setAdminSettings(res.data.settings);
      setUserPrompts(res.data.prompts);
      fetchDuplicates();
      fetchFavorites();
    } catch (err) {
      console.error("Init Data Error:", err);
      showToast("Ошибка загрузки данных.");
    }
    useUiStore.setState({ loading: false });
  };

  const syncProfile = async (currentProfile) => {
    try {
      const res = await api.post('/auth/sync', {
        first_name: currentProfile.first_name,
        last_name: currentProfile.last_name,
        username: currentProfile.username,
        photo_url: currentProfile.photo_url,
        is_guest: currentProfile.is_guest
      });
      
      if (res.data.status === 'ok' && res.data.user) {
        const newProfile = res.data.user;
        if (currentProfile.is_guest && !newProfile.is_guest) {
          console.log("User promoted from Guest to Real User. Re-fetching data...");
          setUserProfile(newProfile);
          storage.set('lerne_user_profile', JSON.stringify(newProfile));
          fetchInitData();
        } else {
          setUserProfile(newProfile);
          storage.set('lerne_user_profile', JSON.stringify(newProfile));
        }
      }
    } catch (err) {
      console.error("Profile sync error:", err);
    }
  };
};
