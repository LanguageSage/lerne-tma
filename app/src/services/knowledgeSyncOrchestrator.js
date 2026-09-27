import { syncKnowledgeAttempts, BATCH_SIZE } from './knowledgeSyncService.js';
import { resetStaleKnowledgeAttempts } from './knowledgeDbService.js';

export const MAX_BATCHES_PER_RUN = 5;
export const SYNC_INTERVAL_MS = 60000; // 60 seconds

let currentUserId = null;
let currentGeneration = 0;
let isSyncing = false;
let syncRequested = false;
let periodicTimerId = null;
let listenersAttached = false;
let inFlightPromise = null;

function isKnowledgeLayerEnabled() {
  const env = (typeof import.meta !== 'undefined' && import.meta?.env)
    || (typeof globalThis !== 'undefined' && globalThis.import?.meta?.env);
  if (env && env.VITE_KNOWLEDGE_LAYER_ENABLED === 'false') {
    return false;
  }
  return true;
}

function handleOnline() {
  requestKnowledgeSync({ reason: 'online' });
}

function handleVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    requestKnowledgeSync({ reason: 'visibility' });
  }
}

/**
 * Starts the Knowledge Sync orchestrator for a specific user:
 * - Resets stale in-flight attempts
 * - Attaches browser online and visibilitychange listeners
 * - Starts a 60-second periodic sync timer
 * - Runs startup batch drain
 */
export function startKnowledgeSync(userId) {
  if (!isKnowledgeLayerEnabled()) return Promise.resolve();
  if (!userId) return Promise.resolve();

  const normalizedUserId = String(userId);

  // If already running for this user and listeners/timers are intact, just trigger sync
  if (currentUserId === normalizedUserId && listenersAttached) {
    return requestKnowledgeSync({ reason: 'start_active' });
  }

  // Stop previous user/generation lifecycle
  stopKnowledgeSync();

  currentGeneration++;
  const generation = currentGeneration;
  currentUserId = normalizedUserId;

  // 1. Attach listeners
  if (typeof window !== 'undefined' && !listenersAttached) {
    window.addEventListener('online', handleOnline);
  }
  if (typeof document !== 'undefined' && !listenersAttached) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  listenersAttached = true;

  // 2. Start periodic timer
  periodicTimerId = setInterval(() => {
    requestKnowledgeSync({ reason: 'periodic' });
  }, SYNC_INTERVAL_MS);

  // 3. Stale recovery & startup sync under single inFlightPromise
  inFlightPromise = runStartupCycle(normalizedUserId, generation);
  return inFlightPromise;
}

/**
 * Stops the Knowledge Sync orchestrator:
 * - Increments lifecycle generation token to invalidate any in-flight runs
 * - Clears periodic interval
 * - Detaches browser event listeners
 * - Resets active user state and sync flags
 */
export function stopKnowledgeSync() {
  currentGeneration++;
  currentUserId = null;
  syncRequested = false;
  isSyncing = false;
  inFlightPromise = null;

  if (periodicTimerId) {
    clearInterval(periodicTimerId);
    periodicTimerId = null;
  }

  if (listenersAttached) {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    listenersAttached = false;
  }
}

/**
 * Requests a sync run with single-flight and coalescing semantics.
 * If a sync is already in flight for this user, coalesces into syncRequested = true.
 */
export function requestKnowledgeSync() {
  if (!isKnowledgeLayerEnabled()) return Promise.resolve();
  if (!currentUserId) return Promise.resolve();

  if (isSyncing) {
    syncRequested = true;
    return inFlightPromise || Promise.resolve();
  }

  const generation = currentGeneration;
  const userId = currentUserId;

  inFlightPromise = runDrainCycle(userId, generation);
  return inFlightPromise;
}

async function runStartupCycle(userId, generation) {
  isSyncing = true;
  try {
    try {
      await resetStaleKnowledgeAttempts();
    } catch (err) {
      console.warn('[KnowledgeSyncOrchestrator] Stale recovery warning:', err);
    }

    if (generation === currentGeneration && currentUserId === userId) {
      await performBatches(userId, generation);
    }
  } finally {
    finalizeDrainCycle(userId, generation);
  }
}

/**
 * Performs draining of the user's pending knowledge attempts in batches of up to 100.
 */
async function runDrainCycle(userId, generation) {
  isSyncing = true;
  try {
    await performBatches(userId, generation);
  } finally {
    finalizeDrainCycle(userId, generation);
  }
}

async function performBatches(userId, generation) {
  let batchesCount = 0;
  while (batchesCount < MAX_BATCHES_PER_RUN) {
    // Check generation validity before starting each batch
    if (generation !== currentGeneration || userId !== currentUserId) {
      return;
    }

    const result = await syncKnowledgeAttempts(userId);
    batchesCount++;

    // Transport failure immediately stops this drain cycle
    if (result.transportFailed) {
      break;
    }

    // Selected less than BATCH_SIZE (e.g. 0 or < 100) -> queue is drained
    if (result.selectedCount < BATCH_SIZE) {
      break;
    }
  }
}

function finalizeDrainCycle(userId, generation) {
  if (generation === currentGeneration && userId === currentUserId) {
    isSyncing = false;
    inFlightPromise = null;

    if (syncRequested) {
      syncRequested = false;
      queueMicrotask(() => {
        if (generation === currentGeneration && userId === currentUserId) {
          requestKnowledgeSync({ reason: 'coalesced' });
        }
      });
    }
  }
}

/**
 * Diagnostic accessor for test verification
 */
export function getOrchestratorState() {
  return {
    currentUserId,
    currentGeneration,
    isSyncing,
    syncRequested,
    listenersAttached,
    hasTimer: Boolean(periodicTimerId)
  };
}
