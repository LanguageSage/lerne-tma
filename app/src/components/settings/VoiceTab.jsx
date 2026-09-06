import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import api from '../../services/api';
import { VOICE_OPTIONS } from '../../constants/settingsConstants';
import { renderFlag } from '../deckgrid/FlagIcons';

export const VoiceTab = () => {
  useInterfaceLocale();
  const { adminSettings, updateAdminSetting, speechMatchThreshold, setSpeechMatchThreshold } = useSettingsStore();
  const { showToast } = useUiStore();
  const { activeLanguage, getLanguageInfo } = useLanguageStore();

  const langInfo = getLanguageInfo();

  const getVoiceFilterPrefix = (code) => {
    switch (code) {
      case 'en': return 'en-';
      case 'no': return 'nb-';
      case 'uk': return 'uk-';
      case 'ru': return 'ru-';
      case 'de':
      default:
        return 'de-';
    }
  };

  const currentPrefix = getVoiceFilterPrefix(activeLanguage);
  const filteredVoices = VOICE_OPTIONS.filter(opt => opt.value.startsWith(currentPrefix));

  const saveAdminSettings = async () => {
    const settings = useSettingsStore.getState().adminSettings;
    try {
      await api.post('/admin/settings', settings);
      showToast(tr("Настройки сохранены"), "success");
    } catch {
      showToast(tr("Ошибка сохранения настроек"));
    }
  };

  return (
    <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>{tr("Синтез речи (Edge TTS)")}</h3>

      {/* Target Language Voice Selection */}
      <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '15px', color: '#38bdf8', fontSize: '1rem', borderBottom: '1px solid rgba(56, 189, 248, 0.2)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{tr("Для оригинала (")}{langInfo.name})</span>
          {renderFlag(langInfo.code, 18)}
        </h4>
        <div className="form-group">
          <label>{tr("Голос (")}{langInfo.name})</label>
          {(() => {
            const voiceKey = activeLanguage === 'de' ? 'TTS_VOICE' : `TTS_VOICE_${activeLanguage.toUpperCase()}`;
            const selectedVal = adminSettings[voiceKey] || (filteredVoices[0]?.value || '');
            return (
              <select 
                value={selectedVal} 
                onChange={e => updateAdminSetting(voiceKey, e.target.value)}
              >
                {filteredVoices.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            );
          })()}
        </div>
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Скорость")}</label>
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
              useSettingsStore.getState().setTtsSpeed(val);
            }} 
          />
          <div className="range-labels">
            <span>{tr("Медленно")}</span>
            <span>{tr("Норм")}</span>
            <span>{tr("Быстро")}</span>
          </div>
        </div>
      </div>

      {/* Russian Translation Voice Selection */}
      <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '15px', color: '#38bdf8', fontSize: '1rem', borderBottom: '1px solid rgba(56, 189, 248, 0.2)', paddingBottom: '8px' }}>{tr("Для перевода (Русский 🇷🇺)")}</h4>
        <div className="form-group">
          <label>{tr("Голос")}</label>
          <select value={adminSettings.TTS_VOICE_RU || ''} onChange={e => updateAdminSetting('TTS_VOICE_RU', e.target.value)}>
            {VOICE_OPTIONS.filter(opt => opt.value.startsWith('ru')).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Скорость")}</label>
            <span className="value-badge">{adminSettings.TTS_SPEED_RU || "+0%"}</span>
          </div>
          <input 
            type="range" 
            min="-50" 
            max="100" 
            step="5"
            value={parseInt((adminSettings.TTS_SPEED_RU || "+0%").replace('%', ''))} 
            onChange={e => {
              const val = parseInt(e.target.value);
              const speed = val >= 0 ? `+${val}%` : `${val}%`;
              updateAdminSetting('TTS_SPEED_RU', speed);
              useSettingsStore.getState().setTtsSpeedRu(val);
            }} 
          />
          <div className="range-labels">
            <span>{tr("Медленно")}</span>
            <span>{tr("Норм")}</span>
            <span>{tr("Быстро")}</span>
          </div>
        </div>
      </div>

      {/* Speech Recognition Settings */}
      <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '15px', color: '#a855f7', fontSize: '1rem', borderBottom: '1px solid rgba(168, 85, 247, 0.2)', paddingBottom: '8px' }}>{tr("Распознавание речи")}</h4>
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Точность совпадения произношения")}</label>
            <span className="value-badge" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc' }}>{speechMatchThreshold}%</span>
          </div>
          <input 
            type="range" 
            min="50" 
            max="100" 
            step="5"
            value={speechMatchThreshold} 
            onChange={e => setSpeechMatchThreshold(Number(e.target.value))} 
          />
          <div className="range-labels">
            <span>{tr("Свободно (50%)")}</span>
            <span>{tr("Нормально (75%)")}</span>
            <span>{tr("Строго (100%)")}</span>
          </div>
        </div>
      </div>

      <button className="btn btn-primary btn-small" style={{ marginTop: '20px' }} onClick={saveAdminSettings}>{tr("Сохранить настройки голоса")}</button>
    </motion.div>
  );
};
