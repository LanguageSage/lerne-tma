import { create } from 'zustand';
import { storage } from '../utils/auth';
import api from '../services/api';

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
  previewCardLines: 3
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

const getInitialStudyState = () => ({
  autoPlay: storage.get('lerne_autoplay') !== null ? storage.get('lerne_autoplay') === 'true' : false,
  autoShow: storage.get('lerne_autoshow') !== null ? storage.get('lerne_autoshow') === 'true' : false,
  autoplayOrder: storage.get('lerne_autoplay_order') || 'list',
  autoplayFrontPause: storage.get('lerne_autoplay_front_pause') !== null ? Number(storage.get('lerne_autoplay_front_pause')) : 4,
  autoplayBackPause: storage.get('lerne_autoplay_back_pause') !== null ? Number(storage.get('lerne_autoplay_back_pause')) : 2,
  autoplayFrontRepeat: storage.get('lerne_autoplay_front_repeat') !== null ? Number(storage.get('lerne_autoplay_front_repeat')) : (storage.get('lerne_autoplay_card_repeat') !== null ? Number(storage.get('lerne_autoplay_card_repeat')) : 1),
  autoplayBackRepeat: storage.get('lerne_autoplay_back_repeat') !== null ? Number(storage.get('lerne_autoplay_back_repeat')) : (storage.get('lerne_autoplay_card_repeat') !== null ? Number(storage.get('lerne_autoplay_card_repeat')) : 1),
  autoplayCardRepeat: storage.get('lerne_autoplay_card_repeat') !== null ? Number(storage.get('lerne_autoplay_card_repeat')) : 1,
  ttsSpeed: storage.get('lerne_tts_speed') !== null ? Number(storage.get('lerne_tts_speed')) : 0,
  ttsSpeedRu: storage.get('lerne_tts_speed_ru') !== null ? Number(storage.get('lerne_tts_speed_ru')) : 0,
  autoplayLoop: storage.get('lerne_autoplay_loop') !== null ? storage.get('lerne_autoplay_loop') === 'true' : true,
  autoplayForceFrontAudio: storage.get('lerne_autoplay_force_front_audio') !== null ? storage.get('lerne_autoplay_force_front_audio') === 'true' : false,
  autoplayForceBackAudio: storage.get('lerne_autoplay_force_back_audio') !== null ? storage.get('lerne_autoplay_force_back_audio') === 'true' : false,
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
    };
  });

  return {
    // --- Study Settings ---
    ...getInitialStudyState(),
    setSpeechMatchThreshold: (value) => {
      storage.set('lerne_speech_match_threshold', value);
      set({ speechMatchThreshold: Number(value) });
    },
    setStudyMode: (value) => {
      storage.set('lerne_study_mode', value);
      set({ studyMode: value });
    },
    setRandomEnabledModes: (modes) => {
      storage.set('lerne_random_enabled_modes', JSON.stringify(modes));
      set({ randomEnabledModes: modes });
    },
    setAutoPlay: (value) => {
      storage.set('lerne_autoplay', value);
      set({ autoPlay: value });
    },
    setAutoShow: (value) => {
      storage.set('lerne_autoshow', value);
      set({ autoShow: value });
    },
    setAutoplayOrder: (value) => {
      storage.set('lerne_autoplay_order', value);
      set({ autoplayOrder: value });
    },
    setAutoplayFrontPause: (value) => {
      storage.set('lerne_autoplay_front_pause', value);
      set({ autoplayFrontPause: Number(value) });
    },
    setAutoplayBackPause: (value) => {
      storage.set('lerne_autoplay_back_pause', value);
      set({ autoplayBackPause: Number(value) });
    },
    setAutoplayFrontRepeat: (value) => {
      storage.set('lerne_autoplay_front_repeat', value);
      set({ autoplayFrontRepeat: Number(value) });
    },
    setAutoplayBackRepeat: (value) => {
      storage.set('lerne_autoplay_back_repeat', value);
      set({ autoplayBackRepeat: Number(value) });
    },
    setAutoplayCardRepeat: (value) => {
      storage.set('lerne_autoplay_card_repeat', value);
      set({ autoplayCardRepeat: Number(value) });
    },
    setTtsSpeed: (value) => {
      storage.set('lerne_tts_speed', value);
      set({ ttsSpeed: Number(value) });
    },
    setTtsSpeedRu: (value) => {
      storage.set('lerne_tts_speed_ru', value);
      set({ ttsSpeedRu: Number(value) });
    },
    setAutoplayLoop: (value) => {
      storage.set('lerne_autoplay_loop', value);
      set({ autoplayLoop: value });
    },
    setAutoplayForceFrontAudio: (value) => {
      storage.set('lerne_autoplay_force_front_audio', value);
      set({ autoplayForceFrontAudio: value });
    },
    setAutoplayForceBackAudio: (value) => {
      storage.set('lerne_autoplay_force_back_audio', value);
      set({ autoplayForceBackAudio: value });
    },
    setVoiceBack: (value) => {
      storage.set('lerne_voice_back', value);
      set({ voiceBack: value });
    },
    setSrsExtendedGrades: (value) => {
      storage.set('lerne_srs_extended_grades', value);
      set({ srsExtendedGrades: Boolean(value) });
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
    },

    saveUserDesign: () => {
      const s = get();
      const design = {};
      Object.keys(DESIGN_STORAGE_MAP).forEach((k) => {
        design[k] = s[k];
      });
      storage.set('lerne_user_design', JSON.stringify(design));
      set({ userDesign: design });
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

    customBackgrounds: [],
    setCustomBackgrounds: (bgs) => set({ customBackgrounds: bgs }),

    // --- Bot Reminder Settings ---
    reminderSettings: {
      enabled: true,
      times: ['10:00', '19:00'],
      frequency: 'twice_daily',
      timezone_offset: 3,
    },
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
