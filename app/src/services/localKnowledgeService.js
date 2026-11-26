import { cardDuplicateKey } from '../utils/search.js';
import { isKnowledgeKey, isPortableKnowledgeAttempt, studyKnowledgeObservation } from '../utils/knowledgeEvidence.js';
import { getCardKnowledgeMappings } from './knowledgeDbService.js';

const LOCAL = 'local';
export function portableLocalAttempt(row) {
  const { user_id: _user, card_id: _card, sync_status: _status, ...event } = row;
  return event;
}

export async function resolveStudyKnowledgeAttempt(database, cardId, observe) {
  const mappings = await getCardKnowledgeMappings(cardId, database);
  const primary = mappings.find(link => link.role === 'primary' && isKnowledgeKey(link.knowledge_item_id));
  if (!primary) return null;
  const observation = observe();
  if (!observation) return null;
  return {
    ...observation,
    knowledge_item_id: primary.knowledge_item_id,
    complexity: primary.complexity ?? null,
    ability: primary.ability ?? null,
    example_key: primary.example_key ?? null,
  };
}

/** The caller's Dexie transaction owns the commit for Study and other sources. */
export async function writeLocalKnowledgeAttempt(database, userId, cardId, event) {
  if (userId == null || !isPortableKnowledgeAttempt(event)) throw new Error('Invalid local knowledge attempt');
  const existing = await database.knowledge_attempt_outbox.get(event.client_event_id);
  if (existing) {
    if (existing.sync_status !== LOCAL || existing.user_id !== String(userId)
      || cardDuplicateKey(portableLocalAttempt(existing)) !== cardDuplicateKey(event)) {
      throw new Error('Knowledge action already used with different data');
    }
    if (existing.card_id == null && cardId != null) {
      await database.knowledge_attempt_outbox.update(event.client_event_id, { card_id: cardId });
    }
    return false;
  }
  await database.knowledge_attempt_outbox.add({ ...event, card_id: cardId ?? null, user_id: String(userId), sync_status: LOCAL });
  return true;
}

export function readLocalKnowledgeAttempts(database, userId) {
  return database.knowledge_attempt_outbox.where('user_id').equals(String(userId))
    .filter(event => event.sync_status === LOCAL).toArray();
}

export function pendingKnowledgeReceipts(database) {
  return database.syncState.where('key').startsWith('grade:').filter(receipt => receipt.knowledge_pending).toArray();
}

export async function recoverLocalKnowledgeAttempts(database, userId) {
  const receipts = await pendingKnowledgeReceipts(database);
  let remaining = 0;
  for (const { key } of receipts) {
    try {
      await database.transaction('rw', database.syncState, database.cards, database.card_knowledge_items,
        database.knowledge_attempt_outbox, async () => {
          const receipt = await database.syncState.get(key);
          if (!receipt?.knowledge_pending) return;
          const { knowledge_pending: pending, ...resolved } = receipt;
          const { card_id: cardId, observation } = pending;
          let event = pending.event;
          if (!event) {
            const card = await database.cards.get(cardId);
            const current = studyKnowledgeObservation(card, observation.evaluation_data.rating,
              observation.evaluation_data.extended, null, observation.event_time);
            if (current?.task_key !== observation.task_key || current.example_fingerprint !== observation.example_fingerprint) {
              throw new Error('Could not resolve Knowledge mapping for changed material');
            }
            event = await resolveStudyKnowledgeAttempt(database, cardId, () => observation);
          }
          if (event) await writeLocalKnowledgeAttempt(database, userId, cardId, event);
          await database.syncState.put(resolved);
        });
    } catch (error) {
      remaining += 1;
      console.error('[Knowledge] Local grade evidence still pending', key, error);
    }
  }
  return remaining;
}
