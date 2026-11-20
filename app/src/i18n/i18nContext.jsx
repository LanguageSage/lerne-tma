/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { cloudStorage } from '../utils/auth';
import api from '../services/api';
import { setInterfaceLanguage, normalizeInterfaceLanguage, getInterfaceLanguage, t as translateLocale } from './locale';
import { useInterfaceLocale } from './useInterfaceLocale';
import { useSettingsStore } from '../store/useSettingsStore';

const noop = () => {};
const LanguageContext = createContext({
  nativeLanguage: getInterfaceLanguage(),
  changeNativeLanguage: noop,
  syncNativeLanguageFromExternal: noop,
  t: translateLocale,
  isFirstLaunch: false,
  setIsFirstLaunch: noop,
});

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
      useSettingsStore.getState().saveCurrentSettingsToServer().catch(() => {});
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

  const t = useCallback((path, param1, param2) => (
    translateLocale(path, param1, param2, nativeLanguage)
  ), [nativeLanguage]);

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
