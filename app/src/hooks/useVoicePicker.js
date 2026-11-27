import { tr } from '../i18n/locale';
import { useState, useCallback, useRef, useEffect } from 'react';
import api from '../services/api';
import { VOICES_BY_LANG, getTtsVoiceForLang } from '../constants/languageConstants';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { useDeckStore } from '../store/useDeckStore';
import { useLidStore } from '../store/useLidStore';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import {
  getVoicesForStandaloneProvider,
  resolveValidStandaloneVoice,
} from '../pilot/tts/registry.js';
import { canUseLocalOfflineTtsForLang } from '../pilot/tts/ttsService.js';
import { androidSystemTtsProvider } from '../pilot/tts/androidSystemTtsProvider.js';
import { piperTtsProvider } from '../pilot/tts/piperTtsProvider.js';

export const useVoicePicker = (
  lang = 'de',
  sessionVoice = null,
  onVoiceChange = null,
  autoGenerate = true,
  structured = false,
) => {
  const rawCode = (lang || 'de').toLowerCase().trim().replace('_', '-');
  const code = rawCode.split('-')[0] || 'de';
  const adminSettings = useSettingsStore((s) => s.adminSettings);
  const ttsVoices = useSettingsStore((s) => s.ttsVoices);
  const standaloneTtsProvider = useSettingsStore((s) => s.standaloneTtsProvider);
  const standaloneAndroidTtsEngine = useSettingsStore((s) => s.standaloneAndroidTtsEngine);
  const [androidVoices, setAndroidVoices] = useState([]);
  const [piperVoices, setPiperVoices] = useState([]);

  useEffect(() => {
    if (!IS_STANDALONE || standaloneTtsProvider !== 'piper' || !piperTtsProvider.isSupported()) {
      return;
    }
    let canceled = false;
    piperTtsProvider.listVoices()
      .then((res) => {
        if (!canceled) setPiperVoices(Array.isArray(res?.voices) ? res.voices : []);
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
        if (!canceled) setAndroidVoices(Array.isArray(res?.voices) ? res.voices : []);
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, [standaloneTtsProvider, standaloneAndroidTtsEngine]);

  const voices = IS_STANDALONE
    ? getVoicesForStandaloneProvider(standaloneTtsProvider, code, androidVoices, piperVoices)
    : (VOICES_BY_LANG[code] || []);
  const defaultVoice = IS_STANDALONE
    ? resolveValidStandaloneVoice(standaloneTtsProvider, code, ttsVoices?.[code], androidVoices, piperVoices)
    : getTtsVoiceForLang(code, adminSettings, ttsVoices);
  const isOfflineLocalAvailable = IS_STANDALONE
    ? canUseLocalOfflineTtsForLang(code, { piperVoices, providerOverride: standaloneTtsProvider })
    : false;

  const [selectedVoice, setSelectedVoiceState] = useState(sessionVoice || defaultVoice);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [wordBoundaries, setWordBoundaries] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  const cacheRef = useRef(new Map());
  const cardTextRef = useRef('');
  const requestGenRef = useRef(0);
  const abortControllerRef = useRef(null);

  const cancelInFlightRequest = useCallback(() => {
    requestGenRef.current += 1;
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch { /* ignore */ }
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  useEffect(() => () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch { /* ignore */ }
      abortControllerRef.current = null;
    }
  }, []);

  const isDefaultVoice = selectedVoice === defaultVoice;

  useEffect(() => {
    cancelInFlightRequest();
    setSelectedVoiceState(defaultVoice);
    setPreviewUrl(null);
    setWordBoundaries(null);
  }, [defaultVoice, cancelInFlightRequest]);

  const generatePreview = useCallback(async (text, voiceOverride = null) => {
    const voice = voiceOverride || selectedVoice || defaultVoice;
    if (!text?.trim() || !voice) return null;

    const settings = useSettingsStore.getState();
    const speed = code === 'ru' ? settings.ttsSpeedRu : settings.ttsSpeed;
    const rate = `${Number(speed) >= 0 ? '+' : ''}${Number(speed) || 0}%`;

    const cacheKey = `${voice}|${rate}|${text.trim()}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setPreviewUrl(cached.url);
      setWordBoundaries(cached.boundaries || null);
      return cached.url;
    }

    cancelInFlightRequest();
    const reqGen = requestGenRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const res = await api.post(
        '/media/generate-audio',
        {
          text: text.trim(),
          lang: code,
          voice,
          rate,
          with_boundaries: true,
          ...(structured ? { structured: true } : {}),
        },
        { signal: controller.signal },
      );

      const url = res.data?.url;
      const boundaries = res.data?.word_boundaries || null;

      if (url) {
        cacheRef.current.set(cacheKey, { url, boundaries });
        if (requestGenRef.current === reqGen) {
          setPreviewUrl(url);
          setWordBoundaries(boundaries);
        }
      }
      return url || null;
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return null;
      }
      const isOfflineLocalVoice = String(voice).startsWith('android_system:') || String(voice).startsWith('piper:');
      const isOfflineAndroidLocal = !navigator.onLine && !isOfflineLocalVoice;
      const msg = isOfflineAndroidLocal ? tr("Для создания озвучки нужно подключение к сети")
        : err?.response?.data?.detail || err.message || tr("Ошибка генерации");
      if (requestGenRef.current === reqGen) {
        setGenerateError(msg);
      }
      console.error('[useVoicePicker] generate failed:', msg);
      return null;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (requestGenRef.current === reqGen) {
        setIsGenerating(false);
      }
    }
  }, [cancelInFlightRequest, code, selectedVoice, defaultVoice, structured]);

  const generateOrGetLocalStudyAudio = useCallback(async (text, isBack = false, voiceOverride = null) => {
    const voice = voiceOverride || selectedVoice || defaultVoice;
    if (!text?.trim() || !voice) return null;

    const settings = useSettingsStore.getState();
    const speed = isBack ? settings.ttsSpeedRu : settings.ttsSpeed;
    const rate = `${Number(speed) >= 0 ? '+' : ''}${Number(speed) || 0}%`;

    const cacheKey = `local-study|${voice}|${rate}|${text.trim()}`;
    const memCached = cacheRef.current.get(cacheKey);
    if (memCached?.url) {
      setPreviewUrl(memCached.url);
      setWordBoundaries(null);
      return memCached.url;
    }

    cancelInFlightRequest();
    const reqGen = requestGenRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setGenerateError(null);
    try {
      const res = await api.post(
        '/media/study-local-audio',
        {
          text: text.trim(),
          lang: code,
          side: isBack ? 'back' : 'front',
          voice,
          rate,
        },
        { signal: controller.signal },
      );
      const url = res.data?.url || null;
      if (url) {
        cacheRef.current.set(cacheKey, { url, boundaries: null });
        if (requestGenRef.current === reqGen) {
          setPreviewUrl(url);
          setWordBoundaries(null);
        }
      }
      return url;
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return null;
      }
      const msg = err?.response?.data?.detail || err?.message || tr("Ошибка локального синтеза речи");
      if (requestGenRef.current === reqGen) {
        setGenerateError(msg);
      }
      console.error('[useVoicePicker] local study TTS failed:', msg);
      return null;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (requestGenRef.current === reqGen) {
        setIsGenerating(false);
      }
    }
  }, [cancelInFlightRequest, code, selectedVoice, defaultVoice]);

  const setSelectedVoice = useCallback(async (voiceValue) => {
    cancelInFlightRequest();
    setSelectedVoiceState(voiceValue);
    setPreviewUrl(null);
    setWordBoundaries(null);
    onVoiceChange?.(voiceValue);
    if (voiceValue) {
      useSettingsStore.getState().setTtsVoice(code, voiceValue);
    }

    if (autoGenerate && cardTextRef.current) {
      setTimeout(() => {
        generatePreview(cardTextRef.current, voiceValue);
      }, 0);
    }
  }, [autoGenerate, cancelInFlightRequest, code, generatePreview, onVoiceChange]);

  const setCardText = useCallback((text) => {
    if (cardTextRef.current !== text) {
      cancelInFlightRequest();
      setGenerateError(null);
    }
    cardTextRef.current = text;
  }, [cancelInFlightRequest]);

  const resetToDefault = useCallback(() => {
    cancelInFlightRequest();
    setSelectedVoiceState(sessionVoice || defaultVoice);
    setPreviewUrl(null);
    setWordBoundaries(null);
    setGenerateError(null);
    cardTextRef.current = '';
  }, [cancelInFlightRequest, defaultVoice, sessionVoice]);

  const generateAndSaveToCard = useCallback(async (
    cardId,
    text,
    isBack = false,
    voiceOverride = null,
    options = {},
  ) => {
    const voice = voiceOverride || selectedVoice || defaultVoice;
    if (!text?.trim() || !voice || !cardId) return null;

    cancelInFlightRequest();
    const reqGen = requestGenRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const settings = useSettingsStore.getState();
      const speed = isBack ? settings.ttsSpeedRu : settings.ttsSpeed;
      const res = await api.post(
        '/media/generate-card-audio',
        {
          card_id: cardId,
          side: isBack ? 'back' : 'front',
          text: text.trim(),
          lang: code,
          voice,
          rate: `${Number(speed) >= 0 ? '+' : ''}${Number(speed) || 0}%`,
          with_boundaries: true,
          force: options.force === true,
        },
        { signal: controller.signal },
      );

      const url = res.data?.url;
      const path = res.data?.path;
      const boundaries = res.data?.word_boundaries || null;

      if (url && path) {
        const sessionState = useSessionStore.getState();

        const cardPatch = isBack
          ? { audio_back_url: url, audio_back_path: path }
          : { audio_url: url, audio_path: path };

        if (res.data.revision) cardPatch.revision = res.data.revision;

        if (sessionState.updateCardInSession) {
          sessionState.updateCardInSession(cardId, cardPatch);
        } else {
          if (sessionState.card && String(sessionState.card.id) === String(cardId)) {
            sessionState.setCard({ ...sessionState.card, ...cardPatch });
          }
          if (sessionState.studyHistory) {
            sessionState.setStudyHistory(
              sessionState.studyHistory.map(item =>
                item && String(item.id) === String(cardId) ? { ...item, ...cardPatch } : item
              )
            );
          }
        }

        const updateCardLocal = useDeckStore.getState().updateCardLocal;
        if (updateCardLocal) {
          updateCardLocal(cardId, cardPatch);
        }

        try {
          const updateQuestionAudio = useLidStore.getState().updateQuestionAudio;
          if (updateQuestionAudio) {
            updateQuestionAudio(cardId, { audio_path: path, audio_url: url });
          }
        } catch { /* ignore */ }

        if (!options.silent) {
          useUiStore.getState().showToast(tr("Озвучка обновлена"), 'success');
        }
        if (requestGenRef.current === reqGen) {
          setPreviewUrl(url);
          setWordBoundaries(boundaries);
        }
      }
      return url || null;
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return null;
      }
      const isOfflineLocalVoice = String(voice).startsWith('android_system:') || String(voice).startsWith('piper:');
      const isOfflineAndroidLocal = !navigator.onLine && !isOfflineLocalVoice;
      const msg = isOfflineAndroidLocal ? tr("Для создания озвучки нужно подключение к сети")
        : err?.response?.data?.detail || err.message || tr("Ошибка генерации и сохранения");
      if (requestGenRef.current === reqGen) {
        setGenerateError(msg);
      }
      console.error('[useVoicePicker] generateAndSaveToCard failed:', msg);
      return null;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (requestGenRef.current === reqGen) {
        setIsGenerating(false);
      }
    }
  }, [cancelInFlightRequest, code, selectedVoice, defaultVoice]);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    isDefaultVoice,
    isOfflineLocalAvailable,
    previewUrl,
    setPreviewUrl,
    wordBoundaries,
    generatePreview,
    generateOrGetLocalStudyAudio,
    generateAndSaveToCard,
    isGenerating,
    generateError,
    resetToDefault,
    setCardText,
  };
};
