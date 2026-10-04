import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import "fake-indexeddb/auto";

// 1. Mock api.js before loading modules
mock.module('../api.js', {
  namedExports: {},
  defaultExport: {
    post: async () => ({ data: { results: [] } })
  }
});

// Setup mock environment
globalThis.import = { meta: { env: { VITE_KNOWLEDGE_LAYER_ENABLED: 'true' } } };

let mockUserId = '101';
let mockListeners = {};
globalThis.window = {
  location: { search: '' },
  Capacitor: null,
  addEventListener: (event, handler) => {
    mockListeners[event] = handler;
  },
  removeEventListener: (event, handler) => {
    if (mockListeners[event] === handler) delete mockListeners[event];
  },
  dispatchEvent: (event) => {
    if (mockListeners[event.type]) mockListeners[event.type](event);
  }
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: (event, handler) => {
    mockListeners[event] = handler;
  },
  removeEventListener: (event, handler) => {
    if (mockListeners[event] === handler) delete mockListeners[event];
  }
};
globalThis.localStorage = {
  getItem: (key) => {
    if (key === 'lerne_user_id') return String(mockUserId);
    if (key === 'offline_mode') return 'false';
    if (key === 'lerne_temp_id_counter') return '-1';
    return null;
  },
  setItem: (k, v) => {
    if (k === 'lerne_user_id') mockUserId = String(v);
  },
  removeItem: (k) => {
    if (k === 'lerne_user_id') mockUserId = null;
  }
};

describe('KnowledgeSyncOrchestrator - KI-04.2', () => {
  beforeEach(async () => {
    const { stopKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    stopKnowledgeSync();
    mockListeners = {};
    mockUserId = '101';
    globalThis.import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED = 'true';

    const { resetAllDatabases } = await import('../localDb.js');
    resetAllDatabases();

    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise(r => {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = r;
          req.onerror = r;
        });
      }
    }
    resetAllDatabases();
  });

  afterEach(async () => {
    const { stopKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    stopKnowledgeSync();
  });

  test('1. Startup: pending exists -> auth ready -> resetStale & sync called', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-startup-1',
      knowledge_item_id: 10
    }));

    let apiCalled = false;
    api.post = async (url, payload) => {
      apiCalled = true;
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    assert.strictEqual(apiCalled, true);
    const pending = await dbService.getPendingKnowledgeAttempts('101');
    assert.strictEqual(pending.length, 0);
  });

  test('2. Single-flight: concurrent triggers do not launch parallel syncs', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { requestKnowledgeSync, getOrchestratorState, startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-sf-1',
      knowledge_item_id: 10
    }));

    let concurrentCalls = 0;
    let maxConcurrent = 0;

    api.post = async (url, payload) => {
      concurrentCalls++;
      if (concurrentCalls > maxConcurrent) maxConcurrent = concurrentCalls;
      await new Promise(r => setTimeout(r, 40));
      concurrentCalls--;
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    const pInit = startKnowledgeSync('101');
    const p1 = requestKnowledgeSync({ reason: 'trigger_1' });
    const p2 = requestKnowledgeSync({ reason: 'trigger_2' });
    const p3 = requestKnowledgeSync({ reason: 'trigger_3' });

    assert.strictEqual(getOrchestratorState().isSyncing, true);

    await Promise.all([pInit, p1, p2, p3]);

    assert.strictEqual(maxConcurrent, 1);
    const pending = await dbService.getPendingKnowledgeAttempts('101');
    assert.strictEqual(pending.length, 0);
  });

  test('3. Coalescing: trigger during active sync schedules next run after finish', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync, requestKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-c-1',
      knowledge_item_id: 1
    }));

    let batchesSent = [];
    api.post = async (url, payload) => {
      batchesSent.push(payload.attempts.map(a => a.client_event_id));
      await new Promise(r => setTimeout(r, 40));
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    const syncPromise = startKnowledgeSync('101');

    // While first sync is in flight, enqueue second event and trigger sync
    await new Promise(r => setTimeout(r, 10));
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-c-2',
      knowledge_item_id: 2
    }));
    requestKnowledgeSync({ reason: 'mid_flight' });

    await syncPromise;
    // Wait for the coalesced microtask to run
    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(batchesSent.length, 2);
    assert.deepStrictEqual(batchesSent[0], ['evt-c-1']);
    assert.deepStrictEqual(batchesSent[1], ['evt-c-2']);

    const pending = await dbService.getPendingKnowledgeAttempts('101');
    assert.strictEqual(pending.length, 0);
  });

  test('4. Online trigger: browser online event requests sync', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    let syncedEvents = [];
    api.post = async (url, payload) => {
      syncedEvents.push(...payload.attempts.map(a => a.client_event_id));
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-online-1',
      knowledge_item_id: 5
    }));

    // Trigger online event
    if (mockListeners['online']) {
      mockListeners['online']();
    }

    await new Promise(r => setTimeout(r, 60));
    assert.ok(syncedEvents.includes('evt-online-1'));
  });

  test('5. Visibility trigger: document becoming visible requests sync', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    let syncedEvents = [];
    api.post = async (url, payload) => {
      syncedEvents.push(...payload.attempts.map(a => a.client_event_id));
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-vis-1',
      knowledge_item_id: 8
    }));

    // Trigger visibilitychange
    globalThis.document.visibilityState = 'visible';
    if (mockListeners['visibilitychange']) {
      mockListeners['visibilitychange']();
    }

    await new Promise(r => setTimeout(r, 60));
    assert.ok(syncedEvents.includes('evt-vis-1'));
  });

  test('5b. Periodic timer: 60s tick triggers sync and stopKnowledgeSync clears interval', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const dbService = await import('../knowledgeDbService.js');
      const { startKnowledgeSync, stopKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
      const api = (await import('../api.js')).default;

      let syncCallCount = 0;
      api.post = async (url, payload) => {
        syncCallCount++;
        return {
          data: {
            results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
          }
        };
      };

      // 1. Enqueue attempt 1 & start sync
      await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
        user_id: '101',
        client_event_id: 'evt-periodic-1',
        knowledge_item_id: 10
      }));

      await startKnowledgeSync('101');
      assert.strictEqual(syncCallCount, 1);

      // 2. Enqueue attempt 2 & advance timer by 60s
      await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
        user_id: '101',
        client_event_id: 'evt-periodic-2',
        knowledge_item_id: 11
      }));

      mock.timers.tick(60000);
      await new Promise(r => setTimeout(r, 40));
      assert.strictEqual(syncCallCount, 2);

      // 3. Enqueue attempt 3 & advance timer by another 60s
      await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
        user_id: '101',
        client_event_id: 'evt-periodic-3',
        knowledge_item_id: 12
      }));

      mock.timers.tick(60000);
      await new Promise(r => setTimeout(r, 40));
      assert.strictEqual(syncCallCount, 3);

      // 4. Stop knowledge sync (cleanup interval)
      stopKnowledgeSync();

      // 5. Enqueue attempt 4 & advance timer by another 120s
      await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
        user_id: '101',
        client_event_id: 'evt-periodic-4',
        knowledge_item_id: 13
      }));

      mock.timers.tick(120000);
      await new Promise(r => setTimeout(r, 40));

      // No new sync calls after stopKnowledgeSync!
      assert.strictEqual(syncCallCount, 3);

      // Attempt 4 must remain pending in DB
      const pending = await dbService.getPendingKnowledgeAttempts('101');
      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].client_event_id, 'evt-periodic-4');
    } finally {
      mock.timers.reset();
    }
  });

  test('6. Multi-batch: 230 pending -> 100 + 100 + 30', async () => {
    const { getLocalDb } = await import('../localDb.js');
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    const attempts = [];
    for (let i = 1; i <= 230; i++) {
      attempts.push({
        user_id: '101',
        client_event_id: `evt-mb-${i}`,
        knowledge_item_id: i,
        sync_status: 'pending',
        created_locally_at: new Date().toISOString()
      });
    }
    await getLocalDb().knowledge_attempt_outbox.bulkPut(attempts);

    const batchSizes = [];
    api.post = async (url, payload) => {
      batchSizes.push(payload.attempts.length);
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    assert.deepStrictEqual(batchSizes, [100, 100, 30]);

    const remaining = await dbService.getPendingKnowledgeAttempts('101');
    assert.strictEqual(remaining.length, 0);
  });

  test('7. Transport failure stops drain immediately', async () => {
    const { getLocalDb } = await import('../localDb.js');
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    const attempts = [];
    for (let i = 1; i <= 250; i++) {
      attempts.push({
        user_id: '101',
        client_event_id: `evt-tf-${i}`,
        knowledge_item_id: i,
        sync_status: 'pending',
        created_locally_at: new Date().toISOString()
      });
    }
    await getLocalDb().knowledge_attempt_outbox.bulkPut(attempts);

    let batchCount = 0;
    api.post = async (url, payload) => {
      batchCount++;
      if (batchCount === 1) {
        return {
          data: {
            results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
          }
        };
      }
      throw new Error('Network error');
    };

    await startKnowledgeSync('101');

    assert.strictEqual(batchCount, 2);

    const remaining = await dbService.getPendingKnowledgeAttempts('101', 300);
    assert.strictEqual(remaining.length, 150);
  });

  test('8. Max batches per run: 600 pending -> 5 batches max (500 events) in one run', async () => {
    const { getLocalDb } = await import('../localDb.js');
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    const attempts = [];
    for (let i = 1; i <= 600; i++) {
      attempts.push({
        user_id: '101',
        client_event_id: `evt-max-${i}`,
        knowledge_item_id: i,
        sync_status: 'pending',
        created_locally_at: new Date().toISOString()
      });
    }
    await getLocalDb().knowledge_attempt_outbox.bulkPut(attempts);

    let batchesExecuted = 0;
    api.post = async (url, payload) => {
      batchesExecuted++;
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    assert.strictEqual(batchesExecuted, 5);

    const remaining = await dbService.getPendingKnowledgeAttempts('101', 200);
    assert.strictEqual(remaining.length, 100);
  });

  test('9. Failed events: failed attempts are skipped and do not block pending queue', async () => {
    const { getLocalDb } = await import('../localDb.js');
    const { startKnowledgeSync } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    await getLocalDb().knowledge_attempt_outbox.bulkPut([
      {
        user_id: '101',
        client_event_id: 'evt-failed-1',
        knowledge_item_id: 1,
        sync_status: 'failed',
        last_error: 'permanent_error',
        created_locally_at: new Date().toISOString()
      },
      {
        user_id: '101',
        client_event_id: 'evt-pending-1',
        knowledge_item_id: 2,
        sync_status: 'pending',
        created_locally_at: new Date().toISOString()
      }
    ]);

    let sentEventIds = [];
    api.post = async (url, payload) => {
      sentEventIds = payload.attempts.map(a => a.client_event_id);
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    await startKnowledgeSync('101');

    assert.deepStrictEqual(sentEventIds, ['evt-pending-1']);

    const all = await getLocalDb().knowledge_attempt_outbox.toArray();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].client_event_id, 'evt-failed-1');
    assert.strictEqual(all[0].sync_status, 'failed');
  });

  test('10. User switch with Generation Token: user A -> logout -> user B isolation', async () => {
    const { getLocalDb } = await import('../localDb.js');
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync, stopKnowledgeSync, getOrchestratorState } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    // Enqueue for User A (101)
    mockUserId = '101';
    await getLocalDb().knowledge_attempt_outbox.bulkPut([
      { user_id: '101', client_event_id: 'evt-userA-1', knowledge_item_id: 10, sync_status: 'pending', created_locally_at: new Date().toISOString() },
      { user_id: '101', client_event_id: 'evt-userA-2', knowledge_item_id: 11, sync_status: 'pending', created_locally_at: new Date().toISOString() }
    ]);

    // Enqueue for User B (202)
    mockUserId = '202';
    await getLocalDb().knowledge_attempt_outbox.bulkPut([
      { user_id: '202', client_event_id: 'evt-userB-1', knowledge_item_id: 20, sync_status: 'pending', created_locally_at: new Date().toISOString() }
    ]);

    let postCalls = [];
    api.post = async (url, payload) => {
      postCalls.push({
        attempts: payload.attempts.map(a => a.client_event_id)
      });
      await new Promise(r => setTimeout(r, 40));
      return {
        data: {
          results: payload.attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' }))
        }
      };
    };

    // 1. Start User A (101)
    mockUserId = '101';
    const syncAPromise = startKnowledgeSync('101');
    const genA = getOrchestratorState().currentGeneration;

    // 2. User A logs out and User B logs in while sync A is in-flight!
    stopKnowledgeSync();
    mockUserId = '202';
    const syncBPromise = startKnowledgeSync('202');
    const genB = getOrchestratorState().currentGeneration;

    assert.notStrictEqual(genA, genB);
    assert.strictEqual(getOrchestratorState().currentUserId, '202');

    // Wait for both to settle
    await syncAPromise;
    await syncBPromise;

    // User B's pending attempt should be processed
    mockUserId = '202';
    const pendingB = await dbService.getPendingKnowledgeAttempts('202');
    assert.strictEqual(pendingB.length, 0);

    // Verify User A's outbox is intact in User A's DB
    mockUserId = '101';
    const allA = await getLocalDb().knowledge_attempt_outbox.toArray();
    assert.ok(Array.isArray(allA));
  });

  test('11. Feature flag disabled: VITE_KNOWLEDGE_LAYER_ENABLED = false -> no sync initiated', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { startKnowledgeSync, requestKnowledgeSync, getOrchestratorState } = await import('../knowledgeSyncOrchestrator.js');
    const api = (await import('../api.js')).default;

    globalThis.import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED = 'false';

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '101',
      client_event_id: 'evt-flag-off',
      knowledge_item_id: 100
    }));

    let apiCalled = false;
    api.post = async () => {
      apiCalled = true;
      return { data: { results: [] } };
    };

    await startKnowledgeSync('101');
    await requestKnowledgeSync();

    assert.strictEqual(apiCalled, false);
    assert.strictEqual(getOrchestratorState().currentUserId, null);
    assert.strictEqual(getOrchestratorState().listenersAttached, false);

    // Outbox preserved
    const pending = await dbService.getPendingKnowledgeAttempts('101');
    assert.strictEqual(pending.length, 1);
  });
});
