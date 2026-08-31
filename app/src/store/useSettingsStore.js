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

const DESIGN_STORAGE_VERSION = '2026_08_emerald_final_v4';

const getInitialDesignState = () => {
  const storedVersion = storage.get('lerne_design_version');
  const userSavedCustom = storage.get('lerne_user_design');

  if (storedVersion !== DESIGN_STORAGE_VERSION) {
    storage.set('lerne_design_version', DESIGN_STORAGE_VERSION);
    storage.set('lerne_card_bg_front', DEFAULT_DESIGN_SETTINGS.cardBgFront);
    storage.set('lerne_card_bg_back', DEFAULT_DESIGN_SETTINGS.cardBgBack);
    storage.set('lerne_card_font', DEFAULT_DESIGN_SETTINGS.cardFont);
    storage.set('lerne_card_text_color', DEFAULT_DESIGN_SETTINGS.cardTextColor);
    storage.set('lerne_card_font_size', DEFAULT_DESIGN_SETTINGS.cardFontSize);
    storage.set('lerne_card_text_align', DEFAULT_DESIGN_SETTINGS.cardTextAlign);
    storage.set('lerne_back_text_color', DEFAULT_DESIGN_SETTINGS.backTextColor);
    storage.set('lerne_context_font', DEFAULT_DESIGN_SETTINGS.contextFont);
    storage.set('lerne_context_text_color', DEFAULT_DESIGN_SETTINGS.contextTextColor);
    storage.set('lerne_context_font_size', DEFAULT_DESIGN_SETTINGS.contextFontSize);
    storage.set('lerne_context_text_align', DEFAULT_DESIGN_SETTINGS.contextTextAlign);
    storage.set('lerne_card_text_shadow', DEFAULT_DESIGN_SETTINGS.cardTextShadow);
    storage.set('lerne_context_text_shadow', DEFAULT_DESIGN_SETTINGS.contextTextShadow);
    storage.set('lerne_card_font_weight', DEFAULT_DESIGN_SETTINGS.cardFontWeight);
    storage.set('lerne_card_font_style', DEFAULT_DESIGN_SETTINGS.cardFontStyle);
    storage.set('lerne_context_font_weight', DEFAULT_DESIGN_SETTINGS.contextFontWeight);
    storage.set('lerne_context_font_style', DEFAULT_DESIGN_SETTINGS.contextFontStyle);

    storage.set('lerne_preview_card_font', DEFAULT_DESIGN_SETTINGS.previewCardFont);
    storage.set('lerne_preview_card_text_color', DEFAULT_DESIGN_SETTINGS.previewCardTextColor);
    storage.set('lerne_preview_back_text_color', DEFAULT_DESIGN_SETTINGS.previewBackTextColor);
    storage.set('lerne_preview_card_font_size', DEFAULT_DESIGN_SETTINGS.previewCardFontSize);
    storage.set('lerne_preview_back_font_size', DEFAULT_DESIGN_SETTINGS.previewBackFontSize);
    storage.set('lerne_preview_card_font_weight', DEFAULT_DESIGN_SETTINGS.previewCardFontWeight);
    storage.set('lerne_preview_card_font_style', DEFAULT_DESIGN_SETTINGS.previewCardFontStyle);
    storage.set('lerne_preview_text_shadow', DEFAULT_DESIGN_SETTINGS.previewTextShadow);
    storage.set('lerne_preview_card_text_align', DEFAULT_DESIGN_SETTINGS.previewCardTextAlign);
    storage.set('lerne_preview_card_lines', DEFAULT_DESIGN_SETTINGS.previewCardLines);

    return {
      ...DEFAULT_DESIGN_SETTINGS,
      userDesign: userSavedCustom ? JSON.parse(userSavedCustom) : null,
    };
  }

  return {
    cardBgFront: storage.get('lerne_card_bg_front') || DEFAULT_DESIGN_SETTINGS.cardBgFront,
    cardBgBack: storage.get('lerne_card_bg_back') || DEFAULT_DESIGN_SETTINGS.cardBgBack,
    cardFont: storage.get('lerne_card_font') || DEFAULT_DESIGN_SETTINGS.cardFont,
    cardTextColor: storage.get('lerne_card_text_color') || DEFAULT_DESIGN_SETTINGS.cardTextColor,
    cardFontSize: storage.get('lerne_card_font_size') !== null ? Number(storage.get('lerne_card_font_size')) : DEFAULT_DESIGN_SETTINGS.cardFontSize,
    cardTextAlign: storage.get('lerne_card_text_align') || DEFAULT_DESIGN_SETTINGS.cardTextAlign,
    backTextColor: storage.get('lerne_back_text_color') || DEFAULT_DESIGN_SETTINGS.backTextColor,
    contextFont: storage.get('lerne_context_font') || DEFAULT_DESIGN_SETTINGS.contextFont,
    contextTextColor: storage.get('lerne_context_text_color') || DEFAULT_DESIGN_SETTINGS.contextTextColor,
    contextFontSize: storage.get('lerne_context_font_size') !== null ? Number(storage.get('lerne_context_font_size')) : DEFAULT_DESIGN_SETTINGS.contextFontSize,
    contextTextAlign: storage.get('lerne_context_text_align') || DEFAULT_DESIGN_SETTINGS.contextTextAlign,
    cardTextShadow: storage.get('lerne_card_text_shadow') || DEFAULT_DESIGN_SETTINGS.cardTextShadow,
    contextTextShadow: storage.get('lerne_context_text_shadow') || DEFAULT_DESIGN_SETTINGS.contextTextShadow,
    cardFontWeight: storage.get('lerne_card_font_weight') || DEFAULT_DESIGN_SETTINGS.cardFontWeight,
    cardFontStyle: storage.get('lerne_card_font_style') || DEFAULT_DESIGN_SETTINGS.cardFontStyle,
    contextFontWeight: storage.get('lerne_context_font_weight') || DEFAULT_DESIGN_SETTINGS.contextFontWeight,
    contextFontStyle: storage.get('lerne_context_font_style') || DEFAULT_DESIGN_SETTINGS.contextFontStyle,

    previewCardFont: storage.get('lerne_preview_card_font') || DEFAULT_DESIGN_SETTINGS.previewCardFont,
    previewCardTextColor: storage.get('lerne_preview_card_text_color') || DEFAULT_DESIGN_SETTINGS.previewCardTextColor,
    previewBackTextColor: storage.get('lerne_preview_back_text_color') || DEFAULT_DESIGN_SETTINGS.previewBackTextColor,
    previewCardFontSize: storage.get('lerne_preview_card_font_size') !== null ? Number(storage.get('lerne_preview_card_font_size')) : DEFAULT_DESIGN_SETTINGS.previewCardFontSize,
    previewBackFontSize: storage.get('lerne_preview_back_font_size') !== null ? Number(storage.get('lerne_preview_back_font_size')) : DEFAULT_DESIGN_SETTINGS.previewBackFontSize,
    previewCardFontWeight: storage.get('lerne_preview_card_font_weight') || DEFAULT_DESIGN_SETTINGS.previewCardFontWeight,
    previewCardFontStyle: storage.get('lerne_preview_card_font_style') || DEFAULT_DESIGN_SETTINGS.previewCardFontStyle,
    previewTextShadow: storage.get('lerne_preview_text_shadow') || DEFAULT_DESIGN_SETTINGS.previewTextShadow,
    previewCardTextAlign: storage.get('lerne_preview_card_text_align') || DEFAULT_DESIGN_SETTINGS.previewCardTextAlign,
    previewCardLines: storage.get('lerne_preview_card_lines') !== null ? Number(storage.get('lerne_preview_card_lines')) : DEFAULT_DESIGN_SETTINGS.previewCardLines,

    userDesign: userSavedCustom ? JSON.parse(userSavedCustom) : null,
  };
};

const getInitialStudyState = () => ({
  autoPlay: storage.get('lerne_autoplay') !== null ? storage.get('lerne_autoplay') === 'true' : false,
  autoShow: storage.get('lerne_autoshow') !== null ? storage.get('lerne_autoshow') === 'true' : false,
  autoplayFrontPause: storage.get('lerne_autoplay_front_pause') !== null ? Number(storage.get('lerne_autoplay_front_pause')) : 4,
  autoplayBackPause: storage.get('lerne_autoplay_back_pause') !== null ? Number(storage.get('lerne_autoplay_back_pause')) : 2,
  autoplayCardRepeat: storage.get('lerne_autoplay_card_repeat') !== null ? Number(storage.get('lerne_autoplay_card_repeat')) : 1,
  ttsSpeed: storage.get('lerne_tts_speed') !== null ? Number(storage.get('lerne_tts_speed')) : 0,
  ttsSpeedRu: storage.get('lerne_tts_speed_ru') !== null ? Number(storage.get('lerne_tts_speed_ru')) : 0,
  autoplayLoop: storage.get('lerne_autoplay_loop') !== null ? storage.get('lerne_autoplay_loop') === 'true' : false,
  autoplayForceFrontAudio: storage.get('lerne_autoplay_force_front_audio') !== null ? storage.get('lerne_autoplay_force_front_audio') === 'true' : false,
  autoplayForceBackAudio: storage.get('lerne_autoplay_force_back_audio') !== null ? storage.get('lerne_autoplay_force_back_audio') === 'true' : false,
  studyMode: (storage.get('lerne_study_mode') && storage.get('lerne_study_mode') !== 'turbo') ? storage.get('lerne_study_mode') : 'classic',
  speechMatchThreshold: storage.get('lerne_speech_match_threshold') !== null ? Number(storage.get('lerne_speech_match_threshold')) : 75,
  randomEnabledModes: storage.get('lerne_random_enabled_modes')
    ? JSON.parse(storage.get('lerne_random_enabled_modes')).filter(m => m !== 'turbo')
    : ['classic', 'reverse', 'cloze', 'puzzle', 'speak'],
  isAdmin: false,
});

export const useSettingsStore = create((set, get) => ({
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
  setAutoplayFrontPause: (value) => {
    storage.set('lerne_autoplay_front_pause', value);
    set({ autoplayFrontPause: Number(value) });
  },
  setAutoplayBackPause: (value) => {
    storage.set('lerne_autoplay_back_pause', value);
    set({ autoplayBackPause: Number(value) });
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

  // --- Design Settings ---
  ...getInitialDesignState(),
  setCardBgFront: (val) => { storage.set('lerne_card_bg_front', val); set({ cardBgFront: val }); },
  setCardBgBack: (val) => { storage.set('lerne_card_bg_back', val); set({ cardBgBack: val }); },
  setCardFont: (val) => { storage.set('lerne_card_font', val); set({ cardFont: val }); },
  setCardTextColor: (val) => { storage.set('lerne_card_text_color', val); set({ cardTextColor: val }); },
  setCardFontSize: (val) => { storage.set('lerne_card_font_size', val); set({ cardFontSize: val }); },
  setBackTextColor: (val) => { storage.set('lerne_back_text_color', val); set({ backTextColor: val }); },
  setContextFont: (val) => { storage.set('lerne_context_font', val); set({ contextFont: val }); },
  setContextTextColor: (val) => { storage.set('lerne_context_text_color', val); set({ contextTextColor: val }); },
  setContextFontSize: (val) => { storage.set('lerne_context_font_size', val); set({ contextFontSize: val }); },
  setCardTextShadow: (val) => { storage.set('lerne_card_text_shadow', val); set({ cardTextShadow: val }); },
  setContextTextShadow: (val) => { storage.set('lerne_context_text_shadow', val); set({ contextTextShadow: val }); },
  setCardFontWeight: (val) => { storage.set('lerne_card_font_weight', val); set({ cardFontWeight: val }); },
  setCardFontStyle: (val) => { storage.set('lerne_card_font_style', val); set({ cardFontStyle: val }); },
  setCardTextAlign: (val) => { storage.set('lerne_card_text_align', val); set({ cardTextAlign: val }); },
  setContextFontWeight: (val) => { storage.set('lerne_context_font_weight', val); set({ contextFontWeight: val }); },
  setContextFontStyle: (val) => { storage.set('lerne_context_font_style', val); set({ contextFontStyle: val }); },
  setContextTextAlign: (val) => { storage.set('lerne_context_text_align', val); set({ contextTextAlign: val }); },

  // Preview List Typography Setters
  setPreviewCardFont: (val) => { storage.set('lerne_preview_card_font', val); set({ previewCardFont: val }); },
  setPreviewCardTextColor: (val) => { storage.set('lerne_preview_card_text_color', val); set({ previewCardTextColor: val }); },
  setPreviewBackTextColor: (val) => { storage.set('lerne_preview_back_text_color', val); set({ previewBackTextColor: val }); },
  setPreviewCardFontSize: (val) => { storage.set('lerne_preview_card_font_size', val); set({ previewCardFontSize: val }); },
  setPreviewBackFontSize: (val) => { storage.set('lerne_preview_back_font_size', val); set({ previewBackFontSize: val }); },
  setPreviewCardFontWeight: (val) => { storage.set('lerne_preview_card_font_weight', val); set({ previewCardFontWeight: val }); },
  setPreviewCardFontStyle: (val) => { storage.set('lerne_preview_card_font_style', val); set({ previewCardFontStyle: val }); },
  setPreviewTextShadow: (val) => { storage.set('lerne_preview_text_shadow', val); set({ previewTextShadow: val }); },
  setPreviewCardTextAlign: (val) => { storage.set('lerne_preview_card_text_align', val); set({ previewCardTextAlign: val }); },
  setPreviewCardLines: (val) => { storage.set('lerne_preview_card_lines', val); set({ previewCardLines: Number(val) }); },

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
    storage.set('lerne_preview_card_font', updates.previewCardFont);
    storage.set('lerne_preview_card_text_color', updates.previewCardTextColor);
    storage.set('lerne_preview_back_text_color', updates.previewBackTextColor);
    storage.set('lerne_preview_card_font_weight', updates.previewCardFontWeight);
    storage.set('lerne_preview_card_font_style', updates.previewCardFontStyle);
    storage.set('lerne_preview_text_shadow', updates.previewTextShadow);
    storage.set('lerne_preview_card_text_align', updates.previewCardTextAlign);
    set(updates);
  },

  // Helper to apply a full design preset
  applyDesignPreset: (preset) => {
    const s = preset.settings;
    if (!s) return;
    
    set({ ...s });
    
    // Sync all to storage
    if (s.cardBgFront) storage.set('lerne_card_bg_front', s.cardBgFront);
    if (s.cardBgBack) storage.set('lerne_card_bg_back', s.cardBgBack);
    if (s.cardFont) storage.set('lerne_card_font', s.cardFont);
    if (s.cardTextColor) storage.set('lerne_card_text_color', s.cardTextColor);
    if (s.cardFontSize) storage.set('lerne_card_font_size', s.cardFontSize);
    if (s.backTextColor) storage.set('lerne_back_text_color', s.backTextColor);
    if (s.contextFont) storage.set('lerne_context_font', s.contextFont);
    if (s.contextTextColor) storage.set('lerne_context_text_color', s.contextTextColor);
    if (s.contextFontSize) storage.set('lerne_context_font_size', s.contextFontSize);
    if (s.cardTextShadow) storage.set('lerne_card_text_shadow', s.cardTextShadow);
    if (s.contextTextShadow) storage.set('lerne_context_text_shadow', s.contextTextShadow);
    if (s.cardFontWeight) storage.set('lerne_card_font_weight', s.cardFontWeight);
    if (s.cardFontStyle) storage.set('lerne_card_font_style', s.cardFontStyle);
    if (s.cardTextAlign) storage.set('lerne_card_text_align', s.cardTextAlign);
    if (s.contextFontWeight) storage.set('lerne_context_font_weight', s.contextFontWeight);
    if (s.contextFontStyle) storage.set('lerne_context_font_style', s.contextFontStyle);
    if (s.contextTextAlign) storage.set('lerne_context_text_align', s.contextTextAlign);

    if (s.previewCardFont) storage.set('lerne_preview_card_font', s.previewCardFont);
    if (s.previewCardTextColor) storage.set('lerne_preview_card_text_color', s.previewCardTextColor);
    if (s.previewBackTextColor) storage.set('lerne_preview_back_text_color', s.previewBackTextColor);
    if (s.previewCardFontSize) storage.set('lerne_preview_card_font_size', s.previewCardFontSize);
    if (s.previewBackFontSize) storage.set('lerne_preview_back_font_size', s.previewBackFontSize);
    if (s.previewCardFontWeight) storage.set('lerne_preview_card_font_weight', s.previewCardFontWeight);
    if (s.previewCardFontStyle) storage.set('lerne_preview_card_font_style', s.previewCardFontStyle);
    if (s.previewTextShadow) storage.set('lerne_preview_text_shadow', s.previewTextShadow);
    if (s.previewCardTextAlign) storage.set('lerne_preview_card_text_align', s.previewCardTextAlign);
    if (s.previewCardLines !== undefined) storage.set('lerne_preview_card_lines', s.previewCardLines);
  },

  saveUserDesign: () => {
    const s = get();
    const design = {
      cardBgFront: s.cardBgFront,
      cardBgBack: s.cardBgBack,
      cardFont: s.cardFont,
      cardTextColor: s.cardTextColor,
      cardFontSize: s.cardFontSize,
      backTextColor: s.backTextColor,
      contextFont: s.contextFont,
      contextTextColor: s.contextTextColor,
      contextFontSize: s.contextFontSize,
      cardTextShadow: s.cardTextShadow,
      contextTextShadow: s.contextTextShadow,
      cardFontWeight: s.cardFontWeight,
      cardFontStyle: s.cardFontStyle,
      cardTextAlign: s.cardTextAlign,
      contextFontWeight: s.contextFontWeight,
      contextFontStyle: s.contextFontStyle,
      contextTextAlign: s.contextTextAlign,

      previewCardFont: s.previewCardFont,
      previewCardTextColor: s.previewCardTextColor,
      previewBackTextColor: s.previewBackTextColor,
      previewCardFontSize: s.previewCardFontSize,
      previewBackFontSize: s.previewBackFontSize,
      previewCardFontWeight: s.previewCardFontWeight,
      previewCardFontStyle: s.previewCardFontStyle,
      previewTextShadow: s.previewTextShadow,
      previewCardTextAlign: s.previewCardTextAlign,
      previewCardLines: s.previewCardLines,
    };
    storage.set('lerne_user_design', JSON.stringify(design));
    set({ userDesign: design });
  },

  applyUserDesign: () => {
    const design = get().userDesign;
    if (design) get().applyDesignPreset({ settings: design });
  },

  resetDesign: () => {
    set(DEFAULT_DESIGN_SETTINGS);
    
    storage.set('lerne_card_bg_front', DEFAULT_DESIGN_SETTINGS.cardBgFront);
    storage.set('lerne_card_bg_back', DEFAULT_DESIGN_SETTINGS.cardBgBack);
    storage.set('lerne_card_font', DEFAULT_DESIGN_SETTINGS.cardFont);
    storage.set('lerne_card_text_color', DEFAULT_DESIGN_SETTINGS.cardTextColor);
    storage.set('lerne_card_font_size', DEFAULT_DESIGN_SETTINGS.cardFontSize);
    storage.set('lerne_card_text_align', DEFAULT_DESIGN_SETTINGS.cardTextAlign);
    storage.set('lerne_back_text_color', DEFAULT_DESIGN_SETTINGS.backTextColor);
    storage.set('lerne_context_font', DEFAULT_DESIGN_SETTINGS.contextFont);
    storage.set('lerne_context_text_color', DEFAULT_DESIGN_SETTINGS.contextTextColor);
    storage.set('lerne_context_font_size', DEFAULT_DESIGN_SETTINGS.contextFontSize);
    storage.set('lerne_context_text_align', DEFAULT_DESIGN_SETTINGS.contextTextAlign);
    storage.set('lerne_card_text_shadow', DEFAULT_DESIGN_SETTINGS.cardTextShadow);
    storage.set('lerne_context_text_shadow', DEFAULT_DESIGN_SETTINGS.contextTextShadow);
    storage.set('lerne_card_font_weight', DEFAULT_DESIGN_SETTINGS.cardFontWeight);
    storage.set('lerne_card_font_style', DEFAULT_DESIGN_SETTINGS.cardFontStyle);
    storage.set('lerne_context_font_weight', DEFAULT_DESIGN_SETTINGS.contextFontWeight);
    storage.set('lerne_context_font_style', DEFAULT_DESIGN_SETTINGS.contextFontStyle);

    storage.set('lerne_preview_card_font', DEFAULT_DESIGN_SETTINGS.previewCardFont);
    storage.set('lerne_preview_card_text_color', DEFAULT_DESIGN_SETTINGS.previewCardTextColor);
    storage.set('lerne_preview_back_text_color', DEFAULT_DESIGN_SETTINGS.previewBackTextColor);
    storage.set('lerne_preview_card_font_size', DEFAULT_DESIGN_SETTINGS.previewCardFontSize);
    storage.set('lerne_preview_back_font_size', DEFAULT_DESIGN_SETTINGS.previewBackFontSize);
    storage.set('lerne_preview_card_font_weight', DEFAULT_DESIGN_SETTINGS.previewCardFontWeight);
    storage.set('lerne_preview_card_font_style', DEFAULT_DESIGN_SETTINGS.previewCardFontStyle);
    storage.set('lerne_preview_text_shadow', DEFAULT_DESIGN_SETTINGS.previewTextShadow);
    storage.set('lerne_preview_card_text_align', DEFAULT_DESIGN_SETTINGS.previewCardTextAlign);
    storage.set('lerne_preview_card_lines', DEFAULT_DESIGN_SETTINGS.previewCardLines);
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
}));

