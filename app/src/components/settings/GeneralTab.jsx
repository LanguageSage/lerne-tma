import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../i18n/i18nContext';
import { SUPPORTED_NATIVE_LANGUAGES } from '../../constants/languageConstants';

export const GeneralTab = ({ userId }) => {
  const { autoPlay, setAutoPlay, autoShow, setAutoShow, setVoiceBack } = useSettingsStore();
  const { nativeLanguage, changeNativeLanguage, t } = useTranslation();

  const handleLanguageChange = (code) => {
    changeNativeLanguage(code, true);
    const langObj = SUPPORTED_NATIVE_LANGUAGES.find(l => l.code === code);
    if (langObj) {
      setVoiceBack(langObj.defaultVoice);
    }
  };

  return (
    <motion.div 
      id="tut-settings-general" 
      key="general" 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section"
    >
      <h3>{t('settings.native_lang_title')}</h3>
      <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>
        {t('settings.native_lang_subtitle')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '24px' }}>
        {SUPPORTED_NATIVE_LANGUAGES.map((lang) => {
          const isSelected = nativeLanguage === lang.code;
          return (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '12px 8px',
                borderRadius: '14px',
                border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: '#ffffff',
                fontSize: '0.9rem',
                fontWeight: isSelected ? '700' : '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.25)' : 'none'
              }}
            >
              <span style={{ fontSize: '1.6rem' }}>{lang.flag}</span>
              <span>{lang.name}</span>
            </button>
          );
        })}
      </div>

      <h3 style={{ marginTop: '16px' }}>Обучение</h3>
      <div className="settings-row">
        <span>{t('settings.auto_sound')}</span>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={autoPlay} 
            onChange={e => setAutoPlay(e.target.checked)} 
          />
          <span className="slider"></span>
        </label>
      </div>
      <div className="settings-row">
        <span>{t('settings.auto_reveal')}</span>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={autoShow} 
            onChange={e => setAutoShow(e.target.checked)} 
          />
          <span className="slider"></span>
        </label>
      </div>
      <div className="settings-debug-info">
        <p>User ID: <code>{userId}</code></p>
        <p>Platform: <code>{window.Telegram?.WebApp?.platform || 'Web'}</code></p>
      </div>
    </motion.div>
  );
};

