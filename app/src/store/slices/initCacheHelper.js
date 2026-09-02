import { storage } from '../../utils/auth';

export const getInitialCachedData = () => {
  try {
    const raw = storage.get('lerne_init_cache');
    if (raw) {
      const data = JSON.parse(raw);
      return {
        decks: Array.isArray(data.decks) ? data.decks : [],
        folders: Array.isArray(data.folders) ? data.folders : []
      };
    }
  } catch { /* ignore */ }
  return { decks: [], folders: [] };
};

export const saveToInitCache = (partialData) => {
  try {
    const raw = storage.get('lerne_init_cache');
    const existing = raw ? JSON.parse(raw) : {};
    const merged = { ...existing, ...partialData };
    storage.set('lerne_init_cache', JSON.stringify(merged));
  } catch { /* ignore */ }
};
