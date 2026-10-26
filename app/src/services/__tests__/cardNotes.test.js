import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { setImmediate } from 'node:timers';

let userId = 1;
let online = false;
const networkApi = { get: async () => ({ data: [] }), put: async () => { throw Error('offline'); } };
mock.module('../api.js', { namedExports: { networkApi } });
mock.module('../../utils/auth.js', { namedExports: { getUserId: () => userId, getAccessToken: () => 'test' } });
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { location: { search: '' }, dispatchEvent() {} };
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });
const { writeCardNote, syncCardNotes, refreshCardNotes } = await import('../cardNotes.js');
const { prepareLocalDb, resetAllDatabases } = await import('../localDb.js');

beforeEach(async () => {
  resetAllDatabases();
  for (const { name } of await indexedDB.databases()) await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = reject;
  });
  userId = 1; online = false;
  networkApi.get = async () => ({ data: [] });
  networkApi.put = async () => { throw Error('offline'); };
});

test('offline create/edit/delete persists across sessions and does not touch cards or SRS', async () => {
  const first = await writeCardNote(10, { kind: 'note', text: 'One' });
  await writeCardNote(10, { id: first.id, kind: 'note', text: 'Two' });
  resetAllDatabases();
  const db = await prepareLocalDb();
  assert.equal((await db.card_notes.get(first.id)).text, 'Two');
  assert.equal(await db.cards.count(), 0);
  assert.equal(await db.progress.count(), 0);
  await writeCardNote(10, { id: first.id, kind: 'note', is_deleted: true });
  assert.equal((await db.card_notes.get(first.id)).is_deleted, true);
});

test('sync uses stable UUID, maps temporary cards and preserves server moderation', async () => {
  const row = await writeCardNote(-10, { kind: 'suggestion', text: 'Fix it' });
  const db = await prepareLocalDb();
  let calls = 0;
  networkApi.put = async (url, payload) => {
    calls++; assert.equal(url, `/card-notes/20/${row.id}`);
    return { data: { ...row, ...payload, card_id: 20, reply: 'Done', status: 'fixed', revision: 2 } };
  };
  online = true;
  await syncCardNotes(db, 1);
  assert.equal(calls, 0);
  await db.syncState.put({ key: 'aliases', mappings: { cards: { '-10': 20 } } });
  await syncCardNotes(db, 1);
  await syncCardNotes(db, 1);
  assert.equal(calls, 1);
  const saved = await db.card_notes.get(row.id);
  assert.equal(saved.card_id, 20); assert.equal(saved.reply, 'Done');
  assert.equal(saved.revision > saved.seen_revision, true);
});

test('an edit during a request survives an old acknowledgement', async () => {
  const row = await writeCardNote(10, { kind: 'note', text: 'Old' });
  const db = await prepareLocalDb();
  let release;
  networkApi.put = () => new Promise(resolve => { release = resolve; });
  const syncing = syncCardNotes(db, 1);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await writeCardNote(10, { ...row, text: 'New' });
  release({ data: row }); await syncing;
  assert.equal((await db.card_notes.get(row.id)).text, 'New');
  assert.equal((await db.card_notes.get(row.id)).is_dirty, 1);
});

test('account switching isolates drafts and rejects responses from the old account', async () => {
  const row = await writeCardNote(10, { kind: 'note', text: 'Private' });
  const firstDb = await prepareLocalDb();
  networkApi.put = async () => { userId = 2; return { data: row }; };
  await syncCardNotes(firstDb, 1);
  assert.equal((await firstDb.card_notes.get(row.id)).is_dirty, 1);
  assert.equal(await (await prepareLocalDb()).card_notes.count(), 0);
});

test('one failed note does not block later records; the draft survives restart and retries with the same UUID', async () => {
  const failed = await writeCardNote(10, { id: '00000000-0000-4000-8000-000000000001', kind: 'note', text: 'Keep draft' });
  const accepted = await writeCardNote(20, { id: '00000000-0000-4000-8000-000000000002', kind: 'note', text: 'Send this' });
  const db = await prepareLocalDb();
  const denied = Object.assign(new Error('Denied'), { response: { status: 403 } });
  const calls = [];
  networkApi.put = async (url, payload) => {
    calls.push(url);
    if (url.includes(failed.id)) throw denied;
    return { data: { ...accepted, ...payload } };
  };
  await assert.rejects(syncCardNotes(db, 1), error => error === denied);
  assert.deepEqual(calls, [`/card-notes/10/${failed.id}`, `/card-notes/20/${accepted.id}`]);
  assert.equal((await db.card_notes.get(accepted.id)).is_dirty, 0);
  resetAllDatabases();
  const reopened = await prepareLocalDb();
  assert.equal((await reopened.card_notes.get(failed.id)).text, 'Keep draft');
  assert.equal((await reopened.card_notes.get(failed.id)).is_dirty, 1);
  networkApi.put = async (url, payload) => {
    assert.equal(url, `/card-notes/10/${failed.id}`);
    return { data: { ...failed, ...payload } };
  };
  await syncCardNotes(reopened, 1);
  assert.equal((await reopened.card_notes.get(failed.id)).is_dirty, 0);
  assert.equal(await reopened.card_notes.count(), 2);
});

test('read acknowledgements omit text and stale refresh cannot restore an unread indicator', async () => {
  const row = await writeCardNote(10, { kind: 'suggestion', text: 'Typo' });
  const db = await prepareLocalDb();
  await db.card_notes.update(row.id, { is_dirty: 0, revision: 2 });
  online = true;
  networkApi.put = async (_url, payload) => {
    assert.equal('text' in payload, false);
    return { data: { ...row, ...payload, revision: 2, seen_revision: 2 } };
  };
  await writeCardNote(10, { id: row.id, kind: 'suggestion', seen_revision: 2 });
  networkApi.get = async () => ({ data: [{ ...row, revision: 2, seen_revision: 1 }] });
  await refreshCardNotes(10);
  assert.equal((await db.card_notes.get(row.id)).seen_revision, 2);
});

test('revoked card annotation access cannot block entity/progress synchronization or erase the draft', async () => {
  const row = await writeCardNote(10, { kind: 'note', text: 'Keep this draft' });
  online = true;
  networkApi.get = async () => ({ data: { status: 'success', server_time: '2026-10-26T10:00:00Z',
    folders: [], decks: [], cards: [], progress: [] } });
  networkApi.put = async () => { throw Object.assign(new Error('Denied'), { response: { status: 403 } }); };
  const { syncService } = await import('../syncService.js');
  const result = await syncService.runSync();
  assert.equal(result.success, true);
  assert.equal(result.card_notes_pending, true);
  const db = await prepareLocalDb();
  assert.equal((await db.card_notes.get(row.id)).is_dirty, 1);
  assert.equal((await db.syncState.get('lastSync')).time, '2026-10-26T10:00:00Z');
});

test('network failure leaves a durable pending row and server refresh does not overwrite a draft', async () => {
  online = true;
  const row = await writeCardNote(10, { kind: 'note', text: 'Pending' });
  assert.equal(row.sync_error, 'offline');
  const db = await prepareLocalDb();
  assert.equal((await db.card_notes.get(row.id)).is_dirty, 1);
  networkApi.put = async (_url, payload) => ({ data: { ...row, ...payload } });
  networkApi.get = async () => {
    online = false;
    await writeCardNote(10, { ...row, text: 'Edited while fetching' });
    return { data: [{ ...row, text: 'Old server version' }] };
  };
  await refreshCardNotes(10);
  assert.equal((await db.card_notes.get(row.id)).text, 'Edited while fetching');
});
