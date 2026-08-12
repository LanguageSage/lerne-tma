/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import ukTranslations from './locales/uk.json';
import ruTranslations from './locales/ru.json';
import enTranslations from './locales/en.json';
import { cloudStorage } from '../utils/auth';
import api from '../services/api';

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

  // 1. Restore native language from Telegram CloudStorage on mount if missing in LocalStorage
  useEffect(() => {
    const restoreFromCloud = async () => {
      try {
        const cloudSel = await cloudStorage.get('lerne_native_language_selected');
        const cloudLang = await cloudStorage.get('lerne_native_language');
        if (cloudSel === 'true' && cloudLang && TRANSLATIONS[cloudLang]) {
          setNativeLanguage(cloudLang);
          localStorage.setItem('native_language', cloudLang);
          localStorage.setItem('native_language_selected', 'true');
          setIsFirstLaunch(false);
        }
      } catch (e) {
        console.warn("CloudStorage native language restore failed:", e);
      }
    };
    restoreFromCloud();
  }, []);

  useEffect(() => {
    localStorage.setItem('native_language', nativeLanguage);
  }, [nativeLanguage]);

  const changeNativeLanguage = (code) => {
    if (TRANSLATIONS[code]) {
      setNativeLanguage(code);
      localStorage.setItem('native_language', code);
      localStorage.setItem('native_language_selected', 'true');
      cloudStorage.set('lerne_native_language', code);
      cloudStorage.set('lerne_native_language_selected', 'true');
      setIsFirstLaunch(false);

      // Async sync to backend
      api.post('/user/language', { native_language: code }).catch(err => {
        console.error("Failed to save native language to backend:", err);
      });
    }
  };

  const syncNativeLanguageFromExternal = (code, selected = true) => {
    if (TRANSLATIONS[code]) {
      setNativeLanguage(code);
      localStorage.setItem('native_language', code);
      cloudStorage.set('lerne_native_language', code);
      if (selected) {
        localStorage.setItem('native_language_selected', 'true');
        cloudStorage.set('lerne_native_language_selected', 'true');
        setIsFirstLaunch(false);
      }
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
    <LanguageContext.Provider value={{
      nativeLanguage, 
      changeNativeLanguage, 
      syncNativeLanguageFromExternal,
      t, 
      isFirstLaunch, 
      setIsFirstLaunch 
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
