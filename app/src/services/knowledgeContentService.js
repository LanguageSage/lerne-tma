import { getLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';
import { resolveAwaitingKnowledgeAttempts } from './knowledgeDbService.js';
import { IS_STANDALONE } from '../utils/standaloneMode.js';

const pending = new WeakMap();

// Capture waits for this exact database's load, even if Study has already moved on.
export function waitForDeckKnowledge(database, deckId) {
  return pending.get(database)?.get(String(deckId));
}

// Content belongs to the account/database that started this request.
export function prepareDeckKnowledge(deckId) {
  if (IS_STANDALONE || import.meta.env?.VITE_KNOWLEDGE_LAYER_ENABLED === 'false') return;
  if (!Number.isInteger(Number(deckId)) || Number(deckId) <= 0) return;
  const userId = getUserId();
  if (!userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const database = getLocalDb();
  let requests = pending.get(database);
  if (!requests) pending.set(database, requests = new Map());
  const key = String(deckId);
  if (requests.has(key)) return requests.get(key);
  const request = loadDeckKnowledge(database, deckId, userId).then(async () => {
    if (getUserId() === userId) await resolveAwaitingKnowledgeAttempts(database, deckId, userId);
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}

async function loadDeckKnowledge(database, deckId, userId) {
  const { default: api } = await import('./api.js');
  const key = `knowledge-content:${deckId}`;
  const cached = await database.syncState.get(key);
  const { data } = await api.get(`/knowledge/decks/${deckId}`, {
    _expectedUserId: userId, params: cached?.revision ? { revision: cached.revision } : {},
  });
  if (getUserId() !== userId) throw new Error('Account changed');
  if (data?.unchanged === true && cached?.revision && data.revision === cached.revision) return;
  if (!Array.isArray(data?.knowledge_items) || !Array.isArray(data?.card_knowledge_items)) {
    throw new Error('Invalid knowledge content');
  }
  await database.transaction('rw', database.cards, database.knowledge_items, database.card_knowledge_items, database.syncState, async () => {
    // Include cached cards so removal also clears old primary links. Older servers omit card_ids.
    const cardIds = [...new Set([
      ...(await database.cards.where('deck_id').equals(Number(deckId)).primaryKeys()),
      ...(data.card_ids ?? []),
      ...data.card_knowledge_items.map(mapping => mapping.card_id),
    ])];
    await database.card_knowledge_items.where('card_id').anyOf(cardIds).delete();
    await database.knowledge_items.bulkPut(data.knowledge_items);
    await database.card_knowledge_items.bulkPut(data.card_knowledge_items);
    if (data.revision) await database.syncState.put({ key, revision: data.revision });
    else await database.syncState.delete(key);
  });
}
