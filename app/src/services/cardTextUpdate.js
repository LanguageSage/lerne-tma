import { networkApi } from './api';
import { isOfflineMode, prepareLocalDb } from './localDb';
import { tr } from '../i18n/locale';

const pendingKey = deckId => `text-update:${deckId}`;
const requireOnline = () => {
  if (isOfflineMode() || !navigator.onLine) {
    throw new Error(tr('Для обновления колоды подключитесь к серверу и выйдите из автономного режима.'));
  }
};

async function requireSyncedContent(deckId) {
  const db = await prepareLocalDb();
  const deck = await db.decks.get(deckId);
  const dirty = await db.cards.where('deck_id').equals(deckId).filter(card => Boolean(card.is_dirty)).count();
  if (deck?.is_dirty || dirty) throw new Error(tr('Сначала синхронизируйте локальные изменения колоды.'));
  return db;
}

export async function previewCardTextUpdate(deckId, cards) {
  requireOnline();
  await requireSyncedContent(deckId);
  const response = await networkApi.post(`/decks/${deckId}/text-update/preview`, { cards });
  return response.data;
}

export async function readPendingTextUpdate(deckId) {
  const db = await prepareLocalDb();
  return (await db.syncState.get(pendingKey(deckId)))?.attempt || null;
}

/** Durable request identity survives reload and a lost response, including new cards. */
export async function applyCardTextUpdate(deckId, attempt) {
  requireOnline();
  const db = await requireSyncedContent(deckId);
  await db.syncState.put({ key: pendingKey(deckId), attempt });
  try {
    const response = await networkApi.post(`/decks/${deckId}/text-update/apply`, attempt.payload);
    await db.syncState.delete(pendingKey(deckId));
    return response.data;
  } catch (error) {
    // These responses guarantee that the transaction did not commit.
    if ([403, 404, 409, 422].includes(error.response?.status)) {
      await db.syncState.delete(pendingKey(deckId));
    }
    throw error;
  }
}
