import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { getLocalDb } from '../services/localDb.js';
import { refreshCardNotes } from '../services/cardNotes.js';
import { useUiStore } from '../store/useUiStore.js';
import { getUserId } from '../utils/auth.js';

export function useCardNotes(cardId, refresh = false) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const [state, setState] = useState({});
  const reload = useCallback(async () => {
    if (cardId == null) return;
    setState(s => ({ ...(s.cardId === cardId && s.userId === userId ? s : { cardId, userId, rows: [] }), loading: true }));
    try {
      await refreshCardNotes(cardId);
      setState(s => s.cardId === cardId && s.userId === userId ? { ...s, error: null, loading: false } : s);
    } catch (error) {
      setState(s => s.cardId === cardId && s.userId === userId ? { ...s, error, loading: false } : s);
      throw error;
    }
  }, [cardId, userId]);
  useEffect(() => {
    if (cardId == null) return;
    let cancelled = false;
    const db = getLocalDb();
    const subscription = liveQuery(() => db.card_notes.where('card_id').equals(cardId)
      .filter(row => !row.is_deleted && String(row.user_id) === String(userId)).toArray()).subscribe({
      next: rows => { if (!cancelled) setState(s => ({ ...s, cardId, userId, rows })); },
      error: error => { if (!cancelled) setState({ cardId, userId, rows: [], error }); },
    });
    const update = () => {
      if (refresh && !cancelled) reload().catch(() => {});
    };
    update();
    window.addEventListener('lerne:synced', update);
    window.addEventListener('online', update);
    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener('lerne:synced', update);
      window.removeEventListener('online', update);
    };
  }, [cardId, userId, refresh, reload]);
  const current = state.cardId === cardId && state.userId === userId && String(userId) === String(getUserId());
  const rows = current ? state.rows || [] : [];
  const unread = rows.some(row => row.revision > row.seen_revision);
  return { rows, unread, error: current ? state.error : null, loading: current && state.loading, reload,
    active: unread || rows.some(row => row.kind === 'note' || ['new', 'reviewed'].includes(row.status)) };
}
