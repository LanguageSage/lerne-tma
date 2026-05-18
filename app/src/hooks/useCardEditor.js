import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { cleanMedia } from '../utils/media';

export const useCardEditor = () => {
  const { fetchDecks, fetchDeckCards } = useDeckStore();
  const { setLoading, showToast, setView } = useUiStore();

  const saveCard = async (manualCardData = null, viewState = 'editor') => {
    const session = useSessionStore.getState();
    const ui = useUiStore.getState();
    const { currentDeck } = useDeckStore.getState();

    const isEvent = manualCardData && typeof manualCardData === 'object' && 'preventDefault' in manualCardData;
    const data = (manualCardData && !isEvent) ? manualCardData : session.editingCard;

    setLoading(true);
    try {
      let finalDeckId = data.deck_id;
      if (finalDeckId === 'duplicates' || !finalDeckId) {
        finalDeckId = currentDeck?.id !== 'duplicates' ? currentDeck?.id : null;
      }
      const reqData = {
        card_id: data.id || null,
        deck_id: finalDeckId || null,
        front: data.front,
        back: data.back,
        context: data.context || '',
        image_path: data.image_path || cleanMedia(data.image_url),
        audio_path: data.audio_path || cleanMedia(data.audio_url),
        video_front_path: data.video_front_path || cleanMedia(data.video_front_url),
        video_back_path: data.video_back_path || cleanMedia(data.video_back_url),
        allow_duplicate: true
      };

      const res = await api.post('/cards/save', reqData);
      const fullCard = res.data;
      showToast("Сохранено", "success");

      // Всегда обновляем список колод, чтобы счетчики были актуальны
      fetchDecks(true);

      if (ui.editorSourceView === 'study') {
        session.setCard(fullCard);
        session.setIsFlipped(false);
        
        if (currentDeck?.id === 'duplicates') {
          const { fetchDuplicates } = useDeckStore.getState();
          await fetchDuplicates();
        }

        // Если это была новая карточка (creator), добавляем в историю
        if (viewState === 'creator') {
          session.addToHistory(fullCard);
        } else {
          // Если редактировали текущую карточку
          if (session.card && session.card.id === data.id) {
            const newHistory = [...session.studyHistory];
            if (session.historyIndex >= 0) newHistory[session.historyIndex] = fullCard;
            session.setStudyHistory(newHistory);
          }
        }
        setView('study');
      } else if (ui.editorSourceView === 'cards') {
        fetchDeckCards(data.deck_id || currentDeck?.id);
        setView('cards');
      } else if (ui.editorSourceView === 'duplicates') {
        const { fetchDuplicates } = useDeckStore.getState();
        await fetchDuplicates();
        setView('duplicates');
      } else {
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

  const handleDeleteCard = async (cardId, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm("Удалить эту карточку?")) return;
    setLoading(true);
    try {
      await api.delete(`/cards/${cardId}`);
      showToast("Карточка удалена", "success");
      const { currentDeck } = useDeckStore.getState();
      if (currentDeck) fetchDeckCards(currentDeck.id);
      fetchDecks(true);
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
        image_path: targetCard.image_path || cleanMedia(targetCard.image_url),
        audio_path: targetCard.audio_path || cleanMedia(targetCard.audio_url),
        video_front_path: targetCard.video_front_path || cleanMedia(targetCard.video_front_url),
        video_back_path: targetCard.video_back_path || cleanMedia(targetCard.video_back_url),
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
        image_path: targetCard.image_path || cleanMedia(targetCard.image_url),
        audio_path: targetCard.audio_path || cleanMedia(targetCard.audio_url),
        video_front_path: targetCard.video_front_path || cleanMedia(targetCard.video_front_url),
        video_back_path: targetCard.video_back_path || cleanMedia(targetCard.video_back_url),
        want_to_learn: !!targetCard.want_to_learn
      });
      showToast("Карточка скопирована", "success");
      fetchDecks(true);
    } catch (err) {
      showToast(`Ошибка при копировании: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const handleShareCard = async (targetCard) => {
    // 1. Telegram Desktop Fix: На десктопе лучше не показывать лоадер сразу,
    // чтобы не блокировать "user activation" для открытия ссылки.
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) setLoading(true);

    let screenshot = null;
    try {
      // Пытаемся сделать скриншот текущего вида карточки
      const html2canvas = (await import('html2canvas')).default;
      const { isFlipped } = useSessionStore.getState();
      const { view } = useUiStore.getState();
      
      let elementId = 'tut-study-card';
      if (view === 'creator' || view === 'editor') {
        elementId = isFlipped ? 'card-preview-back' : 'card-preview-front';
      }
      
      let element = document.getElementById(elementId);
      if (!element) {
        // Fallback search
        element = document.querySelector('.card-container');
      }

      if (element) {
        const canvas = await html2canvas(element, {
          useCORS: true,
          allowTaint: true,
          scale: 2, // Increased for better resolution
          backgroundColor: null,
          logging: false,
          imageTimeout: 5000
        });
        screenshot = canvas.toDataURL('image/jpeg', 0.85);
        console.log("Screenshot captured, length:", screenshot.length);
      }
    } catch (err) {
      console.error("Screenshot error:", err);
    }

    try {
      const res = await api.post(`/share/generate/card/${targetCard.id}`, { screenshot });
      if (res.data.status === 'ok') {
        const shareId = res.data.share_id;
        const link = `${window.location.origin}/api/share/v/${shareId}`;
        const text = `Посмотри эту карточку: ${targetCard.front}`;
        
        if (navigator.share) {
          try {
            await navigator.share({
              title: 'Карточка Lerne',
              text: text,
              url: link,
            });
            if (isMobile) setLoading(false);
            return { success: true, type: 'share' };
          } catch (shareErr) {
            if (shareErr.name === 'AbortError') {
               if (isMobile) setLoading(false);
               return { success: false };
            }
          }
        }

        const tg = window.Telegram?.WebApp;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
        
        if (tg && tg.openTelegramLink) {
          tg.openTelegramLink(shareUrl);
        } else {
          window.open(shareUrl, '_blank');
        }
        
        if (isMobile) setLoading(false);
        return { success: true, type: 'telegram' };
      }
    } catch (err) {
      showToast("Ошибка при создании ссылки", "error");
    } finally {
      setLoading(false);
    }
    return { success: false };
  };

  return {
    saveCard,
    handleDeleteCard,
    handleToggleLearn,
    handleMoveCard,
    handleCopyCard,
    handleShareCard
  };
};
