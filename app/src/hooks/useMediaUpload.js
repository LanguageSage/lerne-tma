import { tr } from '../i18n/locale';
import api from '../services/api';
import { useUiStore } from '../store/useUiStore';
import { useSessionStore } from '../store/useSessionStore';
import { getSessionIdentity } from '../utils/auth';
import { isNativeStudyCard, studyErrorDetail } from '../utils/structuredStudyCard.js';
import { useDeckStore } from '../store/useDeckStore';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import { storeLocalMediaFile } from '../pilot/localMediaWriter.js';

export const fetchRemoteImageFile = async (url) => {
  if (IS_STANDALONE || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const res = await fetch(trimmed);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type?.startsWith('image/')) return null;
  return new File([blob], `pasted_${Date.now()}.png`, { type: blob.type });
};

export const useMediaUpload = () => {
  const setLoading = useUiStore(state => state.setLoading);
  const showToast = useUiStore(state => state.showToast);

  const uploadImageFile = async (file, signal) => {
    if (!file) return null;
    if (!file.type?.startsWith('image/')) {
      showToast(tr("Выберите файл изображения"));
      return null;
    }

    if (IS_STANDALONE) {
      if (signal?.aborted) return null;
      const uploaded = await storeLocalMediaFile(file, 'images');
      if (signal?.aborted) return null;
      return uploaded;
    }

    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post('/media/upload-image', formData, { signal });
    return res.data;
  };

  const uploadLayoutImageFile = async (file, signal) => {
    const uploaded = await uploadImageFile(file, signal);
    if (!uploaded) return null;
    if (IS_STANDALONE) {
      return {
        ...uploaded,
        path: uploaded.relativePath,
        url: uploaded.url,
      };
    }
    return uploaded;
  };

  const uploadVideoFile = async (file) => {
    if (!file?.size || file.size > 20 * 1024 * 1024) {
      throw new Error(tr('Выберите MP4 или WebM видео до 20 МБ.'));
    }
    if (IS_STANDALONE) {
      return storeLocalMediaFile(file, 'videos');
    }
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/media/upload-video', formData);
    return data;
  };

  const uploadAudioFile = async (file) => {
    if (!file?.size || file.size > 20 * 1024 * 1024) throw new Error(tr('Выберите MP3 или PCM WAV до 20 МБ.'));
    if (IS_STANDALONE) {
      return storeLocalMediaFile(file, 'audio');
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const body = new FormData();
    body.append('file', file);
    body.append('sha256', sha256);
    const { data } = await api.post('/media/upload-audio', body);
    if (!data.path || !data.url || data.sha256 !== sha256 || data.size !== file.size) {
      throw new Error(tr('Сервер не подтвердил целостность аудио. Повторите загрузку.'));
    }
    return data;
  };

  const saveStudyMedia = async (card, patch) => {
    if (!isNativeStudyCard(card)) throw new Error(tr('Карточка недоступна в формате Structured Cards V2.'));
    const { data } = await api.patch(`/cards/${card.id}`, {
      request_id: crypto.randomUUID(), revision: card.revision, content_v2: card.content_v2, ...patch,
    });
    useSessionStore.getState().updateCardInSession(card.id, data);
    useDeckStore.getState().updateCardLocal(card.id, data);
  };

  const uploadStudyImage = async (file, targetCard) => {
    if (!file || !targetCard || !useDeckStore.getState().currentDeck?.id) return;
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file);
      if (uploaded) {
        await saveStudyMedia(targetCard, { image_path: uploaded.path });

        // Prefetch media
        const img = new Image();
        img.src = uploaded.url;

        showToast(tr("Картинка добавлена"), "success");
      }
    } catch (err) {
      console.error(err);
      showToast(tr("Ошибка загрузки картинки: {{p0}}", { p0: studyErrorDetail(err) }));
    } finally {
      setLoading(false);
    }
  };

  const uploadCreatorImage = async (file, cardId, setter, signal) => {
    if (!file) return;
    const identity = getSessionIdentity();
    setLoading(true);
    try {
      const uploaded = await uploadImageFile(file, signal);
      if (uploaded && !signal?.aborted && identity === getSessionIdentity()) {
        setter(current => {
          if (!current || current.id !== cardId || signal?.aborted || identity !== getSessionIdentity()) {
            return current;
          }
          const next = { ...current, image_path: uploaded.path, image_url: uploaded.url };
          if (next.content_v2?.card?.image) {
            const nextCard = { ...next.content_v2.card };
            delete nextCard.image;
            const nextEnvelope = { ...next.content_v2, card: nextCard };
            next.content_v2 = nextEnvelope;
            if (next.content_v2_source != null) {
              next.content_v2_source = JSON.stringify(nextEnvelope, null, 2);
            }
          }
          return next;
        });
        showToast(tr("Картинка добавлена"), "success");
      }
    } catch (err) {
      if (!signal?.aborted && identity === getSessionIdentity()) {
        showToast(tr("Ошибка загрузки картинки: {{p0}}", { p0: err.response?.data?.detail || err.message }));
      }
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
      showToast(tr("Фон загружен"), "success");
      if (fetchBackgroundsFn) fetchBackgroundsFn();
      return res.data;
    } catch (err) {
      console.error(err);
      showToast(tr("Ошибка загрузки фона: {{p0}}", { p0: err.response?.data?.detail || err.message }));
    } finally {
      setLoading(false);
    }
  };

  const uploadDeckResource = async (file, type, deckId, replaceIndex = -1) => {
    if (!file || !deckId) return null;
    setLoading(true);
    try {
      let data = null;
      if (type === 'image') {
        data = await uploadImageFile(file);
      } else if (type === 'audio') {
        data = await uploadAudioFile(file);
      } else if (type === 'video') {
        data = await uploadVideoFile(file);
      }

      if (data) {
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
          path: data.path,
          url: IS_STANDALONE ? data.path : (data.url || data.path),
          title: file.name || (type === 'image' ? tr("Картинка") : type === 'audio' ? tr("Аудио") : tr("Видео"))
        };

        let updatedResources = [...metadata.resources];
        if (replaceIndex >= 0 && replaceIndex < updatedResources.length) {
          updatedResources[replaceIndex] = {
            ...updatedResources[replaceIndex],
            ...newResource
          };
        } else {
          const existingImgIdx = type === 'image' ? updatedResources.findIndex(r => r.type === 'image') : -1;
          if (existingImgIdx >= 0) {
            updatedResources[existingImgIdx] = {
              ...updatedResources[existingImgIdx],
              ...newResource
            };
          } else {
            updatedResources.push(newResource);
          }
        }
        const newMetadata = { ...metadata, resources: updatedResources };

        const updatedMeta = await store.updateDeckMetadata(deckId, newMetadata);
        showToast(replaceIndex >= 0 ? tr("Ресурс обновлен") : tr("Файл добавлен в ресурсы колоды"), "success");
        return updatedMeta;
      }
      return null;
    } catch (err) {
      console.error(err);
      showToast(tr("Ошибка загрузки: {{p0}}", { p0: err.response?.data?.detail || err.message }));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    uploadImageFile,
    uploadLayoutImageFile,
    uploadAudioFile,
    uploadVideoFile,
    uploadStudyImage,
    uploadCreatorImage,
    uploadCustomBackground,
    uploadDeckResource,
    fetchRemoteImageFile,
  };
};
