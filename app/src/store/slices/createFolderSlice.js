import api from '../../services/api';
import { getInitialCachedData, saveToInitCache } from './initCacheHelper';

let folderReorderTimeout = null;

export const createFolderSlice = (set, get) => ({
  folders: getInitialCachedData().folders,

  setFolders: (folders) => {
    set({ folders });
    saveToInitCache({ folders });
  },

  fetchFolders: async () => {
    try {
      const res = await api.get('/folders');
      const folders = res.data || [];
      const storedOrderStr = localStorage.getItem('lerne_folder_order');
      const storedOrder = storedOrderStr ? JSON.parse(storedOrderStr) : null;
      folders.sort((a, b) => {
        if (storedOrder && Array.isArray(storedOrder)) {
          const idxA = storedOrder.indexOf(a.id);
          const idxB = storedOrder.indexOf(b.id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
        }
        const aPos = a.position ?? 0;
        const bPos = b.position ?? 0;
        if (aPos !== bPos) return aPos - bPos;
        return a.id - b.id;
      });
      set({ folders });
      saveToInitCache({ folders });
    } catch (err) {
      console.error('Fetch Folders Error:', err);
    }
  },

  createFolder: async (name, parentId = null, color = null, targetLang = null) => {
    try {
      const { useLanguageStore } = await import('../useLanguageStore');
      const targetLanguage = targetLang || useLanguageStore.getState().activeLanguage || 'de';
      await api.post('/folders', { name, parent_id: parentId, color, target_language: targetLanguage });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Create Folder Error:', err);
      throw err;
    }
  },

  renameFolder: async (folderId, newName) => {
    try {
      await api.post(`/folders/${folderId}/rename`, { name: newName });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Rename Folder Error:', err);
      throw err;
    }
  },

  changeFolderColor: async (folderId, color) => {
    try {
      await api.post(`/folders/${folderId}/color`, { color });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Change Folder Color Error:', err);
      throw err;
    }
  },

  moveFolder: async (folderId, parentId) => {
    try {
      const { folders } = get();
      const updatedFolders = (folders || []).map(f => f.id === folderId ? { ...f, parent_id: parentId } : f);
      set({ folders: updatedFolders });
      saveToInitCache({ folders: updatedFolders });

      await api.post(`/folders/${folderId}/move`, { parent_id: parentId });
      const { fetchFolders } = get();
      await fetchFolders();
    } catch (err) {
      console.error('Move Folder Error:', err);
      throw err;
    }
  },

  deleteFolder: async (folderId) => {
    try {
      await api.delete(`/folders/${folderId}`);
      const { fetchFolders, fetchDecks } = get();
      await fetchFolders();
      await fetchDecks(true);
    } catch (err) {
      console.error('Delete Folder Error:', err);
      throw err;
    }
  },

  reorderFolders: async (orderedIds) => {
    const { folders } = get();
    if (!orderedIds || orderedIds.length === 0) return;

    const posMap = new Map();
    orderedIds.forEach((id, idx) => posMap.set(id, idx));

    const updated = [...(folders || [])];
    const reorderedItems = [];
    const positions = [];

    updated.forEach((f, idx) => {
      if (posMap.has(f.id)) {
        reorderedItems.push(f);
        positions.push(idx);
      }
    });

    reorderedItems.sort((a, b) => posMap.get(a.id) - posMap.get(b.id));

    positions.forEach((pos, i) => {
      const item = reorderedItems[i];
      updated[pos] = { ...item, position: posMap.get(item.id) };
    });

    set({ folders: updated });
    saveToInitCache({ folders: updated });

    if (folderReorderTimeout) {
      clearTimeout(folderReorderTimeout);
    }

    folderReorderTimeout = setTimeout(async () => {
      try {
        await api.post('/folders/reorder', { folder_ids: orderedIds });
      } catch (err) {
        console.error('Reorder Folders Error:', err);
      }
    }, 400);
  },
});
