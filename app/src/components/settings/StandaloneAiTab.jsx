import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, ShieldCheck, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { listAiProviders, testAiConnection } from '../../pilot/ai/registry';
import { deleteVaultKey, getVaultKeyStatus, getVaultStorageMode, setVaultKey } from '../../pilot/secretVault';

export const StandaloneAiTab = () => {
  useInterfaceLocale();
  const {
    standaloneAiProvider,
    standaloneAiModels,
    setStandaloneAiProvider,
    setStandaloneAiModel,
  } = useSettingsStore();
  const { showToast } = useUiStore();

  const providers = listAiProviders();
  const activeProvider = providers.find((p) => p.id === standaloneAiProvider) || providers[0];
  const currentModel = standaloneAiModels?.[activeProvider.id] ?? activeProvider.defaultModel;

  const [keyInput, setKeyInput] = useState('');
  const [vaultStatus, setVaultStatus] = useState(() => ({
    storage: getVaultStorageMode(),
    slots: {},
  }));
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  const refreshVaultStatus = async () => {
    try {
      const st = await getVaultKeyStatus();
      setVaultStatus(st);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refreshVaultStatus();
  }, [activeProvider.id]);

  const hasKey = Boolean(vaultStatus?.slots?.[activeProvider.slot]);
  const isNativeVault = vaultStatus?.storage === 'android_keystore';

  const handleSaveKey = async () => {
    const clean = keyInput.trim();
    if (!clean) {
      showToast(tr('Введите API-ключ'), 'error');
      return;
    }
    try {
      await setVaultKey(activeProvider.slot, clean);
      setKeyInput('');
      setTestStatus(null);
      await refreshVaultStatus();
      showToast(tr('API-ключ сохранён'), 'success');
    } catch (err) {
      showToast(err?.message || tr('Не удалось сохранить API-ключ'), 'error');
    }
  };

  const handleDeleteKey = async () => {
    try {
      await deleteVaultKey(activeProvider.slot);
      setTestStatus(null);
      await refreshVaultStatus();
      showToast(tr('API-ключ удалён'), 'info');
    } catch (err) {
      showToast(err?.message || tr('Не удалось удалить ключ'), 'error');
    }
  };

  const handleTest = async () => {
    if (!hasKey) {
      showToast(tr('Сначала укажите API-ключ'), 'error');
      return;
    }
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await testAiConnection({ providerId: activeProvider.id, model: currentModel });
      setTestStatus({ ok: true, message: `${res.providerId}/${res.model}: OK` });
    } catch (err) {
      setTestStatus({ ok: false, message: err?.message || 'Ошибка подключения' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div key="standalone-ai" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>{tr('Провайдер ИИ (локальный режим)')}</h3>

      <div
        style={{
          marginTop: '12px',
          padding: '12px 14px',
          borderRadius: '14px',
          background: isNativeVault ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
          border: `1px solid ${isNativeVault ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          fontSize: '0.82rem',
          color: '#e2e8f0',
        }}
      >
        <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2, color: isNativeVault ? '#34d399' : '#fbbf24' }} />
        <div>
          {isNativeVault
            ? tr('Ключи шифруются через Android Keystore и не передаются в WebView. Ключ Gemini используется совместно с Gemini TTS.')
            : tr('На ПК в браузере API-ключ хранится только в оперативной памяти текущей вкладки (не сохраняется в localStorage или IndexedDB). Ключ Gemini используется совместно с Gemini TTS.')}
        </div>
      </div>

      <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="form-group">
          <label htmlFor="standalone-ai-provider-select">{tr('Провайдер ИИ')}</label>
          <select
            id="standalone-ai-provider-select"
            value={activeProvider.id}
            onChange={(e) => {
              setTestStatus(null);
              setStandaloneAiProvider(e.target.value);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="standalone-ai-model-select">{tr('Модель (без автопереключения при ошибках)')}</label>
          <select
            id="standalone-ai-model-select"
            value={activeProvider.models.some((m) => m.id === currentModel) ? currentModel : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setStandaloneAiModel(activeProvider.id, e.target.value);
              }
            }}
          >
            {activeProvider.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            <option value="__custom__">{tr('Другая модель (вручную)')}</option>
          </select>
          <input
            id="standalone-ai-model-input"
            type="text"
            className="form-input"
            style={{ marginTop: '8px' }}
            value={currentModel}
            onChange={(e) => setStandaloneAiModel(activeProvider.id, e.target.value)}
            onBlur={() => {
              if (!String(currentModel || '').trim()) {
                setStandaloneAiModel(activeProvider.id, activeProvider.defaultModel);
              }
            }}
            placeholder={activeProvider.defaultModel}
          />
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label htmlFor="standalone-ai-key-input" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyRound size={15} /> {tr('API-ключ')} ({activeProvider.id.toUpperCase()})
            </label>
            <span
              id="standalone-ai-key-status"
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: hasKey ? '#34d399' : '#f87171',
              }}
            >
              {hasKey ? tr('Настроен') : tr('Не задан')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              id="standalone-ai-key-input"
              type="password"
              autoComplete="off"
              className="form-input"
              style={{ flex: '1 1 220px' }}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={hasKey ? tr('Введите новый ключ для замены') : tr('Вставьте API-ключ')}
            />
            <button
              id="standalone-ai-save-key-btn"
              type="button"
              className="btn btn-primary btn-small"
              onClick={handleSaveKey}
            >
              {tr('Сохранить ключ')}
            </button>
            {hasKey && (
              <button
                id="standalone-ai-delete-key-btn"
                type="button"
                className="btn btn-secondary btn-small"
                onClick={handleDeleteKey}
                title={tr('Удалить ключ')}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            id="standalone-ai-test-btn"
            type="button"
            className="btn btn-secondary btn-small"
            disabled={testing || !hasKey}
            onClick={handleTest}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {testing && <Loader2 size={14} className="spin" />}
            {tr('Проверить подключение')}
          </button>
          {testStatus && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.82rem',
                color: testStatus.ok ? '#34d399' : '#fca5a5',
              }}
            >
              {testStatus.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {testStatus.message}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};
