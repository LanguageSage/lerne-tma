/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import ukTranslations from './locales/uk.json';
import ruTranslations from './locales/ru.json';
import enTranslations from './locales/en.json';
import { cloudStorage } from '../utils/auth';
import api from '../services/api';
import { setInterfaceLanguage, normalizeInterfaceLanguage, tr } from './locale';
import { useInterfaceLocale } from './useInterfaceLocale';

const TRANSLATIONS = {
  uk: ukTranslations,
  ru: ruTranslations,
  en: enTranslations
};

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const nativeLanguage = useInterfaceLocale();
  const [isFirstLaunch, setIsFirstLaunch] = useState(() => {
    const nativeDone = localStorage.getItem('native_language_selected') === 'true';
    const targetDone = localStorage.getItem('lerne_has_selected_language') === 'true';
    return !nativeDone || !targetDone;
  });

  // 1. Restore native language from Telegram CloudStorage on mount if missing in LocalStorage
  useEffect(() => {
    const savedAtStart = localStorage.getItem('native_language');
    const restoreFromCloud = async () => {
      try {
        const [cloudSel, rawCloudLang, cloudTargetSel] = await Promise.all([
          cloudStorage.get('lerne_native_language_selected'),
          cloudStorage.get('lerne_native_language'),
          cloudStorage.get('lerne_has_selected_language')
        ]);
        const cloudLang = normalizeInterfaceLanguage(rawCloudLang);
        if (!savedAtStart && !localStorage.getItem('native_language') && cloudSel === 'true' && cloudLang) {
          setInterfaceLanguage(cloudLang);
          localStorage.setItem('native_language_selected', 'true');
        }
        if (cloudSel === 'true' && cloudTargetSel === 'true') {
          setIsFirstLaunch(false);
        }
      } catch (e) {
        console.warn("CloudStorage native language restore failed:", e);
      }
    };
    restoreFromCloud();
  }, []);

  useEffect(() => {
    const previous = localStorage.getItem('native_language');
    setInterfaceLanguage(nativeLanguage);
    if (previous && previous !== nativeLanguage) {
      cloudStorage.set('lerne_native_language', nativeLanguage);
      api.post('/user/language', { native_language: nativeLanguage }).catch(() => {});
    }
  }, [nativeLanguage]);

  const changeNativeLanguage = useCallback((code, markCompleted = false) => {
    code = normalizeInterfaceLanguage(code);
    if (code) {
      setInterfaceLanguage(code);
      cloudStorage.set('lerne_native_language', code);

      if (markCompleted) {
        localStorage.setItem('native_language_selected', 'true');
        cloudStorage.set('lerne_native_language_selected', 'true');
        setIsFirstLaunch(false);
      }

      // Async sync to backend
      api.post('/user/language', { native_language: code }).catch(err => {
        console.error("Failed to save native language to backend:", err);
      });
    }
  }, []);

  const syncNativeLanguageFromExternal = useCallback((code, selected = true) => {
    code = normalizeInterfaceLanguage(code);
    if (code) {
      setInterfaceLanguage(code);
      cloudStorage.set('lerne_native_language', code);
      if (selected) {
        localStorage.setItem('native_language_selected', 'true');
        cloudStorage.set('lerne_native_language_selected', 'true');
        setIsFirstLaunch(false);
      }
    }
  }, []);

  const t = useCallback((path, param1, param2) => {
    let fallback = '';
    let params = null;

    if (typeof param1 === 'object' && param1 !== null) {
      params = param1;
      fallback = path;
    } else {
      if (typeof param1 === 'string') fallback = param1;
      if (typeof param2 === 'object' && param2 !== null) params = param2;
    }

    const dict = TRANSLATIONS[nativeLanguage] || TRANSLATIONS.uk;
    const keys = path.split('.');
    let current = dict;
    for (const key of keys) {
      if (current && current[key] !== undefined) {
        current = current[key];
      } else {
        current = tr(fallback || path, null, nativeLanguage);
        break;
      }
    }

    if (typeof current === 'string' && params) {
      return current.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{{${k}}}`));
    }

    return typeof current === 'string' ? current : String(current || '');
  }, [nativeLanguage]);

  const value = useMemo(() => ({
    nativeLanguage, 
    changeNativeLanguage, 
    syncNativeLanguageFromExternal,
    t, 
    isFirstLaunch, 
    setIsFirstLaunch 
  }), [nativeLanguage, changeNativeLanguage, syncNativeLanguageFromExternal, t, isFirstLaunch]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
