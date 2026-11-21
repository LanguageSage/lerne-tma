import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

const storage = new Map();
globalThis.window = globalThis.window || {
  location: { search: '' },
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.localStorage = {
  get length() { return storage.size; },
  key: (i) => Array.from(storage.keys())[i] ?? null,
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, locks: { request: (_n, a, b) => (typeof b === 'function' ? b : a)({}) } },
  configurable: true,
});

class MockCanceledError extends Error {
  constructor(message = 'canceled') {
    super(message);
    this.name = 'CanceledError';
    this.code = 'ERR_CANCELED';
  }
}

let transportHandler = async () => ({ status: 200, data: {} });
const requestInterceptors = [];
const responseInterceptors = [];

function createMockAxiosInstance(defaults = {}) {
  const dispatch = async (config) => {
    let cfg = { ...defaults, ...config, headers: { ...(defaults?.headers || {}), ...(config?.headers || {}) } };
    for (const { onFulfilled } of requestInterceptors) {
      cfg = await onFulfilled(cfg);
    }
    try {
      const response = await transportHandler(cfg);
      let res = { status: 200, ...response, config: cfg };
      for (const { onFulfilled } of responseInterceptors) {
        if (onFulfilled) res = await onFulfilled(res);
      }
      return res;
    } catch (err) {
      let currentErr = err;
      if (currentErr && typeof currentErr === 'object' && !currentErr.config) {
        currentErr.config = cfg;
      }
      for (const { onRejected } of responseInterceptors) {
        if (onRejected) {
          currentErr = await onRejected(currentErr);
          return currentErr;
        }
      }
      throw currentErr;
    }
  };
  const instance = (cfg) => dispatch(cfg);
  instance.defaults = { ...defaults };
  instance.get = (url, cfg = {}) => dispatch({ ...cfg, method: 'get', url });
  instance.post = (url, data, cfg = {}) => dispatch({ ...cfg, method: 'post', url, data });
  instance.interceptors = {
    request: { use: (onFulfilled, onRejected) => requestInterceptors.push({ onFulfilled, onRejected }) },
    response: { use: (onFulfilled, onRejected) => responseInterceptors.push({ onFulfilled, onRejected }) },
  };
  return instance;
}

const mockAxios = {
  CanceledError: MockCanceledError,
  create: (defaults) => createMockAxiosInstance(defaults),
  post: async () => ({ status: 200, data: { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' } }),
};

mock.module('axios', { defaultExport: mockAxios });
mock.module('../apiConfig.js', { namedExports: { API_BASE_URL: '/api', mediaURL: (v) => v } });

const { saveAuthSession, clearAuthSession, getSessionIdentity } = await import('../../utils/auth.js');
const { networkApi } = await import('../networkApi.js');
const { getLocalDb, closeLocalDb } = await import('../localDb.js');

const GEN_A = 'a'.repeat(64);
const GEN_B = 'b'.repeat(64);

beforeEach(async () => {
  closeLocalDb();
  storage.clear();
  mockAxios.post = async () => ({ status: 200, data: { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' } });
  saveAuthSession({ account_id: 1, access_token: 'tok-1', refresh_token: 'ref-1', session_id: 'ses-1' });
  const db = getLocalDb(1);
  await db.syncState.clear();
});

const waitOrFail = (gate, label) => Promise.race([
  gate,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1000)),
]);

test('concurrent /sync/v2/status requests share one HTTP GET and do not cache after completion', async () => {
  let statusCalls = 0;
  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise((r) => { releaseFirst = r; });
  const firstStarted = new Promise((r) => { markFirstStarted = r; });

  transportHandler = async (cfg) => {
    const path = cfg.url?.split('?')[0];
    if (path === '/sync/v2/status') {
      statusCalls++;
      if (statusCalls === 1) {
        markFirstStarted();
        await firstGate;
      }
      return { data: { server_generation: GEN_A, seq: statusCalls } };
    }
    return { data: { ok: true } };
  };

  const p1 = networkApi.get('/sync/v2/status');
  const p2 = networkApi.get('/sync/v2/status');
  const p3 = networkApi.get('/sync/v2/status');
  try {
    await Promise.race([waitOrFail(firstStarted, 'firstStarted'), p1]);
    assert.equal(statusCalls, 1);
  } finally {
    releaseFirst();
  }
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.data.seq, 1);
  assert.equal(r2.data.seq, 1);
  assert.equal(r3.data.seq, 1);

  // Subsequent call after completion must hit network again (no permanent caching)
  const r4 = await networkApi.get('/sync/v2/status');
  assert.equal(statusCalls, 2);
  assert.equal(r4.data.seq, 2);
});

test('concurrent cold API calls without Dexie serverGeneration share one /sync/v2/status fetch', async () => {
  const calls = [];
  let releaseStatus;
  let markStatusStarted;
  const gate = new Promise((r) => { releaseStatus = r; });
  const statusStarted = new Promise((r) => { markStatusStarted = r; });

  transportHandler = async (cfg) => {
    const path = cfg.url?.split('?')[0];
    calls.push(path);
    if (path === '/sync/v2/status') {
      markStatusStarted();
      await gate;
      return { data: { server_generation: GEN_A } };
    }
    return { data: { url: path, gen: cfg.headers['X-Lerne-Generation'] } };
  };

  const pInit = networkApi.get('/init');
  const pMsgs = networkApi.get('/messages');
  const pDecks = networkApi.get('/decks');
  try {
    await Promise.race([waitOrFail(statusStarted, 'statusStarted'), pInit]);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(calls.filter((u) => u === '/sync/v2/status'), ['/sync/v2/status']);
  } finally {
    releaseStatus();
  }
  const [rInit, rMsgs, rDecks] = await Promise.all([pInit, pMsgs, pDecks]);
  assert.equal(calls.filter((u) => u === '/sync/v2/status').length, 1);
  assert.equal(rInit.data.gen, GEN_A);
  assert.equal(rMsgs.data.gen, GEN_A);
  assert.equal(rDecks.data.gen, GEN_A);
});

test('status single-flight releases cleanly on network/server error and propagates failure to all waiters', async () => {
  let statusCalls = 0;
  let releaseErr;
  let markErrStarted;
  const gate = new Promise((r) => { releaseErr = r; });
  const errStarted = new Promise((r) => { markErrStarted = r; });

  transportHandler = async (cfg) => {
    const path = cfg.url?.split('?')[0];
    if (path === '/sync/v2/status') {
      statusCalls++;
      if (statusCalls === 1) {
        markErrStarted();
        await gate;
        const err = new Error('Server 500');
        err.response = { status: 500, data: { detail: 'boom' } };
        throw err;
      }
      return { data: { server_generation: GEN_A } };
    }
    return { data: {} };
  };

  const p1 = networkApi.get('/sync/v2/status');
  const p2 = networkApi.get('/sync/v2/status');
  try {
    await Promise.race([waitOrFail(errStarted, 'errStarted'), p1]);
    assert.equal(statusCalls, 1);
  } finally {
    releaseErr();
  }

  await assert.rejects(p1, (e) => e?.response?.status === 500);
  await assert.rejects(p2, (e) => e?.response?.status === 500);

  // Clean recovery after failure
  const ok = await networkApi.get('/sync/v2/status');
  assert.equal(statusCalls, 2);
  assert.equal(ok.data.server_generation, GEN_A);
});

test('status single-flight never mixes accounts or sessions and rejects stale callers after switch', async () => {
  let releaseU1;
  let markU1Started;
  const u1Gate = new Promise((r) => { releaseU1 = r; });
  const u1Started = new Promise((r) => { markU1Started = r; });
  const authSeen = [];

  transportHandler = async (cfg) => {
    authSeen.push(cfg.headers.Authorization);
    if (cfg.headers.Authorization === 'Bearer tok-1') {
      markU1Started();
      await u1Gate;
      return { data: { server_generation: GEN_A } };
    }
    return { data: { server_generation: GEN_B } };
  };

  const identity1 = getSessionIdentity();
  const pU1 = networkApi.get('/sync/v2/status', { _expectedUserId: 1, _expectedSessionIdentity: identity1 });
  try {
    await Promise.race([waitOrFail(u1Started, 'u1Started'), pU1]);
    // Switch account to user 2 while user 1 /sync/v2/status is still in flight
    saveAuthSession({ account_id: 2, access_token: 'tok-2', refresh_token: 'ref-2', session_id: 'ses-2' });
    const rU2 = await networkApi.get('/sync/v2/status');
    assert.equal(rU2.data.server_generation, GEN_B);
    assert.deepEqual(authSeen, ['Bearer tok-1', 'Bearer tok-2']);
  } finally {
    releaseU1();
  }

  // Unblock old flight: stale caller must NOT receive response across account switch
  await assert.rejects(pU1, (err) => err instanceof MockCanceledError || err?.code === 'ERR_CANCELED');
  clearAuthSession();
});

test('concurrent /sync/v2/status hitting 401 refreshes once and replays without single-flight deadlock', async () => {
  let statusAttempts = 0;
  let refreshCalls = 0;
  let release401;
  let mark401Started;
  const gate = new Promise((r) => { release401 = r; });
  const started401 = new Promise((r) => { mark401Started = r; });

  mockAxios.post = async (url) => {
    if (url === '/api/auth/v2/refresh') {
      refreshCalls++;
      return { status: 200, data: { account_id: 1, access_token: 'tok-fresh', refresh_token: 'ref-fresh' } };
    }
    throw new Error(`Unexpected post ${url}`);
  };

  transportHandler = async (cfg) => {
    const path = cfg.url?.split('?')[0];
    if (path === '/sync/v2/status') {
      statusAttempts++;
      if (cfg.headers.Authorization === 'Bearer tok-1') {
        mark401Started();
        await gate;
        const err = new Error('Unauthorized');
        err.response = { status: 401, data: { detail: 'expired' } };
        throw err;
      }
      assert.equal(cfg.headers.Authorization, 'Bearer tok-fresh');
      return { data: { server_generation: GEN_A } };
    }
    return { data: {} };
  };

  const p1 = networkApi.get('/sync/v2/status');
  const p2 = networkApi.get('/sync/v2/status');
  try {
    await Promise.race([waitOrFail(started401, 'started401'), p1]);
    assert.equal(statusAttempts, 1);
  } finally {
    release401();
  }
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(refreshCalls, 1);
  assert.equal(statusAttempts, 2);
  assert.equal(r1.data.server_generation, GEN_A);
  assert.equal(r2.data.server_generation, GEN_A);
});
