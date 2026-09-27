import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import "fake-indexeddb/auto";

// Mock api.js before dynamically importing the service
mock.module('../api.js', { 
  namedExports: {}, 
  defaultExport: {
    post: async () => ({ data: { results: [] } }) 
  }
});

globalThis.window = { location: { search: '' }, Capacitor: null };
let mockUserId = '123';
globalThis.localStorage = {
  getItem: (key) => {
    if (key === 'lerne_user_id') return mockUserId;
    if (key === 'offline_mode') return 'false';
    if (key === 'lerne_temp_id_counter') return '-1';
    return null;
  },
  setItem: () => {},
  removeItem: () => {}
};

describe('KnowledgeSyncService - KI-03', () => {

  beforeEach(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise(r => { const req = indexedDB.deleteDatabase(db.name); req.onsuccess = r; req.onerror = r; });
      }
    }
    const { resetAllDatabases } = await import('../localDb.js');
    resetAllDatabases();
    mockUserId = '123';
  });

  test('Test A - pending attempt server created -> deleted', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
    const api = (await import('../api.js')).default;
    
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-A',
      knowledge_item_id: 1
    }));
    
    api.post = async () => ({
      data: {
        results: [{ client_event_id: 'evt-A', status: 'created' }]
      }
    });

    await syncKnowledgeAttempts('123');
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0);
  });

  test('Test B - server duplicate -> deleted', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-B',
      knowledge_item_id: 1
    }));
    
    api.post = async () => ({
      data: {
        results: [{ client_event_id: 'evt-B', status: 'duplicate' }]
      }
    });

    await syncKnowledgeAttempts('123');
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0);
  });

  test('Test C - server permanent rejection -> failed', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-C',
      knowledge_item_id: 1
    }));
    
    api.post = async () => ({
      data: {
        results: [{ client_event_id: 'evt-C', status: 'event_conflict' }]
      }
    });

    await syncKnowledgeAttempts('123');
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0); // Not pending anymore
    
    const all = await (await import('../localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].sync_status, 'failed');
  });

  test('Test D - transport errors preserve event (pending)', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-D1',
      knowledge_item_id: 1
    }));
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-D2',
      knowledge_item_id: 1
    }));
    
    // Simulate 401
    api.post = async () => {
      const err = new Error('Auth error');
      err.response = { status: 401 };
      throw err;
    };
    await syncKnowledgeAttempts('123').catch(() => {});
    
    let pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 2);

    // Simulate 422
    api.post = async () => {
      const err = new Error('Validation error');
      err.response = { status: 422 };
      throw err;
    };
    await syncKnowledgeAttempts('123').catch(() => {});
    pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 2);

    // Simulate Network error
    api.post = async () => {
      throw new Error('Network error');
    };
    await syncKnowledgeAttempts('123').catch(() => {});
    pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 2);
  });

  test('Test E - partial result processed per-event', async () => {
    const dbService = await import('../knowledgeDbService.js');
    const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
    const api = (await import('../api.js')).default;

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({ user_id: '123', client_event_id: 'evt-1', knowledge_item_id: 1 }));
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({ user_id: '123', client_event_id: 'evt-2', knowledge_item_id: 1 }));
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({ user_id: '123', client_event_id: 'evt-3', knowledge_item_id: 1 }));
    
    api.post = async () => ({
      data: {
        results: [
          { client_event_id: 'evt-1', status: 'created' },
          { client_event_id: 'evt-2', status: 'event_conflict' },
          { client_event_id: 'evt-3', status: 'duplicate' }
        ]
      }
    });

    await syncKnowledgeAttempts('123');
    
    const all = await (await import('../localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray();
    assert.strictEqual(all.length, 1); // 1 and 3 should be deleted
    assert.strictEqual(all[0].client_event_id, 'evt-2');
    assert.strictEqual(all[0].sync_status, 'failed');
  });
});
