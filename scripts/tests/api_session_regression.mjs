// Execute the real API interceptors with Axios and isolated storage/transport.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IS_LOCAL } from '../../app/src/utils/localMode.js';
import axios from '../../app/node_modules/axios/index.js';

const source = readFileSync(new URL('../../app/src/services/api.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export .*;\r?$/gm, '');

function fixture() {
  let session = { access_token: 'old', refresh_token: 'refresh-old' }, userId = 101;
  const calls = [];
  const f = { calls, refreshes: 0, clears: 0,
    offlineRead: async () => ({ data: [] }),
    transport: async config => ({ data: { ok: true }, status: 200, headers: {}, config }),
    refresh: async () => ({ data: { access_token: 'fresh', refresh_token: 'refresh-fresh' } }),
    get session() { return session; }, set session(value) { session = value; },
    set userId(value) { userId = value; },
  };
  const context = { IS_LOCAL,
    axios: { create: config => axios.create({ ...config, adapter: async config => {
      calls.push(config);
      return f.transport(config);
    } }), post: async (...args) => { f.refreshes++; return f.refresh(...args); } },
    API_BASE_URL: '/api', getAccessToken: () => session?.access_token,
    getAuthSession: () => session, saveAuthSession: value => { session = value; },
    clearAuthSession: () => { f.clears++; session = null; }, getUserId: () => userId,
    isOfflineMode: () => false, navigator: { onLine: true }, console,
    offlineApi: { handle: (...args) => f.offlineRead(...args) },
  };
  vm.runInNewContext(`${source}\nglobalThis.subject = axiosInstance; globalThis.proxySubject = api;`, context);
  f.api = context.subject;
  f.proxy = context.proxySubject;
  return f;
}
function unauthorized(config) {
  throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('late 401 from the previous account cannot clear a newly signed-in session', async () => {
  const f = fixture(), gate = deferred(), started = deferred();
  f.transport = async config => { started.resolve(); await gate.promise; unauthorized(config); };
  const request = f.api.get('/auth/v2/me');
  await started.promise;
  f.userId = 202;
  f.session = { access_token: 'account-b', refresh_token: 'refresh-b' };
  gate.resolve();
  await assert.rejects(request);
  assert.equal(f.session?.access_token, 'account-b');
  assert.equal(f.refreshes, 0);
  assert.equal(f.clears, 0);
});

test('late 401 after rotation replays with the current token without another rotation', async () => {
  const f = fixture(), gate = deferred(), started = deferred();
  f.transport = async config => {
    if (config.headers.Authorization === 'Bearer old') {
      started.resolve(); await gate.promise; unauthorized(config);
    }
    return { data: { ok: true }, status: 200, headers: {}, config };
  };
  const request = f.api.get('/auth/v2/me');
  await started.promise;
  f.session = { access_token: 'fresh', refresh_token: 'refresh-fresh' };
  gate.resolve();
  assert.equal((await request).status, 200);
  assert.equal(f.refreshes, 0);
});

test('concurrent expired requests share one refresh and all replay', async () => {
  const f = fixture();
  f.transport = async config => config.headers.Authorization === 'Bearer old'
    ? unauthorized(config) : { data: {}, status: 200, headers: {}, config };
  await Promise.all(['/auth/v2/me', '/decks', '/folders'].map(url => f.api.get(url)));
  assert.equal(f.refreshes, 1);
  assert.equal(f.clears, 0);
  assert.equal(f.session.access_token, 'fresh');
});

for (const status of [0, 503, 401]) {
  test(`refresh failure ${status} only clears credentials on confirmed 401`, async () => {
    const f = fixture();
    f.transport = unauthorized;
    f.refresh = async () => { throw Object.assign(new Error('Fixture refresh failure'),
      status ? { response: { status } } : {}); };
    await assert.rejects(f.api.get('/auth/v2/me'));
    assert.equal(f.clears, status === 401 ? 1 : 0);
  });
}

test('rejected Mini App proof does not refresh or delete an existing session', async () => {
  const f = fixture();
  f.transport = unauthorized;
  await assert.rejects(f.api.post('/auth/v2/telegram/mini-app', { init_data: 'fixture' }));
  assert.equal(f.refreshes, 0);
  assert.equal(f.clears, 0);
});

test('network failure and empty local library preserve the original error', async () => {
  const f = fixture();
  const error = new Error('Network Error');
  f.transport = async () => { throw error; };
  await assert.rejects(f.proxy.get('/init'), error);
  assert.equal(f.clears, 0);
});

test('nonempty offline library is explicitly marked as cached', async () => {
  const f = fixture();
  f.transport = async () => { throw new Error('Network Error'); };
  f.offlineRead = async () => ({ data: { decks: [{ id: 1 }], folders: [] } });
  const response = await f.proxy.get('/init');
  assert.equal(response.dataSource, 'cache');
  assert.equal(response.data.decks.length, 1);
});

test('HTTP 500 and 401 never become successful offline library responses', async () => {
  for (const status of [500, 401]) {
    const f = fixture();
    f.transport = async config => { throw Object.assign(new Error('Fixture failure'), { config, response: { status } }); };
    f.refresh = async () => { throw Object.assign(new Error('Rejected refresh'), { response: { status: 401 } }); };
    f.offlineRead = async () => { assert.fail('HTTP errors must not use offline fallback'); };
    await assert.rejects(f.proxy.get('/folders'));
  }
});
