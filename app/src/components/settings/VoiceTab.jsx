import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';
import { VOICE_OPTIONS } from '../../constants/settingsConstants';

export const VoiceTab = () => {
  const { adminSettings, updateAdminSetting } = useSettingsStore();
  const { showToast } = useUiStore();

  const saveAdminSettings = async () => {
    const settings = useSettingsStore.getState().adminSettings;
    try {
      await api.post('/admin/settings', settings);
      showToast("Настройки сохранены", "success");
    } catch (err) {
      showToast("Ошибка сохранения настроек");
    }
  };

  return (
    <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>Синтез речи</h3>
      <div className="form-group">
        <label>Голос (Edge TTS)</label>
        <select value={adminSettings.TTS_VOICE || ''} onChange={e => updateAdminSetting('TTS_VOICE', e.target.value)}>
          {VOICE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <div className="label-with-value">
          <label>Скорость</label>
          <span className="value-badge">{adminSettings.TTS_SPEED || "+0%"}</span>
        </div>
        <input 
          type="range" 
          min="-50" 
          max="100" 
          step="5"
          value={parseInt((adminSettings.TTS_SPEED || "+0%").replace('%', ''))} 
          onChange={e => {
            const val = parseInt(e.target.value);
            const speed = val >= 0 ? `+${val}%` : `${val}%`;
            updateAdminSetting('TTS_SPEED', speed);
          }} 
        />
        <div className="range-labels">
          <span>Медленно</span>
          <span>Норм</span>
          <span>Быстро</span>
        </div>
      </div>
      <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить настройки голоса</button>
    </motion.div>
  );
};
