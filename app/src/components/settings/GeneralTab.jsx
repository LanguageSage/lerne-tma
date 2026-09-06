import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../i18n/i18nContext';

export const GeneralTab = ({ userId }) => {
  useInterfaceLocale();
  const { autoPlay, setAutoPlay, autoShow, setAutoShow } = useSettingsStore();
  const { t } = useTranslation();

  return (
    <motion.div 
      id="tut-settings-general" 
      key="general" 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section"
    >
      <h3>{tr("Обучение")}</h3>
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

