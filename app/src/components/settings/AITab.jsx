import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';

export const AITab = ({ availableModels, fetchModels, isFetchingModels, saveAdminSettings, testAiConnection }) => {
  const { adminSettings, updateAdminSetting } = useSettingsStore();

  React.useEffect(() => {
    if (adminSettings.AI_PROVIDER && adminSettings.AI_PROVIDER !== 'default') {
      fetchModels();
    }
  }, [adminSettings.AI_PROVIDER]);

  const getApiKeyLink = () => {
    switch(adminSettings.AI_PROVIDER) {
      case 'google': return "https://aistudio.google.com/app/apikey";
      case 'groq': return "https://console.groq.com/keys";
      case 'openrouter': return "https://openrouter.ai/keys";
      default: return null;
    }
  };

  return (
    <motion.div key="ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section admin-section">
      <div className="section-header-with-btn">
        <h3>Настройки ИИ</h3>
        <button className="btn-secondary btn-tiny" onClick={testAiConnection}>
          Проверить соединение
        </button>
      </div>

      <div className="info-banner" style={{ marginBottom: '15px', padding: '10px', background: 'rgba(52, 152, 219, 0.1)', borderLeft: '4px solid #3498db', borderRadius: '4px', fontSize: '0.85rem' }}>
        <strong>ℹ️ Облачный режим:</strong> Для работы без ПК используйте Gemini, Groq или OpenRouter.
      </div>

      <div className="form-group">
        <label>Провайдер</label>
        <select value={adminSettings.AI_PROVIDER || 'default'} onChange={e => {
          updateAdminSetting('AI_PROVIDER', e.target.value);
          updateAdminSetting('DEFAULT_MODEL', '');
        }}>
          <option value="default">По умолчанию (Lerne Shared)</option>
          <option value="groq">Groq (Очень быстро / Бесплатно)</option>
          <option value="google">Google Gemini (Бесплатно / Надежно)</option>
          <option value="openrouter">OpenRouter (Много моделей)</option>
          <option value="ollama">Ollama (Ваш сервер/ПК)</option>
        </select>
      </div>

      {adminSettings.AI_PROVIDER === 'ollama' && (
        <div className="form-group">
          <label>Ollama URL</label>
          <input value={adminSettings.OLLAMA_URL || ''} onChange={e => updateAdminSetting('OLLAMA_URL', e.target.value)} placeholder="http://localhost:11434" />
        </div>
      )}

      {adminSettings.AI_PROVIDER === 'groq' && (
        <div className="form-group">
          <label>Groq API Key</label>
          <input type="password" value={adminSettings.GROQ_API_KEY || ''} onChange={e => updateAdminSetting('GROQ_API_KEY', e.target.value)} placeholder="gsk_..." />
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

      {getApiKeyLink() && (
        <div style={{ marginTop: '-8px', marginBottom: '15px' }}>
          <a href={getApiKeyLink()} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#3498db', textDecoration: 'none' }}>
            🔗 Получить бесплатный API ключ
          </a>
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
              {availableModels.map(m => (
                <option key={m} value={m}>
                  {m.includes(':free') ? `🎁 ${m}` : m}
                </option>
              ))}
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
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button className="btn btn-primary btn-small" style={{ flex: 1 }} onClick={saveAdminSettings}>Сохранить</button>
      </div>
    </motion.div>
  );
};
