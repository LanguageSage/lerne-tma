import api from './api.js';
import { getLocalDb } from './localDb.js';
import { getUserId } from '../utils/auth.js';

// Content belongs to the account/database that started this request.
export async function prepareDeckKnowledge(deckId) {
  if (import.meta.env?.VITE_KNOWLEDGE_LAYER_ENABLED === 'false') return;
  if (!Number.isInteger(Number(deckId)) || Number(deckId) <= 0) return;
  const userId = getUserId();
  if (!userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const database = getLocalDb();
  const { data } = await api.get(`/knowledge/decks/${deckId}`, { _expectedUserId: userId });
  if (getUserId() !== userId) throw new Error('Account changed');
  if (!Array.isArray(data?.knowledge_items) || !Array.isArray(data?.card_knowledge_items)) {
    throw new Error('Invalid knowledge content');
  }
  await database.transaction('rw', database.cards, database.knowledge_items, database.card_knowledge_items, async () => {
    // Include cached cards so removal also clears old primary links. Older servers omit card_ids.
    const cardIds = [...new Set([
      ...(await database.cards.where('deck_id').equals(Number(deckId)).primaryKeys()),
      ...(data.card_ids ?? []),
      ...data.card_knowledge_items.map(mapping => mapping.card_id),
    ])];
    await database.card_knowledge_items.where('card_id').anyOf(cardIds).delete();
    await database.knowledge_items.bulkPut(data.knowledge_items);
    await database.card_knowledge_items.bulkPut(data.card_knowledge_items);
  });
}
