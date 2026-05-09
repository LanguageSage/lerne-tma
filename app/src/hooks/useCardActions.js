import { useRef } from 'react';
import axios from 'axios';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { useSettingsStore } from '../store/useSettingsStore';

export const useCardActions = () => {
  const gradingRef = useRef(false);
  const abortControllerRef = useRef(null);

  const { fetchDecks, fetchDeckCards } = useDeckStore();
  const { setLoading, showToast, setView, setIsAiWizardOpen } = useUiStore();
  const { adminSettings } = useSettingsStore();

  const prefetchMedia = (url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  };

  const fetchNextCard = async (deckId, isFirst = false, excludeIds = []) => {
    setLoading(true);
    const session = useSessionStore.getState();
    session.setApiError(null);
    try {
      const excludeParam = excludeIds.length > 0 ? `?exclude_ids=${excludeIds.join(',')}` : '';
      const res = await api.get(`/decks/${deckId}/next${excludeParam}`);

      if (res.data.error) {
        session.setApiError(res.data.error);
        session.setCard(null);
      } else if (res.data.finished) {
        session.setCard(null);
      } else {
        const newCard = res.data;
        session.addToHistory(newCard);
        prefetchMedia(newCard.image_url);
      }
    } catch (err) {
      console.error("fetchNextCard Error:", err);
      session.setApiError(err.response?.data?.detail || err.message);
    }
    setLoading(false);
  };

  const submitGrade = async (grade, playAudio) => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    
    if (!session.card || gradingRef.current || !currentDeck) return;
    gradingRef.current = true;

    session.setIsFlipped(false);
    setLoading(true);

    try {
      const gradedCardId = session.card.id;
      const res = await api.post('/study/grade', {
        card_id: gradedCardId,
        deck_id: currentDeck.id,
        grade
      });

      if (res.data.finished) {
        session.setCard(null);
      } else {
        const nextCard = res.data;
        session.addToHistory(nextCard);
        prefetchMedia(nextCard.image_url);
      }
    } catch (err) {
      console.error("SubmitGrade Error:", err);
      showToast(`Ошибка при сохранении оценки: ${err.response?.data?.detail || err.message}`);
    } finally {
      gradingRef.current = false;
      setLoading(false);
    }
  };

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

      await api.post('/cards/save', {
        card_id: c.id,
        deck_id: c.deck_id,
        front: c.front,
        back: c.back,
        context: c.context,
        image_path: c.image_url || c.image_path || '',
        audio_path: newAudioPath
      });

      const updatedCard = { ...c, audio_url: res.data.url, audio_path: res.data.path };
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

  const saveCard = async (manualCardData = null, viewState = 'editor') => {
    const session = useSessionStore.getState();
    const ui = useUiStore.getState();
    const { currentDeck } = useDeckStore.getState();

    const isEvent = manualCardData && typeof manualCardData === 'object' && 'preventDefault' in manualCardData;
    const data = (manualCardData && !isEvent) ? manualCardData : session.editingCard;

    setLoading(true);
    try {
      const reqData = {
        card_id: data.id || null,
        deck_id: data.deck_id || currentDeck?.id || null,
        front: data.front,
        back: data.back,
        context: data.context || '',
        image_path: data.image_path || '',
        audio_path: data.audio_path || ''
      };

      const res = await api.post('/cards/save', reqData);
      const fullCard = res.data;
      showToast("Сохранено", "success");

      if (viewState === 'creator') {
        session.setCard(fullCard);
        session.setIsFlipped(false);
        
        if (ui.editorSourceView === 'study') {
           session.addToHistory(fullCard);
        } else {
           session.setStudyHistory([fullCard]);
           session.setHistoryIndex(0);
        }
        
        setView('study');
        return;
      }

      if (ui.editorSourceView === 'study') {
        if (session.card && session.card.id === data.id) {
          session.setCard(fullCard);
          // Also update in history
          const newHistory = [...session.studyHistory];
          if (session.historyIndex >= 0) newHistory[session.historyIndex] = fullCard;
          session.setStudyHistory(newHistory);
        }
        setView('study');
      } else if (ui.editorSourceView === 'cards') {
        fetchDeckCards(data.deck_id || currentDeck?.id);
        setView('cards');
      } else {
        fetchDecks(true);
        setView('decks');
      }
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail || err.message;
      showToast(`Ошибка сохранения: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCard = async (cardId) => {
    if (!window.confirm("Удалить эту карточку?")) return;
    setLoading(true);
    try {
      await api.delete(`/cards/${cardId}`);
      showToast("Карточка удалена", "success");
      const { currentDeck } = useDeckStore.getState();
      if (currentDeck) fetchDeckCards(currentDeck.id);
    } catch (err) {
      console.error(err);
      showToast("Ошибка при удалении");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLearn = async (targetCard) => {
    const session = useSessionStore.getState();
    try {
      const res = await api.post(`/cards/${targetCard.id}/toggle-learn`);
      const updatedCard = res.data;
      if (session.card && session.card.id === targetCard.id) {
        session.setCard({ ...session.card, want_to_learn: updatedCard.want_to_learn });
      }
      session.setStudyHistory(session.studyHistory.map(c => c.id === targetCard.id ? { ...c, want_to_learn: updatedCard.want_to_learn } : c));
      showToast(updatedCard.want_to_learn ? "Добавлено в 'Хочу выучить'" : "Удалено из 'Хочу выучить'", "success");
    } catch (err) {
      showToast("Ошибка при изменении статуса");
    }
  };

  const handleMoveCard = async (targetCard, targetDeckId, goNextFn) => {
    setLoading(true);
    try {
      await api.post('/cards/save', {
        card_id: targetCard.id,
        deck_id: targetDeckId,
        front: targetCard.front || '',
        back: targetCard.back || '',
        context: targetCard.context || '',
        image_path: targetCard.image_path || '',
        audio_path: targetCard.audio_path || '',
        video_front_path: targetCard.video_front_path || '',
        video_back_path: targetCard.video_back_path || '',
        want_to_learn: !!targetCard.want_to_learn
      });
      showToast("Карточка перемещена", "success");
      const session = useSessionStore.getState();
      if (session.card && session.card.id === targetCard.id && goNextFn) {
        goNextFn();
      }
      fetchDecks(true);
    } catch (err) {
      showToast(`Ошибка при перемещении: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const handleCopyCard = async (targetCard, targetDeckId) => {
    setLoading(true);
    try {
      await api.post('/cards/save', {
        deck_id: targetDeckId,
        front: targetCard.front || '',
        back: targetCard.back || '',
        context: targetCard.context || '',
        image_path: targetCard.image_path || '',
        audio_path: targetCard.audio_path || '',
        video_front_path: targetCard.video_front_path || '',
        video_back_path: targetCard.video_back_path || '',
        want_to_learn: !!targetCard.want_to_learn
      });
      showToast("Карточка скопирована", "success");
      fetchDecks(true);
    } catch (err) {
      showToast(`Ошибка при копировании: ${err.response?.data?.detail || err.message}`);
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

  const goBack = () => {
    useSessionStore.getState().goBack();
  };

  const goNext = async () => {
    const session = useSessionStore.getState();
    const { currentDeck } = useDeckStore.getState();
    if (session.historyIndex < session.studyHistory.length - 1) {
      session.moveToHistory(session.historyIndex + 1);
    } else if (currentDeck) {
      const historyIds = session.studyHistory.map(c => c.id);
      await fetchNextCard(currentDeck.id, false, historyIds);
    }
  };

  return {
    fetchNextCard,
    submitGrade,
    handleQuickAudio,
    generateAudioInternal,
    saveCard,
    handleDeleteCard,
    handleToggleLearn,
    handleMoveCard,
    handleCopyCard,
    runAiGenerator,
    stopAiGeneration,
    goBack,
    goNext
  };
};
