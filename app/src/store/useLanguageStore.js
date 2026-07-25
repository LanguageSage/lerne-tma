import { create } from 'zustand';

export const SUPPORTED_LANGUAGES = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', label: 'Немецкий', desc: 'Изучение грамматики, артиклей der/die/das и падежей' },
  { code: 'en', name: 'English', flag: '🇬🇧', label: 'Английский', desc: 'Изучение разговорных фраз, времён и фразовых глаголов' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴', label: 'Норвежский', desc: 'Изучение слов, родов en/ei/et и конструкций Bokmål' },
];

const INITIAL_LANG = localStorage.getItem('lerne_target_language') || 'de';
const INITIAL_HAS_SELECTED = localStorage.getItem('lerne_has_selected_language') === 'true';

export const useLanguageStore = create((set, get) => ({
  activeLanguage: INITIAL_LANG,
  hasSelectedLanguage: INITIAL_HAS_SELECTED,
  isLanguageModalOpen: false,
  
  setLanguage: (code) => {
    if (SUPPORTED_LANGUAGES.some(l => l.code === code)) {
      localStorage.setItem('lerne_target_language', code);
      localStorage.setItem('lerne_has_selected_language', 'true');
      set({ activeLanguage: code, hasSelectedLanguage: true, isLanguageModalOpen: false });
    }
  },

  setLanguageModalOpen: (isOpen) => set({ isLanguageModalOpen: isOpen }),

  getLanguageInfo: (code) => {
    const target = code || get().activeLanguage;
    return SUPPORTED_LANGUAGES.find(l => l.code === target) || SUPPORTED_LANGUAGES[0];
  }
}));
