// Execute the real store with synthetic API/storage/UI boundaries. No network.
// Run: node scripts/tests/auth_store_regression.mjs (no child process required).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/node_modules/zustand/esm/vanilla.mjs';

const source = readFileSync(new URL('../../app/src/store/useAuthStore.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export const useAuthStore', 'const useAuthStore');
function fixture({ methods = ['email_password'], email = 'fixture@example.test' } = {}) {
  const pending = new Map(), timers = new Map(), calls = [];
  let nextTimer = 0;
  const ui = { setIsAuthModalOpen: value => { ui.isAuthModalOpen = value; }, showToast() {},
    openSettings: tab => { ui.settingsTab = tab; } };
  const api = {
    async get(path) {
      if (path === '/auth/v2/me') return { data: { user_id: -123, is_guest: false } };
      if (path === '/auth/v2/identities') return { data: { providers: methods } };
      if (path === '/auth/v2/password-settings') return { data: { email, can_reset_password: false } };
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) {
      calls.push({ path, body });
      if (path === '/auth/v2/challenges') return { data: { challenge_id: 'fixture', secret: 'synthetic',
        expires_at: new Date(Date.now() + 300000).toISOString(), authorization_url: 'https://example.invalid' } };
      return { data: { access_token: 'synthetic', refresh_token: 'synthetic' } };
    },
  };
  let deckStoreResetCount = 0;
  const closedDbUserIds = [];
  let resetAllDatabasesCount = 0;
  let currentUserId = null;
  let accessToken = null;
  const context = { create: createStore, tr: value => value, api,
    getUserProfile: () => (currentUserId ? { user_id: currentUserId } : null),
    saveUserProfile(p) { currentUserId = p?.user_id; },
    saveAuthSession(session) { accessToken = session.access_token; }, clearAuthSession() { currentUserId = null; accessToken = null; },
    getUserId: () => currentUserId, getAccessToken: () => accessToken,
    closeLocalDb: (id) => { closedDbUserIds.push(id); },
    resetAllDatabases: () => { resetAllDatabasesCount++; },
    storage: { remove() {}, set() {}, get() { return null; } }, getPlatform: () => 'web', openExternalLink() { return true; },
    prepareExternalLink: () => ({ navigate() {}, close() {} }),
    useUiStore: { getState: () => ui, setState: value => Object.assign(ui, value) },
    useDeckStore: { getState: () => ({
      async fetchDecks() {},
      async fetchFolders() {},
      resetDeckStore: () => { deckStoreResetCount++; },
    }) },
    sessionStorage: { getItem: key => pending.get(key), setItem: (key, value) => pending.set(key, value),
      removeItem: key => pending.delete(key) },
    setInterval: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval: id => timers.delete(id), window: {},
    document: { hidden: false, addEventListener() {} },
  };
  vm.runInNewContext(`${source}\nglobalThis.subject = useAuthStore;`, context);
  return { store: context.subject, api, ui, pending, timers, calls, context,
    get deckStoreResetCount() { return deckStoreResetCount; },
    get closedDbUserIds() { return closedDbUserIds; },
    get resetAllDatabasesCount() { return resetAllDatabasesCount; },
    set currentUserId(id) { currentUserId = id; },
    set accessToken(token) { accessToken = token; },
  };
}

test('registration offers linking without opening a second login', async () => {
  const f = fixture();
  await f.store.getState().loginWithEmailPassword('fixture@example.test', 'synthetic password', true);
  assert.equal(f.store.getState().showTelegramPrompt, true);
  assert.equal(f.ui.isAuthModalOpen, true);
  await f.store.getState().linkProvider('telegram');
  assert.equal(f.calls.at(-1).body.purpose, 'link');
});

test('normal login closes modal; linked Telegram does not prompt again', async () => {
  const f = fixture({ methods: ['email_password', 'telegram'] });
  await f.store.getState().loginWithEmailPassword('fixture@example.test', 'synthetic password', true);
  assert.equal(f.store.getState().showTelegramPrompt, false);
  assert.equal(f.ui.isAuthModalOpen, false);
});

test('recovery survives provider round trip and opens profile', async () => {
  const f = fixture();
  await f.store.getState().startPasswordRecovery('telegram');
  assert.equal(f.calls[0].body.purpose, 'login');
  await f.store.getState().checkPendingSession();
  assert.equal(f.ui.settingsTab, 'profile');
  assert.equal(f.timers.size, 0);
});

test('polling exchanges a one-time challenge only once at a time', async () => {
  const f = fixture();
  await f.store.getState().linkProvider('telegram');
  let resolve;
  let exchanges = 0;
  f.api.post = () => { exchanges++; return new Promise(done => { resolve = done; }); };
  const first = f.store.getState().checkPendingSession();
  assert.equal(await f.store.getState().checkPendingSession(), false);
  assert.equal(exchanges, 1);
  resolve({ data: { linked: true } });
  await first;
  assert.equal(f.timers.size, 0);
  assert.equal(f.store.getState().isPolling, false);
});

test('cancelling a pending exchange does not sign in afterwards', async () => {
  const f = fixture();
  await f.store.getState().startPasswordRecovery();
  let resolve;
  f.api.post = () => new Promise(done => { resolve = done; });
  const exchange = f.store.getState().checkPendingSession();
  f.store.getState().cancelPendingAuth();
  resolve({ data: { access_token: 'synthetic' } });
  assert.equal(await exchange, false);
  assert.equal(f.store.getState().userProfile, null);
  assert.equal(f.timers.size, 0);
});

test('adding email and resetting password use distinct endpoints', async () => {
  const f = fixture({ email: null });
  await f.store.getState().refreshAuthMethods();
  await f.store.getState().linkEmailPassword('fixture@example.test', 'synthetic password');
  assert.equal(f.calls.at(-1).path, '/auth/v2/email-password/link');
  f.store.setState({ passwordSettings: { email: 'fixture@example.test', can_reset_password: true } });
  await f.store.getState().linkEmailPassword('fixture@example.test', 'synthetic password');
  assert.equal(f.calls.at(-1).path, '/auth/v2/email-password/set');
});

test('expired and rejected challenges stop polling and allow retry', async () => {
  const f = fixture();
  await f.store.getState().startPasswordRecovery();
  const [key, value] = [...f.pending][0];
  f.pending.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: '2000-01-01T00:00:00Z' }));
  assert.equal(await f.store.getState().checkPendingSession(), false);
  assert.equal(f.timers.size, 0);
  await f.store.getState().startPasswordRecovery();
  f.api.post = async () => { throw { response: { status: 401, data: { detail: 'reauthentication_required' } } }; };
  assert.equal(await f.store.getState().checkPendingSession(), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.store.getState().isPolling, false);
});

test('logout isolates state: resets deck store, closes local database, and resets all databases', () => {
  const f = fixture();
  f.currentUserId = -999;
  f.store.getState().logout();
  assert.equal(f.deckStoreResetCount, 1);
  assert.deepEqual(f.closedDbUserIds, [-999]);
  assert.equal(f.resetAllDatabasesCount, 1);
  assert.equal(f.store.getState().userProfile, null);
});

test('finishLogin isolates state when switching user accounts', async () => {
  const f = fixture();
  f.currentUserId = -999;
  await f.store.getState().finishLogin({ access_token: 'tok', refresh_token: 'ref' });
  // f.api.get('/auth/v2/me') returns user_id: -123 != -999
  assert.equal(f.deckStoreResetCount, 1);
  assert.deepEqual(f.closedDbUserIds, [-999]);
  assert.equal(f.store.getState().userProfile.user_id, -123);
});

test('restoration is shared while pending and publishes the canonical profile before ready', async () => {
  const f = fixture(); f.accessToken = 'synthetic';
  let resolve;
  f.api.get = () => new Promise(done => { resolve = done; });
  const first = f.store.getState().restoreSession();
  assert.equal(f.store.getState().restoreSession(), first);
  assert.equal(f.store.getState().isRestoring, true);
  resolve({ data: { user_id: -123 }, config: { headers: { Authorization: 'Bearer synthetic' } } });
  await first;
  assert.equal(f.store.getState().isRestoring, false);
  assert.equal(f.store.getState().userProfile.user_id, -123);
});

test('late restoration response cannot restore a logged-out account', async () => {
  const f = fixture(); f.accessToken = 'synthetic';
  let resolve;
  f.api.get = () => new Promise(done => { resolve = done; });
  const restoration = f.store.getState().restoreSession();
  f.store.getState().logout();
  resolve({ data: { user_id: -123 }, config: { headers: { Authorization: 'Bearer synthetic' } } });
  await restoration;
  assert.equal(f.store.getState().userProfile, null);
  assert.equal(f.store.getState().isRestoring, false);
});

test('logout retires an in-flight login before it can save tokens', async () => {
  const f = fixture();
  let resolve;
  f.api.post = () => new Promise(done => { resolve = done; });
  const login = f.store.getState().loginWithEmailPassword('fixture@example.test', 'synthetic password');
  f.store.getState().logout();
  resolve({ data: { access_token: 'late', refresh_token: 'late-refresh' } });
  assert.equal((await login).success, false);
  assert.equal(f.store.getState().userProfile, null);
});

test('logout retires a login already waiting for its profile', async () => {
  const f = fixture();
  let resolve;
  f.api.get = () => new Promise(done => { resolve = done; });
  const login = f.store.getState().finishLogin({ access_token: 'synthetic', refresh_token: 'synthetic' });
  f.store.getState().logout();
  resolve({ data: { user_id: -123 } });
  assert.equal(await login, null);
  assert.equal(f.store.getState().userProfile, null);
});

test('unconfigured provider failure presents clear message without generic fallback', async () => {
  const f = fixture();
  f.api.post = async (path) => {
    if (path === '/auth/v2/challenges') {
      const err = new Error('Request failed with status code 503');
      err.response = { status: 503, data: { detail: 'provider_not_configured' } };
      throw err;
    }
    return { data: {} };
  };
  const result = await f.store.getState().startProvider('telegram');
  assert.equal(result.success, false);
  assert.equal(result.error, 'Этот способ входа пока не настроен. Используйте email и пароль.');
  assert.equal(f.store.getState().authError, 'Этот способ входа пока не настроен. Используйте email и пароль.');
  assert.equal(f.store.getState().isPolling, false);
});

test('missing pending storage stops the waiting UI', async () => {
  const f = fixture();
  await f.store.getState().startTelegramLinking();
  f.pending.clear();
  await f.store.getState().checkPendingSession();
  assert.equal(f.store.getState().isPolling, false);
  assert.equal(f.timers.size, 0);
});

test('invalid expiry cannot leave a challenge polling forever', async () => {
  const f = fixture();
  await f.store.getState().startTelegramLinking();
  const [key, value] = [...f.pending][0];
  f.pending.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: 'invalid' }));
  f.api.post = async () => { throw { response: { status: 401, data: { detail: 'invalid_challenge' } } }; };
  await f.store.getState().checkPendingSession();
  assert.equal(f.store.getState().isPolling, false);
  assert.equal(f.timers.size, 0);
});

test('reload resumes pending login with its manual URL and exchanges it', async () => {
  const before = fixture();
  await before.store.getState().startGoogleLogin();
  const after = fixture();
  before.pending.forEach((value, key) => after.pending.set(key, value));
  after.api.post = async () => { throw { response: { status: 401, data: { detail: 'invalid_challenge' } } }; };
  await after.store.getState().restoreSession();
  assert.equal(after.store.getState().isPolling, true);
  assert.equal(after.store.getState().authUrl, 'https://example.invalid');
  assert.equal(after.ui.isAuthModalOpen, true);
  after.api.post = async () => ({ data: { access_token: 'new', refresh_token: 'new-refresh' } });
  assert.equal(await after.store.getState().checkPendingSession(), true);
  assert.equal(after.store.getState().isPolling, false);
  assert.equal(after.timers.size, 0);
});

for (const detail of ['invalid_provider_proof', 'provider_proof_replayed']) {
  test(`Mini App falls back to bot confirmation when initData is rejected: ${detail}`, async () => {
    const f = fixture();
    f.context.window.Telegram = { WebApp: { initData: 'synthetic-old-proof' } };
    f.context.getPlatform = () => 'telegram';
    const post = f.api.post;
    f.api.post = async (path, body) => {
      if (path === '/auth/v2/telegram/mini-app') throw { response: { status: 401, data: { detail } } };
      return post(path, body);
    };
    assert.equal((await f.store.getState().startTelegramLinking()).success, true);
    assert.equal(f.calls.at(-1).path, '/auth/v2/challenges');
    assert.equal(f.store.getState().isPolling, true);
  });
}

test('valid Mini App login needs no external window or challenge', async () => {
  const f = fixture();
  f.context.window.Telegram = { WebApp: { initData: 'synthetic-fresh-proof' } };
  let popups = 0;
  f.context.prepareExternalLink = () => { popups++; return null; };
  assert.equal((await f.store.getState().startTelegramLinking()).success, true);
  assert.equal(popups, 0);
  assert.equal(f.calls[0].path, '/auth/v2/telegram/mini-app');
  assert.equal(f.store.getState().isPolling, false);
});

test('temporary exchange failure retains the challenge but still respects its deadline', async () => {
  const f = fixture();
  await f.store.getState().startGoogleLogin();
  f.api.post = async () => { throw { response: { status: 503 } }; };
  assert.equal(await f.store.getState().checkPendingSession(), false);
  assert.equal(f.store.getState().isPolling, true);
  const [key, value] = [...f.pending][0];
  f.pending.set(key, JSON.stringify({ ...JSON.parse(value), expiresAt: '2000-01-01T00:00:00Z' }));
  await f.store.getState().checkPendingSession();
  assert.equal(f.store.getState().isPolling, false);
  assert.equal(f.timers.size, 0);
});

test('Telegram preflight is deduplicated and cannot poll or persist before activation', async () => {
  const f = fixture();
  let resolve;
  const post = f.api.post;
  f.api.post = (...args) => new Promise(done => { resolve = async () => done(await post(...args)); });
  const first = f.store.getState().prepareTelegramChallenge();
  assert.equal(f.store.getState().prepareTelegramChallenge(), first);
  assert.equal(f.pending.size, 0);
  assert.equal(f.timers.size, 0);
  resolve();
  const challenge = await first;
  assert.equal((await f.store.getState().prepareTelegramChallenge()).id, challenge.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.getState().activatePreparedTelegram(challenge.id), true);
  assert.equal(f.store.getState().activatePreparedTelegram(challenge.id), false);
  assert.equal(f.pending.size, 1);
  assert.equal(f.timers.size, 1);
  assert.equal(f.calls.length, 1);
});

test('early Telegram click awaits the same preflight and disables async popup retries', async () => {
  const f = fixture();
  let resolve;
  let opens = 0;
  const post = f.api.post;
  f.api.post = (...args) => new Promise(done => { resolve = async () => done(await post(...args)); });
  f.context.prepareExternalLink = () => null;
  f.context.openExternalLink = (url, popup, options) => {
    opens++;
    assert.equal(popup, null);
    assert.equal(options.allowPopup, false);
    assert.equal(options.sameTabFallback, true);
    return true;
  };
  const preparation = f.store.getState().prepareTelegramChallenge();
  const login = f.store.getState().startTelegramLinking();
  assert.equal((await f.store.getState().startTelegramLinking()).success, false);
  resolve();
  await preparation;
  assert.equal((await login).success, true);
  assert.equal(opens, 1);
  assert.equal(f.calls.length, 1);
});

for (const action of ['cancelPendingAuth', 'logout']) {
  test(`${action} retires an in-flight Telegram preflight`, async () => {
    const f = fixture();
    let resolve;
    const post = f.api.post;
    f.api.post = (...args) => new Promise(done => { resolve = async () => done(await post(...args)); });
    const preparation = f.store.getState().prepareTelegramChallenge();
    f.store.getState()[action]();
    resolve();
    assert.equal(await preparation, null);
    assert.equal(f.store.getState().preparedTelegramChallenge, null);
    assert.equal(f.pending.size, 0);
    assert.equal(f.timers.size, 0);
  });
}

test('Telegram preflight cannot reuse an expired or differently purposed challenge', async () => {
  const f = fixture();
  const login = await f.store.getState().prepareTelegramChallenge();
  assert.equal(f.store.getState().activatePreparedTelegram(login.id, 'link'), false);
  f.store.setState({ preparedTelegramChallenge: { ...login, expiresAt: '2000-01-01T00:00:00Z' } });
  assert.equal(f.store.getState().activatePreparedTelegram(login.id), false);
  await f.store.getState().prepareTelegramChallenge('link');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.purpose, 'link');
  assert.equal(f.store.getState().activatePreparedTelegram('fixture', 'link'), true);
  assert.equal(JSON.parse([...f.pending.values()][0]).purpose, 'link');
});

test('prepared Telegram recovery preserves the flag through exchange', async () => {
  const f = fixture();
  await f.store.getState().prepareTelegramChallenge();
  assert.equal(f.store.getState().activatePreparedTelegram('fixture', 'login', true), true);
  await f.store.getState().checkPendingSession();
  assert.equal(f.ui.settingsTab, 'profile');
  assert.equal(f.store.getState().preparedTelegramChallenge, null);
});
