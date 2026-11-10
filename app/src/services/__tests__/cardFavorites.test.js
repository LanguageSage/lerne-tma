import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { setImmediate } from 'node:timers';

let userId = 1;
let online = false;
const networkApi = {};
mock.module('../networkApi.js', { namedExports: { networkApi } });
mock.module('../../utils/auth.js', { namedExports: { getUserId: () => userId, getAccessToken: () => 'test', getUserProfile: () => ({ user_id: userId }) } });
mock.module('../mediaCache.js', { namedExports: { localMediaURL: async () => null } });
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { location: { search: '' }, dispatchEvent() {} };
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });
const { writeCardFavorite, syncCardFavorites, refreshFavorites, readFavoriteCards } = await import('../cardFavorites.js');
const { prepareLocalDb, resetAllDatabases } = await import('../localDb.js');
const { syncService } = await import('../syncService.js');
const { offlineApi } = await import('../offlineApi.js');
const card = { id: 10, deck_id: 5, front: 'Hallo', back: 'Привет', target_language: 'de' };

beforeEach(async () => {
  resetAllDatabases();
  for (const { name } of await indexedDB.databases()) await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = reject;
  });
  userId = 1; online = false;
  networkApi.get = async () => ({ data: [] });
  networkApi.put = async () => ({ data: {} });
});

test('heart persists offline without dirtying content or changing SRS; removal survives restart', async () => {
  const db = await prepareLocalDb();
  const srs = { card_id: 10, user_id: 1, queue: 'review', interval: 12, repetitions: 7, flag: 2 };
  await db.progress.put(srs);
  await writeCardFavorite(card, true);
  assert.equal((await readFavoriteCards(db, 1, 'de')).length, 1);
  assert.equal((await readFavoriteCards(db, 1, 'uk')).length, 0);
  for (const [key, value] of Object.entries(srs)) assert.equal((await db.progress.get([10, 1]))[key], value);
  assert.equal((await db.cards.get(10)).is_dirty, 0);
  assert.equal((await db.progress.get([10, 1])).is_dirty, undefined);
  await writeCardFavorite(card, false);
  resetAllDatabases();
  const reopened = await prepareLocalDb();
  assert.equal((await reopened.progress.get([10, 1])).want_to_learn, false);
  assert.equal((await reopened.progress.get([10, 1])).favorite_dirty, 1);
  assert.deepEqual(await readFavoriteCards(reopened, 1, 'de'), []);
});

test('a bookmark with incomplete SRS cannot reset a reviewed card during an offline grade', async () => {
  await writeCardFavorite(card, true);
  await assert.rejects(offlineApi.handle('post', '/study/grade', {
    card_id: 10, deck_id: 5, grade: 2, review_context: 'forced', return_next: false,
  }), error => error.code === 'OFFLINE_PROGRESS_UNAVAILABLE');
  const db = await prepareLocalDb();
  assert.equal((await db.progress.get([10, 1])).queue, undefined);
  assert.equal(await db.syncState.filter(row => row.key.startsWith('review:')).count(), 0);
});

test('favoriting a fully loaded study card retains its SRS for offline review', async () => {
  await writeCardFavorite({ ...card, queue: 'review', interval: 12, ease_factor: 2.7,
    repetitions: 5, lapses: 1, step_index: null, next_review: '2099-01-01T00:00:00' }, true);
  const db = await prepareLocalDb();
  const response = await offlineApi.handle('post', '/study/grade', {
    card_id: 10, deck_id: 5, grade: 2, review_context: 'forced', return_next: false,
  });
  assert.equal(response.data.status, 'success');
  const progress = await db.progress.get([10, 1]);
  assert.equal(progress.queue, 'review');
  assert.equal(progress.want_to_learn, true);
  assert.equal(progress.favorite_dirty, 1);
  assert.equal(await db.syncState.filter(row => row.key.startsWith('review:')).count(), 1);
});

test('server receives only the personal mark and retries a failed removal', async () => {
  await writeCardFavorite(card, false);
  const db = await prepareLocalDb();
  networkApi.put = async () => { throw Error('offline'); };
  await assert.rejects(syncCardFavorites(db, 1));
  assert.equal((await db.progress.get([10, 1])).favorite_dirty, 1);
  networkApi.put = async (url, payload) => {
    assert.equal(url, '/cards/10/favorite');
    assert.deepEqual(payload, { want_to_learn: false });
    return { data: payload };
  };
  await syncCardFavorites(db, 1);
  assert.equal((await db.progress.get([10, 1])).favorite_dirty, 0);
});

test('a toggle during a request survives the old acknowledgement', async () => {
  await writeCardFavorite(card, true);
  const db = await prepareLocalDb();
  let release;
  networkApi.put = () => new Promise(resolve => { release = resolve; });
  const sending = syncCardFavorites(db, 1);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await writeCardFavorite(card, false);
  release({ data: {} }); await sending;
  const row = await db.progress.get([10, 1]);
  assert.equal(row.want_to_learn, false);
  assert.equal(row.favorite_dirty, 1);
});

test('refresh protects edits made while a stale favorites list is in flight', async () => {
  online = true;
  let release;
  networkApi.get = () => new Promise(resolve => { release = resolve; });
  const reading = refreshFavorites('de');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await writeCardFavorite(card, true);
  release({ data: [] }); await reading;
  assert.equal((await (await prepareLocalDb()).progress.get([10, 1])).want_to_learn, true);
});

test('accounts are isolated and an old response cannot clear the pending mark', async () => {
  await writeCardFavorite(card, true);
  const db = await prepareLocalDb();
  networkApi.put = async () => { userId = 2; return { data: {} }; };
  await syncCardFavorites(db, 1);
  assert.equal((await db.progress.get([10, 1])).favorite_dirty, 1);
  assert.deepEqual(await readFavoriteCards(await prepareLocalDb(), 2, 'de'), []);
});

test('deleted decks/cards are excluded and temporary IDs wait for entity sync', async () => {
  await writeCardFavorite({ ...card, id: -10 }, true);
  const db = await prepareLocalDb();
  let calls = 0;
  networkApi.put = async () => { calls++; return { data: {} }; };
  await syncCardFavorites(db, 1);
  assert.equal(calls, 0);
  await db.cards.update(-10, { is_deleted: true });
  assert.deepEqual(await readFavoriteCards(db, 1, 'de'), []);
  await db.cards.update(-10, { is_deleted: false });
  await db.decks.put({ id: 5, target_language: 'de', is_deleted: true });
  assert.deepEqual(await readFavoriteCards(db, 1, 'de'), []);
});

const snapshot = progress => ({ status: 'success', folders: [], decks: [], cards: [
  { id: 10, deck_id: 5, front_text: 'Hallo', back_text: 'Привет' }], progress, server_time: '2026-11-08T12:00:00Z' });

test('entity snapshot cannot delete a pending favorite after the narrow write fails', async () => {
  await writeCardFavorite(card, true);
  online = true;
  networkApi.put = async () => { throw Error('temporarily unavailable'); };
  networkApi.get = async () => ({ data: snapshot([]) });
  const result = await syncService.sync();
  assert.equal(result.success, true);
  assert.equal(result.favorites_pending, true);
  const row = await (await prepareLocalDb()).progress.get([10, 1]);
  assert.equal(row.want_to_learn, true);
  assert.equal(row.favorite_dirty, 1);
});

test('a stale full pull cannot overwrite a heart saved and acknowledged during the request', async () => {
  const db = await prepareLocalDb();
  await db.progress.put({ card_id: 10, user_id: 1, want_to_learn: false });
  online = true;
  let release;
  networkApi.get = () => new Promise(resolve => { release = resolve; });
  const syncing = syncService.sync();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await writeCardFavorite(card, true);
  release({ data: snapshot([{ card_id: 10, user_id: 1, want_to_learn: false }]) });
  assert.equal((await syncing).success, true);
  assert.equal((await db.progress.get([10, 1])).want_to_learn, true);
});

test('an older persisted entity batch is followed by the current heart without overwriting SRS', async () => {
  await writeCardFavorite(card, false);
  const db = await prepareLocalDb();
  await db.progress.update([10, 1], { favorite_dirty: 0, local_revision: 'old-batch' });
  await db.syncState.put({ key: 'pending', request_id: 'stored-request', userId: 1,
    folders: [], decks: [], cards: [], reviews: [],
    progress: [{ card_id: 10, user_id: 1, want_to_learn: true, local_revision: 'old-batch' }] });
  const sent = [];
  online = true;
  networkApi.post = async (_url, payload) => {
    sent.push(payload.progress[0].want_to_learn);
    return { data: { status: 'success', mappings: { folders: {}, decks: {}, cards: {} } } };
  };
  networkApi.put = async (_url, payload) => { sent.push(payload.want_to_learn); return { data: payload }; };
  networkApi.get = async () => ({ data: snapshot([{ card_id: 10, user_id: 1, want_to_learn: false, interval: 12 }]) });
  assert.equal((await syncService.sync()).success, true);
  assert.deepEqual(sent, [true, false]);
  assert.equal((await db.progress.get([10, 1])).want_to_learn, false);
  assert.equal((await db.progress.get([10, 1])).interval, 12);
});
