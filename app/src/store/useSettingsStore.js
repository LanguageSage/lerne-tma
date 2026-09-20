import { create } from 'zustand';
import { storage } from '../utils/auth';
import api from '../services/api';
import { AUTOPLAY_DEFAULTS, AUTOPLAY_VERSION, normalizeAutoplaySettings } from '../utils/autoplaySequence';
import { normalizeDesignConfig, DEFAULT_DESIGN_CONFIG_V2, patchDesignValue } from '../design/designConfig.js';
import { applyPublishedDesignTokens } from '../design/designTokens.js';

// ─── Design V2 localStorage cache (offline fallback) ──────────────────────────
const DESIGN_V2_CACHE_KEY = 'lerne:published-design:v2';

function loadCachedPublishedDesign() {
  try {
    const raw = localStorage.getItem(DESIGN_V2_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedPublishedDesign(doc) {
  try {
    if (doc && doc.config) {
      localStorage.setItem(DESIGN_V2_CACHE_KEY, JSON.stringify(doc));
    }
  } catch { /* quota exceeded — silently ignore */ }
}

// Immediately apply design tokens on startup (cached published design or defaults)
const initialPublishedDesign = loadCachedPublishedDesign();
if (initialPublishedDesign?.config) {
  applyPublishedDesignTokens(initialPublishedDesign.config);
} else {
  applyPublishedDesignTokens(DEFAULT_DESIGN_CONFIG_V2);
}

export const AUTOPLAY_STORAGE_MAP = Object.fromEntries(
  Object.keys(AUTOPLAY_DEFAULTS).map(key => [key, `lerne_auto_v2_${key}`]),
);

const getInitialAutoplaySettings = () => {
  const saved = {};
  for (const [key, storageKey] of Object.entries(AUTOPLAY_STORAGE_MAP)) {
    const value = storage.get(storageKey);
    if (value !== null) saved[key] = value;
  }
  const settings = Number(saved.autoplayVersion) === AUTOPLAY_VERSION
    ? normalizeAutoplaySettings(saved) : { ...AUTOPLAY_DEFAULTS };
  for (const [key, value] of Object.entries(settings)) storage.set(AUTOPLAY_STORAGE_MAP[key], value);
  return settings;
};

export const DEFAULT_DESIGN_SETTINGS = {
  cardBgFront: 'liquid_emerald',
  cardBgBack: 'liquid_emerald',
  cardFont: 'Comfortaa',
  cardTextColor: '#fde047',
  cardFontSize: 1.7,
  cardTextAlign: 'left',
  backTextColor: '#cbd5e1',
  contextFont: 'Inter',
  contextTextColor: 'auto',
  contextFontSize: 1.4,
  contextTextAlign: 'left',
  cardTextShadow: 'glow',
  contextTextShadow: 'glow',
  cardFontWeight: '700',
  cardFontStyle: 'normal',
  contextFontWeight: '400',
  contextFontStyle: 'normal',

  // Card List Preview Settings
  previewCardFont: 'Comfortaa',
  previewCardTextColor: '#cbdeb5',
  previewBackTextColor: '#b1e7e0',
  previewCardFontSize: 1.19,
  previewBackFontSize: 0.98,
  previewCardFontWeight: '700',
  previewCardFontStyle: 'normal',
  previewTextShadow: 'none',
  previewCardTextAlign: 'left',
  previewCardLines: 3,
  previewCardBg: 'dark_obsidian'
};

export const DESIGN_STORAGE_MAP = {
  cardBgFront: 'lerne_card_bg_front',
  cardBgBack: 'lerne_card_bg_back',
  cardFont: 'lerne_card_font',
  cardTextColor: 'lerne_card_text_color',
  cardFontSize: 'lerne_card_font_size',
  cardTextAlign: 'lerne_card_text_align',
  backTextColor: 'lerne_back_text_color',
  contextFont: 'lerne_context_font',
  contextTextColor: 'lerne_context_text_color',
  contextFontSize: 'lerne_context_font_size',
  contextTextAlign: 'lerne_context_text_align',
  cardTextShadow: 'lerne_card_text_shadow',
  contextTextShadow: 'lerne_context_text_shadow',
  cardFontWeight: 'lerne_card_font_weight',
  cardFontStyle: 'lerne_card_font_style',
  contextFontWeight: 'lerne_context_font_weight',
  contextFontStyle: 'lerne_context_font_style',

  previewCardFont: 'lerne_preview_card_font',
  previewCardTextColor: 'lerne_preview_card_text_color',
  previewBackTextColor: 'lerne_preview_back_text_color',
  previewCardFontSize: 'lerne_preview_card_font_size',
  previewBackFontSize: 'lerne_preview_back_font_size',
  previewCardFontWeight: 'lerne_preview_card_font_weight',
  previewCardFontStyle: 'lerne_preview_card_font_style',
  previewTextShadow: 'lerne_preview_text_shadow',
  previewCardTextAlign: 'lerne_preview_card_text_align',
  previewCardLines: 'lerne_preview_card_lines',
  previewCardBg: 'lerne_preview_card_bg',
};

export const STUDY_STORAGE_MAP = {
  ...AUTOPLAY_STORAGE_MAP,
  autoPlay: 'lerne_autoplay',
  autoShow: 'lerne_autoshow',
  ttsSpeed: 'lerne_tts_speed',
  ttsSpeedRu: 'lerne_tts_speed_ru',
  ttsVoices: 'lerne_tts_voices',
  alwaysRegenerateAudio: 'lerne_always_regenerate_audio',
  autoGenerateCardAudio: 'lerne_auto_generate_card_audio',
  studyMode: 'lerne_study_mode',
  speechMatchThreshold: 'lerne_speech_match_threshold',
  voiceBack: 'lerne_voice_back',
  randomEnabledModes: 'lerne_random_enabled_modes',
  srsExtendedGrades: 'lerne_srs_extended_grades',
};

export const collectUserSettings = (state) => {
  const settings = {};
  Object.keys(DESIGN_STORAGE_MAP).forEach((k) => {
    if (state[k] !== undefined) settings[k] = state[k];
  });
  Object.keys(STUDY_STORAGE_MAP).forEach((k) => {
    if (state[k] !== undefined) settings[k] = state[k];
  });
  if (state.userDesign !== undefined) {
    settings.userDesign = state.userDesign;
  }
  const nativeLang = storage.get('native_language');
  if (nativeLang) {
    settings.native_language = nativeLang;
  }
  return settings;
};

let saveTimer = null;
export const debouncedSaveSettings = (get) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const { getAccessToken, getUserId } = await import('../utils/auth');
      if (!getAccessToken() && !getUserId()) return;
      const settings = collectUserSettings(get());
      await api.post('/user/settings', settings);
    } catch (e) {
      console.warn('Failed to sync user settings to server:', e);
    }
  }, 1000);
};

const DESIGN_STORAGE_VERSION = '2026_08_emerald_final_v4';

const getInitialDesignState = () => {
  const storedVersion = storage.get('lerne_design_version');
  const userSavedCustom = storage.get('lerne_user_design');

  if (storedVersion !== DESIGN_STORAGE_VERSION) {
    storage.set('lerne_design_version', DESIGN_STORAGE_VERSION);
    Object.entries(DESIGN_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
      storage.set(storageKey, DEFAULT_DESIGN_SETTINGS[stateKey]);
    });

    return {
      ...DEFAULT_DESIGN_SETTINGS,
      userDesign: userSavedCustom ? JSON.parse(userSavedCustom) : null,
    };
  }

  const state = {};
  Object.entries(DESIGN_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
    const raw = storage.get(storageKey);
    const defaultVal = DEFAULT_DESIGN_SETTINGS[stateKey];
    if (typeof defaultVal === 'number') {
      state[stateKey] = raw !== null ? Number(raw) : defaultVal;
    } else {
      state[stateKey] = raw || defaultVal;
    }
  });

  state.userDesign = userSavedCustom ? JSON.parse(userSavedCustom) : null;
  return state;
};

const getStoredTtsVoices = () => {
  try {
    const value = storage.get('lerne_tts_voices');
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const getInitialStudyState = () => ({
  ...getInitialAutoplaySettings(),
  autoPlay: storage.get('lerne_autoplay') !== null ? storage.get('lerne_autoplay') === 'true' : false,
  autoShow: storage.get('lerne_autoshow') !== null ? storage.get('lerne_autoshow') === 'true' : false,
  ttsSpeed: storage.get('lerne_tts_speed') !== null ? Number(storage.get('lerne_tts_speed')) : 0,
  ttsSpeedRu: storage.get('lerne_tts_speed_ru') !== null ? Number(storage.get('lerne_tts_speed_ru')) : 0,
  ttsVoices: getStoredTtsVoices(),
  alwaysRegenerateAudio: storage.get('lerne_always_regenerate_audio') === 'true',
  autoGenerateCardAudio: storage.get('lerne_auto_generate_card_audio') !== 'false',
  studyMode: (storage.get('lerne_study_mode') && storage.get('lerne_study_mode') !== 'turbo') ? storage.get('lerne_study_mode') : 'classic',
  speechMatchThreshold: storage.get('lerne_speech_match_threshold') !== null ? Number(storage.get('lerne_speech_match_threshold')) : 75,
  voiceBack: storage.get('lerne_voice_back') || '',
  randomEnabledModes: storage.get('lerne_random_enabled_modes')
    ? JSON.parse(storage.get('lerne_random_enabled_modes')).filter(m => m !== 'turbo')
    : ['classic', 'reverse', 'cloze', 'puzzle', 'speak'],
  srsExtendedGrades: storage.get('lerne_srs_extended_grades') !== null ? storage.get('lerne_srs_extended_grades') === 'true' : false,
  isAdmin: false,
});

export const useSettingsStore = create((set, get) => {
  // Generate design setters dynamically to eliminate boilerplate
  const designSetters = {};
  Object.entries(DESIGN_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
    const capitalized = stateKey.charAt(0).toUpperCase() + stateKey.slice(1);
    const setterName = `set${capitalized}`;
    const isNumber = typeof DEFAULT_DESIGN_SETTINGS[stateKey] === 'number';

    designSetters[setterName] = (val) => {
      const parsedVal = isNumber && val !== null && val !== undefined ? Number(val) : val;
      storage.set(storageKey, parsedVal);
      set({ [stateKey]: parsedVal });
      debouncedSaveSettings(get);
    };
  });

  return {
    // --- Study Settings ---
    ...getInitialStudyState(),
    setSpeechMatchThreshold: (value) => {
      storage.set('lerne_speech_match_threshold', value);
      set({ speechMatchThreshold: Number(value) });
      debouncedSaveSettings(get);
    },
    setStudyMode: (value) => {
      storage.set('lerne_study_mode', value);
      set({ studyMode: value });
      debouncedSaveSettings(get);
    },
    setRandomEnabledModes: (modes) => {
      storage.set('lerne_random_enabled_modes', JSON.stringify(modes));
      set({ randomEnabledModes: modes });
      debouncedSaveSettings(get);
    },
    setAutoPlay: (value) => {
      storage.set('lerne_autoplay', value);
      set({ autoPlay: value });
      debouncedSaveSettings(get);
    },
    setAutoShow: (value) => {
      storage.set('lerne_autoshow', value);
      set({ autoShow: value });
      debouncedSaveSettings(get);
    },
    setAutoplaySettings: (patch) => {
      const settings = normalizeAutoplaySettings({ ...get(), ...patch });
      for (const [key, value] of Object.entries(settings)) storage.set(AUTOPLAY_STORAGE_MAP[key], value);
      set(settings);
      debouncedSaveSettings(get);
    },
    setTtsSpeed: (value) => {
      storage.set('lerne_tts_speed', value);
      set({ ttsSpeed: Number(value) });
      debouncedSaveSettings(get);
    },
    setTtsSpeedRu: (value) => {
      storage.set('lerne_tts_speed_ru', value);
      set({ ttsSpeedRu: Number(value) });
      debouncedSaveSettings(get);
    },
    setTtsVoice: (lang, voice) => {
      const code = (lang || 'de').toLowerCase().replace('_', '-').split('-')[0];
      const nextVoices = { ...get().ttsVoices, [code]: voice };
      storage.set('lerne_tts_voices', JSON.stringify(nextVoices));
      set({ ttsVoices: nextVoices });
      debouncedSaveSettings(get);
    },
    setAlwaysRegenerateAudio: (value) => {
      storage.set('lerne_always_regenerate_audio', value);
      set({ alwaysRegenerateAudio: Boolean(value) });
      debouncedSaveSettings(get);
    },
    setAutoGenerateCardAudio: (value) => {
      storage.set('lerne_auto_generate_card_audio', value);
      set({ autoGenerateCardAudio: Boolean(value) });
      debouncedSaveSettings(get);
    },
    setVoiceBack: (value) => {
      storage.set('lerne_voice_back', value);
      set({ voiceBack: value });
      debouncedSaveSettings(get);
    },
    setSrsExtendedGrades: (value) => {
      storage.set('lerne_srs_extended_grades', value);
      set({ srsExtendedGrades: Boolean(value) });
      debouncedSaveSettings(get);
    },

    // --- Design Settings & Setters ---
    ...getInitialDesignState(),
    ...designSetters,

    syncPreviewFromCard: () => {
      const s = get();
      const updates = {
        previewCardFont: s.cardFont,
        previewCardTextColor: s.cardTextColor,
        previewBackTextColor: s.backTextColor || s.cardTextColor,
        previewCardFontWeight: s.cardFontWeight || '600',
        previewCardFontStyle: s.cardFontStyle || 'normal',
        previewTextShadow: s.cardTextShadow || 'none',
        previewCardTextAlign: s.cardTextAlign || 'left',
      };
      Object.entries(updates).forEach(([k, v]) => {
        const storageKey = DESIGN_STORAGE_MAP[k];
        if (storageKey) storage.set(storageKey, v);
      });
      set(updates);
    },

    // Helper to apply a full design preset
    applyDesignPreset: (preset) => {
      const s = preset?.settings;
      if (!s) return;
      
      set({ ...s });
      
      // Sync all valid keys to storage
      Object.entries(s).forEach(([k, v]) => {
        const storageKey = DESIGN_STORAGE_MAP[k];
        if (storageKey) storage.set(storageKey, v);
      });
      debouncedSaveSettings(get);
    },

    saveUserDesign: () => {
      const s = get();
      const design = {};
      Object.keys(DESIGN_STORAGE_MAP).forEach((k) => {
        design[k] = s[k];
      });
      storage.set('lerne_user_design', JSON.stringify(design));
      set({ userDesign: design });
      debouncedSaveSettings(get);
    },

    applyUserDesign: () => {
      const design = get().userDesign;
      if (design) get().applyDesignPreset({ settings: design });
    },

    resetDesign: () => {
      set(DEFAULT_DESIGN_SETTINGS);
      Object.entries(DESIGN_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
        storage.set(storageKey, DEFAULT_DESIGN_SETTINGS[stateKey]);
      });
      debouncedSaveSettings(get);
    },

    syncUserSettingsFromServer: (serverSettings) => {
      if (!serverSettings || typeof serverSettings !== 'object') return;
      const migrateAutoplay = Number(serverSettings.autoplayVersion) !== AUTOPLAY_VERSION;
      // Old clients/server snapshots must not overwrite the new settings after migration.
      const autoplay = migrateAutoplay
        ? normalizeAutoplaySettings(get()) : normalizeAutoplaySettings(serverSettings);
      serverSettings = { ...serverSettings, ...autoplay };
      const updates = {};

      // Apply design settings
      Object.entries(DESIGN_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
        if (serverSettings[stateKey] !== undefined) {
          const defaultVal = DEFAULT_DESIGN_SETTINGS[stateKey];
          const val = typeof defaultVal === 'number' 
            ? Number(serverSettings[stateKey]) 
            : serverSettings[stateKey];
          updates[stateKey] = val;
          storage.set(storageKey, val);
        }
      });

      // Apply study/SRS settings
      Object.entries(STUDY_STORAGE_MAP).forEach(([stateKey, storageKey]) => {
        if (serverSettings[stateKey] !== undefined) {
          const val = serverSettings[stateKey];
          if (typeof val === 'boolean') {
            storage.set(storageKey, String(val));
          } else if (typeof val === 'number') {
            storage.set(storageKey, String(val));
          } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
            storage.set(storageKey, JSON.stringify(val));
          } else {
            storage.set(storageKey, val);
          }
          updates[stateKey] = val;
        }
      });

      if (serverSettings.userDesign !== undefined) {
        updates.userDesign = serverSettings.userDesign;
        if (serverSettings.userDesign) {
          storage.set('lerne_user_design', JSON.stringify(serverSettings.userDesign));
        } else {
          storage.remove('lerne_user_design');
        }
      }

      // Sync native interface language if present and changed
      if (serverSettings.native_language) {
        const currentLang = storage.get('native_language');
        if (currentLang !== serverSettings.native_language) {
          import('../i18n/locale').then(({ setInterfaceLanguage, normalizeInterfaceLanguage }) => {
            const lang = normalizeInterfaceLanguage(serverSettings.native_language);
            if (lang) {
              setInterfaceLanguage(lang);
              storage.set('native_language', lang);
              storage.set('native_language_selected', 'true');
            }
          }).catch(() => {});
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates);
      }
      if (migrateAutoplay) debouncedSaveSettings(get);
    },

    saveCurrentSettingsToServer: async () => {
      try {
        const { getAccessToken, getUserId } = await import('../utils/auth');
        if (!getAccessToken() && !getUserId()) return false;
        const settings = collectUserSettings(get());
        await api.post('/user/settings', settings);
        return true;
      } catch (e) {
        console.warn('Manual settings sync failed:', e);
        return false;
      }
    },

    fetchUserSettingsFromServer: async () => {
      try {
        if (saveTimer !== null) return null;
        const { getAccessToken, getUserId } = await import('../utils/auth');
        if (!getAccessToken() && !getUserId()) return null;
        const res = await api.get('/user/settings');
        if (res.data && typeof res.data === 'object' && Object.keys(res.data).length > 0) {
          get().syncUserSettingsFromServer(res.data);
          return res.data;
        }
      } catch (e) {
        console.warn('Failed to fetch user settings from server:', e);
      }
      return null;
    },

    // --- Admin/API Settings (Fetched from Backend) ---
    adminSettings: {},
    setAdminSettings: (settings) => set({ adminSettings: settings }),
    updateAdminSetting: (key, value) => set((state) => ({ 
      adminSettings: { ...state.adminSettings, [key]: value } 
    })),

    userPrompts: { translation_prompt: '', context_prompt: '' },
    setUserPrompts: (prompts) => set({ userPrompts: prompts }),
    updateUserPrompt: (key, value) => set((state) => ({ 
      userPrompts: { ...state.userPrompts, [key]: value } 
    })),

    // --- Design Config V2 ────────────────────────────────────────────────────
    // publishedDesignV2: глобальный дизайн, применяется к app root.
    //   null → дизайн ещё не опубликован → использовать DEFAULT_DESIGN_CONFIG_V2.
    // adminDraftDesignV2: черновик администратора, изолирован внутри preview.
    //   Не влияет на реальное приложение до публикации.
    publishedDesignV2: initialPublishedDesign,
    adminDraftDesignV2: null,

    /** Применяет опубликованный global design (из /init или /design/global).
     *  Сохраняет в localStorage-кеш и применяет CSS tokens к app root. */
    setPublishedDesignV2: (serverDoc) => {
      if (!serverDoc?.config) return;
      const normalized = normalizeDesignConfig(serverDoc.config);
      const doc = { ...serverDoc, config: normalized };
      saveCachedPublishedDesign(doc);
      set({ publishedDesignV2: doc });
      applyPublishedDesignTokens(normalized);
    },

    /** Обновляет admin draft (только в памяти, не трогает published). */
    setAdminDraftDesignV2: (config) => {
      const normalized = normalizeDesignConfig(config);
      set({ adminDraftDesignV2: normalized });
    },

    /** Патчит одно поле в admin draft по dot-path. */
    patchAdminDraft: (path, value) => {
      const current = get().adminDraftDesignV2 ?? normalizeDesignConfig(get().publishedDesignV2?.config);
      set({ adminDraftDesignV2: patchDesignValue(current, path, value) });
    },

    /** Публикует admin draft: отправляет на сервер, при успехе обновляет published. */
    publishAdminDraftToServer: async () => {
      const draft = get().adminDraftDesignV2;
      if (!draft) return { success: false, error: 'No draft to publish' };
      try {
        const res = await api.post('/admin/design/publish', { config: draft });
        if (res.data?.config) {
          get().setPublishedDesignV2(res.data);
          return { success: true, doc: res.data };
        }
        return { success: false, error: 'Invalid server response' };
      } catch (e) {
        console.warn('Failed to publish design:', e);
        return { success: false, error: e?.response?.data?.detail || e.message };
      }
    },

    /** Сохраняет admin draft на сервер (без публикации). */
    saveAdminDraftToServer: async () => {
      const draft = get().adminDraftDesignV2;
      if (!draft) return;
      try {
        await api.post('/admin/design/draft', { config: draft });
      } catch (e) {
        console.warn('Failed to save admin draft:', e);
      }
    },

    /** Загружает admin draft с сервера. */
    loadAdminDraftFromServer: async () => {
      try {
        const res = await api.get('/admin/design/draft');
        if (res.data?.config) {
          set({ adminDraftDesignV2: normalizeDesignConfig(res.data.config) });
        }
      } catch (e) {
        console.warn('Failed to load admin draft:', e);
      }
    },

    /** Возвращает draft к текущему published design. */
    revertDraftToPublished: () => {
      const published = get().publishedDesignV2?.config;
      set({ adminDraftDesignV2: published ? normalizeDesignConfig(published) : normalizeDesignConfig(null) });
    },

    /** Сбрасывает конкретную секцию в draft до defaults. */
    resetDraftSection: (section) => {
      const current = get().adminDraftDesignV2 ?? normalizeDesignConfig(null);
      if (!(section in DEFAULT_DESIGN_CONFIG_V2)) return;
      const updated = { ...current, [section]: JSON.parse(JSON.stringify(DEFAULT_DESIGN_CONFIG_V2[section])) };
      set({ adminDraftDesignV2: updated });
    },

    /** Инициализирует admin draft из опубликованного дизайна (при открытии редактора). */
    initAdminDraftFromPublished: () => {
      const published = get().publishedDesignV2?.config;
      if (!get().adminDraftDesignV2) {
        set({ adminDraftDesignV2: published ? normalizeDesignConfig(published) : normalizeDesignConfig(null) });
      }
    },

    /** Backend-authoritative setter для isAdmin. Вызывается из /init ответа. */
    setIsAdmin: (value) => set({ isAdmin: Boolean(value) }),

    customBackgrounds: [],
    setCustomBackgrounds: (bgs) => set({ customBackgrounds: bgs }),


    // --- Bot Reminder Settings ---
    reminderSettings: {
      enabled: true,
      times: ['10:00', '19:00'],
      frequency: 'twice_daily',
      timezone: 'Europe/Berlin',
      timezone_offset: 3,
    },
    reminderDiagnostics: null,
    reminderLoading: false,

    fetchReminderSettings: async () => {
      try {
        set({ reminderLoading: true });
        const res = await api.get('/user/reminder-settings');
        if (res.data) {
          set({ reminderSettings: res.data });
        }
      } catch (err) {
        console.error('Fetch Reminder Settings Error:', err);
      } finally {
        set({ reminderLoading: false });
      }
    },

    fetchReminderDiagnostics: async () => {
      try {
        const res = await api.get('/bot/reminder-diagnostics');
        if (res.data) {
          set({ reminderDiagnostics: res.data });
        }
        return res.data;
      } catch (err) {
        console.error('Fetch Reminder Diagnostics Error:', err);
        return null;
      }
    },

    saveReminderSettings: async (newSettings) => {
      try {
        set((state) => ({ reminderSettings: { ...state.reminderSettings, ...newSettings } }));
        const res = await api.post('/user/reminder-settings', newSettings);
        if (res.data?.settings) {
          set({ reminderSettings: res.data.settings });
        }
        return true;
      } catch (err) {
        console.error('Save Reminder Settings Error:', err);
        throw err;
      }
    },

    sendTestReminder: async () => {
      try {
        const res = await api.post('/bot/test-reminder');
        return res.data;
      } catch (err) {
        console.error('Send Test Reminder Error:', err);
        throw err;
      }
    },
  };
});

