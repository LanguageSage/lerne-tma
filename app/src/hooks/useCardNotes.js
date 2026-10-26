import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { getLocalDb } from '../services/localDb.js';
import { refreshCardNotes } from '../services/cardNotes.js';
import { useUiStore } from '../store/useUiStore.js';
import { getUserId } from '../utils/auth.js';

export function useCardNotes(cardId, deckId, refresh = false) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const [state, setState] = useState({});
  const reload = useCallback(async (force = true) => {
    if (cardId == null || userId == null) return;
    setState(s => ({ ...s, cardId, userId, loading: true }));
    try {
      await refreshCardNotes(cardId, deckId, force);
      setState(s => s.cardId === cardId && s.userId === userId
        ? { ...s, error: null, loading: false } : s);
    } catch (error) {
      setState(s => s.cardId === cardId && s.userId === userId
        ? { ...s, error, loading: false } : s);
      throw error;
    }
  }, [cardId, deckId, userId]);

  useEffect(() => {
    if (cardId == null || userId == null) return;
    let cancelled = false;
    const db = getLocalDb();
    const subscription = liveQuery(() => db.card_notes.where('card_id').equals(cardId)
      .filter(row => !row.is_deleted && row.kind !== 'suggestion'
        && String(row.user_id) === String(userId)).toArray()).subscribe({
      next: rows => { if (!cancelled) setState(s => ({ ...s, cardId, userId, rows })); },
      error: error => { if (!cancelled) setState({ cardId, userId, rows: [], error }); },
    });
    if (refresh) reload(false).catch(() => {});
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [cardId, userId, refresh, reload]);

  const current = state.cardId === cardId && state.userId === userId
    && String(userId) === String(getUserId());
  const rows = current ? state.rows || [] : [];
  return { rows, error: current ? state.error : null, loading: current && state.loading,
    reload, active: rows.length > 0 };
}
