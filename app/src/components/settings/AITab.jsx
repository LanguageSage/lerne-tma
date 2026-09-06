import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

export const AITab = () => {
  useInterfaceLocale();
  const { adminSettings, updateAdminSetting } = useSettingsStore();
  const { showToast } = useUiStore();
  const [availableModels, setAvailableModels] = useState([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const fetchModels = async () => {
    setIsFetchingModels(true);
    try {
      const res = await api.get('/settings/models', {
        params: {
          provider: adminSettings.AI_PROVIDER,
          url: adminSettings.OLLAMA_URL
        }
      });
      setAvailableModels(res.data);
    } catch {
      showToast(tr("Ошибка загрузки моделей"));
    } finally {
      setIsFetchingModels(false);
    }
  };

  const saveAdminSettings = async () => {
    const settings = useSettingsStore.getState().adminSettings;
    try {
      await api.post('/admin/settings', settings);
      showToast(tr("Настройки сохранены"), "success");
    } catch {
      showToast(tr("Ошибка сохранения настроек"));
    }
  };

  const testAiConnection = async () => {
     setIsTesting(true);
     try {
       const res = await api.get('/settings/test-ai');
       setTestResults(res.data);
       if (res.data.status === 'ok') {
         showToast(tr("Все ключи проверены: соединение установлено!"), "success");
       } else if (res.data.status === 'warning') {
         showToast(tr("Часть ключей работает, некоторые вызывают ошибки"), "warning");
       } else {
         showToast(tr("Ошибка проверки: {{p0}}", { p0: res.data.error || tr("Сбой соединения") }));
       }
     } catch {
       showToast(tr("Ошибка соединения при проверке"));
     } finally {
       setIsTesting(false);
     }
  };

  const makeKeyPrimary = (rawKeyToPromote) => {
    const rawVal = adminSettings.GOOGLE_API_KEY || '';
    const cleaned = rawVal.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/;/g, ',');
    const keys = [];
    for (const line of cleaned.split('\n')) {
      for (const part of line.split(',')) {
        const k = part.trim();
        if (k && !keys.includes(k)) keys.push(k);
      }
    }
    const idx = keys.indexOf(rawKeyToPromote);
    if (idx > 0) {
      keys.splice(idx, 1);
      keys.unshift(rawKeyToPromote);
      const newStr = keys.join('\n');
      updateAdminSetting('GOOGLE_API_KEY', newStr);
      showToast(tr("Ключ перемещён на 1-е место (основной). Сохраните настройки!"), "info");
    }
  };

  useEffect(() => {
    if (adminSettings.AI_PROVIDER && adminSettings.AI_PROVIDER !== 'default') {
      fetchModels();
    }
  }, [adminSettings.AI_PROVIDER]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <h3>{tr("Настройки ИИ")}</h3>
        <button className="btn-secondary btn-tiny" onClick={testAiConnection} disabled={isTesting}>
          {isTesting ? tr("Проверка...") : tr("Проверить соединение")}
        </button>
      </div>

      <div className="info-banner" style={{ marginBottom: '15px', padding: '10px', background: 'rgba(52, 152, 219, 0.1)', borderLeft: '4px solid #3498db', borderRadius: '4px', fontSize: '0.85rem' }}>
        <strong>{tr("ℹ️ Облачный режим:")}</strong>{' '}{tr("Для работы без ПК используйте Gemini, Groq или OpenRouter.")}{' '}</div>

      <div className="form-group">
        <label>{tr("Провайдер")}</label>
        <select value={adminSettings.AI_PROVIDER || 'default'} onChange={e => {
          updateAdminSetting('AI_PROVIDER', e.target.value);
          updateAdminSetting('DEFAULT_MODEL', '');
          setTestResults(null);
        }}>
          <option value="default">{tr("По умолчанию (Lerne Shared)")}</option>
          <option value="groq">{tr("Groq (Очень быстро / Бесплатно)")}</option>
          <option value="google">{tr("Google Gemini (Бесплатно / Надежно)")}</option>
          <option value="openrouter">{tr("OpenRouter (Много моделей)")}</option>
          <option value="ollama">{tr("Ollama (Ваш сервер/ПК)")}</option>
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
          <label>{tr("Google Gemini API Keys (можно несколько)")}</label>
          <textarea 
            rows={3}
            value={adminSettings.GOOGLE_API_KEY || ''} 
            onChange={e => {
              updateAdminSetting('GOOGLE_API_KEY', e.target.value);
              setTestResults(null);
            }} 
            placeholder={tr("AIzaSy...\nAIzaSy... (укажите каждый ключ с новой строки или через запятую)")} 
            style={{ width: '100%', minHeight: '70px', resize: 'vertical', fontSize: '0.85rem', padding: '8px' }}
          />
          <small style={{ color: '#8e8e93', fontSize: '0.75rem', marginTop: '4px', display: 'block', lineHeight: '1.4' }}>{tr("💡 Вы можете вставить несколько API-ключей Google (своего аккаунта, семьи или коллег). Как только у одного ключа заканчивается лимит (Quota / 429), система автоматически переключится на следующий ключ.")}{' '}</small>

          {testResults && testResults.keys && testResults.keys.length > 0 && (
            <div style={{ marginTop: '10px', background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '6px', fontSize: '0.8rem' }}>
              <strong style={{ display: 'block', marginBottom: '6px' }}>{tr("🔍 Результаты проверки ключей:")}</strong>
              {testResults.keys.map((k, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '8px', padding: '4px 0', borderBottom: i < testResults.keys.length - 1 ? '1px dashed rgba(255,255,255,0.1)' : 'none' }}>
                  <span>
                    {k.status === 'ok' ? '🟢' : '🔴'}{' '}{tr("Ключ #")}{k.index} ({k.key_masked}): <span style={{ opacity: 0.85, color: k.status === 'ok' ? '#2ecc71' : '#e74c3c' }}>{k.message}</span>
                  </span>
                  {i > 0 && (
                    <button 
                      className="btn-secondary btn-tiny"
                      onClick={() => makeKeyPrimary(k.key_raw)}
                      title={tr("Переместить этот ключ на первое место (сделать основным)")}
                    >{tr("Сделать 1-м")}{' '}</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {getApiKeyLink() && (
        <div style={{ marginTop: '-8px', marginBottom: '15px' }}>
          <a href={getApiKeyLink()} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#3498db', textDecoration: 'none' }}>{tr("🔗 Получить бесплатный API ключ")}{' '}</a>
        </div>
      )}
      
      {adminSettings.AI_PROVIDER !== 'default' && (
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Модель")}</label>
            <button className="btn-secondary btn-tiny" onClick={fetchModels} disabled={isFetchingModels}>
              {isFetchingModels ? '...' : <RefreshCw size={12} />}
            </button>
          </div>
          <div className="model-select-group">
            <select 
              value={availableModels.includes(adminSettings.DEFAULT_MODEL) ? adminSettings.DEFAULT_MODEL : 'custom'} 
              onChange={e => {
                const val = e.target.value;
                if (val === 'custom') {
                  updateAdminSetting('DEFAULT_MODEL', '');
                } else {
                  updateAdminSetting('DEFAULT_MODEL', val);
                }
              }}
            >
              <option value="">{tr("Выберите модель...")}</option>
              {availableModels.map(m => (
                <option key={m} value={m}>
                  {m.includes(':free') ? `🎁 ${m}` : m}
                </option>
              ))}
              <option value="custom">{tr("-- Ввести вручную --")}</option>
            </select>
            {( !availableModels.includes(adminSettings.DEFAULT_MODEL) || adminSettings.DEFAULT_MODEL === '' ) && (
              <input 
                style={{marginTop: '8px'}}
                value={adminSettings.DEFAULT_MODEL || ''} 
                onChange={e => updateAdminSetting('DEFAULT_MODEL', e.target.value)} 
                placeholder={tr("Название модели вручную...")} 
              />
            )}
          </div>
        </div>
      )}
      {/* AI Detect Level Toggle */}
      <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', margin: '15px 0' }}>
        <div style={{ paddingRight: '15px' }}>
          <label style={{ margin: 0, fontWeight: 600, display: 'block' }}>{tr("Определять уровень сложности (CEFR)")}</label>
          <span style={{ fontSize: '0.75rem', opacity: 0.7, display: 'block', marginTop: '2px' }}>{tr("Автоматически определять A1–C2 для новых карточек с помощью ИИ")}{' '}</span>
        </div>
        <input 
          type="checkbox"
          style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#3498db' }}
          checked={adminSettings.AI_DETECT_LEVEL !== 'false'}
          onChange={e => updateAdminSetting('AI_DETECT_LEVEL', e.target.checked ? 'true' : 'false')}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button className="btn btn-primary btn-small" style={{ flex: 1 }} onClick={saveAdminSettings}>{tr("Сохранить")}</button>
      </div>
    </motion.div>
  );
};
