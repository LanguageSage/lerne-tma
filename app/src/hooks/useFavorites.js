import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { getLocalDb } from '../services/localDb.js';
import { readFavoriteCards, refreshFavorites, writeCardFavorite } from '../services/cardFavorites.js';
import { useUiStore } from '../store/useUiStore.js';
import { getUserId } from '../utils/auth.js';

export function useCardFavorite(card) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const cardId = card?.id;
  useEffect(() => {
    if (cardId == null || userId == null) return;
    const db = getLocalDb();
    const subscription = liveQuery(() => db.progress.get([cardId, userId])).subscribe({
      next: row => setState({ cardId, userId, value: row?.want_to_learn }),
      error: () => setState({ cardId, userId }),
    });
    return () => subscription.unsubscribe();
  }, [cardId, userId]);
  const current = state.cardId === cardId && state.userId === userId;
  const selected = Boolean(current && state.value != null ? state.value : card?.want_to_learn);
  const toggle = async () => {
    if (saving.current) return;
    if (getUserId() !== userId) throw new Error('Account changed');
    saving.current = true; setBusy(true);
    try { return await writeCardFavorite(card, !selected); }
    finally { saving.current = false; setBusy(false); }
  };
  return { selected, busy, toggle };
}

export function useFavorites(language) {
  const userId = useUiStore(s => s.userProfile?.user_id) ?? getUserId();
  const [state, setState] = useState({});
  const [request, setRequest] = useState({});
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setRequest({ userId, language, loading: true });
    try {
      await refreshFavorites(language);
      if (id === requestId.current && getUserId() === userId) setRequest({ userId, language, loading: false });
    } catch (error) {
      if (id === requestId.current && getUserId() === userId) setRequest({ userId, language, error, loading: false });
    }
  }, [userId, language]);
  useEffect(() => {
    if (userId == null) return;
    let active = true;
    const id = ++requestId.current;
    const db = getLocalDb();
    const subscription = liveQuery(() => readFavoriteCards(db, userId, language)).subscribe({
      next: cards => setState({ userId, language, cards }),
      error: error => {
        setState({ userId, language, cards: [] });
        setRequest({ userId, language, error, loading: false });
      },
    });
    refreshFavorites(language).then(
      () => { if (active && id === requestId.current) setRequest({ userId, language, loading: false }); },
      error => { if (active && id === requestId.current) setRequest({ userId, language, error, loading: false }); });
    window.addEventListener('online', reload);
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener('online', reload); };
  }, [userId, language, reload]);
  const current = state.userId === userId && state.language === language;
  const currentRequest = request.userId === userId && request.language === language;
  return { cards: current ? state.cards : [], reload,
    loading: userId != null && (!current || !currentRequest || request.loading), error: currentRequest ? request.error : null };
}
