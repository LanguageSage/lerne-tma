import { create } from 'zustand';
import { storage } from '../utils/auth';

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
  contextFontStyle: 'normal'
};

const DESIGN_STORAGE_VERSION = '2026_08_emerald';

const getInitialDesignState = () => {
  const storedVersion = storage.get('lerne_design_version');
  const userSavedCustom = storage.get('lerne_user_design');

  if (storedVersion !== DESIGN_STORAGE_VERSION && !userSavedCustom) {
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
    return {
      ...DEFAULT_DESIGN_SETTINGS,
      userDesign: null,
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
    userDesign: userSavedCustom ? JSON.parse(userSavedCustom) : null,
  };
};

const getInitialStudyState = () => ({
  autoPlay: storage.get('lerne_autoplay') !== null ? storage.get('lerne_autoplay') === 'true' : true,
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
}));
