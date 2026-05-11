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
      const reqData = {
        card_id: data.id || null,
        deck_id: data.deck_id || currentDeck?.id || null,
        front: data.front,
        back: data.back,
        context: data.context || '',
        image_path: data.image_path || cleanMedia(data.image_url),
        audio_path: data.audio_path || cleanMedia(data.audio_url),
        video_front_path: data.video_front_path || cleanMedia(data.video_front_url),
        video_back_path: data.video_back_path || cleanMedia(data.video_back_url)
      };

      const res = await api.post('/cards/save', reqData);
      const fullCard = res.data;
      showToast("Сохранено", "success");

      // Всегда обновляем список колод, чтобы счетчики были актуальны
      fetchDecks(true);

      if (ui.editorSourceView === 'study') {
        session.setCard(fullCard);
        session.setIsFlipped(false);
        
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

  const handleDeleteCard = async (cardId) => {
    if (!window.confirm("Удалить эту карточку?")) return;
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
    setLoading(true);
    try {
      const res = await api.post(`/share/generate/card/${targetCard.id}`);
      if (res.data.status === 'ok') {
        const shareId = res.data.share_id;
        const link = `https://t.me/LerneDeutsch287_bot/Lerne?startapp=${shareId}`;
        
        if (navigator.share) {
          try {
            await navigator.share({
              title: 'Карточка Lerne',
              text: `Посмотри эту карточку: ${targetCard.front}`,
              url: link,
            });
          } catch (shareErr) {
            if (shareErr.name !== 'AbortError') {
              await navigator.clipboard.writeText(link);
              showToast("Ссылка скопирована в буфер", "success");
            }
          }
        } else {
          await navigator.clipboard.writeText(link);
          showToast("Ссылка на карточку скопирована!", "success");
        }
      }
    } catch (err) {
      showToast("Ошибка при создании ссылки", "error");
    } finally {
      setLoading(false);
    }
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
