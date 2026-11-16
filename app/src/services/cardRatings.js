import api from './api.js';

// Only server-confirmed snapshots, account-scoped and never persisted offline.
const votes = new Map();
const pending = new Map();
const versions = new Map();
const deckLoads = new Map();
const listeners = new Set();
const REFRESH_MS = 60000;
let revision = 0;
const voteKey = (userId, cardId) => `${userId}:${cardId}`;
const notify = () => listeners.forEach(listener => listener());

function store(key, row) {
  if (row) votes.set(key, row); else votes.delete(key);
  notify();
}

function confirmed(row, cardId) {
  if (!Number.isSafeInteger(cardId) || cardId <= 0
      || row?.card_id !== cardId || ![null, -1, 1].includes(row.rating)
      || !Number.isSafeInteger(row.likes) || row.likes < 0
      || !Number.isSafeInteger(row.dislikes) || row.dislikes < 0) {
    throw new Error('Invalid card rating response');
  }
  return row;
}

export const subscribeRatings = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getRating = (userId, cardId) => votes.get(voteKey(userId, cardId));
export const isRatingBusy = (userId, cardId) => pending.has(voteKey(userId, cardId));

// A single batch per deck, with bounded freshness and in-flight deduplication.
export function loadDeckRatings(userId, deckId, force = false) {
  const deckKey = `${userId}:${deckId}`;
  const cached = deckLoads.get(deckKey);
  if (cached?.promise) return cached.promise;
  if (!force && cached?.until > Date.now()) return Promise.resolve();
  const started = revision;
  const promise = (async () => {
    const { data } = await api.get(`/card-ratings/deck/${deckId}?include_counts=true`, { _expectedUserId: userId });
    if (!Array.isArray(data)) throw new Error('Invalid card ratings response');
    data.forEach(row => confirmed(row, row.card_id));
    for (const row of data) {
      const key = voteKey(userId, row.card_id);
      // Reads started before a write must never resurrect its previous vote.
      if (!pending.has(key) && (versions.get(key) ?? 0) <= started) store(key, row);
    }
  })();
  deckLoads.set(deckKey, { promise });
  return promise.then(() => {
    deckLoads.set(deckKey, { until: Date.now() + REFRESH_MS });
  }, error => {
    deckLoads.delete(deckKey);
    throw error;
  });
}

export async function saveRating(userId, cardId, rating, reason = null) {
  const key = voteKey(userId, cardId);
  // Covers two handlers invoked before React rerenders, and multiple subscribers.
  if (pending.has(key)) throw new Error('Card rating request already pending');
  pending.set(key, true);
  versions.set(key, ++revision);
  notify();
  try {
    const { data } = await api.put(`/card-ratings/${cardId}`, {
      rating, reason: rating === -1 ? reason : null,
    }, { _expectedUserId: userId });
    store(key, confirmed(data, cardId));
  } catch (error) {
    // A write may commit before its response is lost. Invalidate, then reconcile
    // through a read; a failed write must never produce a success notice.
    store(key, null);
    try {
      const { data } = await api.get(`/card-ratings/${cardId}`, { _expectedUserId: userId });
      store(key, confirmed(data, cardId));
    } catch { /* Unknown state remains unselected, with unknown totals. */ }
    throw error;
  } finally {
    versions.set(key, ++revision);
    pending.delete(key);
    notify();
  }
}
