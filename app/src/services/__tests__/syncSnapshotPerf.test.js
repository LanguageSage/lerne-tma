import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { registerHooks } from 'node:module';
import { inspectCardCutover, inspectCutoverDatabase } from '../cardCutoverPreflight.js';
import { nativeCard } from '../../utils/__tests__/nativeFixture.js';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      return next(`${specifier}.js`, context);
    }
    throw error;
  }
} });

let user = 1;
const events = [];
const storage = new Map();
globalThis.window = {
  location: { search: '' },
  dispatchEvent: event => events.push({ type: event.type, detail: event.detail }),
};
globalThis.localStorage = {
  get length() { return storage.size; },
  key: index => Array.from(storage.keys())[index] ?? null,
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
Object.defineProperty(globalThis, 'navigator', {
  value: {
    onLine: true,
    locks: { request: (_name, optionsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optionsOrFn)({}) },
  },
  configurable: true,
});

let pullResponse;
mock.module('../apiConfig.js', { namedExports: { API_BASE_URL: '/api', mediaURL: value => value } });
mock.module('../networkApi.js', {
  namedExports: {
    networkApi: {
      get: async url => {
        if (url === '/sync/v2/status') return { data: { server_generation: 'a'.repeat(64), restored: false } };
        if (url === '/sync/v2/pull') return { data: pullResponse() };
        if (url.startsWith('/card-notes')) return { data: { notes: [] } };
        throw new Error(`Unexpected GET ${url}`);
      },
      post: async () => ({ data: { status: 'success', notes: [] } }),
    },
  },
});

const { saveAuthSession, saveUserProfile } = await import('../../utils/auth.js');
const { getLocalDb, resetAllDatabases } = await import('../localDb.js');
const { syncService } = await import('../syncService.js');

const snapshotCard = (id, revision = 'rev-1', front = 'Prompt') => {
  const card = nativeCard('standard', {
    id, deck_id: 5, revision, updated_at: '2026-11-17T10:00:00Z',
  });
  card.content_v2.card.data.prompt = front;
  return card;
};

beforeEach(async () => {
  user = 1;
  events.length = 0;
  storage.clear();
  saveUserProfile({ user_id: user });
  saveAuthSession({ access_token: 'tok', refresh_token: 'ref', account_id: user });
  navigator.onLine = true;
});

afterEach(async () => {
  resetAllDatabases();
  for (const row of await indexedDB.databases()) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(row.name);
      request.onsuccess = resolve;
      request.onerror = reject;
    });
  }
});

test('inspectCardCutover reuses precomputed active database without dropping secondary DB blockers', async () => {
  const active = getLocalDb();
  await active.decks.put({ id: 5, name: 'Deck', is_dirty: 0 });
  const precomputed = await inspectCutoverDatabase(active);

  const staleOther = new Dexie('LerneLocalDB_999');
  staleOther.version(1).stores({ cards: 'id', syncState: 'key' });
  await staleOther.open();
  await staleOther.syncState.put({ key: 'card-edit-v2:1', payload: { request_id: 'r1' } });
  staleOther.close();

  const originalOpen = Dexie.prototype.open;
  const opened = [];
  Dexie.prototype.open = function patchedOpen(...args) {
    opened.push(this.name);
    return originalOpen.apply(this, args);
  };
  try {
    const report = await inspectCardCutover({ precomputed: new Map([[active.name, precomputed]]) });
    assert.deepEqual(opened, ['LerneLocalDB_999']);
    assert.equal(report.pending_free, false);
    assert.equal(report.databases.find(d => d.name === active.name).tables.decks, 1);
    assert.equal(report.databases.find(d => d.name === 'LerneLocalDB_999').blockers['syncState:native_operation'], 1);
  } finally {
    Dexie.prototype.open = originalOpen;
  }
});

test('applySnapshot diffs unchanged cards cleanly and avoids duplicate UI refresh signaling', async () => {
  const db = getLocalDb();
  let cards = [snapshotCard(1, 'r1', 'One'), snapshotCard(2, 'r2', 'Two')];
  pullResponse = () => ({
    status: 'success',
    card_schema: 2,
    server_time: '2026-11-17T12:00:00Z',
    folders: [],
    decks: [{ id: 5, user_id: 1, name: 'Deck', is_dirty: 0 }],
    cards,
    progress: [{ card_id: 1, user_id: 1, interval: 1 }],
  });

  const first = await syncService.sync({ pullOnly: true });
  assert.equal(first.success, true, first.reason);
  const firstStamp = (await db.cards.get(1)).offline_read_started_at;
  assert.equal(typeof firstStamp, 'number');

  // Repeat pull with unchanged card 1, modified card 2, and full sync completion signal.
  await new Promise(r => setTimeout(r, 5));
  events.length = 0;
  cards = [snapshotCard(1, 'r1', 'One'), snapshotCard(2, 'r3', 'Two updated')];
  pullResponse = () => ({
    status: 'success',
    card_schema: 2,
    server_time: '2026-11-17T12:01:00Z',
    folders: [],
    decks: [{ id: 5, user_id: 1, name: 'Deck', is_dirty: 0 }],
    cards,
    progress: [{ card_id: 1, user_id: 1, interval: 1 }],
  });

  let bulkPuts = 0;
  const origBulkPut = db.cards.bulkPut.bind(db.cards);
  db.cards.bulkPut = items => {
    bulkPuts += items.length;
    return origBulkPut(items);
  };
  const second = await syncService.sync();
  assert.equal(second.success, true, second.reason);
  assert.equal(bulkPuts, 1);
  assert.equal((await db.cards.get(1)).offline_read_started_at, firstStamp);
  assert.equal((await db.cards.get(2)).content_v2.card.data.prompt, 'Two updated');

  const syncedEvents = events.filter(e => e.type === 'lerne:synced').map(e => e.detail);
  assert.deepEqual(syncedEvents.map(d => ({ complete: d.complete, alreadyRefreshed: d.alreadyRefreshed ?? false })), [
    { complete: false, alreadyRefreshed: false },
    { complete: true, alreadyRefreshed: true },
  ]);
});
