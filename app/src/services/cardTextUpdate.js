import { networkApi } from './api';
import { isOfflineMode, prepareLocalDb } from './localDb';
import { tr } from '../i18n/locale';

const pendingKey = (id, folder) => `${folder ? 'folder-text-update' : 'text-update'}:${id}`;
const endpoint = (id, folder) => `/${folder ? 'folders' : 'decks'}/${id}/text-update`;
const requireOnline = () => {
  if (isOfflineMode() || !navigator.onLine) {
    throw new Error(tr('Для обновления колоды подключитесь к серверу и выйдите из автономного режима.'));
  }
};

async function requireSyncedContent(id, cards, folder, requestId) {
  const db = await prepareLocalDb();
  const deckIds = [...new Set(folder ? cards.map(card => card.deck_id).filter(Boolean) : [id])];
  const decks = await db.decks.where('id').anyOf(deckIds).toArray();
  const dirty = await db.cards.where('deck_id').anyOf(deckIds).filter(card => Boolean(card.is_dirty)).count();
  let dirtyFolder = false;
  if (folder) {
    const visited = new Set();
    const ancestors = [id, ...decks.map(deck => deck.folder_id).filter(Boolean)];
    while (ancestors.length) {
      const ancestorId = ancestors.pop();
      if (visited.has(ancestorId)) continue;
      visited.add(ancestorId);
      const ancestor = await db.folders.get(ancestorId);
      if (ancestor?.is_dirty) dirtyFolder = true;
      if (ancestor?.parent_id) ancestors.push(ancestor.parent_id);
    }
  }
  if (dirtyFolder || decks.some(deck => deck.is_dirty) || dirty) {
    throw new Error(tr(folder ? 'Сначала синхронизируйте локальные изменения затронутых колод и папок.' : 'Сначала синхронизируйте локальные изменения колоды.'));
  }
  const attempts = await db.syncState.filter(row => row.key.startsWith('text-update:') || row.key.startsWith('folder-text-update:')).toArray();
  if (attempts.some(row => row.attempt?.payload.request_id !== requestId &&
    (row.key.startsWith('text-update:') ? deckIds.includes(Number(row.key.split(':')[1])) :
      row.attempt?.payload.cards.some(card => deckIds.includes(card.deck_id))))) {
    throw new Error(tr('Сначала проверьте результат предыдущего обновления этих колод.'));
  }
  return db;
}

export async function previewCardTextUpdate(id, cards, { folder = false } = {}) {
  requireOnline();
  await requireSyncedContent(id, cards, folder);
  const response = await networkApi.post(`${endpoint(id, folder)}/preview`, { cards });
  return response.data;
}

export async function readPendingTextUpdate(id, { folder = false } = {}) {
  const db = await prepareLocalDb();
  return (await db.syncState.get(pendingKey(id, folder)))?.attempt || null;
}

/** Durable request identity survives reload and a lost response, including new cards. */
export async function applyCardTextUpdate(id, attempt, { folder = false } = {}) {
  requireOnline();
  const db = await requireSyncedContent(id, attempt.payload.cards, folder, attempt.payload.request_id);
  await db.syncState.put({ key: pendingKey(id, folder), attempt });
  try {
    const response = await networkApi.post(`${endpoint(id, folder)}/apply`, attempt.payload);
    await db.syncState.delete(pendingKey(id, folder));
    return response.data;
  } catch (error) {
    // These responses guarantee that the transaction did not commit.
    if ([403, 404, 409, 422].includes(error.response?.status)) {
      await db.syncState.delete(pendingKey(id, folder));
    }
    throw error;
  }
}
