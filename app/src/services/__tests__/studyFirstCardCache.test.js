import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { nativeCard } from '../../utils/__tests__/nativeFixture.js';
import { getLocalDb, resetAllDatabases } from '../localDb.js';
import * as localDb from '../localDb.js';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      return next(`${specifier}.js`, context);
    }
    throw error;
  }
} });
mock.module('../apiConfig.js', { namedExports: { API_BASE_URL: '/api', mediaURL: value => value } });
mock.module('../localDb.js', { namedExports: { ...localDb, isOfflineMode: () => false } });

let user = '1', respond;
globalThis.window = { location: { search: '' } };
globalThis.localStorage = { getItem: key => key === 'lerne_user_id' ? user : null };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
mock.module('../networkApi.js', { namedExports: { networkApi: { get: (...args) => respond(...args) } } });
const { default: api } = await import('../api.js');
const card = () => nativeCard('standard', { id: 7, deck_id: 5, revision: 'server-revision', position: 1,
  queue: 'new', intervals: { 2: '10 min' } });
beforeEach(async () => {
  user = '1'; navigator.onLine = true;
  respond = async () => ({ data: card() });
  await getLocalDb().decks.put({ id: 5, user_id: 1, role: 'owner', name: 'Synthetic' });
});
afterEach(async () => {
  resetAllDatabases();
  for (const row of await indexedDB.databases()) await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(row.name); request.onsuccess = resolve; request.onerror = reject;
  });
});

test('next persists the first native card before returning; immediate offline grade is durable', async () => {
  const result = await api.get('/decks/5/next?review_context=scheduled');
  assert.equal(result.data.id, 7);
  assert.equal((await getLocalDb().cards.get(7)).revision, 'server-revision');
  navigator.onLine = false;
  const grade = await api.post('/study/grade', { card_id: 7, deck_id: 5, grade: 2,
    action_id: crypto.randomUUID(), return_next: false });
  assert.equal(grade.data.status, 'success');
  assert.equal((await getLocalDb().progress.get([7, 1])).is_dirty, 1);
  assert.equal((await getLocalDb().syncState.filter(row => row.key.startsWith('review:')).toArray()).length, 1);
});

for (const fields of [{ offline_edit: { status: 'pending' } }, { offline_move: { status: 'pending' } },
  { offline_read_started_at: Date.now() + 60000 }]) {
  test(`next preserves protected local content: ${Object.keys(fields)[0]}`, async () => {
    const local = { ...card(), revision: 'local-revision', ...fields };
    await getLocalDb().cards.put(local);
    const result = await api.get('/decks/5/next');
    assert.equal(result.data.revision, 'local-revision');
    assert.deepEqual(await getLocalDb().cards.get(7), local);
  });
}

test('next never resurrects a pending local deletion', async () => {
  await getLocalDb().cards.put({ ...card(), is_deleted: true, offline_lifecycle: { status: 'pending' } });
  const result = await api.get('/decks/5/next');
  assert.equal(result.data.finished, true);
  assert.equal((await getLocalDb().cards.get(7)).is_deleted, true);
});

test('late next response cannot cache a card after account switching', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  respond = async () => { started(); await gate; return { data: card() }; };
  const original = getLocalDb();
  const request = api.get('/decks/5/next');
  await entered; user = '2'; release();
  await assert.rejects(request, /Session changed/);
  assert.equal(await original.cards.count(), 0);
  assert.equal(await getLocalDb().cards.count(), 0);
});
