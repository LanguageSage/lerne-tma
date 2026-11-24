import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

let currentUserId = 900001;
let isStandalone = true;

const memStorage = new Map();
globalThis.localStorage = {
  getItem: key => (memStorage.has(key) ? memStorage.get(key) : null),
  setItem: (key, val) => memStorage.set(key, String(val)),
  removeItem: key => memStorage.delete(key),
  clear: () => memStorage.clear(),
};
globalThis.window = {
  location: { search: '', hostname: 'localhost', port: '' },
};

mock.module('../../utils/auth.js', {
  namedExports: {
    getUserId: () => currentUserId,
  },
});

mock.module('../../utils/standaloneMode.js', {
  namedExports: {
    get IS_STANDALONE() { return isStandalone; },
    STANDALONE_DB_PREFIX: 'LerneStandaloneDB',
  },
});

const {
  getLocalDb,
  prepareLocalDb,
  resetAllDatabases,
  onLocalDbBlocked,
} = await import('../localDb.js');

async function clearAllIndexedDbs() {
  const dbs = await indexedDB.databases();
  for (const { name } of dbs) {
    if (!name) continue;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = resolve;
    });
  }
}

function defineV6UpgradeDatabase(dbName) {
  const nextDb = new Dexie(dbName);
  nextDb.version(1).stores({
    decks: 'id, user_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  });
  nextDb.version(2).stores({
    folders: 'id, user_id, name, is_deleted, is_dirty',
    decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  });
  nextDb.version(3).stores({
    syncState: 'key',
    media: 'url',
  });
  nextDb.version(4).stores({
    knowledge_items: 'id, language, category',
    card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
    knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
    user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id',
  });
  nextDb.version(5).stores({ card_notes: 'id, card_id, is_dirty' });
  nextDb.version(6).stores({
    syncState: 'key',
    local_audit_log: 'id, created_at',
  }).upgrade(async (tx) => {
    await tx.table('syncState').put({ key: 'v6_migrated', value: true });
  });
  return nextDb;
}

describe('localDb lifecycle hardening', () => {
  let seq = 0;

  beforeEach(async () => {
    resetAllDatabases();
    memStorage.clear();
    await clearAllIndexedDbs();
    seq += 1;
    currentUserId = 900001 + seq;
    isStandalone = true;
  });

  test('prepareLocalDb explicitly opens Dexie and clears preparation cache on transient open failure', async () => {
    const firstInstance = getLocalDb();
    assert.equal(firstInstance.isOpen(), false);

    const originalOpen = firstInstance.open.bind(firstInstance);
    let openAttempts = 0;
    firstInstance.open = async () => {
      openAttempts += 1;
      if (openAttempts === 1) {
        throw new Error('transient open failure');
      }
      return originalOpen();
    };

    await assert.rejects(() => prepareLocalDb(), /transient open failure/);
    assert.equal(firstInstance.isOpen(), false);

    const retried = await prepareLocalDb();
    assert.equal(retried, firstInstance);
    assert.equal(openAttempts, 2);
    assert.equal(retried.isOpen(), true);
  });

  test('versionchange closes stale connection, evicts caches, and allows clean reopen', async () => {
    const db1 = await prepareLocalDb();
    assert.equal(db1.isOpen(), true);
    await db1.decks.put({
      id: 9101,
      user_id: currentUserId,
      name: 'Pilot Deck',
      is_deleted: 0,
      is_dirty: 0,
    });

    const dbName = db1.name;
    const upgraded = defineV6UpgradeDatabase(dbName);
    await upgraded.open();
    assert.equal(upgraded.verno, 6);
    assert.equal(db1.isOpen(), false);
    await assert.rejects(() => db1.decks.get(9101), { name: 'DatabaseClosedError' });
    upgraded.close();

    const db2 = getLocalDb();
    assert.notEqual(db2, db1);
    assert.equal(db2.isOpen(), false);

    // Reopen at v6 schema on the same underlying store or verify fresh instance creation
    const probe = defineV6UpgradeDatabase(dbName);
    await probe.open();
    const deck = await probe.decks.get(9101);
    assert.equal(deck?.name, 'Pilot Deck');
    probe.close();
  });

  test('versionchange on same schema version evicts caches so subsequent prepareLocalDb reopens cleanly', async () => {
    const db1 = await prepareLocalDb();
    await db1.syncState.put({ key: 'marker', value: 'ok' });

    const otherConn = new Dexie(db1.name);
    otherConn.version(5).stores({
      folders: 'id, user_id, name, is_deleted, is_dirty',
      decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
      cards: 'id, deck_id, front_text, is_deleted, is_dirty',
      progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
      syncState: 'key',
      media: 'url',
      knowledge_items: 'id, language, category',
      card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
      knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
      user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id',
      card_notes: 'id, card_id, is_dirty',
    });

    // Simulate an external versionchange event targeting db1
    db1.on('versionchange').fire({ oldVersion: 50, newVersion: 60 });
    assert.equal(db1.isOpen(), false);
    await assert.rejects(() => db1.syncState.get('marker'), { name: 'DatabaseClosedError' });

    const db2 = await prepareLocalDb();
    assert.notEqual(db2, db1);
    assert.equal(db2.isOpen(), true);
    assert.equal((await db2.syncState.get('marker'))?.value, 'ok');
    otherConn.close();
  });

  test('versionchange firing mid-prepareLocalDb while concurrent caller opens fresh instance returns open handle to both callers', async () => {
    const db1 = getLocalDb();
    const originalOpen = db1.open.bind(db1);
    let signalOpenEntered;
    const openEntered = new Promise((resolve) => {
      signalOpenEntered = resolve;
    });
    let releaseOpen;
    const openGate = new Promise((resolve) => {
      releaseOpen = resolve;
    });

    db1.open = async () => {
      const opened = await originalOpen();
      signalOpenEntered();
      await openGate;
      return opened;
    };

    const firstCall = prepareLocalDb();
    await openEntered;

    // Fire versionchange mid-preparation before firstCall returns
    db1.on('versionchange').fire({ oldVersion: 50, newVersion: 60 });
    assert.equal(db1.isOpen(), false);

    // Concurrent caller triggers a fresh instance while firstCall is still awaiting
    const secondCall = prepareLocalDb();
    releaseOpen();

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    assert.notEqual(firstResult, db1);
    assert.notEqual(secondResult, db1);
    assert.equal(firstResult, secondResult);
    assert.equal(firstResult.isOpen(), true);
    assert.equal(secondResult.isOpen(), true);

    await firstResult.syncState.put({ key: 'concurrent_vc', value: 'ok' });
    assert.equal((await secondResult.syncState.get('concurrent_vc'))?.value, 'ok');
  });

  test('versionchange firing while db.open is pending retries cleanly, while direct db.close mid-open still rejects', async () => {
    const db1 = getLocalDb();
    const originalOpen = db1.open.bind(db1);
    db1.open = () => {
      const openPromise = originalOpen();
      db1.on('versionchange').fire({ oldVersion: 50, newVersion: 60 });
      return openPromise;
    };

    const recovered = await prepareLocalDb();
    assert.notEqual(recovered, db1);
    assert.equal(recovered.isOpen(), true);

    resetAllDatabases();
    seq += 1;
    currentUserId = 900001 + seq;

    const dbDirect = getLocalDb();
    const origDirectOpen = dbDirect.open.bind(dbDirect);
    dbDirect.open = () => {
      const openPromise = origDirectOpen();
      dbDirect.close();
      return openPromise;
    };

    await assert.rejects(() => prepareLocalDb(), { name: 'DatabaseClosedError' });
    const afterDirectClose = await prepareLocalDb();
    assert.notEqual(afterDirectClose, dbDirect);
    assert.equal(afterDirectClose.isOpen(), true);
  });

  test('prepareLocalDb bounds versionchange retries and rejects instead of returning a closed handle', async () => {
    const origProtoOpen = Dexie.prototype.open;
    let openCalls = 0;
    Dexie.prototype.open = async function patchedOpen(...args) {
      openCalls += 1;
      const result = await origProtoOpen.apply(this, args);
      this.on('versionchange').fire({ oldVersion: 50, newVersion: 60 });
      return result;
    };

    try {
      await assert.rejects(() => prepareLocalDb(), { name: 'DatabaseClosedError' });
      assert.equal(openCalls, 4);
    } finally {
      Dexie.prototype.open = origProtoOpen;
    }
  });

  test('blocked listener notifies subscribers safely without throwing unhandled rejections', async () => {
    const db = await prepareLocalDb();
    const received = [];
    const unsubscribeGood = onLocalDbBlocked((info) => {
      received.push(info.name);
    });
    const unsubscribeReject = onLocalDbBlocked(async () => {
      throw new Error('listener async failure');
    });
    const unsubscribeThrow = onLocalDbBlocked(() => {
      throw new Error('listener sync failure');
    });

    // Hold an independent raw IDB connection that does NOT close on versionchange
    // so db.delete() / upgrade triggers a real IDB blocked event.
    const rawConn = await new Promise((resolve, reject) => {
      const req = indexedDB.open(db.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    rawConn.onversionchange = () => {
      // Intentionally keep rawConn open briefly to trigger onblocked
    };

    try {
      const deletePromise = db.delete();
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(received.includes(db.name), true);
      rawConn.close();
      await deletePromise;
    } finally {
      unsubscribeGood();
      unsubscribeReject();
      unsubscribeThrow();
    }
  });

  test('hasBeenClosed and unexpected close evict stale cached instance and recover cleanly', async () => {
    const db1 = await prepareLocalDb();
    await db1.cards.put({
      id: 1000001,
      deck_id: 9101,
      front_text: 'Hallo',
      is_deleted: 0,
      is_dirty: 0,
    });

    db1.close();
    assert.equal(db1.isOpen(), false);
    await assert.rejects(() => db1.cards.get(1000001), { name: 'DatabaseClosedError' });

    const db2 = await prepareLocalDb();
    assert.notEqual(db2, db1);
    assert.equal(db2.isOpen(), true);
    const saved = await db2.cards.get(1000001);
    assert.equal(saved?.front_text, 'Hallo');

    // Also verify getLocalDb() evicts an instance reporting hasBeenClosed() === true
    // even if close() did not fire an eviction event.
    db2.hasBeenClosed = () => true;
    const db3 = getLocalDb();
    assert.notEqual(db3, db2);
    const db3Prepared = await prepareLocalDb();
    assert.equal(db3Prepared, db3);
    assert.equal(db3Prepared.isOpen(), true);
  });

  test('non-destructive v5 -> v6 upgrade preserves all user rows across core tables', async () => {
    const v5Db = await prepareLocalDb();
    const dbName = v5Db.name;

    const folderRow = { id: 5001, user_id: currentUserId, name: 'Alltag', is_deleted: 0, is_dirty: 0 };
    const deckRow = { id: 9101, user_id: currentUserId, folder_id: 5001, name: 'Basis', is_deleted: 0, is_dirty: 0 };
    const cardRow = {
      id: 1000001,
      deck_id: 9101,
      front_text: 'der Tisch',
      back_text: 'стол',
      card_type: 'standard',
      is_deleted: 0,
      is_dirty: 0,
    };
    const progressRow = {
      card_id: 1000001,
      user_id: currentUserId,
      queue: 'review',
      interval: 6,
      ease_factor: 2.5,
      repetitions: 2,
      lapses: 0,
      next_review: '2026-12-01T10:00:00.000Z',
      is_dirty: 1,
    };
    const syncRow = { key: 'grade:act-1', card_id: 1000001, applied: true };
    const noteRow = { id: 'note-1', card_id: 1000001, text: 'der (m.)', is_dirty: 0 };

    await v5Db.folders.put(folderRow);
    await v5Db.decks.put(deckRow);
    await v5Db.cards.put(cardRow);
    await v5Db.progress.put(progressRow);
    await v5Db.syncState.put(syncRow);
    await v5Db.card_notes.put(noteRow);
    resetAllDatabases();

    const v6Db = defineV6UpgradeDatabase(dbName);
    await v6Db.open();
    try {
      assert.equal(v6Db.verno, 6);
      assert.deepEqual(await v6Db.folders.get(5001), folderRow);
      assert.deepEqual(await v6Db.decks.get(9101), deckRow);
      assert.deepEqual(await v6Db.cards.get(1000001), cardRow);
      assert.deepEqual(await v6Db.progress.get([1000001, currentUserId]), progressRow);
      assert.deepEqual(await v6Db.syncState.get('grade:act-1'), syncRow);
      assert.deepEqual(await v6Db.card_notes.get('note-1'), noteRow);
      assert.equal((await v6Db.syncState.get('v6_migrated'))?.value, true);
    } finally {
      v6Db.close();
    }
  });
});
