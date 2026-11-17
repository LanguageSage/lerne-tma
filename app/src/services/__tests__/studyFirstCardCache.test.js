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

test('cold offline grade saves durable progress even when db.decks lacks the deck row', async () => {
  await getLocalDb().decks.delete(5);
  await api.get('/decks/5/next?review_context=scheduled');
  navigator.onLine = false;
  const grade = await api.post('/study/grade', {
    card_id: 7, deck_id: 5, grade: 2, action_id: crypto.randomUUID(),
    return_next: true, include_progress: true,
  });
  assert.equal(grade.data.status, 'success');
  assert.ok(grade.data.next_error);
  assert.equal(grade.data.graded_progress?.id, 7);
  assert.equal((await getLocalDb().progress.get([7, 1])).is_dirty, 1);
  assert.equal((await getLocalDb().syncState.filter(row => row.key.startsWith('review:')).toArray()).length, 1);
});

test('IDB write error on next rejects instead of falling back to offline cache', async () => {
  const db = getLocalDb();
  await db.cards.put({ ...card(), revision: 'stale-local' });
  const originalTransaction = db.transaction.bind(db);
  db.transaction = (mode, ...args) => {
    if (mode === 'rw') throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    return originalTransaction(mode, ...args);
  };
  try {
    await assert.rejects(api.get('/decks/5/next?review_context=scheduled'), /QuotaExceededError/);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('next does not return a card locally moved to another deck', async () => {
  const db = getLocalDb();
  await db.decks.put({ id: 6, user_id: 1, role: 'owner', name: 'Target' });
  await db.cards.put({ ...card(), deck_id: 6, offline_move: { status: 'pending' } });
  const result = await api.get('/decks/5/next');
  assert.equal(result.data.finished, true);
  assert.equal((await db.cards.get(7)).deck_id, 6);
});

test('cold mature card cached without db.progress preserves its SRS state offline', async () => {
  respond = async () => ({
    data: nativeCard('standard', {
      id: 7, deck_id: 5, revision: 'rev-mature', position: 1,
      queue: 'review', interval: 30, ease_factor: 2.6, repetitions: 5, lapses: 0, step_index: 0,
      last_reviewed: '2026-10-01T10:00:00', next_review: '2026-10-31T10:00:00',
      intervals: { 2: '78 days' },
    }),
  });
  await api.get('/decks/5/next?review_context=scheduled');
  assert.equal(await getLocalDb().progress.get([7, 1]), undefined);
  navigator.onLine = false;
  const view = await api.get('/decks/5/next?review_context=scheduled');
  assert.equal(view.data.queue, 'review');
  assert.equal(view.data.interval, 30);
  const grade = await api.post('/study/grade', {
    card_id: 7, deck_id: 5, grade: 2, action_id: crypto.randomUUID(),
    return_next: false, include_progress: true,
  });
  assert.equal(grade.data.graded_progress.queue, 'review');
  assert.equal(grade.data.graded_progress.repetitions, 6);
  assert.ok(grade.data.graded_progress.interval > 30);
});

test('incomplete offline deck cache never returns finished after grading cold card; complete cache can finish', async () => {
  await api.get('/decks/5/next?review_context=scheduled');
  navigator.onLine = false;
  const grade = await api.post('/study/grade', {
    card_id: 7, deck_id: 5, grade: 2, action_id: crypto.randomUUID(),
    return_next: true, include_progress: true,
  });
  assert.equal(grade.data.status, 'success');
  assert.notEqual(grade.data.finished, true);
  assert.ok(grade.data.next_error);
  assert.equal((await getLocalDb().progress.get([7, 1])).is_dirty, 1);
  assert.equal((await getLocalDb().syncState.filter(r => r.key.startsWith('review:')).toArray()).length, 1);
  await assert.rejects(api.get('/decks/5/next?review_context=scheduled'), /список карточек|загружен|синхрониз/i);

  navigator.onLine = true;
  respond = async () => ({ data: [card()] });
  await api.get('/decks/5/cards');
  navigator.onLine = false;
  const completed = await api.get('/decks/5/next?review_context=scheduled');
  assert.equal(completed.data.finished, true);
});
