import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createStore } from 'zustand/vanilla';

const create = (initializer) => {
  const api = createStore(initializer);
  const useBoundStore = (selector) => (selector ? selector(api.getState()) : api.getState());
  return Object.assign(useBoundStore, api);
};

mock.module('zustand', { namedExports: { create } });

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        return next(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

const storage = new Map();
const winListeners = new Map();
const docListeners = new Map();
const effectCleanups = [];

const addListener = (map) => (ev, fn) => {
  if (!map.has(ev)) map.set(ev, new Set());
  map.get(ev).add(fn);
};
const removeListener = (map) => (ev, fn) => {
  map.get(ev)?.delete(fn);
};
const emitEvent = (map) => (ev) => {
  const type = typeof ev === 'string' ? ev : ev.type;
  const event = typeof ev === 'string' ? { type } : ev;
  for (const fn of [...(map.get(type) || [])]) fn(event);
};

let onlineState = true;
globalThis.window = {
  location: { search: '' },
  addEventListener: addListener(winListeners),
  removeEventListener: removeListener(winListeners),
  dispatchEvent: emitEvent(winListeners),
};
globalThis.document = {
  visibilityState: 'visible',
  documentElement: { style: { setProperty: () => {} } },
  addEventListener: addListener(docListeners),
  removeEventListener: removeListener(docListeners),
  dispatchEvent: emitEvent(docListeners),
};
globalThis.localStorage = {
  get length() { return storage.size; },
  key: (i) => Array.from(storage.keys())[i] ?? null,
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
Object.defineProperty(globalThis, 'navigator', {
  value: {
    get onLine() { return onlineState; },
    locks: { request: (_n, a, b) => (typeof b === 'function' ? b : a)({}) },
  },
  configurable: true,
});

const makeServerSettings = (overrides = {}) => ({
  autoplayVersion: 2,
  autoplayOrder: 'list',
  autoplayFrontRepeat: 3,
  autoplayCycleRepeat: 2,
  autoplayGap: 2,
  autoplayCardPause: 3,
  autoplayPhraseSpeed: 0,
  autoplayTranslationSpeed: 0,
  autoplayLoop: true,
  autoplayForceFrontAudio: false,
  autoplayForceBackAudio: false,
  autoPlay: false,
  autoShow: false,
  ttsSpeed: 0,
  ttsSpeedRu: 0,
  ttsVoices: {},
  alwaysRegenerateAudio: false,
  autoGenerateCardAudio: false,
  studyMode: 'reverse',
  speechMatchThreshold: 75,
  speechFollowupEnabled: false,
  gradeSoundEnabled: false,
  voiceBack: '',
  randomEnabledModes: ['classic', 'reverse', 'cloze', 'puzzle', 'speak'],
  srsExtendedGrades: false,
  playerCollapsed: true,
  gradingCollapsed: false,
  showLessonCompletion: true,
  showCompletionCelebration: true,
  native_language: 'ru',
  designV2: { schemaVersion: 2, revision: 1, config: { global: { accentColor: '#123456' } }, preset: null },
  ...overrides,
});

let apiHandler = async () => ({ data: {} });
let netHandler = async () => ({ data: {} });

const recorded = [];
const mockApi = {
  get: async (url, cfg) => {
    recorded.push(`api:GET ${url}`);
    return apiHandler('GET', url, undefined, cfg);
  },
  post: async (url, data, cfg) => {
    recorded.push(`api:POST ${url}`);
    return apiHandler('POST', url, data, cfg);
  },
};
const mockNetworkApi = {
  get: async (url, cfg) => {
    recorded.push(`net:GET ${url}`);
    return netHandler('GET', url, undefined, cfg);
  },
  post: async (url, data, cfg) => {
    recorded.push(`net:POST ${url}`);
    return netHandler('POST', url, data, cfg);
  },
};

const useUiStore = create((set) => ({
  loading: false,
  hasInitialized: false,
  view: 'decks',
  userProfile: null,
  setUserProfile: (userProfile) => set({ userProfile }),
  showToast: () => {},
}));

const useDeckStore = create((set) => ({
  decks: [],
  folders: [],
  currentDeck: null,
  cardsCompleteByDeck: {},
  isFetchingDecks: false,
  setDecksAndFolders: (decks, folders) => set({ decks, folders }),
  setCurrentDeck: (currentDeck) => set({ currentDeck }),
  fetchDeckCards: async () => {},
  fetchDecks: async () => {},
  setLibraryLoadError: () => {},
  runLibraryLoad: async (_kind, fn) => fn(() => true),
}));

const useLanguageStore = create(() => ({
  targetLanguage: 'de',
  hasSelectedLanguage: true,
  syncLanguageFromExternal: () => {},
}));

let authRestoreHook = async () => {};
const useAuthStore = create((set) => ({
  userProfile: null,
  sessionRevision: 0,
  status: 'anonymous',
  setUserProfile: (userProfile) => set({ userProfile }),
  restoreSession: async () => authRestoreHook(),
  initListeners: () => {},
  checkPendingSession: () => {},
}));

mock.module('react', {
  namedExports: {
    useEffect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') effectCleanups.push(cleanup);
    },
  },
});
mock.module('../api.js', { defaultExport: mockApi, namedExports: { networkApi: mockNetworkApi } });
mock.module('../../store/useUiStore.js', { namedExports: { useUiStore } });
mock.module('../../store/useDeckStore.js', { namedExports: { useDeckStore } });
mock.module('../../store/useLanguageStore.js', { namedExports: { useLanguageStore } });
mock.module('../../store/useAuthStore.js', { namedExports: { useAuthStore } });
mock.module('../localDb.js', { namedExports: { isOfflineMode: () => storage.get('offline_mode') === 'true' } });
mock.module('../../pilot/standaloneBootstrap.js', {
  namedExports: { runStandaloneBootstrap: () => assert.fail('Web startup invoked the standalone bootstrap') },
});
mock.module('../syncService.js', { namedExports: { subscribeSyncUi: () => () => {}, syncService: { sync: async () => ({}) } } });
mock.module('../offlineUi.js', {
  namedExports: {
    markOfflineCreateError: () => {},
    updateOfflineEditUi: () => {},
    remapOfflineUi: () => {},
    refreshOfflineUi: () => {},
    refreshPeerOfflineUi: () => {},
  },
});

const { saveAuthSession, clearAuthSession, saveUserProfile } = await import('../../utils/auth.js');
const { normalizeDesignConfig } = await import('../../design/designConfig.js');
const { useSettingsStore } = await import('../../store/useSettingsStore.js');
const { useAppInitialization } = await import('../../hooks/useAppInitialization.js');

const flushMicrotasks = async () => {
  await new Promise((r) => setTimeout(r, 25));
};

let realDateNow = Date.now;

beforeEach(() => {
  while (effectCleanups.length) effectCleanups.pop()();
  winListeners.clear();
  docListeners.clear();
  storage.clear();
  recorded.length = 0;
  onlineState = true;
  Date.now = realDateNow;
  useUiStore.setState({ loading: false, hasInitialized: false, view: 'decks', userProfile: null });
  useDeckStore.setState({ decks: [], folders: [], currentDeck: null, isFetchingDecks: false });
  useAuthStore.setState({ userProfile: null, sessionRevision: 0, status: 'anonymous' });
  authRestoreHook = async () => {};
  clearAuthSession();
  useSettingsStore.getState().activateSettingsAccount();
});

afterEach(() => {
  while (effectCleanups.length) effectCleanups.pop()();
  winListeners.clear();
  docListeners.clear();
  Date.now = realDateNow;
  useSettingsStore.getState().activateSettingsAccount();
});

test('Task 3: saveCurrentSettingsToServer skips empty POST when client and server match', async () => {
  saveAuthSession({ account_id: 1, access_token: 'tok-1', refresh_token: 'ref-1', session_id: 'ses-1' });
  const srv = makeServerSettings();
  let postCount = 0;

  netHandler = async (method, url) => {
    assert.equal(url, '/user/settings');
    if (method === 'GET') return { data: { ...srv, _designMigrationVersion: 1 } };
    postCount++;
    return { data: { designMigrationVersion: 1, settings: srv } };
  };

  useSettingsStore.getState().activateSettingsAccount();
  useSettingsStore.getState().syncUserSettingsFromServer(srv);

  const saved = await useSettingsStore.getState().saveCurrentSettingsToServer();
  assert.equal(saved, true);
  assert.equal(postCount, 0);

  // Toggling and reverting a study setting within debounce must also skip empty POST
  useSettingsStore.getState().setAutoPlay(true);
  useSettingsStore.getState().setAutoPlay(false);
  const savedAfterRevert = await useSettingsStore.getState().saveCurrentSettingsToServer();
  assert.equal(savedAfterRevert, true);
  assert.equal(postCount, 0);
});

test('Task 3: offline study & design edits survive stale server sync and handle 409 CAS conflict cleanly', async () => {
  saveAuthSession({ account_id: 1, access_token: 'tok-1', refresh_token: 'ref-1', session_id: 'ses-1' });
  const srv = makeServerSettings({
    studyMode: 'reverse',
    autoPlay: false,
    designV2: {
      schemaVersion: 2,
      revision: 1,
      config: normalizeDesignConfig({ global: { accentColor: '#123456' } }),
      preset: null,
    },
  });
  let mode = 'offline';
  let conflictOnce = true;
  let lastPostPayload = null;

  netHandler = async (method, url, data) => {
    assert.equal(url, '/user/settings');
    if (mode === 'offline') throw new Error('Network unavailable');
    if (method === 'GET') return { data: { ...srv, _designMigrationVersion: 1 } };
    if (method === 'POST') {
      if (conflictOnce) {
        conflictOnce = false;
        srv.designV2 = {
          schemaVersion: 2,
          revision: 2,
          config: normalizeDesignConfig({ back: { card: { background: 'dark_emerald' } } }),
          preset: null,
        };
        const err = new Error('CAS conflict');
        err.response = { status: 409 };
        throw err;
      }
      lastPostPayload = data;
      srv.autoPlay = data.autoPlay;
      srv.designV2 = { ...data.designV2, revision: 3 };
      return { data: { designMigrationVersion: 1, settings: srv } };
    }
    throw new Error(`Unexpected ${method}`);
  };

  useSettingsStore.getState().activateSettingsAccount();
  useSettingsStore.getState().syncUserSettingsFromServer(srv);

  // Edit study toggle + personal design while offline
  useSettingsStore.getState().setAutoPlay(true);
  const cfg = normalizeDesignConfig(useSettingsStore.getState().personalDesignV2?.config);
  cfg.front.mainText.font = 'Georgia';
  useSettingsStore.getState().setPersonalDesignV2(cfg, cfg);

  // Offline write fails cleanly without losing local edits
  assert.equal(await useSettingsStore.getState().saveCurrentSettingsToServer(), false);
  assert.equal(useSettingsStore.getState().hasPendingSettingsSync(1), true);
  assert.equal(useSettingsStore.getState().autoPlay, true);

  // Stale server snapshot must not clobber unsaved local study edits
  useSettingsStore.getState().syncUserSettingsFromServer(srv);
  assert.equal(useSettingsStore.getState().autoPlay, true);
  assert.equal(useSettingsStore.getState().personalDesignV2.config.front.mainText.font, 'Georgia');

  // Reconnect + CAS 409 conflict + retry rebase preserves both local edits and remote non-conflicting field
  mode = 'online';
  assert.equal(await useSettingsStore.getState().syncUserSettingsIfNeeded(), false);
  assert.equal(useSettingsStore.getState().hasPendingSettingsSync(1), true);
  assert.equal(await useSettingsStore.getState().syncUserSettingsIfNeeded(), true);
  assert.equal(lastPostPayload.autoPlay, true);
  assert.equal(lastPostPayload.designV2.revision, 2);
  assert.equal(lastPostPayload.designV2.config.front.mainText.font, 'Georgia');
  assert.equal(lastPostPayload.designV2.config.back.card.background, 'dark_emerald');
  assert.equal(useSettingsStore.getState().hasPendingSettingsSync(1), false);
});

test('Task 2 + Task 3: cold init uses /init without GET/POST /user/settings; focus & clean online skip redundant GET; account switch runs 1 GET per switch', async () => {
  const srv1 = makeServerSettings({ studyMode: 'reverse', autoPlay: false });
  const srv2 = makeServerSettings({
    studyMode: 'cloze',
    autoPlay: true,
    designV2: { schemaVersion: 2, revision: 1, config: { global: { accentColor: '#abcdef' } }, preset: null },
  });
  let currentServer = { 1: srv1, 2: srv2 };

  saveAuthSession({ account_id: 1, access_token: 'tok-1', refresh_token: 'ref-1', session_id: 'ses-1' });
  let now = 1_000_000;
  Date.now = () => now;

  authRestoreHook = async () => {
    const uid = Number(JSON.parse(storage.get('lerne_auth_v2_session')).account_id);
    useAuthStore.setState((s) => ({
      userProfile: { user_id: uid },
      sessionRevision: s.sessionRevision + 1,
      status: 'authenticated',
    }));
  };

  apiHandler = async (method, url) => {
    if (method === 'GET' && url === '/init') {
      return {
        data: {
          decks: [{ id: 10, name: 'D1' }],
          folders: [{ id: 1, name: 'F1' }],
          settings: {},
          prompts: {},
          user_settings: currentServer[1],
          user_info: { user_id: 1, native_language: 'ru', active_language: 'de', has_selected_language: true },
        },
      };
    }
    return { data: {} };
  };

  netHandler = async (method, url, _data, cfg) => {
    if (url === '/user/settings' && method === 'GET') {
      const uid = cfg?._expectedUserId || 1;
      return { data: { ...currentServer[uid], _designMigrationVersion: 1 } };
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };

  useAppInitialization(() => {});
  await flushMicrotasks();

  // Cold startup got settings from /init: 0 GET/POST /user/settings
  assert.equal(useSettingsStore.getState().studyMode, 'reverse');
  assert.deepEqual(recorded.filter((r) => r.includes('/user/settings')), []);

  // Duplicate sessionRevision noise on same account must not trigger GET /user/settings
  useAuthStore.setState((s) => ({ sessionRevision: s.sessionRevision + 1 }));
  await flushMicrotasks();
  assert.deepEqual(recorded.filter((r) => r.includes('/user/settings')), []);

  // visibilitychange & focus & clean online within recheck window (<60s): 0 GET /user/settings
  globalThis.document.visibilityState = 'visible';
  globalThis.document.dispatchEvent('visibilitychange');
  globalThis.window.dispatchEvent('offline');
  globalThis.window.dispatchEvent('online');
  await flushMicrotasks();
  assert.deepEqual(recorded.filter((r) => r.includes('/user/settings')), []);

  // After >60s idle while visible, one fresh GET /user/settings refreshes cleanly
  now += 65_000;
  globalThis.document.dispatchEvent('visibilitychange');
  await flushMicrotasks();
  assert.equal(recorded.filter((r) => r === 'net:GET /user/settings').length, 1);

  // Account switch U1 -> U2 with multiple finishLogin notifications triggers 1 GET /user/settings (no empty POST)
  recorded.length = 0;
  saveAuthSession({ account_id: 2, access_token: 'tok-2', refresh_token: 'ref-2', session_id: 'ses-2' });
  useAuthStore.setState((s) => ({ sessionRevision: s.sessionRevision + 1 }));
  saveUserProfile({ user_id: 2 });
  useAuthStore.setState((s) => ({ userProfile: { user_id: 2 }, sessionRevision: s.sessionRevision + 1 }));
  await flushMicrotasks();

  assert.equal(useSettingsStore.getState().designAccountId, 2);
  assert.equal(useSettingsStore.getState().studyMode, 'cloze');
  assert.equal(useSettingsStore.getState().autoPlay, true);
  assert.equal(recorded.filter((r) => r === 'net:GET /user/settings').length, 1);
  assert.equal(recorded.filter((r) => r === 'net:POST /user/settings').length, 0);
});

test('saveCurrentSettingsToServer succeeds when user has no personal designV2 and omits designV2 from POST', async () => {
  saveAuthSession({ account_id: 1, access_token: 'tok-1', refresh_token: 'ref-1', session_id: 'ses-1' });
  saveUserProfile({ user_id: 1 });

  let serverSettings = { autoplayVersion: 2, autoPlay: false };
  const postedPayloads = [];
  netHandler = async (method, url, data) => {
    assert.equal(url, '/user/settings');
    if (method === 'GET') return { data: { ...serverSettings, _designMigrationVersion: 1 } };
    if (method === 'POST') {
      postedPayloads.push(data);
      serverSettings = { ...serverSettings, ...data };
      return { data: { designMigrationVersion: 1, settings: serverSettings } };
    }
    throw new Error(`Unexpected ${method}`);
  };

  useSettingsStore.getState().activateSettingsAccount();
  useSettingsStore.getState().syncUserSettingsFromServer(serverSettings);
  useSettingsStore.getState().setAutoPlay(true);

  const saved = await useSettingsStore.getState().saveCurrentSettingsToServer();
  assert.equal(saved, true);
  assert.equal(useSettingsStore.getState().designMigrationError, null);
  assert.equal(postedPayloads.length, 1);
  assert.equal(Object.hasOwn(postedPayloads[0], 'designV2'), false);
  assert.equal(postedPayloads[0].autoPlay, true);
  assert.equal(useSettingsStore.getState().hasPendingSettingsSync(1), false);
});
