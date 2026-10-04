import { db } from './localDb.js';


// ----------------------------------------------------------------------
// Knowledge Items (Content Cache)
// ----------------------------------------------------------------------

export async function upsertKnowledgeItem(item) {
  if (!item || !item.id) throw new Error("KnowledgeItem must have an id");
  return db.knowledge_items.put(item);
}

export async function upsertKnowledgeItems(items) {
  if (!items || !items.length) return;
  return db.knowledge_items.bulkPut(items);
}

export async function getKnowledgeItem(id) {
  return db.knowledge_items.get(id);
}

export async function getKnowledgeItems(ids) {
  if (!ids || !ids.length) return [];
  return db.knowledge_items.bulkGet(ids).then(results => results.filter(Boolean));
}

export async function deleteKnowledgeItem(id) {
  return db.knowledge_items.delete(id);
}

// ----------------------------------------------------------------------
// Card ↔ KnowledgeItem Mappings (Content Cache)
// ----------------------------------------------------------------------

export async function upsertCardKnowledgeItem(mapping) {
  if (!mapping || mapping.card_id == null || mapping.knowledge_item_id == null) {
    throw new Error("CardKnowledgeItem mapping must have card_id and knowledge_item_id");
  }
  return db.card_knowledge_items.put(mapping);
}

export async function upsertCardKnowledgeItems(mappings) {
  if (!mappings || !mappings.length) return;
  return db.card_knowledge_items.bulkPut(mappings);
}

export async function getCardKnowledgeMappings(cardId) {
  return db.card_knowledge_items.where('card_id').equals(cardId).toArray();
}

export async function getKnowledgeItemsForCard(cardId) {
  const mappings = await getCardKnowledgeMappings(cardId);
  const kiIds = mappings.map(m => m.knowledge_item_id);
  if (kiIds.length === 0) return [];
  return getKnowledgeItems(kiIds);
}

export async function getPrimaryKnowledgeItemForCard(cardId) {
  const mappings = await getCardKnowledgeMappings(cardId);
  const primaryMapping = mappings.find(m => m.role === 'primary');
  if (!primaryMapping) return null;
  return getKnowledgeItem(primaryMapping.knowledge_item_id);
}

// ----------------------------------------------------------------------
// User Knowledge State (User State Cache)
// ----------------------------------------------------------------------

function validateUserId(userId) {
  if (userId == null) throw new Error("userId is required to prevent data leakage");
  return String(userId);
}

export async function upsertUserKnowledgeState(state) {
  const uId = validateUserId(state.user_id);
  if (state.knowledge_item_id == null) throw new Error("knowledge_item_id is required");
  // ensure types match expected index formats
  const stateToPut = { ...state, user_id: uId };
  return db.user_knowledge_state.put(stateToPut);
}

export async function upsertUserKnowledgeStates(states) {
  if (!states || !states.length) return;
  const validatedStates = states.map(s => ({ ...s, user_id: validateUserId(s.user_id) }));
  return db.user_knowledge_state.bulkPut(validatedStates);
}

export async function getUserKnowledgeState(userId, knowledgeItemId) {
  const uId = validateUserId(userId);
  return db.user_knowledge_state.get([uId, knowledgeItemId]);
}

export async function getUserKnowledgeStates(userId) {
  const uId = validateUserId(userId);
  return db.user_knowledge_state.where('user_id').equals(uId).toArray();
}

export async function deleteUserKnowledgeState(userId, knowledgeItemId) {
  const uId = validateUserId(userId);
  return db.user_knowledge_state.delete([uId, knowledgeItemId]);
}

export async function clearUserKnowledgeState(userId) {
  const uId = validateUserId(userId);
  const keys = await db.user_knowledge_state.where('user_id').equals(uId).primaryKeys();
  return db.user_knowledge_state.bulkDelete(keys);
}

// ----------------------------------------------------------------------
// Knowledge Attempt Outbox (Durable Outbox)
// ----------------------------------------------------------------------

export function createKnowledgeAttempt(payload) {
  if (!payload.user_id) throw new Error("user_id is required");
  if (!payload.knowledge_item_id) throw new Error("knowledge_item_id is required");

  return {
    ...payload,
    client_event_id: payload.client_event_id || crypto.randomUUID(),
    event_time: payload.event_time || new Date().toISOString(),
  };
}

export async function enqueueKnowledgeAttempt(event) {
  const uId = validateUserId(event.user_id);
  const clientEventId = event.client_event_id;
  if (!clientEventId) throw new Error("client_event_id is required for idempotency");

  const newEvent = {
    ...event,
    user_id: uId,
    client_event_id: clientEventId,
    sync_status: event.sync_status || 'pending',
    created_locally_at: event.created_locally_at || new Date().toISOString(),
    retry_count: event.retry_count || 0,
  };

  try {
    await db.knowledge_attempt_outbox.add(newEvent);
    return newEvent;
  } catch (error) {
    if (error.name === 'ConstraintError') {
      const existing = await db.knowledge_attempt_outbox.get(clientEventId);
      if (existing) {
        // Idempotency check: if domain payload differs, reject
        const fieldsToCheck = ['knowledge_item_id', 'card_id', 'score', 'result'];
        for (const field of fieldsToCheck) {
          if (existing[field] !== event[field] && (existing[field] != null || event[field] != null)) {
            throw new Error(`Conflict: Attempt ${clientEventId} already exists with different payload (${field}).`);
          }
        }
        return existing; // NO-OP
      }
    }
    throw error;
  }
}

export async function getPendingKnowledgeAttempts(userId, limit = 50) {
  const uId = validateUserId(userId);
  return db.knowledge_attempt_outbox
    .where('user_id').equals(uId)
    .filter(event => event.sync_status === 'pending')
    .limit(limit)
    .toArray();
}

export async function markKnowledgeAttemptSyncing(clientEventId) {
  return db.knowledge_attempt_outbox.update(clientEventId, { sync_status: 'syncing' });
}

export async function markKnowledgeAttemptFailed(clientEventId, error) {
  const attempt = await db.knowledge_attempt_outbox.get(clientEventId);
  if (!attempt) return;
  return db.knowledge_attempt_outbox.update(clientEventId, {
    sync_status: 'failed',
    last_error: error ? String(error) : 'Unknown error',
    retry_count: (attempt.retry_count || 0) + 1
  });
}

export async function markKnowledgeAttemptPending(clientEventId) {
  return db.knowledge_attempt_outbox.update(clientEventId, { sync_status: 'pending' });
}

export async function deleteKnowledgeAttempt(clientEventId) {
  return db.knowledge_attempt_outbox.delete(clientEventId);
}

export async function resetStaleKnowledgeAttempts(staleTimeMs = 5 * 60 * 1000) {
  const threshold = new Date(Date.now() - staleTimeMs).toISOString();
  
  const syncingEvents = await db.knowledge_attempt_outbox
    .filter(event => (event.sync_status === 'syncing') && (event.created_locally_at < threshold))
    .toArray();

  const updates = syncingEvents.map(event => ({
    ...event,
    sync_status: 'pending'
  }));

  if (updates.length > 0) {
    await db.knowledge_attempt_outbox.bulkPut(updates);
  }
}
