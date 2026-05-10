import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { cleanMedia } from '../utils/media';

export const useCardNavigation = () => {
  const { setView, setEditorSourceView } = useUiStore();
  const { setEditingCard } = useSessionStore();

  const openEditor = (deckId, cardToEdit = null, source = 'cards') => {
    if (cardToEdit) {
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

  const openCreator = (deckId, source = 'cards') => {
    setEditorSourceView(source);
    setEditingCard({
      deck_id: deckId,
      front: '',
      back: '',
      context: '',
      image_path: '',
      audio_path: ''
    });
    setView('creator');
  };

  return { openEditor, openCreator };
};
