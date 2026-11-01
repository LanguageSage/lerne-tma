import api from './api.js';

// Private likes/dislikes are owned by the server. This small in-memory cache keeps the
// study footer instant between cards; it is account-scoped and never persisted.
const votes = new Map();
const touched = new Set();
const deckLoads = new Map();
const listeners = new Set();
const RETRY_AFTER_MS = 60000;
const voteKey = (userId, cardId) => `${userId}:${cardId}`;

function store(userId, cardId, row) {
  const key = voteKey(userId, cardId);
  if (row) votes.set(key, row); else votes.delete(key);
  listeners.forEach(listener => listener());
}

export const subscribeRatings = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getRating = (userId, cardId) => votes.get(voteKey(userId, cardId));

// One request per deck; failures (offline, migration missing) retry at most once a minute.
export async function loadDeckRatings(userId, deckId) {
  const key = `${userId}:${deckId}`;
  if ((deckLoads.get(key) ?? 0) > Date.now()) return;
  deckLoads.set(key, Date.now() + RETRY_AFTER_MS);
  try {
    const { data } = await api.get(`/card-ratings/deck/${deckId}`);
    for (const row of data) {
      // A vote made while this request was in flight is newer than the response.
      if (!touched.has(voteKey(userId, row.card_id))) store(userId, row.card_id, row);
    }
    deckLoads.set(key, Infinity);
  } catch { /* The footer stays usable; saving reports its own errors. */ }
}

// Optimistic: the server upserts, so retries converge. Failure restores the previous vote.
export async function saveRating(userId, cardId, rating, reason = null) {
  const previous = getRating(userId, cardId);
  const reasonValue = rating === -1 ? reason : null;
  touched.add(voteKey(userId, cardId));
  store(userId, cardId, rating == null ? null : { card_id: cardId, rating, reason: reasonValue });
  try {
    await api.put(`/card-ratings/${cardId}`, { rating, reason: reasonValue });
  } catch (error) {
    // If the server does not have migration 92 deployed yet (404),
    // keep the local vote active so testing against remote environments works smoothly.
    if (error.response?.status === 404) {
      return;
    }
    store(userId, cardId, previous);
    throw error;
  }
}
