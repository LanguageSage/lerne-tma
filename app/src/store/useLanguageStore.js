import { create } from 'zustand';
import { cloudStorage } from '../utils/auth';
import api from '../services/api';

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
  
  setLanguage: async (code, skipBackend = false) => {
    if (SUPPORTED_LANGUAGES.some(l => l.code === code)) {
      // 1. LocalStorage
      localStorage.setItem('lerne_target_language', code);
      localStorage.setItem('lerne_has_selected_language', 'true');

      // 2. Telegram CloudStorage
      cloudStorage.set('lerne_target_language', code);
      cloudStorage.set('lerne_has_selected_language', 'true');

      set({ activeLanguage: code, hasSelectedLanguage: true, isLanguageModalOpen: false });

      // 3. Backend DB sync
      if (!skipBackend) {
        try {
          await api.post('/user/language', { active_language: code, has_selected_language: true });
        } catch (err) {
          console.error("Error saving user language to backend:", err);
        }
      }
      
      // Automatically refresh decks and folders for newly selected language
      try {
        const { useDeckStore } = await import('./useDeckStore');
        await useDeckStore.getState().fetchDecks(true);
      } catch (err) {
        console.error("Error refreshing decks after language change:", err);
      }
    }
  },

  syncLanguageFromExternal: (code, hasSelected = true) => {
    if (SUPPORTED_LANGUAGES.some(l => l.code === code)) {
      const currentHasSelected = get().hasSelectedLanguage;
      const finalHasSelected = currentHasSelected || Boolean(hasSelected);

      localStorage.setItem('lerne_target_language', code);
      if (finalHasSelected) {
        localStorage.setItem('lerne_has_selected_language', 'true');
        cloudStorage.set('lerne_has_selected_language', 'true');
      }
      cloudStorage.set('lerne_target_language', code);
      set({
        activeLanguage: code,
        hasSelectedLanguage: finalHasSelected,
        isLanguageModalOpen: false
      });
    }
  },

  setLanguageModalOpen: (isOpen) => set({ isLanguageModalOpen: isOpen }),

  getLanguageInfo: (code) => {
    const target = code || get().activeLanguage;
    return SUPPORTED_LANGUAGES.find(l => l.code === target) || SUPPORTED_LANGUAGES[0];
  }
}));
