import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignConfig } from '../designConfig.js';
import { openPersonalDesignRecord, readPersonalDesignRecord,
  reconcilePersonalDesign, editPersonalDesign, acknowledgePersonalDesign, resolveActiveDesign } from '../personalDesignMigration.js';

let owner = 1, failKey = null;
const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem(key, value) { if (key === failKey) throw Error('quota'); memory.set(key, String(value)); },
  removeItem: key => memory.delete(key),
};
const storage = { get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value),
  remove: key => localStorage.removeItem(key) };
const networkApi = { get: async () => ({ data: {} }), post: async () => { throw Error('offline'); } };
mock.module('../../utils/auth.js', { namedExports: { storage, getUserId: () => owner } });
mock.module('../../services/api.js', { defaultExport: networkApi, namedExports: { networkApi } });
const { useSettingsStore } = await import('../../store/useSettingsStore.js');

beforeEach(() => {
  memory.clear(); failKey = null; owner = 1;
  networkApi.get = async () => ({ data: {} });
  networkApi.post = async () => { throw Error('offline'); };
  useSettingsStore.getState().activateSettingsAccount();
  useSettingsStore.setState({ publishedDesignV2: null, adminDraftDesignV2: null, isLocalDesignPreviewActive: false });
});
afterEach(() => { failKey = null; useSettingsStore.getState().activateSettingsAccount(); });

const remoteDoc = (revision = 1, config = normalizeDesignConfig({})) => ({ schemaVersion: 2, revision, config, preset: null });

test('old local settings are ignored; new accounts start in V2 without source backups', () => {
  localStorage.setItem('lerne_card_font', 'Georgia');
  localStorage.setItem('lerne_user_design', '{broken');
  const record = openPersonalDesignRecord(2);
  assert.deepEqual(record.document.config, normalizeDesignConfig(null));
  assert.equal(record.document.preset, null);
  assert.deepEqual(record.backups, {});
  assert.equal(localStorage.getItem('lerne:design-v1-source'), null);
  assert.equal(localStorage.getItem('lerne_card_font'), null);
  assert.equal(localStorage.getItem('lerne_user_design'), null);
});

test('old server settings cannot change V2 or study settings', () => {
  const record = openPersonalDesignRecord(1);
  const next = reconcilePersonalDesign(record, { cardFont: 'Georgia', userDesign: { cardFont: 'serif' } });
  assert.deepEqual(next.document.config, normalizeDesignConfig(null));
  assert.deepEqual(next.backups, {});
  assert.equal(next.pending, true);
});

test('published V2 wins and empty backgrounds inherit personal V2', () => {
  const personal = normalizeDesignConfig({ front: { card: { background: 'dark_mocha' } } });
  const published = normalizeDesignConfig({ front: { mainText: { font: 'Georgia' } } });
  const active = resolveActiveDesign({ personalDesignV2: { config: personal }, publishedDesignV2: { config: published } });
  assert.equal(active.front.mainText.font, 'Georgia');
  assert.equal(active.front.card.background, 'dark_mocha');
  assert.equal(published.front.card.background, '');
});

test('offline edit rebases against another device and preserves unrelated fields', () => {
  let record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: remoteDoc() });
  record = editPersonalDesign(record, { front: { mainText: { font: 'Georgia' } } });
  const remote = remoteDoc(2, normalizeDesignConfig({ back: { answerText: { color: '#123456' } } }));
  const next = reconcilePersonalDesign(record, { designV2: remote });
  assert.equal(next.document.config.front.mainText.font, 'Georgia');
  assert.equal(next.document.config.back.answerText.color, '#123456');
  assert.equal(next.document.revision, 2);
  assert.equal(next.pending, true);
});

test('lost acknowledgement and edits during save preserve pending changes', () => {
  let record = openPersonalDesignRecord(1);
  const sent = record.document;
  record = editPersonalDesign(record, { front: { mainText: { font: 'Georgia' } } });
  const next = acknowledgePersonalDesign(record, sent, { ...sent, revision: 1 });
  assert.equal(next.pending, true);
  assert.equal(next.document.config.front.mainText.font, 'Georgia');
  assert.throws(() => acknowledgePersonalDesign(record, sent, remoteDoc(1, normalizeDesignConfig({ front: { mainText: { font: 'serif' } } }))));
});

test('V2 record write failure remains observable and retry succeeds', () => {
  failKey = 'lerne:personal-design:v2:2';
  assert.throws(() => openPersonalDesignRecord(2), /quota/);
  failKey = null;
  const record = openPersonalDesignRecord(2);
  assert.deepEqual(readPersonalDesignRecord(2), record);
});

test('account switch isolates V2; late server response cannot change the new account', async () => {
  let release;
  networkApi.get = () => new Promise(resolve => { release = resolve; });
  const fetching = useSettingsStore.getState().fetchUserSettingsFromServer();
  owner = 2; useSettingsStore.getState().activateSettingsAccount();
  release({ data: { designV2: remoteDoc(1, normalizeDesignConfig({ front: { mainText: { font: 'private-A' } } })) } });
  await fetching;
  assert.notEqual(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'private-A');
  assert.equal(useSettingsStore.getState().designAccountId, 2);
});


test('existing V2 survives removal of obsolete source copies and keeps study keys', () => {
  const record = openPersonalDesignRecord(1);
  record.document.config.front.mainText.font = 'Georgia';
  record.backups = { local: { lerne_card_font: 'old' }, server: { cardFont: 'old' } };
  localStorage.setItem('lerne:personal-design:v2:1', JSON.stringify(record));
  localStorage.setItem('lerne_card_font', 'old');
  localStorage.setItem('lerne_autoplay', 'true');
  const reopened = openPersonalDesignRecord(1);
  assert.equal(reopened.document.config.front.mainText.font, 'Georgia');
  assert.deepEqual(reopened.backups, {});
  assert.equal(localStorage.getItem('lerne_card_font'), null);
  assert.equal(localStorage.getItem('lerne_autoplay'), 'true');
});

test('lower server revision preserves pending V2 content for re-upload', () => {
  let record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: remoteDoc(3) });
  record = editPersonalDesign(record, { front: { mainText: { font: 'Georgia' } } });
  const next = reconcilePersonalDesign(record, { designV2: remoteDoc(1) });
  assert.equal(next.pending, true);
  assert.equal(next.document.revision, 1);
  assert.equal(next.document.config.front.mainText.font, 'Georgia');
});
