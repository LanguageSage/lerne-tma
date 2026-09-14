import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { VOICE_OPTIONS } from '../../constants/settingsConstants';
import { getTtsVoiceForLang } from '../../constants/languageConstants';
import { renderFlag } from '../deckgrid/FlagIcons';

export const VoiceTab = () => {
  useInterfaceLocale();
  const {
    adminSettings,
    autoPlay,
    setAutoPlay,
    alwaysRegenerateAudio,
    setAlwaysRegenerateAudio,
    autoGenerateCardAudio,
    setAutoGenerateCardAudio,
    ttsSpeed,
    setTtsSpeed,
    ttsSpeedRu,
    setTtsSpeedRu,
    ttsVoices,
    setTtsVoice,
    speechMatchThreshold,
    setSpeechMatchThreshold,
    saveCurrentSettingsToServer,
  } = useSettingsStore();
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
    const saved = await saveCurrentSettingsToServer();
    showToast(
      saved ? tr("Настройки сохранены") : tr("Настройки сохранены на устройстве"),
      "success",
    );
  };

  return (
    <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>{tr("Синтез речи (Edge TTS)")}</h3>

      <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '12px', color: '#c084fc', fontSize: '1rem' }}>{tr("Поведение аудиоплеера")}</h4>
        <div className="settings-row">
          <span>{tr("Автовоспроизведение")}</span>
          <label className="switch">
            <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
        <div className="settings-row">
          <span>{tr("Всегда генерировать и перезаписывать аудио")}</span>
          <label className="switch">
            <input type="checkbox" checked={alwaysRegenerateAudio} onChange={e => setAlwaysRegenerateAudio(e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
        <div className="settings-row">
          <span>{tr("Создавать аудио для новых карточек")}</span>
          <label className="switch">
            <input type="checkbox" checked={autoGenerateCardAudio} onChange={e => setAutoGenerateCardAudio(e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      {/* Target Language Voice Selection */}
      <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '15px', color: '#38bdf8', fontSize: '1rem', borderBottom: '1px solid rgba(56, 189, 248, 0.2)', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{tr("Для оригинала (")}{langInfo.name})</span>
          {renderFlag(langInfo.code, 18)}
        </h4>
        <div className="form-group">
          <label>{tr("Голос (")}{langInfo.name})</label>
          {(() => {
            const selectedVal = getTtsVoiceForLang(activeLanguage, adminSettings, ttsVoices)
              || (filteredVoices[0]?.value || '');
            return (
              <select 
                value={selectedVal} 
                onChange={e => setTtsVoice(activeLanguage, e.target.value)}
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
            <span className="value-badge">{ttsSpeed >= 0 ? `+${ttsSpeed}%` : `${ttsSpeed}%`}</span>
          </div>
          <input 
            type="range" 
            min="-50" 
            max="100" 
            step="5"
            value={ttsSpeed}
            onChange={e => {
              const val = parseInt(e.target.value);
              setTtsSpeed(val);
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
          <select
            value={getTtsVoiceForLang('ru', adminSettings, ttsVoices)}
            onChange={e => setTtsVoice('ru', e.target.value)}
          >
            {VOICE_OPTIONS.filter(opt => opt.value.startsWith('ru')).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Скорость")}</label>
            <span className="value-badge">{ttsSpeedRu >= 0 ? `+${ttsSpeedRu}%` : `${ttsSpeedRu}%`}</span>
          </div>
          <input 
            type="range" 
            min="-50" 
            max="100" 
            step="5"
            value={ttsSpeedRu}
            onChange={e => {
              const val = parseInt(e.target.value);
              setTtsSpeedRu(val);
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

      <button className="btn btn-primary btn-small" style={{ marginTop: '20px' }} onClick={saveAdminSettings}>{tr("Сохранить настройки аудио")}</button>
    </motion.div>
  );
};
