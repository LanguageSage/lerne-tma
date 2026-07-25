import React, { createContext, useContext, useState, useEffect } from 'react';
import ukTranslations from './locales/uk.json';
import ruTranslations from './locales/ru.json';
import enTranslations from './locales/en.json';

const TRANSLATIONS = {
  uk: ukTranslations,
  ru: ruTranslations,
  en: enTranslations
};

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [nativeLanguage, setNativeLanguage] = useState(() => {
    const saved = localStorage.getItem('native_language');
    if (saved && TRANSLATIONS[saved]) return saved;

    // Telegram WebApp auto detect fallback
    const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    if (tgLang && tgLang.startsWith('uk')) return 'uk';
    if (tgLang && tgLang.startsWith('ru')) return 'ru';
    if (tgLang && tgLang.startsWith('en')) return 'en';

    // Default to Ukrainian
    return 'uk';
  });

  const [isFirstLaunch, setIsFirstLaunch] = useState(() => {
    return !localStorage.getItem('native_language_selected');
  });

  useEffect(() => {
    localStorage.setItem('native_language', nativeLanguage);
  }, [nativeLanguage]);

  const changeNativeLanguage = (code) => {
    if (TRANSLATIONS[code]) {
      setNativeLanguage(code);
      localStorage.setItem('native_language', code);
      localStorage.setItem('native_language_selected', 'true');
      setIsFirstLaunch(false);
    }
  };

  const t = (path, fallback = '') => {
    const dict = TRANSLATIONS[nativeLanguage] || TRANSLATIONS.uk;
    const keys = path.split('.');
    let current = dict;
    for (const key of keys) {
      if (current && current[key] !== undefined) {
        current = current[key];
      } else {
        return fallback || path;
      }
    }
    return current;
  };

  return (
    <LanguageContext.Provider value={{ nativeLanguage, changeNativeLanguage, t, isFirstLaunch, setIsFirstLaunch }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
