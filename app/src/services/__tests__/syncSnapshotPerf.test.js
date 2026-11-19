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
const requests = [];
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
      get: async (url, options) => {
        requests.push([url, options?.params?.snapshot_version]);
        if (url === '/sync/v2/status') return { data: { server_generation: 'a'.repeat(64), restored: false } };
        if (url === '/sync/v2/pull') return { data: pullResponse(options?.params?.snapshot_version) };
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
  requests.length = 0;
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

test('background sync reuses a checked snapshot across tabs without rewriting or refreshing it', async () => {
  const db = getLocalDb();
  const version = 'b'.repeat(64);
  const state = { server_generation: 'a'.repeat(64), restored: false, card_schema: 2,
    server_time: '2026-11-17T12:00:00Z', snapshot_version: version };
  pullResponse = previous => previous === version ? { ...state, status: 'unchanged' }
    : { ...state, status: 'success', folders: [], decks: [], cards: [snapshotCard(1)], progress: [] };

  assert.equal((await syncService.sync({ background: true })).pull_applied, true);
  assert.equal((await db.syncState.get('lastSync')).snapshotVersion, version);
  const before = await db.cards.get(1);
  await db.syncState.put({ key: 'deck-cards:5', complete: true });
  events.length = 0;

  assert.equal((await syncService.sync({ background: true, recheckMs: 60_000 })).pull_applied, false);
  assert.equal((await syncService.sync({ background: true })).pull_success, true);
  assert.deepEqual(requests, [['/sync/v2/pull', ''], ['/sync/v2/pull', version]]);
  assert.deepEqual(events, []);
  assert.deepEqual(await db.cards.get(1), before);
  assert.equal((await db.syncState.get('deck-cards:5')).complete, true);
});

test('an unchanged response cannot bypass database restore quarantine', async () => {
  const db = getLocalDb();
  const version = 'b'.repeat(64);
  await db.syncState.bulkPut([
    { key: 'serverGeneration', generation: 'a'.repeat(64) },
    { key: 'lastSync', snapshotVersion: version },
  ]);
  await db.cards.put(snapshotCard(1));
  pullResponse = () => ({ status: 'unchanged', card_schema: 2, snapshot_version: version,
    server_generation: 'c'.repeat(64), restored: true });
  const result = await syncService.sync({ background: true });
  assert.equal(result.pull_success, false);
  assert.equal((await db.syncState.get('serverGenerationConflict')).server_generation, 'c'.repeat(64));
  assert.equal(await db.cards.count(), 1);
  assert.deepEqual(events, []);
});

test('a catalogue or due-count change refreshes only the library and keeps the card snapshot intact', async () => {
  const db = getLocalDb();
  const snapshotVersion = 'b'.repeat(64);
  const deckSummaryVersion = 'd'.repeat(64);
  await db.syncState.put({ key: 'lastSync', snapshotVersion, deckSummaryVersion: 'c'.repeat(64) });
  await db.syncState.put({ key: 'deck-cards:5', complete: true });
  pullResponse = () => ({ status: 'unchanged', card_schema: 2, snapshot_version: snapshotVersion,
    deck_summary_version: deckSummaryVersion, server_generation: 'a'.repeat(64), restored: false });

  assert.equal((await syncService.sync({ background: true })).pull_applied, false);
  assert.deepEqual(events.map(event => [event.type, event.detail.libraryOnly]), [['lerne:synced', true]]);
  assert.equal((await db.syncState.get('lastSync')).deckSummaryVersion, deckSummaryVersion);
  assert.equal((await db.syncState.get('deck-cards:5')).complete, true);
  events.length = 0;
  await syncService.sync({ background: true });
  assert.deepEqual(events, []);
});

test('applySnapshot preserves unsynced creates, conflicts, Date diffs, and isolates switched accounts', async () => {
  const db1 = getLocalDb();
  const unsyncedCreate = snapshotCard(-1, 'local-rev', 'Local draft');
  const conflictEdit = {
    ...snapshotCard(10, 'rev-1', 'Offline conflicted'),
    offline_edit: { status: 'conflict', requestId: 'req-10' },
  };
  const cleanServerCard = snapshotCard(11, 'rev-1', 'Before');
  await db1.decks.put({ id: 5, user_id: 1, name: 'Local deck', is_dirty: 1 });
  await db1.cards.bulkPut([unsyncedCreate, conflictEdit, cleanServerCard]);
  await db1.progress.bulkPut([
    { card_id: 11, user_id: 1, interval: 1, sync_marker: new Date('2026-11-17T00:00:00Z') },
    { card_id: 11, user_id: '1', interval: 99 },
  ]);

  pullResponse = () => ({
    status: 'success',
    card_schema: 2,
    server_time: '2026-11-17T12:05:00Z',
    folders: [],
    decks: [{ id: 5, user_id: 1, name: 'Server deck', is_dirty: 0 }],
    cards: [
      snapshotCard(10, 'rev-2', 'Remote update'),
      { ...snapshotCard(11, 'rev-1', 'Before'), server_marker: new Date('2026-11-17T00:00:00Z') },
    ],
    progress: [{ card_id: 11, user_id: 1, interval: 4, sync_marker: new Date('2026-11-18T00:00:00Z') }],
  });

  const res1 = await syncService.sync({ pullOnly: true });
  assert.equal(res1.pull_success, true, res1.reason);
  assert.equal(res1.success, false);
  assert.equal((await db1.cards.get(-1)).content_v2.card.data.prompt, 'Local draft');
  assert.equal((await db1.cards.get(10)).content_v2.card.data.prompt, 'Offline conflicted');
  assert.equal((await db1.cards.get(10)).offline_edit.status, 'conflict');
  assert.equal((await db1.decks.get(5)).name, 'Local deck');
  assert.equal((await db1.progress.get([11, 1])).interval, 4);
  assert.equal((await db1.progress.get([11, 1])).sync_marker.getTime(), new Date('2026-11-18T00:00:00Z').getTime());

  // Updating Date value with identical keys still triggers snapshot update rather than false equality.
  pullResponse = () => ({
    status: 'success',
    card_schema: 2,
    server_time: '2026-11-17T12:06:00Z',
    folders: [],
    decks: [],
    cards: [
      snapshotCard(10, 'rev-2', 'Remote update'),
      { ...snapshotCard(11, 'rev-1', 'Before'), server_marker: new Date('2026-11-19T00:00:00Z') },
    ],
    progress: [{ card_id: 11, user_id: 1, interval: 4, sync_marker: new Date('2026-11-18T00:00:00Z') }],
  });
  const resDate = await syncService.sync({ pullOnly: true });
  assert.equal(resDate.pull_success, true, resDate.reason);
  assert.equal(resDate.success, false);
  assert.equal((await db1.cards.get(11)).server_marker.getTime(), new Date('2026-11-19T00:00:00Z').getTime());

  // Switch active account to user 2 and verify account 1 data remains isolated.
  user = 2;
  saveUserProfile({ user_id: user });
  saveAuthSession({ access_token: 'tok-2', refresh_token: 'ref-2', account_id: user });
  const db2 = getLocalDb();
  assert.notEqual(db2.name, db1.name);
  pullResponse = () => ({
    status: 'success',
    card_schema: 2,
    server_time: '2026-11-17T12:07:00Z',
    folders: [],
    decks: [{ id: 20, user_id: 2, name: 'Account 2 deck', is_dirty: 0 }],
    cards: [snapshotCard(200, 'rev-200', 'Account 2 card')],
    progress: [{ card_id: 200, user_id: 2, interval: 2 }],
  });
  const res2 = await syncService.sync({ pullOnly: true });
  assert.equal(res2.pull_success, true, res2.reason);
  assert.equal(res2.pending.pending_free, true);
  assert.equal(res2.device_pending, true);
  assert.equal((await db2.cards.get(200)).content_v2.card.data.prompt, 'Account 2 card');
  assert.equal(await db2.cards.get(-1), undefined);
  assert.equal((await db1.cards.get(-1)).content_v2.card.data.prompt, 'Local draft');
});
