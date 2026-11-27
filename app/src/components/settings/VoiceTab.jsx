import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, KeyRound, Trash2, Loader2, FolderPlus, RotateCcw, Check } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { VOICE_OPTIONS } from '../../constants/settingsConstants';
import { SUPPORTED_TARGET_LANGUAGES, getTtsVoiceForLang } from '../../constants/languageConstants';
import { renderFlag } from '../deckgrid/FlagIcons';
import { IS_STANDALONE } from '../../utils/standaloneMode.js';
import api from '../../services/api';
import {
  GEMINI_TTS_MODELS,
  getDefaultStandaloneVoice,
  getVoicesForStandaloneProvider,
  isVoiceSpecCompatibleWithProvider,
  listStandaloneTtsProviders,
  resolveValidStandaloneVoice,
} from '../../pilot/tts/registry.js';
import { androidSystemTtsProvider } from '../../pilot/tts/androidSystemTtsProvider.js';
import { piperTtsProvider } from '../../pilot/tts/piperTtsProvider.js';
import { clearPreviewAudioCache } from '../../pilot/tts/ttsService.js';
import { deleteVaultKey, getVaultKeyStatus, setVaultKey } from '../../pilot/secretVault.js';

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
    useLocalTtsWhenAudioMissing,
    setUseLocalTtsWhenAudioMissing,
    ttsSpeed,
    setTtsSpeed,
    ttsSpeedRu,
    setTtsSpeedRu,
    ttsVoices,
    setTtsVoice,
    speechMatchThreshold,
    setSpeechMatchThreshold,
    saveCurrentSettingsToServer,
    standaloneTtsProvider,
    setStandaloneTtsProvider,
    standaloneGeminiTtsModel,
    setStandaloneGeminiTtsModel,
    standaloneAzureRegion,
    setStandaloneAzureRegion,
    standaloneAndroidTtsEngine,
    setStandaloneAndroidTtsEngine,
  } = useSettingsStore();
  const { showToast } = useUiStore();
  const { activeLanguage, getLanguageInfo } = useLanguageStore();

  const [vaultSlots, setVaultSlots] = useState({});
  const [azureKeyInput, setAzureKeyInput] = useState('');
  const [androidCatalog, setAndroidCatalog] = useState({ engines: [], voices: [], activeEngine: '' });
  const [piperCatalog, setPiperCatalog] = useState({
    available: false,
    canRestoreBundled: false,
    voices: [],
  });
  const [piperCatalogLoading, setPiperCatalogLoading] = useState(false);
  const [piperActionBusy, setPiperActionBusy] = useState('');
  const [piperImportCancelling, setPiperImportCancelling] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState('');
  const previewAudioRef = useRef(null);

  useEffect(() => () => {
    try {
      previewAudioRef.current?.pause();
    } catch { /* ignore */ }
    previewAudioRef.current = null;
  }, []);

  const refreshVault = async () => {
    if (!IS_STANDALONE) return;
    try {
      const st = await getVaultKeyStatus();
      setVaultSlots(st?.slots || {});
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refreshVault();
  }, [standaloneTtsProvider]);

  useEffect(() => {
    if (!IS_STANDALONE || standaloneTtsProvider !== 'piper' || !piperTtsProvider.isSupported()) {
      return;
    }
    let canceled = false;
    setPiperCatalogLoading(true);
    piperTtsProvider.listVoices()
      .then((res) => {
        if (canceled) return;
        setPiperCatalog(res);
        const currentVoices = useSettingsStore.getState().ttsVoices || {};
        const allLangCodes = [...SUPPORTED_TARGET_LANGUAGES.map((l) => l.code), 'ru'];
        for (const langCode of allLangCodes) {
          const cur = currentVoices[langCode] || '';
          const resolved = resolveValidStandaloneVoice('piper', langCode, cur, [], res.voices);
          if (!cur || !isVoiceSpecCompatibleWithProvider(cur, 'piper') || cur !== resolved) {
            setTtsVoice(langCode, resolved);
          }
        }
      })
      .catch((err) => {
        if (!canceled) {
          showToast(err?.message || tr('Не удалось загрузить каталог моделей Piper'), 'error');
        }
      })
      .finally(() => {
        if (!canceled) setPiperCatalogLoading(false);
      });
    return () => { canceled = true; };
  }, [standaloneTtsProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!IS_STANDALONE || standaloneTtsProvider !== 'android_system' || !androidSystemTtsProvider.isSupported()) {
      return;
    }
    let canceled = false;
    androidSystemTtsProvider.listEnginesAndVoices(standaloneAndroidTtsEngine)
      .then((res) => {
        if (!canceled) setAndroidCatalog(res);
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, [standaloneTtsProvider, standaloneAndroidTtsEngine]);

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
  const filteredVoices = IS_STANDALONE
    ? getVoicesForStandaloneProvider(standaloneTtsProvider, activeLanguage, androidCatalog.voices, piperCatalog.voices)
    : VOICE_OPTIONS.filter(opt => opt.value.startsWith(currentPrefix));
  const ruVoices = IS_STANDALONE
    ? getVoicesForStandaloneProvider(standaloneTtsProvider, 'ru', androidCatalog.voices, piperCatalog.voices)
    : VOICE_OPTIONS.filter(opt => opt.value.startsWith('ru'));

  const selectedTargetVoice = IS_STANDALONE
    ? resolveValidStandaloneVoice(
      standaloneTtsProvider,
      activeLanguage,
      ttsVoices?.[activeLanguage],
      androidCatalog.voices,
      piperCatalog.voices,
    )
    : (getTtsVoiceForLang(activeLanguage, adminSettings, ttsVoices) || (filteredVoices[0]?.value || ''));

  const getSampleTextForLang = (langCode) => {
    const base = String(langCode || activeLanguage || 'de').toLowerCase().replace('_', '-').split('-')[0];
    if (base === 'en') return 'Hello, I am learning languages offline.';
    if (base === 'no' || base === 'nb') return 'Hei, jeg lærer norsk offline.';
    if (base === 'ru') return 'Привет! Я изучаю языки полностью автономно.';
    if (base === 'uk') return 'Привіт! Я вивчаю мови офлайн.';
    return 'Hallo! Ich lerne Deutsch offline.';
  };

  const handleStandalonePreview = async (overrideVoice = null, overrideLang = null) => {
    try {
      previewAudioRef.current?.pause();
    } catch { /* ignore */ }
    previewAudioRef.current = null;
    const targetLang = overrideLang
      ? String(overrideLang).toLowerCase().replace('_', '-').split('-')[0]
      : activeLanguage;
    const targetVoice = overrideVoice || selectedTargetVoice;
    setPreviewLoading(true);
    setPreviewingVoiceId(overrideVoice || '__active__');
    try {
      const res = await api.post('/media/generate-audio', {
        text: getSampleTextForLang(targetLang),
        lang: targetLang,
        voice: targetVoice,
        rate: `${ttsSpeed >= 0 ? '+' : ''}${ttsSpeed}%`,
        persist: false,
      });
      if (res.data?.url) {
        const audio = new Audio(res.data.url);
        previewAudioRef.current = audio;
        await audio.play().catch(() => {});
        showToast(tr('Предпрослушивание готово'), 'success');
      }
    } catch (err) {
      showToast(err?.message || tr('Ошибка предпрослушивания'), 'error');
    } finally {
      setPreviewLoading(false);
      setPreviewingVoiceId('');
    }
  };

  const handleImportPiperVoice = async () => {
    setPiperActionBusy('import');
    setPiperImportCancelling(false);
    try {
      const res = await piperTtsProvider.importModelFromPicker();
      if (res?.cancelled) {
        showToast(tr('Импорт модели отменён'), 'info');
        return;
      }
      clearPreviewAudioCache();
      if (res?.catalog) {
        setPiperCatalog(res.catalog);
      }
      if (res?.imported?.id) {
        const langBase = String(res.imported.lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
        const normalizedLang = langBase === 'nb' ? 'no' : langBase;
        setTtsVoice(normalizedLang, `piper:${res.imported.id}`);
        showToast(`${tr('Голосовая модель установлена:')} ${res.imported.displayName || res.imported.id}`, 'success');
      }
    } catch (err) {
      showToast(err?.message || tr('Ошибка импорта голосовой модели'), 'error');
    } finally {
      setPiperActionBusy('');
      setPiperImportCancelling(false);
    }
  };

  const handleDeletePiperVoice = async (voiceItem) => {
    if (!voiceItem?.id) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const confirmed = window.confirm(
        `${tr('Удалить голосовую модель с устройства:')} ${voiceItem.displayName || voiceItem.id}?`
      );
      if (!confirmed) return;
    }
    setPiperActionBusy(`delete:${voiceItem.id}`);
    try {
      const { catalog } = await piperTtsProvider.deleteModel(voiceItem.id);
      clearPreviewAudioCache();
      setPiperCatalog(catalog);
      const allLangCodes = [...SUPPORTED_TARGET_LANGUAGES.map((l) => l.code), 'ru'];
      const currentVoices = useSettingsStore.getState().ttsVoices || {};
      for (const codeItem of allLangCodes) {
        const saved = String(currentVoices[codeItem] || '');
        if (saved === `piper:${voiceItem.id}` || saved.startsWith(`piper:${voiceItem.id}:`)) {
          setTtsVoice(codeItem, getDefaultStandaloneVoice('piper', codeItem, catalog.voices));
        }
      }
      showToast(`${tr('Модель удалена:')} ${voiceItem.displayName || voiceItem.id}`, 'info');
    } catch (err) {
      showToast(err?.message || tr('Не удалось удалить голосовую модель'), 'error');
    } finally {
      setPiperActionBusy('');
    }
  };

  const handleRestoreBundledPiperVoices = async () => {
    setPiperActionBusy('restore');
    try {
      const { restoredCount, catalog } = await piperTtsProvider.restoreBundledModels();
      clearPreviewAudioCache();
      setPiperCatalog(catalog);
      if (restoredCount > 0) {
        const allLangCodes = [...SUPPORTED_TARGET_LANGUAGES.map((l) => l.code), 'ru'];
        const currentVoices = useSettingsStore.getState().ttsVoices || {};
        for (const codeItem of allLangCodes) {
          const cur = currentVoices[codeItem] || '';
          if (!cur || cur === 'piper::default') {
            setTtsVoice(codeItem, getDefaultStandaloneVoice('piper', codeItem, catalog.voices));
          }
        }
        showToast(`${tr('Восстановлено встроенных моделей:')} ${restoredCount}`, 'success');
      } else {
        showToast(tr('Все встроенные модели уже установлены'), 'info');
      }
    } catch (err) {
      showToast(err?.message || tr('Не удалось восстановить встроенные модели'), 'error');
    } finally {
      setPiperActionBusy('');
    }
  };

  const saveAdminSettings = async () => {
    const saved = await saveCurrentSettingsToServer();
    showToast(
      saved ? tr("Настройки сохранены") : tr("Настройки сохранены на устройстве"),
      "success",
    );
  };

  return (
    <motion.div key="voice" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="settings-section">
      <h3>{IS_STANDALONE ? tr("Синтез речи (TTS)") : tr("Синтез речи (Edge TTS)")}</h3>

      {IS_STANDALONE && (
        <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
          <h4 style={{ marginBottom: '12px', color: '#38bdf8', fontSize: '1rem' }}>{tr("Провайдер озвучки")}</h4>
          <div className="form-group">
            <label htmlFor="standalone-tts-provider-select">{tr("Активный движок TTS")}</label>
            <select
              id="standalone-tts-provider-select"
              value={standaloneTtsProvider}
              onChange={(e) => {
                const next = e.target.value;
                if (standaloneTtsProvider === 'piper' && next !== 'piper') {
                  piperTtsProvider.releaseEngine();
                }
                setStandaloneTtsProvider(next);
                for (const langItem of SUPPORTED_TARGET_LANGUAGES) {
                  setTtsVoice(langItem.code, getDefaultStandaloneVoice(next, langItem.code, piperCatalog.voices));
                }
                setTtsVoice('ru', getDefaultStandaloneVoice(next, 'ru', piperCatalog.voices));
              }}
            >
              {listStandaloneTtsProviders().map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {standaloneTtsProvider === 'piper' && (
            <div style={{ marginTop: '8px', marginBottom: '12px' }}>
              <p style={{ marginBottom: '10px', fontSize: '0.78rem', color: piperCatalogLoading ? '#94a3b8' : (piperCatalog.available ? '#34d399' : '#fbbf24') }}>
                {piperCatalogLoading
                  ? tr('Проверка установленных голосовых моделей Piper…')
                  : piperCatalog.available
                    ? `${tr('Локальный нейросетевой движок Piper готов (офлайн, установлено моделей:')} ${piperCatalog.voices.length}).`
                    : tr('Локальные голосовые модели Piper не найдены на устройстве.')}
              </p>

              {piperCatalog.voices.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                  {piperCatalog.voices.map((v) => {
                    const langBase = String(v.lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
                    const normalizedLang = langBase === 'nb' ? 'no' : langBase;
                    const currentVoiceForModelLang = resolveValidStandaloneVoice(
                      'piper',
                      normalizedLang,
                      ttsVoices?.[normalizedLang],
                      [],
                      piperCatalog.voices,
                    );
                    const isDefaultForLang = currentVoiceForModelLang === `piper:${v.id}`;
                    const isDeleting = piperActionBusy === `delete:${v.id}`;
                    const isPreviewingThis = previewLoading && previewingVoiceId === `piper:${v.id}`;

                    return (
                      <div
                        key={v.id}
                        data-testid={`piper-model-row-${v.id}`}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          background: isDefaultForLang ? 'rgba(56, 189, 248, 0.08)' : 'rgba(15, 23, 42, 0.45)',
                          border: isDefaultForLang ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(255, 255, 255, 0.07)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.86rem', color: '#f8fafc' }}>
                              {v.displayName || v.id}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#94a3b8', marginTop: '2px' }}>
                              {[
                                v.lang || 'de_DE',
                                v.sampleRate ? `${Number((v.sampleRate / 1000).toFixed(2))} кГц` : '',
                                v.sizeMb ? `${v.sizeMb} МБ` : '',
                                v.license || '',
                              ].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.16)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              {tr('Офлайн')}
                            </span>
                            <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px', background: 'rgba(148, 163, 184, 0.14)', color: '#cbd5e1' }}>
                              {v.bundled ? tr('встроен') : tr('импортирован')}
                            </span>
                            {v.commercialSafe === false && (
                              <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px', background: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
                                NC
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            type="button"
                            className={isDefaultForLang ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                            disabled={Boolean(piperActionBusy)}
                            onClick={() => {
                              setTtsVoice(normalizedLang, `piper:${v.id}`);
                              showToast(`${tr('Выбран голос по умолчанию:')} ${v.displayName || v.id}`, 'success');
                            }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '6px 12px', minHeight: '34px' }}
                          >
                            {isDefaultForLang && <Check size={13} />}
                            {isDefaultForLang ? tr('По умолчанию') : tr('Выбрать')}
                          </button>

                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={!piperCatalog.available || previewLoading || Boolean(piperActionBusy)}
                            onClick={() => handleStandalonePreview(`piper:${v.id}`, v.lang)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '6px 12px', minHeight: '34px' }}
                          >
                            {isPreviewingThis ? <Loader2 size={13} className="spin" /> : <Volume2 size={13} />}
                            {tr('Пример')}
                          </button>

                          {piperTtsProvider.isSupported() && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              disabled={Boolean(piperActionBusy)}
                              onClick={() => handleDeletePiperVoice(v)}
                              title={tr('Удалить голосовую модель с устройства')}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '6px 12px', minHeight: '34px', marginLeft: 'auto', color: '#fca5a5' }}
                            >
                              {isDeleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                              {tr('Удалить')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {piperTtsProvider.isSupported() && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    id="piper-import-model-btn"
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={Boolean(piperActionBusy)}
                    onClick={handleImportPiperVoice}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {piperActionBusy === 'import' ? <Loader2 size={14} className="spin" /> : <FolderPlus size={14} />}
                    {piperActionBusy === 'import' ? tr('Импорт модели...') : tr('Импортировать модель (.zip)')}
                  </button>

                  {piperActionBusy === 'import' && (
                    <button
                      id="piper-cancel-import-btn"
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={piperImportCancelling}
                      onClick={() => {
                        setPiperImportCancelling(true);
                        piperTtsProvider.cancelModelImport();
                      }}
                    >
                      {piperImportCancelling ? tr('Отмена...') : tr('Отменить')}
                    </button>
                  )}

                  {piperCatalog.canRestoreBundled && !piperActionBusy && (
                    <button
                      id="piper-restore-bundled-btn"
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={handleRestoreBundledPiperVoices}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RotateCcw size={14} />
                      {tr('Восстановить встроенные')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {standaloneTtsProvider === 'gemini' && (
            <div className="form-group">
              <label htmlFor="standalone-gemini-tts-model-select">{tr("Модель Gemini TTS")}</label>
              <select
                id="standalone-gemini-tts-model-select"
                value={standaloneGeminiTtsModel}
                onChange={(e) => setStandaloneGeminiTtsModel(e.target.value)}
              >
                {GEMINI_TTS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <p style={{ marginTop: '6px', fontSize: '0.78rem', color: vaultSlots.gemini ? '#34d399' : '#fbbf24' }}>
                {vaultSlots.gemini
                  ? tr('Ключ Gemini настроен (используется общий ключ с ИИ-генерацией).')
                  : tr('Укажите API-ключ Gemini во вкладке «Провайдеры ИИ» — он общий для ИИ и Gemini TTS.')}
              </p>
            </div>
          )}

          {standaloneTtsProvider === 'android_system' && (
            <div className="form-group">
              <label htmlFor="standalone-android-tts-engine-select">{tr("Системный TTS-движок Android")}</label>
              <select
                id="standalone-android-tts-engine-select"
                value={standaloneAndroidTtsEngine}
                onChange={(e) => setStandaloneAndroidTtsEngine(e.target.value)}
              >
                <option value="">{tr("По умолчанию системы")}</option>
                {androidCatalog.engines.map((eng) => (
                  <option key={eng.name} value={eng.name}>{eng.label || eng.name}</option>
                ))}
              </select>
            </div>
          )}

          {standaloneTtsProvider === 'azure' && (
            <div className="form-group">
              <label htmlFor="standalone-azure-region-input">{tr("Регион Azure Speech")}</label>
              <input
                id="standalone-azure-region-input"
                type="text"
                className="form-input"
                value={standaloneAzureRegion}
                onChange={(e) => setStandaloneAzureRegion(e.target.value)}
                placeholder="germanywestcentral"
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  id="standalone-azure-key-input"
                  type="password"
                  autoComplete="off"
                  className="form-input"
                  style={{ flex: '1 1 200px' }}
                  value={azureKeyInput}
                  onChange={(e) => setAzureKeyInput(e.target.value)}
                  placeholder={vaultSlots.azure_tts ? tr('Azure ключ задан (введите для замены)') : tr('Ключ Azure Speech')}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={async () => {
                    if (!azureKeyInput.trim()) return;
                    try {
                      await setVaultKey('azure_tts', azureKeyInput.trim());
                      setAzureKeyInput('');
                      await refreshVault();
                      showToast(tr('Ключ Azure сохранён'), 'success');
                    } catch (err) {
                      showToast(err?.message || tr('Не удалось сохранить ключ Azure'), 'error');
                    }
                  }}
                >
                  <KeyRound size={14} /> {tr('Сохранить')}
                </button>
                {vaultSlots.azure_tts && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      try {
                        await deleteVaultKey('azure_tts');
                        await refreshVault();
                        showToast(tr('Ключ Azure удалён'), 'info');
                      } catch (err) {
                        showToast(err?.message || tr('Не удалось удалить ключ Azure'), 'error');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          <button
            id="standalone-tts-preview-btn"
            type="button"
            className="btn btn-secondary btn-small"
            disabled={previewLoading}
            onClick={() => handleStandalonePreview()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {previewLoading ? <Loader2 size={14} className="spin" /> : <Volume2 size={14} />}
            {tr("Прослушать голос")}
          </button>
        </div>
      )}

      <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <h4 style={{ marginBottom: '12px', color: '#c084fc', fontSize: '1rem' }}>{tr("Поведение аудиоплеера")}</h4>
        <div className="settings-row">
          <span>{tr("Автовоспроизведение")}</span>
          <label className="switch">
            <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} />
            <span className="slider"></span>
          </label>
        </div>
        {IS_STANDALONE && (
          <div className="settings-row">
            <span>{tr("Использовать локальный TTS при отсутствии готового аудио")}</span>
            <label className="switch">
              <input
                id="use-local-tts-when-missing-toggle"
                type="checkbox"
                checked={useLocalTtsWhenAudioMissing}
                onChange={e => setUseLocalTtsWhenAudioMissing(e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>
        )}
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
          <select
            id="voice-target-select"
            value={selectedTargetVoice}
            onChange={e => setTtsVoice(activeLanguage, e.target.value)}
          >
            {filteredVoices.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
            id="voice-ru-select"
            value={
              IS_STANDALONE
                ? resolveValidStandaloneVoice(
                  standaloneTtsProvider,
                  'ru',
                  ttsVoices?.ru,
                  androidCatalog.voices,
                  piperCatalog.voices,
                )
                : getTtsVoiceForLang('ru', adminSettings, ttsVoices)
            }
            onChange={e => setTtsVoice('ru', e.target.value)}
          >
            {ruVoices.map(opt => (
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
