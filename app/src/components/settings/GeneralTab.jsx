import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';

export const GeneralTab = ({ userId }) => {
  const { autoPlay, setAutoPlay, autoShow, setAutoShow } = useSettingsStore();

  return (
    <motion.div 
      id="tut-settings-general" 
      key="general" 
      initial={{ opacity: 0, x: 10 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -10 }} 
      className="settings-section"
    >
      <h3>Обучение</h3>
      <div className="settings-row">
        <span>Авто-звук</span>
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
        <span>Авто-показ</span>
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
