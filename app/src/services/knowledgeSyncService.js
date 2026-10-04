import api from './api.js';
import { 
  getPendingKnowledgeAttempts,
  markKnowledgeAttemptSyncing,
  deleteKnowledgeAttempt,
  markKnowledgeAttemptFailed,
  markKnowledgeAttemptPending
} from './knowledgeDbService.js';

export const BATCH_SIZE = 100;

/**
 * Synchronizes pending Knowledge Attempts to the backend.
 * Uses batch size of 100.
 * Returns a summary object for orchestration:
 * { selectedCount, succeededCount, failedCount, transportFailed, error }
 */
export async function syncKnowledgeAttempts(userId) {
  if (!userId) {
    return { selectedCount: 0, succeededCount: 0, failedCount: 0, transportFailed: false };
  }

  // 1. Get pending attempts
  const pendingAttempts = await getPendingKnowledgeAttempts(userId, BATCH_SIZE);
  if (!pendingAttempts || pendingAttempts.length === 0) {
    return { selectedCount: 0, succeededCount: 0, failedCount: 0, transportFailed: false };
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
    for (const attempt of batch) {
      await markKnowledgeAttemptPending(attempt.client_event_id);
    }
    return {
      selectedCount: batch.length,
      succeededCount: 0,
      failedCount: 0,
      transportFailed: true,
      error
    };
  }

  // Check malformed response
  const results = response?.data?.results;
  if (!Array.isArray(results)) {
    for (const attempt of batch) {
      await markKnowledgeAttemptPending(attempt.client_event_id);
    }
    return {
      selectedCount: batch.length,
      succeededCount: 0,
      failedCount: 0,
      transportFailed: true,
      error: new Error('Malformed batch response: results array missing')
    };
  }

  // 4. Process per-event results
  let succeededCount = 0;
  let failedCount = 0;
  for (const result of results) {
    if (result.status === 'created' || result.status === 'duplicate') {
      await deleteKnowledgeAttempt(result.client_event_id);
      succeededCount++;
    } else {
      await markKnowledgeAttemptFailed(
        result.client_event_id,
        result.error_code || result.status
      );
      failedCount++;
    }
  }

  return {
    selectedCount: batch.length,
    succeededCount,
    failedCount,
    transportFailed: false
  };
}
