import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, KeyRound, Trash2, Loader2 } from 'lucide-react';
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
  listStandaloneTtsProviders,
} from '../../pilot/tts/registry.js';
import { androidSystemTtsProvider } from '../../pilot/tts/androidSystemTtsProvider.js';
import { piperTtsProvider } from '../../pilot/tts/piperTtsProvider.js';
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
  const [piperCatalog, setPiperCatalog] = useState({ available: false, loadedModelId: '', voices: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
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
    piperTtsProvider.listVoices()
      .then((res) => {
        if (!canceled) setPiperCatalog(res);
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, [standaloneTtsProvider]);

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
    ? (ttsVoices?.[activeLanguage] || getDefaultStandaloneVoice(standaloneTtsProvider, activeLanguage, piperCatalog.voices))
    : (getTtsVoiceForLang(activeLanguage, adminSettings, ttsVoices) || (filteredVoices[0]?.value || ''));

  const handleStandalonePreview = async () => {
    try {
      previewAudioRef.current?.pause();
    } catch { /* ignore */ }
    previewAudioRef.current = null;
    setPreviewLoading(true);
    try {
      const sample = activeLanguage === 'en'
        ? 'Hello, I am learning languages offline.'
        : activeLanguage === 'no'
          ? 'Hei, jeg lærer norsk offline.'
          : 'Hallo! Ich lerne Deutsch offline.';
      const res = await api.post('/media/generate-audio', {
        text: sample,
        lang: activeLanguage,
        voice: selectedTargetVoice,
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
            <p style={{ marginTop: '6px', marginBottom: '10px', fontSize: '0.78rem', color: piperCatalog.available ? '#34d399' : '#fbbf24' }}>
              {piperCatalog.available
                ? `${tr('Локальный нейросетевой движок Piper готов (офлайн, установлено моделей:')} ${piperCatalog.voices.length}).`
                : tr('Локальные голосовые модели Piper не найдены на устройстве.')}
            </p>
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
            onClick={handleStandalonePreview}
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
            value={IS_STANDALONE ? (ttsVoices?.ru || getDefaultStandaloneVoice(standaloneTtsProvider, 'ru', piperCatalog.voices)) : getTtsVoiceForLang('ru', adminSettings, ttsVoices)}
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
