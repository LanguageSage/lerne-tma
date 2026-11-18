import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Trash2, Plus, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import api from '../../services/api';

const KEY_PROVIDERS = new Set(['google', 'groq', 'openrouter']);

const pickFormBaseline = (settings = {}) => ({
  AI_PROVIDER: settings.AI_PROVIDER || 'default',
  DEFAULT_MODEL: settings.DEFAULT_MODEL || '',
  OLLAMA_URL: settings.OLLAMA_URL || '',
  AI_DETECT_LEVEL: settings.AI_DETECT_LEVEL ?? 'true',
});

export const AITab = () => {
  useInterfaceLocale();
  const { setAdminSettings } = useSettingsStore();
  const { showToast } = useUiStore();

  const [aiForm, setAiForm] = useState(() => pickFormBaseline(useSettingsStore.getState().adminSettings));
  const [availableModels, setAvailableModels] = useState([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const [keysStatus, setKeysStatus] = useState(null);
  const [effectiveConfig, setEffectiveConfig] = useState(null);
  const [serverBaseline, setServerBaseline] = useState(null);
  const [newKeysInput, setNewKeysInput] = useState('');
  const [isKeySaving, setIsKeySaving] = useState(false);
  const [manualModelMode, setManualModelMode] = useState(false);

  const updateAiField = (key, value) => {
    setAiForm(prev => ({ ...prev, [key]: value }));
  };

  const selectedProvider = aiForm.AI_PROVIDER || 'default';
  const keyProvider = KEY_PROVIDERS.has(selectedProvider)
    ? selectedProvider
    : (selectedProvider === 'ollama' ? null : 'google');
  const activeKeyInfo = keyProvider ? keysStatus?.[keyProvider] : null;
  const savedKeys = activeKeyInfo?.keys || [];

  const applyServerSnapshot = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.AI_KEYS_STATUS) setKeysStatus(payload.AI_KEYS_STATUS);
    if (payload.EFFECTIVE_AI_CONFIG) setEffectiveConfig(payload.EFFECTIVE_AI_CONFIG);
  }, []);

  const loadAdminSettings = useCallback(async () => {
    try {
      const res = await api.get('/admin/settings');
      const data = res.data || {};
      const { AI_KEYS_STATUS, EFFECTIVE_AI_CONFIG, ...rest } = data;
      const merged = { ...useSettingsStore.getState().adminSettings, ...rest };
      for (const secretKey of ['GOOGLE_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'API_KEY']) {
        delete merged[secretKey];
      }
      const baseline = pickFormBaseline(merged);
      setAdminSettings(merged);
      setAiForm(baseline);
      setServerBaseline(baseline);
      if (AI_KEYS_STATUS) setKeysStatus(AI_KEYS_STATUS);
      if (EFFECTIVE_AI_CONFIG) setEffectiveConfig(EFFECTIVE_AI_CONFIG);
    } catch {
      showToast(tr("Не удалось загрузить настройки ИИ с сервера"));
    }
  }, [setAdminSettings, showToast]);

  const fetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    try {
      const res = await api.get('/settings/models', {
        params: {
          provider: aiForm.AI_PROVIDER,
          url: aiForm.OLLAMA_URL
        }
      });
      setAvailableModels(Array.isArray(res.data) ? res.data : []);
    } catch {
      showToast(tr("Ошибка загрузки моделей"));
    } finally {
      setIsFetchingModels(false);
    }
  }, [aiForm.AI_PROVIDER, aiForm.OLLAMA_URL, showToast]);

  useEffect(() => {
    loadAdminSettings();
  }, [loadAdminSettings]);

  useEffect(() => {
    if (selectedProvider !== 'default') {
      fetchModels();
    }
  }, [selectedProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentFormState = pickFormBaseline(aiForm);
  const hasUnsavedConfig = Boolean(
    serverBaseline && (
      serverBaseline.AI_PROVIDER !== currentFormState.AI_PROVIDER ||
      serverBaseline.DEFAULT_MODEL !== currentFormState.DEFAULT_MODEL ||
      serverBaseline.OLLAMA_URL !== currentFormState.OLLAMA_URL ||
      serverBaseline.AI_DETECT_LEVEL !== currentFormState.AI_DETECT_LEVEL
    )
  );
  const hasUnsavedInput = hasUnsavedConfig || newKeysInput.trim().length > 0;

  const submitKeyAction = async (action, extra = {}) => {
    if (!keyProvider) return false;
    setIsKeySaving(true);
    try {
      const res = await api.post('/admin/settings/keys', {
        provider: keyProvider,
        action,
        ...extra,
      });
      applyServerSnapshot(res.data);
      setTestResults(null);
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : tr("Ошибка управления ключами API"));
      return false;
    } finally {
      setIsKeySaving(false);
    }
  };

  const handleAddKeys = async () => {
    if (!newKeysInput.trim()) return;
    const ok = await submitKeyAction('add', { keys_text: newKeysInput });
    if (ok) {
      setNewKeysInput('');
      showToast(tr("Новые ключи добавлены и сохранены на сервере"), "success");
      if (selectedProvider !== 'default') fetchModels();
    }
  };

  const handleDeleteKey = async (keyId) => {
    const ok = await submitKeyAction('delete', { key_id: keyId });
    if (ok) {
      showToast(tr("Ключ удалён"), "info");
    }
  };

  const handleClearKeys = async () => {
    const ok = await submitKeyAction('clear');
    if (ok) {
      showToast(tr("Ключи очищены в базе данных"), "info");
    }
  };

  const handlePromoteKey = async (keyId) => {
    const ok = await submitKeyAction('promote', { key_id: keyId });
    if (ok) {
      showToast(tr("Ключ перемещён на 1-е место (основной)"), "success");
    }
  };

  const saveAdminSettings = async ({ silentSuccess = false } = {}) => {
    try {
      if (newKeysInput.trim() && keyProvider) {
        const added = await submitKeyAction('add', { keys_text: newKeysInput });
        if (!added) return false;
        setNewKeysInput('');
      }
      const settingsToSave = pickFormBaseline(aiForm);
      const res = await api.post('/admin/settings', settingsToSave);
      applyServerSnapshot(res.data);
      setServerBaseline(settingsToSave);
      setAdminSettings({ ...useSettingsStore.getState().adminSettings, ...settingsToSave });
      if (!silentSuccess) {
        showToast(tr("Настройки сохранены"), "success");
      }
      return true;
    } catch {
      showToast(tr("Ошибка сохранения настроек"));
      return false;
    }
  };

  const testAiConnection = async () => {
    setIsTesting(true);
    try {
      if (hasUnsavedInput) {
        const saved = await saveAdminSettings({ silentSuccess: true });
        if (!saved) return;
      }
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

  const getApiKeyLink = () => {
    switch (keyProvider) {
      case 'google': return "https://aistudio.google.com/app/apikey";
      case 'groq': return "https://console.groq.com/keys";
      case 'openrouter': return "https://openrouter.ai/keys";
      default: return null;
    }
  };

  const currentModel = aiForm.DEFAULT_MODEL || '';
  const selectValue = manualModelMode ? 'custom' : currentModel;

  const resultForKey = (keyId) => {
    if (!testResults?.keys || testResults.provider !== keyProvider) return null;
    return testResults.keys.find(r => r.key_id === keyId) || null;
  };

  return (
    <motion.div key="ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section admin-section">
      <div className="section-header-with-btn">
        <h3>{tr("Настройки ИИ")}</h3>
        <button className="btn-secondary btn-tiny" onClick={testAiConnection} disabled={isTesting || isKeySaving}>
          {isTesting ? tr("Проверка...") : tr("Проверить соединение")}
        </button>
      </div>

      {effectiveConfig && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.25)', borderRadius: '8px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={16} style={{ color: '#2ecc71', flexShrink: 0 }} />
          <div>
            <strong>{tr("Активно на сервере:")}</strong>{' '}
            <code>{effectiveConfig.provider}</code>{' / '}
            <code>{effectiveConfig.model || tr("модель не выбрана")}</code>
          </div>
        </div>
      )}

      {hasUnsavedInput && (
        <div style={{ marginBottom: '12px', padding: '9px 12px', background: 'rgba(243, 156, 18, 0.14)', borderLeft: '4px solid #f39c12', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={16} style={{ color: '#f39c12', flexShrink: 0 }} />
          <span>{tr("Есть несохранённые изменения. Нажмите «Сохранить», чтобы они применялись на сервере.")}</span>
        </div>
      )}

      <div className="info-banner" style={{ marginBottom: '15px', padding: '10px', background: 'rgba(52, 152, 219, 0.1)', borderLeft: '4px solid #3498db', borderRadius: '4px', fontSize: '0.85rem' }}>
        <strong>{tr("ℹ️ Облачный режим:")}</strong>{' '}{tr("Для работы без ПК используйте Gemini, Groq или OpenRouter.")}{' '}
      </div>

      <div className="form-group">
        <label>{tr("Провайдер")}</label>
        <select value={selectedProvider} onChange={e => {
          setAiForm(prev => ({ ...prev, AI_PROVIDER: e.target.value, DEFAULT_MODEL: '' }));
          setManualModelMode(false);
          setTestResults(null);
        }}>
          <option value="default">{tr("По умолчанию (Google Gemini)")}</option>
          <option value="groq">{tr("Groq (Очень быстро / Бесплатно)")}</option>
          <option value="google">{tr("Google Gemini (Бесплатно / Надежно)")}</option>
          <option value="openrouter">{tr("OpenRouter (Много моделей)")}</option>
          <option value="ollama">{tr("Ollama (Ваш сервер/ПК)")}</option>
        </select>
      </div>

      {selectedProvider === 'ollama' && (
        <div className="form-group">
          <label>Ollama URL</label>
          <input value={aiForm.OLLAMA_URL || ''} onChange={e => updateAiField('OLLAMA_URL', e.target.value)} placeholder="http://localhost:11434" />
        </div>
      )}

      {keyProvider && (
        <div className="form-group" style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ margin: 0 }}>
              {tr("Сохранённые ключи")} ({keyProvider.toUpperCase()}): {savedKeys.length}
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {activeKeyInfo?.source && activeKeyInfo.source !== 'none' && (
                <span style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: activeKeyInfo.source === 'db' ? 'rgba(46,204,113,0.18)' : 'rgba(241,196,15,0.2)', color: activeKeyInfo.source === 'db' ? '#2ecc71' : '#f1c40f' }}>
                  {activeKeyInfo.source === 'db' ? tr("БД") : tr("ENV (сервер)")}
                </span>
              )}
              {savedKeys.length > 0 && activeKeyInfo?.source === 'db' && (
                <button
                  type="button"
                  className="btn-secondary btn-tiny"
                  style={{ color: '#e74c3c' }}
                  disabled={isKeySaving}
                  onClick={handleClearKeys}
                >
                  {tr("Удалить все")}
                </button>
              )}
            </div>
          </div>

          {activeKeyInfo?.source === 'env' && (
            <small style={{ color: '#f1c40f', fontSize: '0.75rem', marginBottom: '8px', display: 'block', lineHeight: '1.35' }}>
              {tr("Ключи загружены из переменных окружения сервера. Добавление нового ключа переопределит их в БД; для полного отзыва старый ключ также нужно удалить в Google AI Studio / Vercel.")}
            </small>
          )}

          {savedKeys.length === 0 ? (
            <div style={{ fontSize: '0.8rem', opacity: 0.7, padding: '6px 0' }}>
              {tr("Ключи не настроены")}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
              {savedKeys.map((k, idx) => {
                const check = resultForKey(k.id);
                return (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 8px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span>{check ? (check.status === 'ok' ? '🟢' : '🔴') : '🔑'}</span>
                      <strong>#{k.index}{idx === 0 ? ` (${tr("Основной")})` : ''}</strong>
                      <code>{k.masked}</code>
                      {check && (
                        <span style={{ opacity: 0.85, color: check.status === 'ok' ? '#2ecc71' : '#e74c3c' }}>
                          {check.message}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {idx > 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-tiny"
                          disabled={isKeySaving}
                          onClick={() => handlePromoteKey(k.id)}
                          title={tr("Переместить этот ключ на первое место (сделать основным)")}
                        >
                          {tr("Сделать 1-м")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary btn-tiny"
                        disabled={isKeySaving}
                        onClick={() => handleDeleteKey(k.id)}
                        title={tr("Удалить этот ключ")}
                        style={{ color: '#e74c3c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Trash2 size={12} /> {tr("Удалить")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <label style={{ marginTop: '6px', display: 'block', fontSize: '0.82rem' }}>
            {keyProvider === 'google' ? tr("Добавить новые ключи Google Gemini") : tr("Добавить новый API ключ")}
          </label>
          {keyProvider === 'google' ? (
            <textarea
              rows={2}
              value={newKeysInput}
              onChange={e => setNewKeysInput(e.target.value)}
              placeholder={tr("AIzaSy... (каждый новый ключ с новой строки или через запятую)")}
              style={{ width: '100%', minHeight: '56px', resize: 'vertical', fontSize: '0.85rem', padding: '8px', marginBottom: '6px' }}
            />
          ) : (
            <input
              type="password"
              value={newKeysInput}
              onChange={e => setNewKeysInput(e.target.value)}
              placeholder={keyProvider === 'groq' ? 'gsk_...' : 'sk-or-...'}
              style={{ marginBottom: '6px' }}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary btn-tiny"
              disabled={isKeySaving || !newKeysInput.trim()}
              onClick={handleAddKeys}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={12} /> {tr("Добавить ключи")}
            </button>
            {getApiKeyLink() && (
              <a href={getApiKeyLink()} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#3498db', textDecoration: 'none' }}>
                {tr("🔗 Получить API ключ")}
              </a>
            )}
          </div>
          {keyProvider === 'google' && (
            <small style={{ color: '#8e8e93', fontSize: '0.74rem', marginTop: '6px', display: 'block', lineHeight: '1.35' }}>
              {tr("💡 Ключи хранятся только на сервере и отображаются здесь в виде маски. При лимите (429 / Quota) система автоматически переключится на следующий ключ.")}
            </small>
          )}
        </div>
      )}

      {testResults && testResults.keys && testResults.keys.length > 0 && (
        <div style={{ marginBottom: '12px', background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '6px', fontSize: '0.8rem' }}>
          <strong style={{ display: 'block', marginBottom: '6px' }}>
            {tr("🔍 Результаты проверки")} ({testResults.provider}{testResults.model ? ` / ${testResults.model}` : ''}):
          </strong>
          {testResults.keys.map((k, i) => (
            <div key={k.key_id || i} style={{ marginBottom: '4px' }}>
              {k.status === 'ok' ? '🟢' : '🔴'}{' '}{tr("Ключ #")}{k.index} ({k.key_masked}):{' '}
              <span style={{ opacity: 0.85, color: k.status === 'ok' ? '#2ecc71' : '#e74c3c' }}>{k.message}</span>
            </div>
          ))}
        </div>
      )}

      {selectedProvider !== 'default' && (
        <div className="form-group">
          <div className="label-with-value">
            <label>{tr("Модель")}</label>
            <button className="btn-secondary btn-tiny" onClick={fetchModels} disabled={isFetchingModels}>
              {isFetchingModels ? '...' : <RefreshCw size={12} />}
            </button>
          </div>
          <div className="model-select-group">
            <select
              value={selectValue}
              onChange={e => {
                const val = e.target.value;
                if (val === 'custom') {
                  setManualModelMode(true);
                  updateAiField('DEFAULT_MODEL', '');
                } else {
                  setManualModelMode(false);
                  updateAiField('DEFAULT_MODEL', val);
                }
              }}
            >
              <option value="">{tr("Выберите модель...")}</option>
              {currentModel && !availableModels.includes(currentModel) && (
                <option value={currentModel}>{currentModel}</option>
              )}
              {availableModels.map(m => (
                <option key={m} value={m}>
                  {m === 'gemini-flash-latest'
                    ? `${m} (${tr("алиас текущей линейки Flash")})`
                    : m.includes(':free') ? `🎁 ${m}` : m}
                </option>
              ))}
              <option value="custom">{tr("-- Ввести вручную --")}</option>
            </select>
            {selectValue === 'custom' && (
              <input
                style={{ marginTop: '8px' }}
                value={currentModel}
                onChange={e => updateAiField('DEFAULT_MODEL', e.target.value)}
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
          checked={aiForm.AI_DETECT_LEVEL !== 'false'}
          onChange={e => updateAiField('AI_DETECT_LEVEL', e.target.checked ? 'true' : 'false')}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button className="btn btn-primary btn-small" style={{ flex: 1 }} disabled={isKeySaving} onClick={() => saveAdminSettings()}>
          {tr("Сохранить")}
        </button>
      </div>
    </motion.div>
  );
};
