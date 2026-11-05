import { tr } from '../i18n/locale';
import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { newCardContent } from '../utils/cardDraft';
import { getAudioUrl } from '../utils/media';
import { networkApi } from '../services/api';
import { getSessionIdentity } from '../utils/auth';

export const useCardNavigation = () => {
  const { setView, setEditorSourceView, userProfile, setIsAuthModalOpen, setLastSelectedCardId, setCardsScrollTop, showToast } = useUiStore();
  const { setEditingCard } = useSessionStore();

  const captureScroll = () => {
    const container = document.getElementById('app-container');
    if (container) {
      setCardsScrollTop(container.scrollTop);
    }
  };

  const openEditor = async (deckId, cardToEdit = null, source = 'cards') => {
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, tr("Для редактирования карточек войдите через Telegram"));
      return;
    }
    captureScroll();
    if (cardToEdit) {
      if (cardToEdit.id) {
        const identity = getSessionIdentity();
        const view = useUiStore.getState().view;
        try {
          const { data } = await networkApi.get(`/cards/${cardToEdit.id}`);
          if (getSessionIdentity() !== identity || useUiStore.getState().view !== view) return;
          cardToEdit = data;
          setLastSelectedCardId(data.id);
        } catch (error) {
          if (getSessionIdentity() !== identity) return;
          showToast(error.response?.data?.detail?.code === 'card_requires_migration'
            ? tr('Карточки ещё не перенесены в Structured Cards V2.')
            : tr('Не удалось загрузить данные с сервера'), 'error');
          return;
        }
      }
      setEditingCard({
        ...cardToEdit,
        id: cardToEdit.id,
        image_url: cardToEdit.image_url || (cardToEdit.image_path ? `/api/media/${cardToEdit.image_path}` : ''),
        audio_url: getAudioUrl(cardToEdit.audio_url || cardToEdit.audio_path),
        video_front_url: cardToEdit.video_front_url || (cardToEdit.video_front_path ? `/api/media/${cardToEdit.video_front_path}` : ''),
        video_back_url: cardToEdit.video_back_url || (cardToEdit.video_back_path ? `/api/media/${cardToEdit.video_back_path}` : ''),
        deck_id: deckId
      });
    } else {
      setEditingCard({ content_v2: newCardContent(), deck_id: deckId });
    }
    setEditorSourceView(source);
    setView('editor');
  };

  const openCreator = (deckId, source = 'cards', afterCardId = null) => {
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
  };

  return { openEditor, openCreator };
};
