import api from './api.js';
import { getLocalDb, isOfflineMode } from './localDb.js';
import { getUserId } from '../utils/auth.js';
import { assessmentAttempt } from '../utils/assessment.js';

export async function prepareAssessmentKnowledge(deckId) {
  const database = getLocalDb();
  const userId = getUserId();
  if (!isOfflineMode() && navigator.onLine) {
    const { data } = await api.get(`/knowledge/decks/${deckId}`);
    if (getUserId() !== userId) throw new Error('Account changed');
    await database.transaction('rw', database.knowledge_items, database.card_knowledge_items, async () => {
      await database.knowledge_items.bulkPut(data.knowledge_items);
      await database.card_knowledge_items.bulkPut(data.card_knowledge_items);
    });
  }
}

// Result and durable knowledge outbox commit together. No SRS rating is invented.
export async function saveAssessment(session, result) {
  if (String(getUserId()) !== String(session.userId)) throw new Error('Account changed');
  const database = getLocalDb();
  await database.transaction('rw', database.syncState, database.card_knowledge_items,
    database.knowledge_attempt_outbox, async () => {
      if (result) {
        const mapping = await database.card_knowledge_items.where('card_id').equals(result.cardId).filter(m => m.role === 'primary').first();
        if (!mapping) throw new Error('Knowledge mapping unavailable');
        const attempt = assessmentAttempt(session, result, mapping.knowledge_item_id);
        const existing = await database.knowledge_attempt_outbox.get(attempt.client_event_id);
        if (!existing) await database.knowledge_attempt_outbox.add({ ...attempt, user_id: String(session.userId),
          sync_status: 'pending', created_locally_at: result.at, retry_count: 0 });
      }
      await database.syncState.put({ key: `assessment:${session.userId}:${session.deckId}`, session });
    });
}

export async function loadAssessment(userId, deckId) {
  return (await getLocalDb().syncState.get(`assessment:${userId}:${deckId}`))?.session || null;
}
