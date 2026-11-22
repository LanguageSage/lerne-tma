import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignConfig } from '../designConfig.js';
import { openPersonalDesignRecord, readPersonalDesignRecord,
  reconcilePersonalDesign, editPersonalDesign, acknowledgePersonalDesign, resolveActiveDesign,
  isPersonalDesignActive, hasSavedPersonalDesign } from '../personalDesignMigration.js';

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
  useSettingsStore.setState({
    publishedDesignV2: null,
    designEditorDraft: null,
    designEditorBase: null,
    designPreviewInApp: false,
    designPreviewDismissed: false,
  });
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

test('old server settings cannot change V2 or study settings, and new empty record stays non-pending', () => {
  const record = openPersonalDesignRecord(1);
  const next = reconcilePersonalDesign(record, { cardFont: 'Georgia', userDesign: { cardFont: 'serif' } });
  assert.deepEqual(next.document.config, normalizeDesignConfig(null));
  assert.deepEqual(next.backups, {});
  assert.equal(next.pending, false);
  assert.equal(isPersonalDesignActive(next.document), false);
});

test('priority order: in-app preview > explicitly enabled personal > global default > built-in fallback', () => {
  const personal = normalizeDesignConfig({ front: { card: { background: 'dark_mocha' }, mainText: { font: 'Georgia' } } });
  const published = normalizeDesignConfig({ front: { mainText: { font: 'serif' } } });

  // Auto-created / disabled personal design must NOT override global default
  const autoDoc = { schemaVersion: 2, revision: 1, config: personal, preset: null };
  assert.equal(resolveActiveDesign({ personalDesignV2: autoDoc, publishedDesignV2: { config: published } }).front.mainText.font, 'serif');
  assert.equal(resolveActiveDesign({ personalDesignV2: { ...autoDoc, enabled: false }, publishedDesignV2: { config: published } }).front.mainText.font, 'serif');
  assert.equal(resolveActiveDesign({ personalDesignV2: { ...autoDoc, enabled: false }, publishedDesignV2: { config: published } }).front.card.background, '');

  // Explicitly enabled personal design wins over global default
  const activePersonal = resolveActiveDesign({ personalDesignV2: { ...autoDoc, enabled: true }, publishedDesignV2: { config: published } });
  assert.equal(activePersonal.front.mainText.font, 'Georgia');
  assert.equal(activePersonal.front.card.background, 'dark_mocha');

  // Built-in fallback applies when neither personal nor global is set
  assert.equal(resolveActiveDesign({ personalDesignV2: autoDoc, publishedDesignV2: null }).front.mainText.font, 'Comfortaa');

  // Temporary in-app preview overrides during editing
  const draft = normalizeDesignConfig({ front: { mainText: { font: 'monospace' } } });
  assert.equal(resolveActiveDesign({
    personalDesignV2: { ...autoDoc, enabled: true },
    publishedDesignV2: { config: published },
    designEditorDraft: draft,
    designPreviewInApp: true,
  }).front.mainText.font, 'monospace');
});

test('an explicitly empty publication clears the stale cache and restores fallback or enabled personal design', () => {
  const store = useSettingsStore.getState();
  const personal = normalizeDesignConfig({ global: { accentColor: '#123456' } });
  useSettingsStore.setState({ personalDesignV2: { schemaVersion: 2, revision: 1, config: personal, preset: null, enabled: true } });
  store.setPublishedDesignV2(remoteDoc(3, normalizeDesignConfig({ global: { accentColor: '#abcdef' } })));
  // Explicitly enabled personal design stays active over published
  assert.equal(useSettingsStore.getState().activeDesignConfig.global.accentColor, '#123456');
  assert.ok(memory.has('lerne:published-design:v2'));
  // Disabling personal design switches to published global
  useSettingsStore.setState({ personalDesignV2: { schemaVersion: 2, revision: 1, config: personal, preset: null, enabled: false } });
  assert.equal(useSettingsStore.getState().activeDesignConfig.global.accentColor, '#abcdef');
  // Empty published clears cache and falls back to built-in default
  store.setPublishedDesignV2({});
  assert.equal(useSettingsStore.getState().publishedDesignV2, null);
  assert.equal(useSettingsStore.getState().activeDesignConfig.global.accentColor, '#a78bfa');
  assert.equal(memory.has('lerne:published-design:v2'), false);
});

test('manual save waits for server confirmation, handles 409 CAS, and switching to global preserves personal config', async () => {
  const store = useSettingsStore.getState();
  const custom = normalizeDesignConfig({ front: { mainText: { font: 'Georgia' } }, global: { accentColor: '#224466' } });
  store.initDesignEditor();
  store.patchDesignEditorDraft('front.mainText.font', 'Georgia');
  assert.equal(store.hasUnsavedDesignChanges(), true);

  // Offline / failed save must not confirm or persist personal enabled design
  const failRes = await store.savePersonalDesignToServer(custom);
  assert.equal(failRes.success, false);
  assert.equal(isPersonalDesignActive(useSettingsStore.getState().personalDesignV2), false);
  assert.equal(useSettingsStore.getState().hasUnsavedDesignChanges(), true);

  // Successful save with 409 conflict recovery confirms and applies personal design
  let serverDoc = { schemaVersion: 2, revision: 2, config: normalizeDesignConfig(null), preset: null, enabled: false };
  let conflictOnce = true;
  networkApi.get = async () => ({ data: { _designMigrationVersion: 1, designV2: serverDoc } });
  networkApi.post = async (_url, payload) => {
    if (conflictOnce) {
      conflictOnce = false;
      const err = new Error('conflict');
      err.response = { status: 409 };
      throw err;
    }
    assert.equal(payload.designV2.revision, serverDoc.revision);
    serverDoc = { ...payload.designV2, revision: serverDoc.revision + 1 };
    return { data: { designMigrationVersion: 1, settings: { designV2: serverDoc } } };
  };

  const okRes = await store.savePersonalDesignToServer(custom);
  assert.equal(okRes.success, true);
  assert.equal(isPersonalDesignActive(useSettingsStore.getState().personalDesignV2), true);
  assert.equal(useSettingsStore.getState().personalDesignV2.revision, 3);
  assert.equal(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'Georgia');
  assert.equal(useSettingsStore.getState().hasUnsavedDesignChanges(), false);

  // Switching to global design sets enabled=false while keeping saved config intact
  store.setPublishedDesignV2(remoteDoc(5, normalizeDesignConfig({ front: { mainText: { font: 'serif' } } })));
  const useGlobal = await store.setPersonalDesignEnabled(false);
  assert.equal(useGlobal.success, true);
  assert.equal(isPersonalDesignActive(useSettingsStore.getState().personalDesignV2), false);
  assert.equal(hasSavedPersonalDesign(useSettingsStore.getState().personalDesignV2), true);
  assert.equal(useSettingsStore.getState().personalDesignV2.config.front.mainText.font, 'Georgia');
  assert.equal(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'serif');

  // Re-enabling personal design restores saved Georgia config
  const enablePersonal = await store.setPersonalDesignEnabled(true);
  assert.equal(enablePersonal.success, true);
  assert.equal(isPersonalDesignActive(useSettingsStore.getState().personalDesignV2), true);
  assert.equal(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'Georgia');
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
