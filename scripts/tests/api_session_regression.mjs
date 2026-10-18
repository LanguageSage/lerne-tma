// Execute the real API interceptors with Axios and isolated storage/transport.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import axios from '../../app/node_modules/axios/index.js';

const source = readFileSync(new URL('../../app/src/services/api.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export .*;\r?$/gm, '');

function fixture() {
  let session = { access_token: 'old', refresh_token: 'refresh-old' }, userId = 101;
  const calls = [];
  const f = { calls, refreshes: 0, clears: 0,
    transport: async config => ({ data: { ok: true }, status: 200, headers: {}, config }),
    refresh: async () => ({ data: { access_token: 'fresh', refresh_token: 'refresh-fresh' } }),
    get session() { return session; }, set session(value) { session = value; },
    set userId(value) { userId = value; },
  };
  const context = {
    axios: { create: config => axios.create({ ...config, adapter: async config => {
      calls.push(config);
      return f.transport(config);
    } }), post: async (...args) => { f.refreshes++; return f.refresh(...args); } },
    API_BASE_URL: '/api', getAccessToken: () => session?.access_token,
    getAuthSession: () => session, saveAuthSession: value => { session = value; },
    clearAuthSession: () => { f.clears++; session = null; }, getUserId: () => userId,
    isOfflineMode: () => false, navigator: { onLine: true }, console,
  };
  vm.runInNewContext(`${source}\nglobalThis.subject = axiosInstance;`, context);
  f.api = context.subject;
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
