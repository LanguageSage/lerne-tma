import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/node_modules/zustand/esm/vanilla.mjs';

const source = ['initCacheHelper', 'createDeckSlice', 'createFolderSlice'].map(name => readFileSync(
  new URL(`../../app/src/store/slices/${name}.js`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export const /g, 'const ')).join('\n');
const data = { user_id: 101, decks: [{ id: 1, name: 'Synthetic deck' }], folders: [{ id: 2, parent_id: null }] };

function fixture(cache = data) {
  const values = new Map(cache ? [['lerne_init_cache', JSON.stringify(cache)]] : []);
  let userId = 101;
  const f = { request: async path => ({ data: path === '/decks' ? data.decks : data.folders }) };
  const context = { createStore, getUserId: () => userId,
    storage: { get: key => values.get(key), set: (key, value) => values.set(key, value) },
    localStorage: { getItem: key => values.get(key) },
    api: { get: (...args) => f.request(...args) }, console, setTimeout };
  vm.runInNewContext(`${source}\nglobalThis.subject = createStore((set, get) => ({
    ...createDeckSlice(set, get), ...createFolderSlice(set, get)
  }));`, context);
  return { store: context.subject, values, set userId(value) { userId = value; },
    set request(value) { f.request = value; } };
}

test('cache requires a matching account and accepts legacy user_info ownership without deleting it', () => {
  for (const cache of [{ ...data, user_id: 202 }, { decks: data.decks, folders: data.folders }]) {
    const f = fixture(cache);
    assert.equal(f.store.getState().decks.length, 0);
    assert.equal(f.values.get('lerne_init_cache'), JSON.stringify(cache));
  }
  const f = fixture({ decks: data.decks, folders: data.folders, user_info: { user_id: 101 } });
  assert.equal(f.store.getState().decks.length, 1);
});

test('failed folder load preserves the confirmed pair and stores only safe error metadata', async () => {
  const f = fixture();
  f.request = async path => {
    if (path === '/folders') throw Object.assign(new Error('Synthetic failure'), {
      response: { status: 500 }, config: { headers: { Authorization: 'sensitive-fixture' } } });
    return { data: [{ id: 9 }] };
  };
  await assert.rejects(f.store.getState().fetchDecks(true, 1));
  assert.equal(f.store.getState().decks[0].id, 1);
  assert.equal(f.store.getState().folders[0].id, 2);
  assert.equal(f.store.getState().libraryStatus, 'cached');
  assert.equal(JSON.stringify(f.store.getState().libraryError), '{"status":500}');
  assert.equal(f.values.get('lerne_init_cache'), JSON.stringify(data));
});

test('late responses cannot replace the new account library or cache', async () => {
  const f = fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.request = async () => { await gate; return { data: [{ id: 999 }] }; };
  const request = f.store.getState().fetchDecks(true, 1);
  f.userId = 202;
  f.store.getState().setDecksAndFolders([{ id: 202 }], []);
  release();
  await request;
  assert.equal(f.store.getState().decks[0].id, 202);
  const cache = JSON.parse(f.values.get('lerne_init_cache'));
  assert.equal(cache.user_id, 202);
  assert.equal(cache.decks[0].id, 202);
});

test('malformed success is an error; only valid empty arrays confirm an empty account', async () => {
  const f = fixture(null);
  f.request = async () => ({ data: {} });
  await assert.rejects(f.store.getState().fetchDecks(true, 1));
  assert.equal(f.store.getState().libraryStatus, 'error');
  f.request = async () => ({ data: [] });
  await f.store.getState().fetchDecks(true, 1);
  assert.equal(f.store.getState().libraryStatus, 'ready');
  assert.equal(f.store.getState().decks.length, 0);
});

test('automatic fallback retains the fuller cache while explicit local mode updates its view', () => {
  const f = fixture();
  f.store.getState().setDecksAndFolders([], [], 'cache');
  assert.equal(f.store.getState().decks.length, 1);
  f.store.getState().setDecksAndFolders([{ id: -1 }], [], 'local');
  assert.equal(f.store.getState().decks[0].id, -1);
  assert.equal(f.store.getState().libraryStatus, 'cached');
  assert.equal(f.values.get('lerne_init_cache'), JSON.stringify(data));
});

test('standalone folder fallback cannot replace the saved server folders', async () => {
  const f = fixture();
  f.request = async () => ({ data: [{ id: 99 }], dataSource: 'cache' });
  await f.store.getState().fetchFolders();
  assert.equal(f.store.getState().folders[0].id, 2);
  assert.equal(f.store.getState().libraryStatus, 'cached');
  assert.equal(f.values.get('lerne_init_cache'), JSON.stringify(data));
});

test('standalone local folders update the view without erasing the init cache', async () => {
  const f = fixture();
  f.request = async () => ({ data: [{ id: -2 }], dataSource: 'local' });
  await f.store.getState().fetchFolders();
  assert.equal(f.store.getState().folders[0].id, -2);
  assert.equal(f.values.get('lerne_init_cache'), JSON.stringify(data));
});
