import { networkApi } from './api.js';
import { prepareLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';

// This small outbox belongs to the existing account-scoped Dexie database.
// UUIDs make resubmission safe; local_revision protects edits made during a request.
const syncing = new Map();
const fetched = new WeakMap();
export async function syncCardNotes(db, userId, cardId) {
  const previous = syncing.get(db.name) || Promise.resolve();
  const run = () => flushNotes(db, userId, cardId);
  const next = previous.catch(() => {}).then(() => navigator.locks
    ? navigator.locks.request(`lerne-card-notes-${db.name}`, run) : run());
  syncing.set(db.name, next);
  try { await next; }
  finally { if (syncing.get(db.name) === next) syncing.delete(db.name); }
}

async function flushNotes(db, userId, cardId) {
  const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
  const pending = (await db.card_notes.where('is_dirty').equals(1).toArray())
    .filter(row => row.kind !== 'suggestion');
  let firstError;
  for (const row of pending) {
    if (getUserId() !== userId) return;
    if (cardId != null && row.card_id !== cardId) continue;
    const resolvedId = aliases[String(row.card_id)] ?? row.card_id;
    if (resolvedId < 0) continue; // Existing entity sync owns temporary card IDs.
    try {
      const { data } = await networkApi.put(`/card-notes/${resolvedId}/${row.id}`, {
        text: row.text, is_deleted: row.is_deleted,
      });
      if (getUserId() !== userId) return;
      await db.transaction('rw', db.card_notes, async () => {
        if ((await db.card_notes.get(row.id))?.local_revision === row.local_revision) {
          await db.card_notes.put({ ...data, is_dirty: 0, local_revision: row.local_revision });
        }
      });
    } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

export async function refreshCardNotes(cardId, deckId = null, force = true) {
  const userId = getUserId();
  if (userId == null) return;
  const db = await prepareLocalDb();
  if (!navigator.onLine) return;
  const key = deckId == null ? `card:${cardId}` : `deck:${deckId}`;
  let requests = fetched.get(db);
  if (!requests) { requests = new Map(); fetched.set(db, requests); }
  if (!force && requests.has(key)) return requests.get(key);
  const request = fetchNotes(db, userId, cardId, deckId);
  requests.set(key, request);
  await request;
}

async function fetchNotes(db, userId, cardId, deckId) {
  await syncCardNotes(db, userId).catch(() => {}); // Failed writes remain in Dexie; reads still proceed.
  const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
  const resolvedId = aliases[String(cardId)] ?? cardId;
  if ((deckId == null && resolvedId < 0) || getUserId() !== userId) return;
  const { data } = await networkApi.get(deckId == null
    ? `/card-notes/${resolvedId}` : `/card-notes/deck/${deckId}`);
  if (getUserId() !== userId) return;
  await db.transaction('rw', db.card_notes, async () => {
    for (const row of data) {
      const local = await db.card_notes.get(row.id);
      if (!local?.is_dirty && (!local || row.revision >= local.revision)) {
        await db.card_notes.put({ ...row, is_dirty: 0, local_revision: local?.local_revision });
      }
    }
  });
}

export async function writeCardNote(cardId, row) {
  const userId = getUserId();
  if (userId == null) throw new Error('Authentication required');
  const db = await prepareLocalDb();
  const value = await db.transaction('rw', db.card_notes, async () => {
    const previous = row.id ? await db.card_notes.get(row.id) : null;
    if (getUserId() !== userId) throw new Error('Account changed');
    const value = { ...previous, ...row, id: row.id || crypto.randomUUID(), card_id: cardId,
      user_id: userId, revision: previous?.revision || 1,
      is_deleted: row.is_deleted ?? previous?.is_deleted ?? false,
      is_dirty: 1, local_revision: crypto.randomUUID() };
    await db.card_notes.put(value);
    return value;
  });
  // Failure leaves a durable pending row. The caller shows it and offers retry.
  try {
    if (navigator.onLine) await syncCardNotes(db, value.user_id, cardId);
    return value;
  } catch (error) {
    return { ...value, sync_error: error.response?.data?.detail || error.message };
  }
}
