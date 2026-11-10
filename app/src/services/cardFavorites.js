import { networkApi } from './networkApi.js';
import { prepareLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';
import { localMediaURL } from './mediaCache.js';
import { getNextIntervals } from '../utils/srsEngine.js';

const progressFields = ['queue', 'interval', 'ease_factor', 'repetitions', 'lapses',
  'step_index', 'next_review', 'last_reviewed', 'flag'];

const syncing = new Map();
const refreshing = new Map();

// Favorites share the personal progress key, but use a narrow annotation write.
// They must never upload a cached SRS snapshot merely because a heart was tapped.
export async function syncCardFavorites(db, userId) {
  const previous = syncing.get(db.name) || Promise.resolve();
  const run = async () => {
    const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
    const pending = await db.progress.filter(row => row.favorite_dirty).toArray();
    let failure;
    for (const row of pending) {
      if (getUserId() !== userId) return;
      const cardId = aliases[String(row.card_id)] ?? row.card_id;
      if (cardId < 0) continue;
      try {
        await networkApi.put(`/cards/${cardId}/favorite`, { want_to_learn: row.want_to_learn },
          { _expectedUserId: userId });
        if (getUserId() !== userId) return;
        await db.transaction('rw', db.progress, async () => {
          const key = [cardId, userId];
          const oldKey = [row.card_id, userId];
          const current = await db.progress.get(key) || await db.progress.get(oldKey);
          if (current?.favorite_revision === row.favorite_revision) {
            if (row.card_id !== cardId) await db.progress.delete(oldKey);
            await db.progress.put({ ...current, card_id: cardId, favorite_dirty: 0 });
          }
        });
      } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  };
  const next = previous.catch(() => {}).then(() => navigator.locks
    ? navigator.locks.request(`lerne-favorites-${db.name}`, run) : run());
  syncing.set(db.name, next);
  try { await next; }
  finally { if (syncing.get(db.name) === next) syncing.delete(db.name); }
}

export async function writeCardFavorite(card, selected) {
  const userId = getUserId();
  if (userId == null) throw new Error('Authentication required');
  const db = await prepareLocalDb();
  await db.transaction('rw', db.cards, db.progress, async () => {
    if (getUserId() !== userId) throw new Error('Account changed');
    if (!await db.cards.get(card.id)) await db.cards.put({ ...card,
      front_text: card.front_text ?? card.front, back_text: card.back_text ?? card.back,
      is_deleted: false, is_dirty: 0 });
    const key = [card.id, userId];
    const previous = await db.progress.get(key);
    const known = Object.fromEntries(progressFields.filter(field => card[field] !== undefined).map(field => [field, card[field]]));
    await db.progress.put({ ...known, ...previous, card_id: card.id, user_id: userId,
      want_to_learn: selected, favorite_dirty: 1, favorite_revision: crypto.randomUUID() });
  });
  // A failed request retains a durable annotation for retry, including removals.
  if (navigator.onLine) {
    try { await syncCardFavorites(db, userId); }
    catch { return { syncPending: true }; }
  }
  const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
  return { syncPending: Boolean((await db.progress.get([aliases[String(card.id)] ?? card.id, userId]))?.favorite_dirty) };
}

export async function readFavoriteCards(db, userId, language) {
  const marks = await db.progress.where('user_id').equals(userId).filter(p => p.want_to_learn).toArray();
  const cards = await db.cards.bulkGet(marks.map(row => row.card_id));
  const decks = new Map((await db.decks.toArray()).map(deck => [deck.id, deck]));
  const progress = new Map(marks.map(row => [row.card_id, row]));
  const result = [];
  for (const card of cards) {
    if (!card || card.is_deleted) continue;
    const deck = decks.get(card.deck_id);
    if (deck?.is_deleted || (deck?.target_language || card.target_language || 'de') !== language) continue;
    const p = progress.get(card.id);
    result.push({ ...card, ...p, id: card.id, front: card.front_text ?? card.front,
      back: card.back_text ?? card.back, deck_name: deck?.name || card.deck_name,
      intervals: getNextIntervals({ ...card, ...p }, 'forced'),
      image_url: card.image_url || await localMediaURL(db, card.image_path, 'images'),
      audio_url: card.audio_url || await localMediaURL(db, card.audio_path, 'audio'),
      audio_back_url: card.audio_back_url || await localMediaURL(db, card.audio_back_path, 'audio'),
      video_front_url: card.video_front_url || await localMediaURL(db, card.video_front_path, 'videos'),
      video_back_url: card.video_back_url || await localMediaURL(db, card.video_back_path, 'videos') });
  }
  return result.sort((a, b) => (a.deck_id - b.deck_id) || (a.position || 0) - (b.position || 0) || a.id - b.id);
}

export async function refreshFavorites(language) {
  const userId = getUserId();
  if (userId == null || !navigator.onLine) return;
  const db = await prepareLocalDb();
  const key = `${db.name}:${language}`;
  if (refreshing.has(key)) return refreshing.get(key);
  const request = (async () => {
    await syncCardFavorites(db, userId).catch(() => {});
    const versions = new Map((await db.progress.toArray()).map(p => [p.card_id, p.favorite_revision]));
    const { data } = await networkApi.get('/cards/favorites', { params: { target_language: language },
      _expectedUserId: userId });
    if (!Array.isArray(data)) throw new Error('Invalid favorites response');
    if (getUserId() !== userId) return;
    await db.transaction('rw', db.cards, db.progress, db.decks, async () => {
      const incoming = new Set(data.map(card => card.id));
      for (const card of data) {
        const cached = await db.cards.get(card.id);
        if (!cached?.is_dirty) await db.cards.put({ ...cached, ...card,
          front_text: card.front, back_text: card.back, is_deleted: false, is_dirty: 0 });
        const deck = await db.decks.get(card.deck_id);
        if (!deck) await db.decks.put({ id: card.deck_id, name: card.deck_name,
          target_language: card.target_language, role: 'viewer', is_deleted: false, is_dirty: 0 });
        const previous = await db.progress.get([card.id, userId]);
        if (!previous?.favorite_dirty && previous?.favorite_revision === versions.get(card.id)) {
          const fields = Object.fromEntries(progressFields.map(field => [field, card[field]]));
          await db.progress.put({ ...previous, ...(!previous?.is_dirty ? fields : {}),
            card_id: card.id, user_id: userId, want_to_learn: true });
        }
      }
      for (const row of await db.progress.where('user_id').equals(userId).toArray()) {
        if (!row.want_to_learn || row.favorite_dirty || incoming.has(row.card_id)
          || row.favorite_revision !== versions.get(row.card_id) || row.card_id < 0) continue;
        const card = await db.cards.get(row.card_id);
        const deck = card && await db.decks.get(card.deck_id);
        if ((deck?.target_language || card?.target_language || 'de') === language) {
          await db.progress.update([row.card_id, userId], { want_to_learn: false });
        }
      }
    });
  })();
  refreshing.set(key, request);
  try { await request; }
  finally { refreshing.delete(key); }
}
