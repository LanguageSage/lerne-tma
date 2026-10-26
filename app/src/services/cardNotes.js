import { networkApi } from './api.js';
import { prepareLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';

// This small outbox belongs to the existing account-scoped Dexie database.
// UUIDs make resubmission safe; local_revision protects edits made during a request.
const syncing = new Map();
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
  const pending = await db.card_notes.where('is_dirty').equals(1).toArray();
  for (const row of pending) {
    if (getUserId() !== userId) return;
    if (cardId != null && row.card_id !== cardId) continue;
    const resolvedId = aliases[String(row.card_id)] ?? row.card_id;
    if (resolvedId < 0) continue; // Existing entity sync owns temporary card IDs.
    const { data } = await networkApi.put(`/card-notes/${resolvedId}/${row.id}`, {
      kind: row.kind, ...(row.write_text ? { text: row.text } : {}), is_deleted: row.is_deleted,
      seen_revision: row.seen_revision,
    });
    if (getUserId() !== userId) return;
    await db.transaction('rw', db.card_notes, async () => {
      if ((await db.card_notes.get(row.id))?.local_revision === row.local_revision) {
        await db.card_notes.put({ ...data, is_dirty: 0, local_revision: row.local_revision });
      }
    });
  }
}

export async function refreshCardNotes(cardId) {
  const userId = getUserId();
  const db = await prepareLocalDb();
  if (!navigator.onLine) return;
  await syncCardNotes(db, userId, cardId);
  const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
  const resolvedId = aliases[String(cardId)] ?? cardId;
  if (resolvedId < 0 || getUserId() !== userId) return;
  const before = new Map((await db.card_notes.where('card_id').equals(resolvedId).toArray())
    .map(row => [row.id, row.local_revision]));
  const { data } = await networkApi.get(`/card-notes/${resolvedId}`);
  if (getUserId() !== userId) return;
  await db.transaction('rw', db.card_notes, async () => {
    for (const row of data) {
      const local = await db.card_notes.get(row.id);
      if (!local?.is_dirty && local?.local_revision === before.get(row.id)
          && (!local || row.revision >= local.revision)) {
        await db.card_notes.put({ ...row, seen_revision: Math.max(row.seen_revision, local?.seen_revision || 0),
          is_dirty: 0, local_revision: local?.local_revision });
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
      user_id: userId, status: previous?.status || 'new', reply: previous?.reply || '',
      revision: previous?.revision || 1,
      seen_revision: Math.max(row.seen_revision ?? 1, previous?.seen_revision || 0),
      is_deleted: row.is_deleted ?? previous?.is_deleted ?? false,
      write_text: row.text !== undefined || !!(previous?.is_dirty && previous?.write_text),
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
