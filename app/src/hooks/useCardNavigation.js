import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { cleanMedia } from '../utils/media';

export const useCardNavigation = () => {
  const { setView, setEditorSourceView, userProfile, setIsAuthModalOpen, setLastSelectedCardId, setCardsScrollTop } = useUiStore();
  const { setEditingCard } = useSessionStore();

  const captureScroll = () => {
    const container = document.getElementById('app-container');
    if (container) {
      setCardsScrollTop(container.scrollTop);
    }
  };

  const openEditor = (deckId, cardToEdit = null, source = 'cards') => {
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, "Для редактирования карточек войдите через Telegram");
      return;
    }
    captureScroll();
    if (cardToEdit) {
      if (cardToEdit.id) {
        setLastSelectedCardId(cardToEdit.id);
      }
      setEditingCard({
        id: cardToEdit.id,
        front: cardToEdit.front || '',
        back: cardToEdit.back || '',
        context: cardToEdit.context || '',
        image_path: cleanMedia(cardToEdit.image_path),
        image_url: cardToEdit.image_url || (cardToEdit.image_path ? `/api/media/${cardToEdit.image_path}` : ''),
        audio_path: cleanMedia(cardToEdit.audio_path),
        audio_url: cardToEdit.audio_url || (cardToEdit.audio_path ? `/api/media/${cardToEdit.audio_path}` : ''),
        video_front_path: cleanMedia(cardToEdit.video_front_path),
        video_front_url: cardToEdit.video_front_url || (cardToEdit.video_front_path ? `/api/media/${cardToEdit.video_front_path}` : ''),
        video_back_path: cleanMedia(cardToEdit.video_back_path),
        video_back_url: cardToEdit.video_back_url || (cardToEdit.video_back_path ? `/api/media/${cardToEdit.video_back_path}` : ''),
        deck_id: deckId
      });
    } else {
      setEditingCard({ front: '', back: '', context: '', deck_id: deckId });
    }
    setEditorSourceView(source);
    setView('editor');
  };

  const openCreator = (deckId, source = 'cards', afterCardId = null) => {
    if (userProfile?.is_guest) {
      setIsAuthModalOpen(true, "Для создания карточек войдите через Telegram");
      return;
    }
    captureScroll();
    setEditorSourceView(source);
    setEditingCard({
      deck_id: deckId,
      front: '',
      back: '',
      context: '',
      image_path: '',
      audio_path: '',
      after_card_id: afterCardId
    });
    setView('creator');
  };

  return { openEditor, openCreator };
};
