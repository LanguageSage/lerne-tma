import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useUiStore } from '../store/useUiStore';
import { cleanMedia } from '../utils/media';
import { getPublicShareUrl, executeShare } from '../utils/share';
import { isTelegram, isNative } from '../utils/platform';
import { useStudySession } from './useStudySession';

export const useCardEditor = () => {
  const { fetchDecks, fetchDeckCards } = useDeckStore();
  const { setLoading, showToast } = useUiStore();
  const { fetchNextCard } = useStudySession();

  const saveCard = async (manualCardData = null) => {
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
        deck_id: finalDeckId,
        front: data.front || '',
        back: data.back || '',
        context: data.context || '',
        difficulty: data.difficulty !== undefined ? data.difficulty : null,
        level: data.level || null,
        tags: data.tags || null,
        image_path: data.image_path || cleanMedia(data.image_url),
        audio_path: data.audio_path || cleanMedia(data.audio_url),
        audio_back_path: data.audio_back_path || cleanMedia(data.audio_back_url),
        video_front_path: data.video_front_path || cleanMedia(data.video_front_url),
        video_back_path: data.video_back_path || cleanMedia(data.video_back_url)
      };
      if (data.after_card_id) reqData.after_card_id = data.after_card_id;

      const res = await api.post('/cards/save', reqData);

      showToast("Карточка сохранена", "success");
      
      const { deckCards } = useDeckStore.getState();
      let savedCard = (res?.data && res.data.id) ? res.data : data;
      if (res?.data && res.data.id) {
        const existingIdx = (deckCards || []).findIndex(c => String(c.id) === String(savedCard.id));
        let nextCards = [...(deckCards || [])];
        if (existingIdx !== -1) {
          nextCards[existingIdx] = { ...nextCards[existingIdx], ...savedCard };
        } else if (data.after_card_id) {
          const afterIdx = nextCards.findIndex(c => String(c.id) === String(data.after_card_id));
          if (afterIdx !== -1) {
            nextCards.splice(afterIdx + 1, 0, savedCard);
          } else {
            nextCards.push(savedCard);
          }
        } else {
          nextCards.push(savedCard);
        }
        useDeckStore.setState({ deckCards: nextCards });
      }

      const updatedDeck = useDeckStore.getState().decks.find(d => d.id === finalDeckId) || currentDeck;
      if (updatedDeck) {
        fetchDeckCards(updatedDeck.id).catch(err => console.warn('Background deck cards refresh:', err));
      }
      fetchDecks(true).catch(err => console.warn('Background decks refresh:', err));

      const sourceView = ui.editorSourceView || 'cards';
      session.setEditingCard(null);

      if (sourceView === 'study') {
        if (savedCard && savedCard.id) {
          session.setCard(savedCard);
          const { studyHistory, historyIndex } = session;
          if (data.id && historyIndex >= 0 && studyHistory[historyIndex]?.id === savedCard.id) {
            const updatedHistory = [...studyHistory];
            updatedHistory[historyIndex] = savedCard;
            session.setStudyHistory(updatedHistory);
          } else if (!data.id) {
            session.addToHistory(savedCard);
          }
        }
        if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
          window.history.back();
        } else {
          ui.setView('study');
        }
      } else if (sourceView === 'duplicates') {
        if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
          window.history.back();
        } else {
          ui.setView('duplicates');
        }
      } else {
        if (window.history.state?.view === 'editor' || window.history.state?.view === 'creator') {
          window.history.back();
        } else {
          ui.setView(sourceView);
        }
      }
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail || err.message;
      showToast(`Ошибка сохранения: ${detail}`, "error");
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
      
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const { currentDeck, deckCards } = useDeckStore.getState();

      const updatedDeckCards = (deckCards || []).filter(c => String(c.id) !== String(cardId));
      useDeckStore.setState({ deckCards: updatedDeckCards });

      session.removeCardFromSession(cardId);
      
      const freshSession = useSessionStore.getState();
      if (ui.view === 'study' && currentDeck) {
        if (!freshSession.card) {
          if (updatedDeckCards.length > 0) {
            await fetchNextCard(currentDeck.id, true);
          } else {
            session.setCard(null);
          }
        }
      }

      if (currentDeck && currentDeck.id && currentDeck.id !== 'duplicates') {
        fetchDeckCards(currentDeck.id).catch(err => console.warn('Refresh deck cards failed:', err));
      }
      fetchDecks(true).catch(err => console.warn('Refresh decks failed:', err));
    } catch (err) {
      console.error('Delete Card Error:', err);
      showToast("Ошибка при удалении");
    } finally {
      setLoading(false);
    }
  };

  const handleMoveCard = async (targetCard, targetDeckId) => {
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
        video_back_path: targetCard.video_back_path || cleanMedia(targetCard.video_back_url)
      });
      showToast("Карточка перемещена", "success");
      
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const { currentDeck, deckCards } = useDeckStore.getState();
      
      const updatedDeckCards = (deckCards || []).filter(c => c.id !== targetCard.id);
      useDeckStore.setState({ deckCards: updatedDeckCards });

      session.removeCardFromSession(targetCard.id);
      
      const freshSession = useSessionStore.getState();
      if (ui.view === 'study' && currentDeck) {
        if (!freshSession.card) {
          if (updatedDeckCards.length > 0) {
            await fetchNextCard(currentDeck.id, true);
          } else {
            session.setCard(null);
          }
        }
      }
      
      if (currentDeck && currentDeck.id !== 'duplicates') {
        fetchDeckCards(currentDeck.id);
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
        front: targetCard.front || targetCard.front_text || '',
        back: targetCard.back || targetCard.back_text || '',
        context: targetCard.context || '',
        image_path: targetCard.image_path || cleanMedia(targetCard.image_url),
        audio_path: targetCard.audio_path || cleanMedia(targetCard.audio_url),
        audio_back_path: targetCard.audio_back_path || cleanMedia(targetCard.audio_back_url),
        video_front_path: targetCard.video_front_path || cleanMedia(targetCard.video_front_url),
        video_back_path: targetCard.video_back_path || cleanMedia(targetCard.video_back_url),
        allow_duplicate: true
      });
      showToast("Карточка скопирована", "success");
      const { currentDeck } = useDeckStore.getState();
      if (currentDeck && currentDeck.id === targetDeckId) {
        fetchDeckCards(currentDeck.id);
      }
      fetchDecks(true);
    } catch (err) {
      showToast(`Ошибка при копировании: ${err.response?.data?.detail || err.message}`);
    }
    setLoading(false);
  };

  const handleShareCard = async (targetCard) => {
    if (!targetCard) return;
    try {
      const link = getPublicShareUrl('card', targetCard.id);
      const isMobile = isTelegram() || isNative();
      if (isMobile) setLoading(true);

      const title = targetCard.front || 'Карточка Lerne';
      const text = `${targetCard.front || ''} — ${targetCard.back || ''}`;
      
      const shareData = {
        title: `Учи слово в Lerne: ${title}`,
        text: `Изучай немецкий язык с карточкой: "${text}"`,
        url: link
      };

      if (!isMobile && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(link);
        showToast("Ссылка скопирована!", "success");
        return { success: true, type: 'copy' };
      }

      if (navigator.share) {
        await navigator.share(shareData);
        return { success: true, type: 'share' };
      } else {
        const result = await executeShare({
          title: shareData.title,
          text: shareData.text,
          url: link,
          link
        });
        if (result.type === 'copy') {
          showToast("Ссылка скопирована!", "success");
        }
        if (isMobile) setLoading(false);
        return result;
      }
    } catch {
      showToast("Ошибка при создании ссылки", "error");
    } finally {
      setLoading(false);
    }
    return { success: false };
  };

  const handleSetCardFlag = async (targetCard, flag) => {
    if (!targetCard || !targetCard.id) return;
    try {
      const res = await api.post(`/cards/${targetCard.id}/flag`, { flag });
      const updatedCard = res.data;
      const session = useSessionStore.getState();
      if (session.card && session.card.id === targetCard.id) {
        session.setCard({ ...session.card, flag: updatedCard.flag });
      }
      session.setStudyHistory(session.studyHistory.map(c => c.id === targetCard.id ? { ...c, flag: updatedCard.flag } : c));
      useDeckStore.setState(state => ({
        deckCards: state.deckCards.map(c => c.id === targetCard.id ? { ...c, flag: updatedCard.flag } : c)
      }));
      showToast(flag ? "Метка установлена" : "Метка снята", "success");
    } catch {
      showToast("Ошибка при установке метки");
    }
  };

  return {
    saveCard,
    handleDeleteCard,
    handleSetCardFlag,
    handleMoveCard,
    handleCopyCard,
    handleShareCard
  };
};
