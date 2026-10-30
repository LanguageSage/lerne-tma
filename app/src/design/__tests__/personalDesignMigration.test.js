import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESIGN_SETTINGS, DESIGN_STORAGE_MAP, migrateLegacyDesignSettings } from '../legacyAdapter.js';
import { getCardStyle, getBackCardStyle, getContextStyle, getDesignStylesFromV2 } from '../../utils/cardStyles.js';
import { normalizeDesignConfig } from '../designConfig.js';
import { openPersonalDesignRecord, readPersonalDesignRecord, savePersonalDesignRecord,
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
const { useSettingsStore, collectUserSettings } = await import('../../store/useSettingsStore.js');

beforeEach(() => {
  memory.clear(); failKey = null; owner = 1;
  networkApi.get = async () => ({ data: {} });
  networkApi.post = async () => { throw Error('offline'); };
  useSettingsStore.getState().activateSettingsAccount();
  useSettingsStore.setState({ publishedDesignV2: null, adminDraftDesignV2: null, isLocalDesignPreviewActive: false });
});
afterEach(() => { failKey = null; useSettingsStore.getState().activateSettingsAccount(); });

const remoteDoc = (revision = 1, config = normalizeDesignConfig({})) => ({ schemaVersion: 2, revision, config, preset: null });

test('every stored V1 field changes its V2 representation; inherited answer and list typography survive', () => {
  const original = migrateLegacyDesignSettings(DEFAULT_DESIGN_SETTINGS);
  for (const [key, value] of Object.entries(DEFAULT_DESIGN_SETTINGS)) {
    const alternative = typeof value === 'number' ? value + 1 : key.includes('Bg') ? '#123456'
      : key.toLowerCase().includes('color') ? '#123456' : `${value}-custom`;
    assert.notDeepEqual(migrateLegacyDesignSettings({ ...DEFAULT_DESIGN_SETTINGS, [key]: alternative }), original, key);
  }
  const flat = { ...DEFAULT_DESIGN_SETTINGS, cardFont: 'Georgia', cardFontSize: 2.2, cardFontWeight: '500',
    cardFontStyle: 'italic', cardTextShadow: 'outline', contextTextAlign: 'right',
    previewCardFont: 'monospace', previewCardFontStyle: 'italic', previewTextShadow: 'neon' };
  const config = migrateLegacyDesignSettings(flat);
  const expected = getBackCardStyle(flat), front = getCardStyle(flat);
  for (const key of ['font', 'size', 'weight', 'style', 'shadow']) {
    assert.equal(config.back.answerText[key], config.front.mainText[key], key);
  }
  assert.equal(config.back.answerText.font, expected.fontFamily);
  assert.equal(`${config.back.answerText.size}rem`, expected.fontSize);
  assert.equal(config.back.referenceText.font, front.fontFamily);
  assert.equal(config.back.answerText.align, 'right');
  assert.equal(config.cardList.backText.font, 'monospace');
  assert.equal(config.cardList.backText.weight, '500');
  assert.equal(config.cardList.backText.style, 'italic');
  assert.equal(config.cardList.backText.shadow, 'neon');
  assert.equal(migrateLegacyDesignSettings({ cardFontSize: '2.4' }).front.mainText.size, 2.4);
});

test('backup is exact, version resets do not run, and reopening is idempotent', () => {
  memory.clear();
  storage.set('lerne_card_font', 'serif'); storage.set('lerne_design_version', 'old');
  storage.set('lerne_user_design', '{"cardBgFront":"custom_saved","cardFontSize":2.4,"extra":"keep"}');
  const first = openPersonalDesignRecord(1);
  assert.equal(first.backups.local.lerne_user_design, storage.get('lerne_user_design'));
  assert.equal(first.document.config.front.mainText.font, 'serif');
  assert.equal(first.document.preset.front.card.background, 'custom_saved');
  assert.equal(first.document.preset.front.mainText.size, 2.4);
  assert.deepEqual(openPersonalDesignRecord(1), first);
  assert.equal(storage.get('lerne_design_version'), 'old');
  assert.equal(storage.get('lerne_card_font'), 'serif');
});

test('failed backup or target write cannot consume V1; retry resumes from the original source', () => {
  memory.clear(); storage.set('lerne_card_font', 'serif');
  for (const key of ['lerne:design-v1-source', 'lerne:personal-design:v2:1']) {
    failKey = key;
    assert.throws(() => openPersonalDesignRecord(1), /quota/);
    assert.equal(storage.get('lerne_card_font'), 'serif');
  }
  failKey = null;
  assert.equal(openPersonalDesignRecord(1).document.config.front.mainText.font, 'serif');
});

test('corrupt presets, future V2 documents and damaged target records retain original bytes', () => {
  memory.clear(); storage.set('lerne_user_design', '{broken');
  const record = openPersonalDesignRecord(1);
  assert.equal(record.backups.local.lerne_user_design, '{broken');
  assert.equal(record.document.preset, null);
  assert.throws(() => reconcilePersonalDesign(record, { designV2: { schemaVersion: 3 } }), /Unsupported/);
  storage.set('lerne:personal-design:v2:1', '{broken-target');
  assert.throws(() => openPersonalDesignRecord(1));
  assert.equal(storage.get('lerne:personal-design:v2:1'), '{broken-target');
});

test('first authoritative server settings override local V1; original local and server sources remain', () => {
  const record = openPersonalDesignRecord(1);
  const server = { cardFont: 'serif', cardBgFront: 'dark_mocha', userDesign: { cardFont: 'monospace' }, unknown: [1] };
  const next = reconcilePersonalDesign(record, server);
  assert.equal(next.document.config.front.mainText.font, 'serif');
  assert.equal(next.document.preset.front.mainText.font, 'monospace');
  assert.deepEqual(next.backups.server, server);
  assert.deepEqual(next.backups.local, record.backups.local);
});

test('published design wins; empty background keeps personal; preview wins without mutating either', () => {
  const personal = migrateLegacyDesignSettings({ cardFont: 'serif', cardBgFront: 'dark_mocha' });
  const published = { front: { mainText: { font: 'monospace' } } };
  const state = { personalDesignV2: remoteDoc(1, personal), publishedDesignV2: { config: published } };
  assert.equal(resolveActiveDesign(state).front.mainText.font, 'monospace');
  assert.equal(resolveActiveDesign(state).front.card.background, 'dark_mocha');
  assert.equal(published.front.card, undefined);
  state.adminDraftDesignV2 = { front: { card: { background: '#123456' } } }; state.isLocalDesignPreviewActive = true;
  assert.equal(resolveActiveDesign(state).front.card.background, '#123456');
});

test('offline edit before the first server read survives reconciliation, including a saved preset', () => {
  const record = openPersonalDesignRecord(1);
  const local = editPersonalDesign(record, { ...record.document.config, front: {
    ...record.document.config.front, mainText: { ...record.document.config.front.mainText, font: 'serif' } } },
  normalizeDesignConfig({ front: { mainText: { font: 'Georgia' } } }));
  const next = reconcilePersonalDesign(local, { designV2: remoteDoc(5) });
  assert.equal(next.document.config.front.mainText.font, 'serif');
  assert.equal(next.document.preset.front.mainText.font, 'Georgia');
  assert.equal(next.document.revision, 5); assert.equal(next.pending, true);
});

test('two device conflict rebases local edits, keeps remote edits and stores both conflicting snapshots', () => {
  let record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: remoteDoc() });
  record = editPersonalDesign(record, normalizeDesignConfig({ front: { mainText: { font: 'serif' } } }));
  const remote = remoteDoc(2, normalizeDesignConfig({ back: { answerText: { color: '#123456' } },
    front: { mainText: { font: 'monospace' } } }));
  const next = reconcilePersonalDesign(record, { designV2: remote });
  assert.equal(next.document.config.front.mainText.font, 'serif');
  assert.equal(next.document.config.back.answerText.color, '#123456');
  assert.equal(next.document.revision, 2);
  assert.equal(next.backups.conflicts.length, 1);
  assert.deepEqual(next.backups.conflicts[0].remote, remote);
  assert.deepEqual(next.backups.conflicts[0].local, record.document);
});

test('lost POST acknowledgement is recognized on the next read; edits during POST stay pending', () => {
  let record = reconcilePersonalDesign(openPersonalDesignRecord(1), {});
  const remote = { ...record.document, revision: 1 };
  assert.equal(reconcilePersonalDesign(record, { designV2: remote }).pending, false);
  const sent = record.document;
  record = editPersonalDesign(record, { front: { mainText: { font: 'serif' } } });
  const next = acknowledgePersonalDesign(record, sent, remote);
  assert.equal(next.pending, true); assert.equal(next.document.revision, 1);
  assert.equal(next.document.config.front.mainText.font, 'serif');
});

test('account switch cannot claim another account source or consume late settings/admin responses', async () => {
  const first = openPersonalDesignRecord(1);
  let release;
  networkApi.get = () => new Promise(resolve => { release = resolve; });
  const fetching = useSettingsStore.getState().fetchUserSettingsFromServer();
  owner = 2; useSettingsStore.getState().activateSettingsAccount();
  release({ data: { cardFont: 'private-A' } }); await fetching;
  assert.deepEqual(openPersonalDesignRecord(2).backups.local, {});
  assert.notEqual(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'private-A');
  assert.deepEqual(readPersonalDesignRecord(1), first);
  const restoring = useSettingsStore.getState().loadAdminDraftFromServer();
  owner = 1; useSettingsStore.getState().activateSettingsAccount();
  release({ data: { config: { front: { mainText: { font: 'private-B' } } } } });
  assert.equal((await restoring).success, false);
  assert.equal(useSettingsStore.getState().adminDraftDesignV2, null);
});

test('store persists first, keeps pending after network loss, and syncs acknowledged V2 without V1 writes', async () => {
  let server = {};
  networkApi.get = async () => ({ data: { ...server, _designMigrationVersion: 1 } });
  const state = useSettingsStore.getState();
  state.setPersonalDesignV2({ front: { mainText: { font: 'serif' } } });
  assert.equal(readPersonalDesignRecord(1).document.config.front.mainText.font, 'serif');
  assert.equal(await state.saveCurrentSettingsToServer(), false);
  assert.equal(readPersonalDesignRecord(1).pending, true);
  networkApi.post = async (_url, payload, options) => {
    assert.equal(options._expectedUserId, 1);
    for (const key of Object.keys(DESIGN_STORAGE_MAP)) assert.equal(payload[key], undefined, key);
    assert.equal(payload.userDesign, undefined);
    server = { ...payload, designV2: { ...payload.designV2, revision: 1 } };
    return { data: { settings: server, designMigrationVersion: 1 } };
  };
  assert.equal(await state.saveCurrentSettingsToServer(), true);
  assert.equal(readPersonalDesignRecord(1).pending, false);
  assert.equal(useSettingsStore.getState().activeDesignConfig.front.mainText.font, 'serif');
  assert.equal(collectUserSettings(useSettingsStore.getState()).designV2.revision, 1);
});

test('local restore uses the preserved source and a newer server revision rather than resetting migration', async () => {
  const record = openPersonalDesignRecord(1);
  const next = reconcilePersonalDesign(record, { designV2: remoteDoc(6,
    normalizeDesignConfig({ front: { mainText: { font: 'serif' } } })) });
  savePersonalDesignRecord(next); useSettingsStore.setState({ personalDesignV2: next.document });
  await useSettingsStore.getState().restorePersonalDesignFromBackup();
  const restored = readPersonalDesignRecord(1);
  assert.equal(restored.document.revision, 6); assert.equal(restored.pending, true);
  assert.deepEqual(restored.backups.local, record.backups.local);
  assert.equal(restored.document.config.front.mainText.font, DEFAULT_DESIGN_SETTINGS.cardFont);
});

test('older backend cannot receive a migration before advertising atomic backup support', async () => {
  let posts = 0;
  networkApi.post = async () => { posts++; return { data: {} }; };
  assert.equal(await useSettingsStore.getState().saveCurrentSettingsToServer(), false);
  assert.equal(posts, 0);
  assert.equal(readPersonalDesignRecord(1).pending, true);
});

test('acknowledgement after account A -> B -> A cannot acknowledge a different session', async () => {
  networkApi.get = async () => ({ data: { _designMigrationVersion: 1 } });
  let release, sent;
  networkApi.post = async (_url, payload) => {
    sent = payload.designV2;
    return new Promise(resolve => { release = resolve; });
  };
  const saving = useSettingsStore.getState().saveCurrentSettingsToServer();
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  owner = 2; useSettingsStore.getState().activateSettingsAccount();
  owner = 1; useSettingsStore.getState().activateSettingsAccount();
  release({ data: { designMigrationVersion: 1, settings: { designV2: { ...sent, revision: 1 } } } });
  assert.equal(await saving, false);
  assert.equal(readPersonalDesignRecord(1).pending, true);
  assert.equal(readPersonalDesignRecord(1).document.revision, 0);
});

test('restoring a server snapshot from before V2 preserves local design and restarts only server revision', () => {
  const record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: remoteDoc(6) });
  const next = reconcilePersonalDesign(record, { cardFont: 'old-snapshot' });
  assert.equal(next.pending, true); assert.equal(next.document.revision, 0);
  assert.deepEqual(next.document.config, record.document.config);
  assert.equal(next.backups.serverRestores[0].document.revision, 6);
  assert.deepEqual(next.backups.serverRestores[0].settings, { cardFont: 'old-snapshot' });
});

test('invalid or older acknowledgement cannot mark a different/newer design as migrated', () => {
  const record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: remoteDoc(6) });
  assert.throws(() => acknowledgePersonalDesign(record, record.document, remoteDoc(7,
    normalizeDesignConfig({ front: { mainText: { font: 'wrong' } } }))), /different/);
  assert.deepEqual(acknowledgePersonalDesign(record, record.document, remoteDoc(5)), record);
});

test('inherited Free Text color and independent Match right typography migrate into V2 roles', () => {
  const flat = { ...DEFAULT_DESIGN_SETTINGS, cardFont: 'Georgia', cardTextColor: '#ff00ff',
    contextFont: 'monospace', contextTextColor: '#ffff00', contextFontSize: 1.6, contextFontStyle: 'italic' };
  const config = migrateLegacyDesignSettings(flat), styles = getDesignStylesFromV2(config);
  assert.equal(config.exercises.freeText.input.color, getContextStyle(flat).color);
  assert.equal(config.exercises.match.item.color, '#ff00ff');
  assert.equal(styles.matchRightText.fontFamily, 'monospace');
  assert.equal(styles.matchRightText.fontSize, '1.6rem');
  assert.equal(styles.matchRightText.color, '#ffff00');
  assert.equal(styles.matchRightText.fontStyle, 'italic');
  const defaults = normalizeDesignConfig({ front: { mainText: { font: 'Georgia' } } });
  assert.equal(getDesignStylesFromV2(defaults).matchRightText.fontFamily, 'Georgia');
  assert.equal(getDesignStylesFromV2(defaults).matchRightText.color, defaults.exercises.match.item.color);
});

test('fresh V1 updates arriving before server migration are preserved together with pending local V2 edits', () => {
  let record = reconcilePersonalDesign(openPersonalDesignRecord(1), { cardFont: 'serif', cardTextColor: '#123456' });
  record = editPersonalDesign(record, { ...record.document.config,
    front: { ...record.document.config.front, mainText: { ...record.document.config.front.mainText, size: 2.5 } } });
  const next = reconcilePersonalDesign(record, { cardFont: 'monospace', cardTextColor: '#abcdef' });
  assert.equal(next.document.config.front.mainText.font, 'monospace');
  assert.equal(next.document.config.front.mainText.color, '#abcdef');
  assert.equal(next.document.config.front.mainText.size, 2.5);
  assert.equal(next.backups.serverUpdates.length, 1);
  assert.equal(next.backups.server.cardFont, 'serif');
});

test('an older server V2 snapshot cannot discard the newer cached personal design', () => {
  const latest = remoteDoc(6, normalizeDesignConfig({ front: { mainText: { font: 'serif' } } }));
  const record = reconcilePersonalDesign(openPersonalDesignRecord(1), { designV2: latest });
  const restored = reconcilePersonalDesign(record, { designV2: remoteDoc(2) });
  assert.deepEqual(restored.document.config, latest.config);
  assert.equal(restored.document.revision, 2); assert.equal(restored.pending, true);
  assert.equal(restored.backups.serverRestores[0].document.revision, 6);
  assert.deepEqual(reconcilePersonalDesign(restored, { designV2: latest }).document, latest);
  const migrated = migrateLegacyDesignSettings({ cardFontWeight: 500, contextFontWeight: 600,
    previewCardFontWeight: 400, backCardFontSize: '2.4' });
  assert.equal(migrated.front.mainText.weight, '500');
  assert.equal(migrated.back.context.weight, '600');
  assert.equal(migrated.cardList.frontText.weight, '400');
  assert.equal(migrated.back.answerText.size, 2.4);
});
