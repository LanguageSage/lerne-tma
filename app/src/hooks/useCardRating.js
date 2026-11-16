import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getRating, isRatingBusy, loadDeckRatings, saveRating, subscribeRatings } from '../services/cardRatings.js';
import { useUiStore } from '../store/useUiStore.js';
import { getUserId } from '../utils/auth.js';

export function useCardRating(cardId, deckId) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const value = useSyncExternalStore(subscribeRatings, () => getRating(userId, cardId));
  const busy = useSyncExternalStore(subscribeRatings, () => isRatingBusy(userId, cardId));

  useEffect(() => {
    if (userId == null || deckId == null) return undefined;
    const load = () => loadDeckRatings(userId, deckId, true).catch(() => {});
    loadDeckRatings(userId, deckId).catch(() => {});
    window.addEventListener('online', load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('online', load);
      window.removeEventListener('focus', load);
    };
  }, [userId, deckId]);

  const save = useCallback((rating, reason = null) =>
    saveRating(userId, cardId, rating, reason), [userId, cardId]);

  return { userId, value, busy, save };
}
