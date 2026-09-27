import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import "fake-indexeddb/auto";
import { getLocalDb, resetAllDatabases } from '../localDb.js';

// Setup environment for getUserId before importing knowledgeDbService
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

import * as dbService from '../knowledgeDbService.js';

describe('KnowledgeDbService - KI-02', () => {

  beforeEach(async () => {
    resetAllDatabases();
    mockUserId = '123';
    // Clear databases from fake-indexeddb
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = resolve;
          req.onerror = resolve;
        });
      }
    }
  });

  test('Test 1 - Knowledge Item persistence', async () => {
    const item = { id: 1, name: 'Rule 1', language: 'de' };
    await dbService.upsertKnowledgeItem(item);
    const result = await dbService.getKnowledgeItem(1);
    assert.deepStrictEqual(result, item);
  });

  test('Test 2 - bulk KI upsert', async () => {
    const items = [
      { id: 1, name: 'Rule 1' },
      { id: 2, name: 'Rule 2' }
    ];
    await dbService.upsertKnowledgeItems(items);
    
    // Upsert again with modified data
    await dbService.upsertKnowledgeItems([
      { id: 1, name: 'Rule 1 Modified' }
    ]);
    
    const results = await dbService.getKnowledgeItems([1, 2]);
    assert.strictEqual(results.length, 2);
    const item1 = results.find(i => i.id === 1);
    assert.strictEqual(item1.name, 'Rule 1 Modified');
  });

  test('Test 3 - Card ↔ KI mapping', async () => {
    await dbService.upsertCardKnowledgeItems([
      { card_id: 10, knowledge_item_id: 1, role: 'primary' },
      { card_id: 10, knowledge_item_id: 2, role: 'secondary' }
    ]);
    
    const mappings = await dbService.getCardKnowledgeMappings(10);
    assert.strictEqual(mappings.length, 2);

    await dbService.upsertKnowledgeItems([
      { id: 1, name: 'KI 1' },
      { id: 2, name: 'KI 2' }
    ]);
    
    const primary = await dbService.getPrimaryKnowledgeItemForCard(10);
    assert.strictEqual(primary.name, 'KI 1');
  });

  test('Test 4 - User Knowledge State isolation', async () => {
    mockUserId = '111';
    await dbService.upsertUserKnowledgeState({
      user_id: '111',
      knowledge_item_id: 1,
      attempts_count: 5
    });

    mockUserId = '222';
    await dbService.upsertUserKnowledgeState({
      user_id: '222',
      knowledge_item_id: 1,
      attempts_count: 10
    });

    const states222 = await dbService.getUserKnowledgeStates('222');
    assert.strictEqual(states222.length, 1);
    assert.strictEqual(states222[0].attempts_count, 10);
    
    mockUserId = '111';
    const states111 = await dbService.getUserKnowledgeStates('111');
    assert.strictEqual(states111.length, 1);
    assert.strictEqual(states111[0].attempts_count, 5);
  });

  test('Test 5 - Attempt persistence & client_event_id idempotency (Test 6)', async () => {
    mockUserId = '123';
    // Use factory
    const event = dbService.createKnowledgeAttempt({
      user_id: '123',
      knowledge_item_id: 1,
      card_id: 10,
      score: 1
    });
    assert.ok(event.client_event_id);
    
    await dbService.enqueueKnowledgeAttempt(event);
    
    // Idempotency: enqueue again with identical payload
    await dbService.enqueueKnowledgeAttempt(event);
    
    // Idempotency: differing payload throws
    const differingEvent = { ...event, score: 0 };
    await assert.rejects(
      dbService.enqueueKnowledgeAttempt(differingEvent),
      /Conflict: Attempt .* already exists with different payload \(score\)\./
    );
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].client_event_id, event.client_event_id);
    assert.strictEqual(pending[0].score, 1);
  });

  test('Test 7 - user isolation outbox', async () => {
    mockUserId = 'A';
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: 'A',
      knowledge_item_id: 1
    }));

    mockUserId = 'B';
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: 'B',
      knowledge_item_id: 1
    }));

    const pendingB = await dbService.getPendingKnowledgeAttempts('B');
    assert.strictEqual(pendingB.length, 1);
    assert.strictEqual(pendingB[0].user_id, 'B');
  });

  test('Test 8 - successful removal simulation', async () => {
    mockUserId = '123';
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-success',
      knowledge_item_id: 1
    }));
    
    await dbService.markKnowledgeAttemptSyncing('evt-success');
    let pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0); // it's syncing, not pending
    
    await dbService.deleteKnowledgeAttempt('evt-success');
    
    const localDb = getLocalDb();
    const count = await localDb.knowledge_attempt_outbox.where('client_event_id').equals('evt-success').count();
    assert.strictEqual(count, 0);
  });

  test('Test 9 - stale syncing to pending & failed simulation', async () => {
    mockUserId = '123';
    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-syncing',
      knowledge_item_id: 1,
    }));
    await dbService.markKnowledgeAttemptSyncing('evt-syncing');

    await dbService.enqueueKnowledgeAttempt(dbService.createKnowledgeAttempt({
      user_id: '123',
      client_event_id: 'evt-fail',
      knowledge_item_id: 1
    }));
    await dbService.markKnowledgeAttemptSyncing('evt-fail');
    await dbService.markKnowledgeAttemptFailed('evt-fail', 'Network Error');
    
    // Simulate time pass for threshold
    await dbService.resetStaleKnowledgeAttempts(0); // reset all syncing
    
    const localDb = getLocalDb();
    const attemptSyncing = await localDb.knowledge_attempt_outbox.get('evt-syncing');
    assert.strictEqual(attemptSyncing.sync_status, 'pending');

    const attemptFailed = await localDb.knowledge_attempt_outbox.get('evt-fail');
    assert.strictEqual(attemptFailed.sync_status, 'failed'); // should NOT be reset
  });
});

import Dexie from 'dexie';

describe('KnowledgeDbService - Migrations', () => {
  beforeEach(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise(r => { const req = indexedDB.deleteDatabase(db.name); req.onsuccess = r; req.onerror = r; });
      }
    }
    resetAllDatabases();
  });

  test('Migration v3 -> v4', async () => {
    const dbName = 'LerneLocalDB_999';
    const db3 = new Dexie(dbName);
    db3.version(1).stores({ decks: 'id', cards: 'id', progress: '[card_id+user_id]' });
    db3.version(2).stores({ folders: 'id', decks: 'id', cards: 'id', progress: '[card_id+user_id]' });
    db3.version(3).stores({ syncState: 'key', media: 'url' });
    await db3.open();
    await db3.decks.put({ id: 1, name: 'Old Deck' });
    await db3.close();

    // Now open via our localDb.js which applies version 4
    mockUserId = '999';
    const db4 = getLocalDb();
    await db4.open();
    
    // Old data is preserved
    const decks = await db4.decks.toArray();
    assert.strictEqual(decks.length, 1);
    assert.strictEqual(decks[0].name, 'Old Deck');

    // New stores exist and work
    await db4.knowledge_items.put({ id: 99, language: 'en', category: 'vocab' });
    const kis = await db4.knowledge_items.toArray();
    assert.strictEqual(kis.length, 1);
  });
});
