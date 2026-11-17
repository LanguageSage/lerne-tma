import { useCallback } from 'react';
import { tr } from '../i18n/locale';
import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { newCardContent } from '../utils/cardDraft';
import { getAudioUrl } from '../utils/media';
import api from '../services/api';
import { getSessionIdentity } from '../utils/auth';

let activeOpenRequest = null;

export const useCardNavigation = () => {
  const userProfile = useUiStore(s => s.userProfile);

  const captureScroll = () => {
    const container = document.getElementById('app-container');
    if (container) {
      useUiStore.getState().setCardsScrollTop(container.scrollTop);
    }
  };

  const openEditor = useCallback(async (deckId, cardToEdit = null, source = 'cards') => {
    const { setView, setEditorSourceView, setIsAuthModalOpen, setLastSelectedCardId, setIsOpeningEditor, showToast } = useUiStore.getState();
    const { setEditingCard } = useSessionStore.getState();
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, tr("Для редактирования карточек войдите через Telegram"));
      return;
    }
    const identity = getSessionIdentity();
    const view = useUiStore.getState().view;
    if (cardToEdit?.id && activeOpenRequest?.identity === identity && activeOpenRequest?.view === view) {
      return;
    }
    captureScroll();
    if (cardToEdit) {
      if (cardToEdit.id) {
        const token = { cardId: cardToEdit.id, identity, view };
        activeOpenRequest = token;
        setIsOpeningEditor(true);
        try {
          const { data } = await api.get(`/cards/${cardToEdit.id}`, { freshCard: true });
          if (activeOpenRequest !== token || getSessionIdentity() !== identity || useUiStore.getState().view !== view) return;
          cardToEdit = data;
          setLastSelectedCardId(data.id);
        } catch (error) {
          if (activeOpenRequest !== token || getSessionIdentity() !== identity) return;
          showToast(error.response?.data?.detail?.code === 'card_requires_migration'
            ? tr('Карточки ещё не перенесены в Structured Cards V2.')
            : tr('Не удалось загрузить данные с сервера'), 'error');
          return;
        } finally {
          if (activeOpenRequest === token) {
            activeOpenRequest = null;
            useUiStore.getState().setIsOpeningEditor(false);
          }
        }
      }
      setEditingCard({
        ...cardToEdit,
        id: cardToEdit.id,
        image_url: cardToEdit.image_url || (cardToEdit.image_path ? `/api/media/${cardToEdit.image_path}` : ''),
        audio_url: getAudioUrl(cardToEdit.audio_url || cardToEdit.audio_path),
        audio_back_url: getAudioUrl(cardToEdit.audio_back_url || cardToEdit.audio_back_path),
        video_front_url: cardToEdit.video_front_url || (cardToEdit.video_front_path ? `/api/media/${cardToEdit.video_front_path}` : ''),
        video_back_url: cardToEdit.video_back_url || (cardToEdit.video_back_path ? `/api/media/${cardToEdit.video_back_path}` : ''),
        deck_id: cardToEdit.deck_id ?? deckId
      });
    } else {
      setEditingCard({ content_v2: newCardContent(), deck_id: deckId });
    }
    setEditorSourceView(source);
    setView('editor');
  }, [userProfile?.is_guest]);

  const openCreator = useCallback((deckId, source = 'cards', afterCardId = null) => {
    const { setView, setEditorSourceView, setIsAuthModalOpen } = useUiStore.getState();
    const { setEditingCard } = useSessionStore.getState();
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, tr("Для создания карточек войдите через Telegram"));
      return;
    }
    captureScroll();
    setEditorSourceView(source);
    setEditingCard({
      deck_id: deckId,
      content_v2: newCardContent(),
      image_path: '',
      audio_path: '',
      after_card_id: afterCardId
    });
    setView('creator');
  }, [userProfile?.is_guest]);

  return { openEditor, openCreator };
};
