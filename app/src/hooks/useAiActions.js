import { useRef } from 'react';
import axios from 'axios';
import api from '../services/api';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { cleanMedia } from '../utils/media';

export const useAiActions = () => {
  const abortControllerRef = useRef(null);
  const { setLoading, showToast } = useUiStore();
  const { adminSettings } = useSettingsStore();

  const handleQuickAudio = async (c, playAudioFn) => {
    if (!c || !c.front) return;
    setLoading(true);
    const voice = adminSettings?.TTS_VOICE || 'de-DE-KatjaNeural';
    const rate = adminSettings?.TTS_SPEED || '+0%';
    const hasRussian = /[а-яА-Я]/.test(c.front);
    const textToSpeak = hasRussian ? c.back : c.front;

    if (!textToSpeak) {
      showToast("Нет текста для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/media/generate-audio', {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      });
      const newAudioPath = res.data.path;

      const finalImagePath = c.image_path || cleanMedia(c.image_url);

      await api.post('/cards/save', {
        card_id: c.id,
        deck_id: c.deck_id,
        front: c.front,
        back: c.back,
        context: c.context,
        image_path: finalImagePath,
        audio_path: newAudioPath
      });

      const updatedCard = { ...c, audio_url: res.data.url, audio_path: res.data.path, image_path: finalImagePath };
      const session = useSessionStore.getState();
      session.setCard(updatedCard);
      
      // Update history if needed
      if (session.studyHistory.length > 0) {
        const newHistory = [...session.studyHistory];
        if (session.historyIndex >= 0 && newHistory[session.historyIndex].id === c.id) {
           newHistory[session.historyIndex] = updatedCard;
           session.setStudyHistory(newHistory);
        }
      }

      showToast("Озвучка добавлена!", "success");
      if (playAudioFn) playAudioFn(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации: ${err.response?.data?.detail || err.message}`, "error");
    }
    setLoading(false);
  };

  const generateAudioInternal = async (targetData = null, setter = null, playAudioFn = null) => {
    const session = useSessionStore.getState();
    const data = targetData || session.editingCard;
    if (!data || !data.front) return;

    setLoading(true);
    const voice = adminSettings?.TTS_VOICE || 'de-DE-KatjaNeural';
    const rate = adminSettings?.TTS_SPEED || '+0%';
    const hasRussian = /[а-яА-Я]/.test(data.front);
    const textToSpeak = hasRussian ? data.back : data.front;

    if (!textToSpeak) {
      showToast("Заполните текст для озвучки");
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/media/generate-audio', {
        text: textToSpeak,
        lang: 'de',
        voice: voice,
        rate: rate
      });

      const update = {
        audio_path: res.data.path,
        audio_url: res.data.url
      };

      if (setter) {
        setter(prev => ({ ...prev, ...update }));
      } else {
        session.setEditingCard({ ...session.editingCard, ...update });
      }

      showToast("Аудио сгенерировано", "success");
      if (playAudioFn) playAudioFn(res.data.url);
    } catch (err) {
      console.error(err);
      showToast(`Ошибка генерации аудио: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const stopAiGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
      showToast("Генерация остановлена", "info");
    }
  };

  const runAiGenerator = async (phrase, returnResult = false) => {
    if (!phrase) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    const maxRetries = 3;
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
      attempt++;
      if (attempt > 1) {
        showToast(`Попытка ${attempt}${lastError ? ` (${lastError})` : ""}...`, "info");
      }

      try {
        const res = await api.post('/cards/ai-generate', 
          { phrase }, 
          { signal: abortControllerRef.current.signal }
        );

        if (res.data.error) {
          lastError = res.data.error;
          if (res.data.error.includes("Quota") || res.data.error.includes("Timeout") || res.data.error.includes("Connection")) {
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 1500));
              continue;
            }
          }
          showToast(`Ошибка ИИ: ${res.data.error}`);
          setLoading(false);
          abortControllerRef.current = null;
          return null;
        }

        abortControllerRef.current = null;
        if (returnResult) {
          setLoading(false);
          return res.data;
        }

        const session = useSessionStore.getState();
        const ui = useUiStore.getState();
        session.setEditingCard({
          ...session.editingCard,
          front: res.data.front || session.editingCard?.front,
          back: res.data.back || session.editingCard?.back,
          context: res.data.context || session.editingCard?.context
        });
        ui.setIsAiWizardOpen(false);
        showToast("Готово! Проверьте поля.", "success");
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

        const detail = err.response?.data?.detail || err.message;
        if (err.message === 'Network Error') {
          showToast("Ошибка сети: проверьте соединение");
        } else {
          showToast(`Ошибка ИИ: ${detail}`);
        }
      }
    }

    setLoading(false);
    abortControllerRef.current = null;
    return null;
  };

  return {
    handleQuickAudio,
    generateAudioInternal,
    runAiGenerator,
    stopAiGeneration
  };
};
