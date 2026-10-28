import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/node_modules/zustand/esm/vanilla.mjs';

const source = ['initCacheHelper', 'createDeckSlice', 'createFolderSlice'].map(name => readFileSync(
  new URL(`../../app/src/store/slices/${name}.js`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export const /g, 'const ')).join('\n');
const resetSource = readFileSync(new URL('../../app/src/store/useDeckStore.js', import.meta.url), 'utf8')
  .split('  resetDeckStore: ')[1].split('\n}));')[0].replace(/,\s*$/, '');
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
    ...createDeckSlice(set, get), ...createFolderSlice(set, get), resetDeckStore: ${resetSource}
  }));`, context);
  return { context, store: context.subject, values, set userId(value) { userId = value; },
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('partial cache hydrates missing folders while preserving existing decks and persisted cache', () => {
  const f = fixture({ user_id: 101, decks: data.decks });
  f.store.getState().setDecksAndFolders([{ id: 99 }], data.folders, 'cache');
  assert.equal(f.store.getState().decks[0].id, 1);
  assert.equal(f.store.getState().folders[0].id, 2);
  assert.equal(JSON.parse(f.values.get('lerne_init_cache')).folders, undefined);
});

test('partial cache hydrates missing decks while preserving existing folders', () => {
  const f = fixture({ user_id: 101, folders: data.folders });
  f.store.getState().setDecksAndFolders(data.decks, [{ id: 99 }], 'cache');
  assert.equal(f.store.getState().decks[0].id, 1);
  assert.equal(f.store.getState().folders[0].id, 2);
});

test('simultaneous forced refreshes and folder refresh share one endpoint pair', async () => {
  const f = fixture();
  const gate = deferred(), calls = [];
  f.request = async path => { calls.push(path); await gate.promise; return { data: [] }; };
  const requests = [f.store.getState().fetchDecks(true), f.store.getState().fetchDecks(true),
    f.store.getState().fetchFolders()];
  await Promise.resolve();
  assert.deepEqual(calls, ['/decks', '/folders']);
  gate.resolve();
  await Promise.all(requests);
  assert.equal(f.store.getState().isFetchingDecks, false);
});

test('late folder success from the same account cannot overwrite a newer full refresh or cache', async () => {
  const f = fixture(), old = deferred();
  f.request = () => old.promise;
  const first = f.store.getState().fetchFolders();
  await Promise.resolve();
  f.request = async () => ({ data: [{ id: 88 }] });
  await f.store.getState().fetchDecks(true, 1);
  old.resolve({ data: [{ id: 77 }] });
  await first;
  assert.equal(f.store.getState().folders[0].id, 88);
  assert.equal(JSON.parse(f.values.get('lerne_init_cache')).folders[0].id, 88);
});

test('late folder failure from the same account cannot mark a newer refresh as failed', async () => {
  const f = fixture(), old = deferred();
  f.request = () => old.promise;
  const first = f.store.getState().fetchFolders();
  await Promise.resolve();
  f.request = async () => ({ data: [] });
  await f.store.getState().fetchDecks(true, 1);
  old.reject(new Error('obsolete'));
  await first;
  assert.equal(f.store.getState().libraryStatus, 'ready');
  assert.equal(f.store.getState().libraryError, null);
});

const hookSource = readFileSync(new URL('../../app/src/hooks/useAppInitialization.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export const useAppInitialization', 'const useAppInitialization')
  .replace(/import\.meta\.env\.DEV/g, 'false')
  .replace(/await import\('..\/store\/useLanguageStore'\)/g, 'await Promise.resolve({ useLanguageStore })')
  .replace('  const syncProfile =', '  globalThis.fetchInitData = fetchInitData;\n  const syncProfile =');

function initFixture() {
  const f = fixture(), effects = [];
  const ui = { view: 'cards', loading: false };
  const settings = Object.fromEntries(['setAdminSettings', 'setUserPrompts', 'setIsAdmin', 'setPublishedDesignV2',
    'syncUserSettingsFromServer', 'saveCurrentSettingsToServer'].map(name => [name, () => { effects.push(name); return Promise.resolve(); }]));
  const uiStore = () => ({ setUserProfile() { effects.push('profile'); }, showToast() {} });
  uiStore.getState = () => ui;
  uiStore.setState = value => Object.assign(ui, value);
  const settingsStore = () => settings;
  settingsStore.getState = () => settings;
  Object.assign(f.context, { useEffect() {}, useUiStore: uiStore, useSettingsStore: settingsStore,
    useDeckStore: f.store, useAuthStore: { getState: () => ({ sessionRevision: 1 }) },
    getInterfaceLanguage: () => 'ru', useLanguageStore: { getState: () => ({ syncLanguageFromExternal() {} }) },
    cloudStorage: { set() { effects.push('cloud'); } }, tr: value => value });
  vm.runInNewContext(`${hookSource}\nuseAppInitialization(() => {});`, f.context);
  f.store.setState({ fetchDeckCards: id => { effects.push(['cards', id]); } });
  return { ...f, load: f.context.fetchInitData, ui, effects };
}

test('local init restores saved deck and cards before exit, without server settings/profile/cache writes or refetch', async () => {
  const f = initFixture(), before = f.values.get('lerne_init_cache'), calls = [];
  f.values.set('lerne_current_deck_id', '-1');
  f.context.api.get = async path => { calls.push(path); return { dataSource: 'local',
    data: { decks: [{ id: -1 }], folders: [], settings: {}, prompts: [], is_admin: false } }; };
  await f.load();
  assert.deepEqual(calls, ['/init']);
  assert.deepEqual(f.effects, [['cards', -1]]);
  assert.equal(f.store.getState().currentDeck.id, -1);
  assert.equal(f.values.get('lerne_init_cache'), before);
  assert.equal(f.ui.loading, false);
  assert.equal(f.ui.hasInitialized, true);
});

test('empty local init exits without cold-start refetch or fallback endpoints', async () => {
  const f = initFixture(), calls = [];
  f.context.api.get = async path => { calls.push(path); return { dataSource: 'local', data: { decks: [], folders: [] } }; };
  await f.load();
  assert.deepEqual(calls, ['/init']);
  assert.equal(f.ui.view, 'decks');
  assert.deepEqual(f.effects, []);
});

test('concurrent init calls share one request', async () => {
  const f = initFixture(), gate = deferred(), calls = [];
  f.context.api.get = path => { calls.push(path); return gate.promise; };
  const first = f.load(), second = f.load();
  await Promise.resolve();
  assert.deepEqual(calls, ['/init']);
  gate.resolve({ dataSource: 'local', data: { decks: [], folders: [] } });
  await Promise.all([first, second]);
});

test('late init for the same account cannot overwrite newer library, settings or cache', async () => {
  const f = initFixture(), gate = deferred();
  f.context.api.get = () => gate.promise;
  const first = f.load();
  await Promise.resolve();
  f.context.api.get = async () => ({ data: [{ id: 88 }] });
  await f.store.getState().fetchDecks(true, 1);
  const before = f.values.get('lerne_init_cache');
  gate.resolve({ data: { decks: [{ id: 77 }], folders: [], settings: {} } });
  await first;
  assert.equal(f.store.getState().decks[0].id, 88);
  assert.equal(f.values.get('lerne_init_cache'), before);
  assert.deepEqual(f.effects, []);
});


test('same-account store reset invalidates in-flight success and permits a new refresh', async () => {
  const f = fixture(), old = deferred();
  f.request = () => old.promise;
  const first = f.store.getState().fetchDecks(true, 1);
  await Promise.resolve();
  f.store.getState().resetDeckStore();
  f.request = async () => ({ data: [{ id: 66 }] });
  await f.store.getState().fetchDecks(true, 1);
  old.resolve({ data: [{ id: 55 }] });
  await first;
  assert.equal(f.store.getState().decks[0].id, 66);
  assert.equal(f.store.getState().folders[0].id, 66);
  assert.equal(JSON.parse(f.values.get('lerne_init_cache')).decks[0].id, 66);
});

test('same-account store reset invalidates in-flight failure without erasing new loading state', async () => {
  const f = fixture(), old = deferred(), next = deferred();
  f.request = () => old.promise;
  const first = f.store.getState().fetchDecks(true, 1);
  await Promise.resolve();
  f.store.getState().resetDeckStore();
  f.request = () => next.promise;
  const second = f.store.getState().fetchDecks(true, 1);
  await Promise.resolve();
  old.reject(new Error('obsolete'));
  await first;
  assert.equal(f.store.getState().isFetchingDecks, true);
  assert.equal(f.store.getState().libraryError, null);
  next.resolve({ data: [] });
  await second;
  assert.equal(f.store.getState().libraryStatus, 'ready');
});

test('duplicate standalone folder refreshes share one request', async () => {
  const f = fixture(), gate = deferred(), calls = [];
  f.request = path => { calls.push(path); return gate.promise; };
  const first = f.store.getState().fetchFolders(), second = f.store.getState().fetchFolders();
  await Promise.resolve();
  assert.deepEqual(calls, ['/folders']);
  gate.resolve({ data: [] });
  await Promise.all([first, second]);
});


test('obsolete init failure cannot retry or start a fallback after a newer refresh', async () => {
  const f = initFixture(), old = deferred(), calls = [];
  f.context.api.get = path => { calls.push(path); return old.promise; };
  const first = f.load();
  await Promise.resolve();
  f.context.api.get = async path => { calls.push(path); return { data: [{ id: 88 }] }; };
  await f.store.getState().fetchDecks(true, 1);
  old.reject(new Error('obsolete init'));
  await first;
  assert.deepEqual(calls, ['/init', '/decks', '/folders']);
  assert.equal(f.store.getState().libraryStatus, 'ready');
  assert.equal(f.store.getState().libraryError, null);
});

test('deleting a folder refreshes its library through one endpoint pair', async () => {
  const f = fixture(), calls = [];
  f.context.api.delete = async path => { calls.push(path); };
  f.request = async path => { calls.push(path); return { data: [] }; };
  await f.store.getState().deleteFolder(2);
  assert.deepEqual(calls, ['/folders/2', '/decks', '/folders']);
});
