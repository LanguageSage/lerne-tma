import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getRating, loadDeckRatings, saveRating, subscribeRatings } from '../services/cardRatings.js';
import { useUiStore } from '../store/useUiStore.js';
import { getUserId } from '../utils/auth.js';

export function useCardRating(cardId, deckId) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const value = useSyncExternalStore(subscribeRatings, () => getRating(userId, cardId));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (userId != null && deckId != null) loadDeckRatings(userId, deckId);
  }, [userId, deckId]);

  const save = useCallback(async (rating, reason = null) => {
    setBusy(true);
    try { await saveRating(userId, cardId, rating, reason); }
    finally { setBusy(false); }
  }, [userId, cardId]);

  return { userId, value, busy, save };
}
