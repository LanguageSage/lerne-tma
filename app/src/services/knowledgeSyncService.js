import api from './api.js';
import { 
  getPendingKnowledgeAttempts,
  markKnowledgeAttemptSyncing,
  deleteKnowledgeAttempt,
  markKnowledgeAttemptFailed,
  markKnowledgeAttemptPending
} from './knowledgeDbService.js';

/**
 * Synchronizes pending Knowledge Attempts to the backend.
 * Uses batch size of 100.
 */
export async function syncKnowledgeAttempts(userId) {
  if (!userId) return;

  // 1. Get pending attempts
  const pendingAttempts = await getPendingKnowledgeAttempts(userId, 100);
  if (!pendingAttempts || pendingAttempts.length === 0) {
    return;
  }

  // 2. Mark them as syncing
  const batch = [];
  for (const attempt of pendingAttempts) {
    batch.push({
      client_event_id: attempt.client_event_id,
      knowledge_item_id: attempt.knowledge_item_id,
      card_id: attempt.card_id,
      event_time: attempt.event_time, // already mapped correctly by factory
      evaluation_data: attempt.evaluation_data,
      review_id: attempt.review_id
    });
    await markKnowledgeAttemptSyncing(attempt.client_event_id);
  }

  // 3. Send batch
  let response;
  try {
    response = await api.post('/knowledge/attempts/sync', { attempts: batch });
  } catch (error) {
    // On ANY batch-level HTTP error (401, 403, 400, 422, 5xx, network error),
    // we preserve the events and revert them to pending.
    // Permanent failures are ONLY determined by per-event server responses in the 200 OK payload.
    for (const attempt of batch) {
      await markKnowledgeAttemptPending(attempt.client_event_id);
    }
    // Caller can handle the HTTP error (auth, etc)
    throw error;
  }

  // 4. Process per-event results
  const results = response?.data?.results || [];
  for (const result of results) {
    if (result.status === 'created' || result.status === 'duplicate') {
      await deleteKnowledgeAttempt(result.client_event_id);
    } else {
      await markKnowledgeAttemptFailed(
        result.client_event_id,
        result.error_code || result.status
      );
    }
  }
}
