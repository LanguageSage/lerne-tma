import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { useDeckStore } from '../store/useDeckStore';

export const useMediaUpload = () => {
  const { setLoading, showToast } = useUiStore();
  const { card, setCard, editingCard, setEditingCard } = useSessionStore();
  const { currentDeck } = useDeckStore();

  const uploadImageFile = async (file) => {
    if (!file) return null;
    if (!file.type?.startsWith('image/')) {
      showToast("Выберите файл изображения");
      return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/media/upload-image', formData);
    return res.data;
  };

  const uploadImage = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        setEditingCard({
          ...editingCard,
          image_path: uploaded.path,
          image_url: uploaded.url
        });
        showToast("Картинка добавлена", "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки картинки: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadStudyImage = async (file, targetCard) => {
    if (!file || !targetCard || !currentDeck?.id) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        await api.post('/cards/save', {
          card_id: targetCard.id,
          deck_id: currentDeck.id,
          front: targetCard.front,
          back: targetCard.back,
          context: targetCard.context,
          image_path: uploaded.path,
          audio_path: targetCard.audio_path || ''
        });

        const updatedCard = {
          ...targetCard,
          image_path: uploaded.path,
          image_url: uploaded.url
        };
        setCard(updatedCard);
        
        // Prefetch media
        const img = new Image();
        img.src = uploaded.url;

        showToast("Картинка добавлена", "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки картинки: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadCreatorImage = async (file, currentData, setter) => {
    if (!file) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        setter({
          ...currentData,
          image_path: uploaded.path,
          image_url: uploaded.url
        });
        showToast("Картинка добавлена", "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки картинки: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadCardVideo = async (file, targetCard, side = 'back', isEditor = false) => {
    if (!file || !targetCard || !currentDeck?.id) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploaded = await api.post('/media/upload-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (uploaded.data) {
        const fieldName = side === 'front' ? 'video_front_path' : 'video_back_path';
        const urlName = side === 'front' ? 'video_front_url' : 'video_back_url';

        if (!isEditor) {
          // Study view: save immediately
          await api.post('/cards/save', {
            card_id: targetCard.id,
            deck_id: currentDeck.id,
            front: targetCard.front,
            back: targetCard.back,
            context: targetCard.context,
            image_path: targetCard.image_path || '',
            audio_path: targetCard.audio_path || '',
            video_front_path: side === 'front' ? uploaded.data.path : (targetCard.video_front_path || ''),
            video_back_path: side === 'back' ? uploaded.data.path : (targetCard.video_back_path || '')
          });

          setCard({
            ...targetCard,
            [fieldName]: uploaded.data.path,
            [urlName]: uploaded.data.url
          });
        } else {
          // Editor view: just update state
          setEditingCard({
            ...editingCard,
            [fieldName]: uploaded.data.path,
            [urlName]: uploaded.data.url
          });
        }
        
        showToast(`Видео (${side === 'front' ? 'лицо' : 'оборот'}) добавлено`, "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки видео: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadCustomBackground = async (file, fetchBackgroundsFn) => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/media/upload-background', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast("Фон загружен", "success");
      if (fetchBackgroundsFn) fetchBackgroundsFn();
      return res.data;
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки фона: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadVideo = async (file, currentData, setter, side = 'back') => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/media/upload-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (res.data) {
        const fieldName = side === 'front' ? 'video_front_path' : 'video_back_path';
        const urlName = side === 'front' ? 'video_front_url' : 'video_back_url';
        
        setter({
          ...currentData,
          [fieldName]: res.data.path,
          [urlName]: res.data.url
        });
        showToast(`Видео (${side === 'front' ? 'лицо' : 'оборот'}) добавлено`, "success");
      }
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки видео: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadDeckResource = async (file, type, deckId) => {
    if (!file || !deckId) return null;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      let res;
      if (type === 'image') {
        res = await api.post('/media/upload-image', formData);
      } else if (type === 'audio') {
        res = await api.post('/media/upload-audio', formData);
      } else if (type === 'video') {
        res = await api.post('/media/upload-video', formData);
      }

      if (res && res.data) {
        const store = useDeckStore.getState();
        const currentDeck = store.currentDeck;
        
        let metadata = { resources: [] };
        if (currentDeck && currentDeck.metadata) {
          metadata = typeof currentDeck.metadata === 'string' 
            ? JSON.parse(currentDeck.metadata) 
            : currentDeck.metadata;
        }
        if (!metadata.resources) {
          metadata.resources = [];
        }

        const newResource = {
          type,
          path: res.data.path,
          title: file.name || (type === 'image' ? 'Картинка' : type === 'audio' ? 'Аудио' : 'Видео')
        };

        const updatedResources = [...metadata.resources, newResource];
        const newMetadata = { ...metadata, resources: updatedResources };

        const updatedMeta = await store.updateDeckMetadata(deckId, newMetadata);
        showToast("Файл добавлен в ресурсы колоды", "success");
        return updatedMeta;
      }
      return null;
    } catch (err) {
      console.error(err);
      showToast(`Ошибка загрузки: ${err.response?.data?.detail || err.message}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    uploadImage,
    uploadStudyImage,
    uploadCreatorImage,
    uploadCardVideo,
    uploadVideo,
    uploadCustomBackground,
    uploadDeckResource
  };
};
