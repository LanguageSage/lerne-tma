// Execute the real storage/profile module with isolated browser boundaries.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = (process.env.AUTH_SESSION_BASELINE === '1'
  ? execFileSync('git', ['show', 'HEAD:app/src/utils/auth.js'], { encoding: 'utf8' })
  : readFileSync(new URL('../../app/src/utils/auth.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/import\.meta\.env/g, 'env')
  .replace(/export const /g, 'const ').replace(/^export \{.*\};\r?$/gm, '');
function fixture({ search = '', telegram = null, dev = false } = {}) {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = { localStorage, URLSearchParams, tr: x => x, env: { DEV: dev },
    window: { location: { search, pathname: '/', hash: '#deck', hostname: dev ? 'localhost' : 'tma-amber.vercel.app' },
      history: { state: null, replaceState(_state, _title, url) {
        context.window.location.search = new URL(url, 'https://example.test').search;
      } },
      Telegram: telegram ? { WebApp: { initDataUnsafe: { user: { id: telegram } } } } : null } };
  vm.runInNewContext(`${source}\nglobalThis.subject = { getAuthSession, getAccessToken, getUserProfile, getUserId, saveAuthSession, saveUserProfile, clearAuthSession };`, context);
  return { ...context.subject, values, window: context.window };
}

for (const options of [{ search: '?user_id=101' }, { telegram: 101 }]) {
  test(`verified account survives legacy identity hints ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    f.saveUserProfile({ user_id: -1000000000001, first_name: 'Synthetic' });
    f.saveAuthSession({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
    for (let i = 0; i < 3; i++) {
      assert.equal(f.getUserId(), -1000000000001);
      assert.equal(f.getAccessToken(), 'synthetic-access');
    }
    const reload = fixture(options);
    f.values.forEach((value, key) => reload.values.set(key, value));
    assert.equal(reload.getUserId(), -1000000000001);
    assert.equal(reload.getAccessToken(), 'synthetic-access');
  });
}

test('another tab can rotate, switch account, and log out without a stale memory session', () => {
  const f = fixture();
  f.saveAuthSession({ access_token: 'old', refresh_token: 'old-refresh' });
  assert.equal(f.getAccessToken(), 'old');
  f.values.set('lerne_auth_v2_session', JSON.stringify({ access_token: 'rotated', refresh_token: 'rotated-refresh' }));
  assert.equal(f.getAccessToken(), 'rotated');
  f.values.delete('lerne_auth_v2_session');
  assert.equal(f.getAccessToken(), null);
});

test('explicit reset is consumed once so the subsequent login survives requests', () => {
  const f = fixture({ search: '?guest=1' });
  assert.equal(f.getUserProfile(), null);
  f.saveUserProfile({ user_id: -123 });
  f.saveAuthSession({ access_token: 'new', refresh_token: 'refresh' });
  assert.equal(f.getUserId(), -123);
  assert.equal(f.getAccessToken(), 'new');
});

test('reset URL cannot clear the next login on page reload', () => {
  for (const flag of ['guest', 'reset']) {
    const f = fixture({ search: `?${flag}=1&deck=42` });
    f.getUserProfile();
    f.saveUserProfile({ user_id: -123 });
    f.saveAuthSession({ access_token: 'new', refresh_token: 'refresh' });
    const reload = fixture({ search: f.window.location.search });
    f.values.forEach((value, key) => reload.values.set(key, value));
    assert.equal(reload.getUserId(), -123);
    assert.equal(reload.getAccessToken(), 'new');
    assert.equal(new URLSearchParams(f.window.location.search).get('deck'), '42');
  }
});

test('logout suppresses legacy URL, Telegram and local development fallback', () => {
  for (const options of [{ search: '?user_id=101' }, { telegram: 101 }, { dev: true }]) {
    const f = fixture(options);
    f.values.set('lerne_force_guest', 'true');
    assert.equal(f.getUserProfile(), null);
    assert.equal(f.getAccessToken(), null);
  }
});
