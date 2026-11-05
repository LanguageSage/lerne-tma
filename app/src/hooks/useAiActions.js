import { tr, getInterfaceLanguage } from '../i18n/locale';
import { useRef } from 'react';
import axios from 'axios';
import { studyContent, studySideText } from '../utils/structuredStudyCard';
import api from '../services/api';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { useDeckStore } from '../store/useDeckStore';
import { getTtsVoiceForLang } from '../constants/languageConstants';


export const useAiActions = () => {
  const abortControllerRef = useRef(null);
  const { setLoading, showToast } = useUiStore();
  const { adminSettings } = useSettingsStore();

  const handleQuickAudio = async (c, playAudioFn) => {
    if (!studyContent(c)) return;
    setLoading(true);
    try {
      const res = await api.post('/media/generate-card-audio', { card_id: c.id, side: 'front' });
      const patch = { audio_url: res.data.url, audio_path: res.data.path, revision: res.data.revision };
      useSessionStore.getState().updateCardInSession(c.id, patch);
      useDeckStore.getState().updateCardLocal(c.id, patch);
      showToast(tr("Озвучка добавлена!"), "success");
      if (playAudioFn) playAudioFn(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(tr("Ошибка генерации: {{p0}}", { p0: err.response?.data?.detail || err.message }), "error");
    }
    setLoading(false);
  };

  const generateAudioInternal = async (targetData = null, setter = null, playAudioFn = null) => {
    const session = useSessionStore.getState();
    const data = targetData || session.editingCard;
    if (!studyContent(data)) return;

    const targetLang = data.target_language || useLanguageStore.getState().activeLanguage || 'de';
    const langToSpeak = targetLang;
    const settings = useSettingsStore.getState();
    const voice = getTtsVoiceForLang(langToSpeak, adminSettings, settings.ttsVoices);
    const rate = `${settings.ttsSpeed >= 0 ? '+' : ''}${settings.ttsSpeed}%`;
    const textToSpeak = studySideText(studyContent(data));

    if (!textToSpeak) {
      return;
    }

    try {
      const res = await api.post('/media/generate-audio', {
        text: textToSpeak,
        structured: true,
        lang: langToSpeak,
        voice: voice,
        rate: rate
      });

      if (res.data?.url || res.data?.path) {
        const update = {
          audio_path: res.data.path,
          audio_url: res.data.url
        };

        if (setter) {
          setter(prev => ({ ...prev, ...update }));
        } else {
          session.setEditingCard({ ...session.editingCard, ...update });
        }

        showToast(tr("Озвучка обновлена"), "success");
        if (playAudioFn) playAudioFn(res.data.url);
      } else {
        showToast(tr("Аудио не сгенерировано"), "error");
      }
    } catch (err) {
      console.error(err);
      showToast(tr("Аудио не сгенерировано: {{p0}}", { p0: err.response?.data?.detail || err.message }), "error");
    }
  };

  const stopAiGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
      showToast(tr("Генерация остановлена"), "info");
    }
  };

  const runAiGenerator = async (phrase, returnResult = false, actionType = 'full_card', userRequest = '') => {
    if (!phrase) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    // Quiz content/transport retry belongs to the server (two calls total).
    const maxRetries = actionType === 'quiz_analysis' ? 1 : 2;
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;
      if (attempt > 1) {
        showToast(tr("Попытка {{p0}}{{p1}}...", { p0: attempt, p1: lastError ? ` (${lastError})` : "" }), "info");
      }

      try {
        const currentDeck = useDeckStore.getState().currentDeck;
        const targetLang = currentDeck?.target_language || useLanguageStore.getState().activeLanguage || 'de';
        const nativeLang = getInterfaceLanguage();
        const res = await api.post('/cards/ai-generate', 
          {
            ...(typeof phrase === "string" ? { phrase } : { content_v2: phrase }),
            target_language: targetLang,
            native_language: nativeLang,
            action_type: actionType,
            user_request: String(userRequest || '').trim() || undefined
          },
          { signal: abortControllerRef.current.signal, ...(actionType === 'quiz_analysis' ? { timeout: 100000 } : {}) }
        );

        if (res.data.error) {
          lastError = res.data.error;
          if (res.data.error.includes("Timeout") || res.data.error.includes("Connection")) {
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 1500));
              continue;
            }
          }
          showToast(tr("Ошибка ИИ: {{p0}}", { p0: res.data.error }));
          setLoading(false);
          abortControllerRef.current = null;
          return null;
        }

        abortControllerRef.current = null;
        if (!returnResult) useUiStore.getState().setIsAiWizardOpen(false);
        setLoading(false);
        return res.data;

      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError' || axios.isCancel(err)) {
          return null;
        }
        
        lastError = err.message || "Network Error";
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const detail = err.customTimeoutMsg || err.response?.data?.detail || err.response?.data?.error || err.message;
        if (err.message === 'Network Error') {
          showToast(tr("Ошибка сети: проверьте соединение"));
        } else {
          showToast(tr("Ошибка ИИ: {{p0}}", { p0: detail }));
        }
      }
    }

    setLoading(false);
    abortControllerRef.current = null;
    return null;
  };

  const runBatchAiGenerator = async (text, deckId) => {
    if (!text || !text.trim()) return null;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    try {
      const decks = useDeckStore.getState().decks || [];
      const currentDeck = useDeckStore.getState().currentDeck;
      const targetDeck = deckId ? decks.find(d => String(d.id) === String(deckId)) || currentDeck : currentDeck;
      const targetLang = targetDeck?.target_language || useLanguageStore.getState().activeLanguage || 'de';
      const nativeLang = getInterfaceLanguage();

      const res = await api.post('/cards/ai-generate-batch',
        {
          text: text.trim(),
          deck_id: deckId ? String(deckId) : null,
          target_language: targetLang,
          native_language: nativeLang
        },
        { signal: abortControllerRef.current.signal }
      );

      setLoading(false);
      abortControllerRef.current = null;

      if (res.data.error) {
        showToast(tr("Ошибка пакетной генерации: {{p0}}", { p0: res.data.error }));
        return null;
      }

      showToast(tr("Успешно сгенерировано карточек: {{p0}}", { p0: res.data.generated_count || res.data.cards?.length || 0 }), 'success');
      return res.data;
    } catch (err) {
      setLoading(false);
      abortControllerRef.current = null;
      if (err.name === 'CanceledError' || err.name === 'AbortError' || axios.isCancel(err)) {
        return null;
      }
      const detail = err.response?.data?.detail || err.message;
      showToast(tr("Ошибка ИИ: {{p0}}", { p0: detail }));
      return null;
    }
  };

  return {
    handleQuickAudio,
    generateAudioInternal,
    runAiGenerator,
    runBatchAiGenerator,
    stopAiGeneration
  };
};
