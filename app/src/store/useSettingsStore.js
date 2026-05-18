import { create } from 'zustand';
import { storage } from '../utils/auth';

const getInitialDesignState = () => ({
  cardBgFront: storage.get('lerne_card_bg_front') || 'liquid_morning',
  cardBgBack: storage.get('lerne_card_bg_back') || 'liquid_morning',
  cardFont: storage.get('lerne_card_font') || 'Comfortaa',
  cardTextColor: storage.get('lerne_card_text_color') || '#ffff00',
  cardFontSize: storage.get('lerne_card_font_size') !== null ? Number(storage.get('lerne_card_font_size')) : 1.8,
  contextFont: storage.get('lerne_context_font') || 'Inter',
  contextTextColor: storage.get('lerne_context_text_color') || '#080c03',
  contextFontSize: storage.get('lerne_context_font_size') !== null ? Number(storage.get('lerne_context_font_size')) : 1.35,
  cardTextShadow: storage.get('lerne_card_text_shadow') || 'glow',
  contextTextShadow: storage.get('lerne_context_text_shadow') || 'outline',
  cardFontWeight: storage.get('lerne_card_font_weight') || '700',
  cardFontStyle: storage.get('lerne_card_font_style') || 'normal',
  contextFontWeight: storage.get('lerne_context_font_weight') || '400',
  contextFontStyle: storage.get('lerne_context_font_style') || 'normal',
  userDesign: storage.get('lerne_user_design') ? JSON.parse(storage.get('lerne_user_design')) : null,
});

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
  isAdmin: false,
});

export const useSettingsStore = create((set, get) => ({
  // --- Study Settings ---
  ...getInitialStudyState(),
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
  setContextFont: (val) => { storage.set('lerne_context_font', val); set({ contextFont: val }); },
  setContextTextColor: (val) => { storage.set('lerne_context_text_color', val); set({ contextTextColor: val }); },
  setContextFontSize: (val) => { storage.set('lerne_context_font_size', val); set({ contextFontSize: val }); },
  setCardTextShadow: (val) => { storage.set('lerne_card_text_shadow', val); set({ cardTextShadow: val }); },
  setContextTextShadow: (val) => { storage.set('lerne_context_text_shadow', val); set({ contextTextShadow: val }); },
  setCardFontWeight: (val) => { storage.set('lerne_card_font_weight', val); set({ cardFontWeight: val }); },
  setCardFontStyle: (val) => { storage.set('lerne_card_font_style', val); set({ cardFontStyle: val }); },
  setContextFontWeight: (val) => { storage.set('lerne_context_font_weight', val); set({ contextFontWeight: val }); },
  setContextFontStyle: (val) => { storage.set('lerne_context_font_style', val); set({ contextFontStyle: val }); },

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
    if (s.contextFont) storage.set('lerne_context_font', s.contextFont);
    if (s.contextTextColor) storage.set('lerne_context_text_color', s.contextTextColor);
    if (s.contextFontSize) storage.set('lerne_context_font_size', s.contextFontSize);
    if (s.cardTextShadow) storage.set('lerne_card_text_shadow', s.cardTextShadow);
    if (s.contextTextShadow) storage.set('lerne_context_text_shadow', s.contextTextShadow);
    if (s.cardFontWeight) storage.set('lerne_card_font_weight', s.cardFontWeight);
    if (s.cardFontStyle) storage.set('lerne_card_font_style', s.cardFontStyle);
    if (s.contextFontWeight) storage.set('lerne_context_font_weight', s.contextFontWeight);
    if (s.contextFontStyle) storage.set('lerne_context_font_style', s.contextFontStyle);
  },

  saveUserDesign: () => {
    const s = get();
    const design = {
      cardBgFront: s.cardBgFront,
      cardBgBack: s.cardBgBack,
      cardFont: s.cardFont,
      cardTextColor: s.cardTextColor,
      cardFontSize: s.cardFontSize,
      contextFont: s.contextFont,
      contextTextColor: s.contextTextColor,
      contextFontSize: s.contextFontSize,
      cardTextShadow: s.cardTextShadow,
      contextTextShadow: s.contextTextShadow,
      cardFontWeight: s.cardFontWeight,
      cardFontStyle: s.cardFontStyle,
      contextFontWeight: s.contextFontWeight,
      contextFontStyle: s.contextFontStyle,
    };
    storage.set('lerne_user_design', JSON.stringify(design));
    set({ userDesign: design });
  },

  applyUserDesign: () => {
    const design = get().userDesign;
    if (design) get().applyDesignPreset({ settings: design });
  },

  resetDesign: () => {
    // We'll import DESIGN_PRESETS here or just hardcode the ID. 
    // Since we want to move fast, we'll assume the component passes the default preset or the store knows it.
    // Actually, let's just make it a generic applier.
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
