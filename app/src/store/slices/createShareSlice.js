import api from '../../services/api';
import { getPublicShareUrl, executeShare } from '../../utils/share';

export const createShareSlice = (set, get) => ({
  handleShareDeck: async (deckId) => {
    try {
      let targetId = deckId;
      if (targetId < 0) {
        try {
          const { syncService } = await import('../../services/syncService');
          await syncService.sync();
          const currentDeck = get().decks.find(d => d.id === targetId || d.local_id === targetId);
          if (currentDeck && currentDeck.id > 0) {
            targetId = currentDeck.id;
          }
        } catch { /* ignore */ }
      }
      const res = await api.post(`/share/generate/deck/${targetId}`);
      if (res.data.status === 'ok') {
        const link = getPublicShareUrl(res.data.share_id);
        const deck = get().decks.find(d => d.id === targetId || d.id === deckId);
        const deckName = deck?.name || 'Колода';
        const cardCount = deck?.stats?.total || deck?.cards_count || '';
        const level = deck?.level ? ` • ${deck.level}` : '';
        const text = `🇩🇪 Делюсь с тобой колодой «${deckName}»${cardCount ? ` (${cardCount} карточек${level})` : ''} в Lerne.\nНажми ссылку и кнопку «Старт», чтобы открыть её в браузере:`;

        return await executeShare({
          title: `Колода «${deckName}» в Lerne`,
          text,
          link
        });
      }
      return { success: false };
    } catch (err) {
      console.error('Share Deck Error:', err);
      throw err;
    }
  },

  handleShareFolder: async (folderId) => {
    try {
      let targetId = folderId;
      if (targetId < 0) {
        try {
          const { syncService } = await import('../../services/syncService');
          await syncService.sync();
          const currentFolder = get().folders.find(f => f.id === targetId || f.local_id === targetId);
          if (currentFolder && currentFolder.id > 0) {
            targetId = currentFolder.id;
          }
        } catch { /* ignore */ }
      }
      const res = await api.post(`/share/generate/folder/${targetId}`);
      if (res.data.status === 'ok') {
        const link = getPublicShareUrl(res.data.share_id);
        const folder = get().folders.find(f => f.id === targetId || f.id === folderId);
        const folderName = folder?.name || 'Папка';
        const text = `🇩🇪 Делюсь с тобой папкой «${folderName}» в Lerne.\nНажми ссылку и кнопку «Старт», чтобы открыть её в браузере:`;

        return await executeShare({
          title: `Папка «${folderName}» в Lerne`,
          text,
          link
        });
      }
      return { success: false };
    } catch (err) {
      console.error('Share Folder Error:', err);
      throw err;
    }
  },

  fetchCollaborators: async (targetType, targetId) => {
    try {
      const res = await api.get(`/collaborative/${targetType}/${targetId}/collaborators`);
      return res.data;
    } catch (err) {
      console.error('Fetch Collaborators Error:', err);
      throw err;
    }
  },

  addCollaborator: async (targetType, targetId, userIdentifier, role = 'viewer') => {
    try {
      const res = await api.post(`/collaborative/${targetType}/${targetId}/add`, {
        user_identifier: userIdentifier,
        role
      });
      return res.data;
    } catch (err) {
      console.error('Add Collaborator Error:', err);
      throw err;
    }
  },

  updateCollaboratorRole: async (targetType, targetId, collaboratorUserId, role) => {
    try {
      const res = await api.put(`/collaborative/${targetType}/${targetId}/role`, {
        user_id_to_update: collaboratorUserId,
        role
      });
      return res.data;
    } catch (err) {
      console.error('Update Collaborator Role Error:', err);
      throw err;
    }
  },

  removeCollaborator: async (targetType, targetId, collaboratorUserId) => {
    try {
      const res = await api.delete(`/collaborative/${targetType}/${targetId}/remove/${collaboratorUserId}`);
      return res.data;
    } catch (err) {
      console.error('Remove Collaborator Error:', err);
      throw err;
    }
  },

  removeAllCollaborators: async (targetType, targetId) => {
    try {
      const res = await api.delete(`/collaborative/${targetType}/${targetId}/remove-all`);
      await get().fetchDecks(true);
      await get().fetchFolders();
      return res.data;
    } catch (err) {
      console.error('Remove All Collaborators Error:', err);
      throw err;
    }
  },

  fetchGroupProgress: async (folderId) => {
    try {
      const res = await api.get(`/collaborative/folder/${folderId}/group-progress`);
      return res.data;
    } catch (err) {
      console.error('Fetch Group Progress Error:', err);
      throw err;
    }
  },

  joinCollaborativeItem: async (shareId) => {
    try {
      const res = await api.post(`/collaborative/join/${shareId}`);
      await get().fetchDecks(true);
      await get().fetchFolders();
      return res.data;
    } catch (err) {
      console.error('Join Collaborative Item Error:', err);
      throw err;
    }
  },
});
