import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';

export const AITab = ({ availableModels, fetchModels, isFetchingModels, saveAdminSettings }) => {
  const { adminSettings, updateAdminSetting } = useSettingsStore();

  React.useEffect(() => {
    if (adminSettings.AI_PROVIDER && adminSettings.AI_PROVIDER !== 'default') {
      fetchModels();
    }
  }, [adminSettings.AI_PROVIDER]);

  return (
    <motion.div key="ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section admin-section">
      <h3>Настройки ИИ</h3>
      <div className="info-banner" style={{ marginBottom: '15px', padding: '10px', background: 'rgba(52, 152, 219, 0.1)', borderLeft: '4px solid #3498db', borderRadius: '4px', fontSize: '0.85rem' }}>
        <strong>ℹ️ Тестовый период:</strong> Сейчас приложение использует общий ключ для Gemini 3 Flash Preview. Вы можете оставить поля пустыми или ввести свои ключи ниже.
      </div>
      <div className="form-group">
        <label>Провайдер</label>
        <select value={adminSettings.AI_PROVIDER || 'default'} onChange={e => {
          updateAdminSetting('AI_PROVIDER', e.target.value);
          updateAdminSetting('DEFAULT_MODEL', '');
        }}>
          <option value="default">По умолчанию (Lerne Shared)</option>
          <option value="ollama">Ollama (Локально)</option>
          <option value="openrouter">OpenRouter (Облако)</option>
          <option value="google">Google Gemini (Облако)</option>
        </select>
      </div>
      {adminSettings.AI_PROVIDER === 'ollama' && (
        <div className="form-group">
          <label>Ollama URL</label>
          <input value={adminSettings.OLLAMA_URL || ''} onChange={e => updateAdminSetting('OLLAMA_URL', e.target.value)} placeholder="http://localhost:11434" />
        </div>
      )}
      {adminSettings.AI_PROVIDER === 'openrouter' && (
        <div className="form-group">
          <label>OpenRouter API Key</label>
          <input type="password" value={adminSettings.OPENROUTER_API_KEY || adminSettings.API_KEY || ''} onChange={e => updateAdminSetting('OPENROUTER_API_KEY', e.target.value)} placeholder="sk-or-..." />
        </div>
      )}
      {adminSettings.AI_PROVIDER === 'google' && (
        <div className="form-group">
          <label>Google Gemini API Key</label>
          <input type="password" value={adminSettings.GOOGLE_API_KEY || ''} onChange={e => updateAdminSetting('GOOGLE_API_KEY', e.target.value)} placeholder="AIzaSy..." />
        </div>
      )}
      
      {adminSettings.AI_PROVIDER !== 'default' && (
        <div className="form-group">
          <div className="label-with-value">
            <label>Модель</label>
            <button className="btn-secondary btn-tiny" onClick={fetchModels} disabled={isFetchingModels}>
              {isFetchingModels ? '...' : <RefreshCw size={12} />}
            </button>
          </div>
          <div className="model-select-group">
            <select 
              value={availableModels.includes(adminSettings.DEFAULT_MODEL) ? adminSettings.DEFAULT_MODEL : 'custom'} 
              onChange={e => {
                if (e.target.value !== 'custom') {
                  updateAdminSetting('DEFAULT_MODEL', e.target.value);
                }
              }}
            >
              <option value="">Выберите модель...</option>
              {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="custom">-- Ввести вручную --</option>
            </select>
            {( !availableModels.includes(adminSettings.DEFAULT_MODEL) || adminSettings.DEFAULT_MODEL === '' ) && (
              <input 
                style={{marginTop: '8px'}}
                value={adminSettings.DEFAULT_MODEL || ''} 
                onChange={e => updateAdminSetting('DEFAULT_MODEL', e.target.value)} 
                placeholder="Название модели вручную..." 
              />
            )}
          </div>
        </div>
      )}
      <button className="btn btn-primary btn-small" onClick={saveAdminSettings}>Сохранить конфиг ИИ</button>
    </motion.div>
  );
};
