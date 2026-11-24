import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlatform,
  isCapacitor,
  isTelegram,
  isWeb,
  openExternalLink,
  prepareExternalLink,
  setupBackButton,
} from '../platform.js';

const url = 'https://t.me/fixture_bot?start=auth_fixture';
const authOptions = { allowPopup: false, sameTabFallback: true };

function browser(t, extra = {}) {
  const previous = globalThis.window;
  const opened = [], navigated = [];
  globalThis.window = { open: (...args) => { opened.push(args); return null; },
    location: { assign: target => navigated.push(target) }, ...extra };
  t.after(() => { globalThis.window = previous; });
  return { opened, navigated };
}

test('auth with blocked or closed reservation navigates same tab without another popup', async t => {
  const { opened, navigated } = browser(t);
  assert.equal(prepareExternalLink(), null);
  assert.equal(await openExternalLink(url, null, authOptions), true);
  assert.equal(await openExternalLink(url, { closed: true }, authOptions), true);
  assert.equal(opened.length, 1); // Only the synchronous reservation attempt.
  assert.deepEqual(navigated, [url, url]);
});

test('usable reservation is isolated and navigated once without leaving the app', async t => {
  const popup = { closed: false, opener: {}, location: {}, document: { write() {}, close() {} } };
  const { navigated } = browser(t, { open: () => popup });
  assert.equal(prepareExternalLink(), popup);
  assert.equal(popup.opener, null);
  assert.equal(await openExternalLink(url, popup, authOptions), true);
  assert.equal(popup.location.href, url);
  assert.deepEqual(navigated, []);
});

test('failed reserved navigation closes the unused tab before same-tab fallback', async t => {
  const { opened, navigated } = browser(t);
  let closed = false;
  const popup = { closed: false, close() { closed = true; },
    get location() { throw new Error('Unavailable WindowProxy'); } };
  assert.equal(await openExternalLink(url, popup, authOptions), true);
  assert.equal(closed, true);
  assert.deepEqual(opened, []);
  assert.deepEqual(navigated, [url]);
});

test('failed reservation isolation closes the blank tab instead of orphaning it', t => {
  let closed = false;
  const popup = { document: { write() {}, close() {} }, close() { closed = true; },
    set opener(value) { throw new Error(`Cannot isolate: ${value}`); } };
  browser(t, { open: () => popup });
  assert.equal(prepareExternalLink(), null);
  assert.equal(closed, true);
});

test('Telegram bridge opens the bot without browser navigation', async t => {
  const targets = [];
  const { opened, navigated } = browser(t, {
    Telegram: { WebApp: { initData: 'synthetic', openTelegramLink: target => targets.push(target) } },
  });
  assert.equal(await openExternalLink(url, null, authOptions), true);
  assert.deepEqual(targets, [url]);
  assert.deepEqual(opened, []);
  assert.deepEqual(navigated, []);
});

test('rejected Capacitor bridge automatically falls back to same-tab navigation', async t => {
  const { opened, navigated } = browser(t, {
    Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { open: async () => { throw new Error('Unavailable'); } } } },
  });
  assert.equal(await openExternalLink(url, null, authOptions), true);
  assert.deepEqual(opened, []);
  assert.deepEqual(navigated, [url]);
});

test('restricted navigation reports failure so the manual link remains usable', async t => {
  const { opened } = browser(t, { location: { assign() { throw new Error('Restricted'); } } });
  assert.equal(await openExternalLink(url, null, authOptions), false);
  assert.deepEqual(opened, []);
});

test('platform detection distinguishes web, telegram, and capacitor native contexts', t => {
  browser(t);
  assert.equal(getPlatform(), 'web');
  assert.equal(isWeb(), true);
  assert.equal(isTelegram(), false);
  assert.equal(isCapacitor(), false);

  browser(t, { Telegram: { WebApp: { initData: 'synthetic-init-data' } } });
  assert.equal(getPlatform(), 'telegram');
  assert.equal(isTelegram(), true);
  assert.equal(isWeb(), false);
  assert.equal(isCapacitor(), false);

  browser(t, { Capacitor: { isNativePlatform: () => true } });
  assert.equal(getPlatform(), 'capacitor');
  assert.equal(isCapacitor(), true);
  assert.equal(isWeb(), false);
  assert.equal(isTelegram(), false);
});

test('setupBackButton binds and cleans up Telegram WebApp and Capacitor hardware back listeners', async t => {
  const events = [];
  let backHandler = null;
  let removedNative = false;
  let capCallback = null;
  browser(t, {
    Telegram: {
      WebApp: {
        initData: 'synthetic',
        BackButton: {
          show: () => events.push('tg:show'),
          onClick: fn => { backHandler = fn; events.push('tg:on'); },
          offClick: fn => { if (fn === backHandler) events.push('tg:off'); },
        },
      },
    },
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        App: {
          addListener: async (name, fn) => {
            events.push(`cap:${name}`);
            capCallback = fn;
            return { remove: () => { removedNative = true; } };
          },
        },
      },
    },
  });

  let clicks = 0;
  const cleanup = setupBackButton(() => { clicks += 1; });
  backHandler();
  capCallback();
  assert.equal(clicks, 2);

  cleanup();
  await Promise.resolve();
  assert.deepEqual(events, ['tg:show', 'tg:on', 'cap:backButton', 'tg:off']);
  assert.equal(removedNative, true);
});
