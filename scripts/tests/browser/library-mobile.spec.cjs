const { test, expect } = require('./isolated-fixture.cjs');
const { devices } = require('@playwright/test');
const { writeFileSync } = require('node:fs');
const states = new WeakMap();

test.use({ ...devices['Pixel 7'] });

test.afterEach(async ({ page }, testInfo) => {
  const state = states.get(page);
  if (!state) return;
  const snapshot = await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useAuthStore } = await import('/src/store/useAuthStore.js');
    const { useLanguageStore } = await import('/src/store/useLanguageStore.js');
    const store = useDeckStore.getState();
    const cache = JSON.parse(localStorage.getItem('lerne_init_cache') || 'null');
    return { account: useAuthStore.getState().userProfile?.user_id,
      language: useLanguageStore.getState().activeLanguage,
      store: { decks: store.decks.length, folders: store.folders.length, status: store.libraryStatus, error: store.libraryError },
      cache: cache && { account: cache.user_id ?? cache.user_info?.user_id, decks: cache.decks?.length, folders: cache.folders?.length } };
  });
  const diagnostic = testInfo.outputPath('library-diagnostic.json');
  writeFileSync(diagnostic, JSON.stringify({ requests: state.requests, snapshot }, null, 2));
  await testInfo.attach('library-diagnostic.json', { path: diagnostic, contentType: 'application/json' });
});

// Synthetic accounts only. The shared fixture blocks every external request.
async function setup(page, context, options = {}) {
  const state = { authenticated: !options.fresh, failed: !!options.failed, network: !!options.network,
    refreshes: 0, requests: [], syncBodies: [], errors: [] };
  states.set(page, state);
  const language = options.language || 'de';
  const profile = { user_id: 101, first_name: 'Learner', is_guest: false,
    active_language: language, has_selected_language: true, native_language: 'ru' };
  const folders = options.empty ? [] : [{ id: 11, name: 'Mobile library folder', ...(options.legacyParent ? {} : { parent_id: null }), target_language: language },
    { id: 12, name: 'Nested mobile folder', parent_id: 11, target_language: language }];
  const decks = options.empty ? [] : [{ id: 21, name: 'Mobile root deck', folder_id: null, target_language: language, stats: { total: 2, new: 2 } },
    { id: 22, name: 'Mobile nested deck', folder_id: 12, target_language: language, stats: { total: 2, new: 2 } }];
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(({ profile, fresh, cache, expired }) => {
    if (localStorage.getItem('mobile_fixture_seeded')) return;
    localStorage.setItem('mobile_fixture_seeded', 'true');
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_target_language: 'de', lerne_has_selected_language: 'true', lerne_welcome_seen: 'true',
      lerne_tut_seen_welcome: 'true', lerne_settings_version: '6' })) localStorage.setItem(key, value);
    if (fresh) localStorage.setItem('lerne_force_guest', 'true');
    else {
      localStorage.setItem('lerne_user_profile', JSON.stringify(profile));
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: expired ? 'expired' : 'fixture-access', refresh_token: 'fixture-refresh' }));
    }
    if (cache) {
      localStorage.setItem('lerne_init_cache', JSON.stringify(cache));
      localStorage.setItem('lerne_init_cache_version', '3');
    }
    localStorage.setItem('preserve-user-data', 'sentinel');
  }, { profile, fresh: options.fresh, expired: options.expired,
    cache: options.cache ? { user_id: 101, decks, folders, user_info: profile } : null });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (status, data) => {
      if (['/api/auth/v2/me', '/api/init', '/api/folders', '/api/decks'].includes(path))
        state.requests.push({ path, status, account: state.authenticated ? 101 : null,
          decks: Array.isArray(data) && path === '/api/decks' ? data.length : data.decks?.length,
          folders: Array.isArray(data) && path === '/api/folders' ? data.length : data.folders?.length });
      return route.fulfill({ status, json: data });
    };
    if (path === '/api/auth/v2/email-password/login') {
      state.authenticated = true;
      return reply(200, { access_token: 'fixture-access', refresh_token: 'fixture-refresh' });
    }
    if (path === '/api/auth/v2/refresh') {
      state.refreshes++;
      return reply(options.rejectRefresh ? 401 : 200, options.rejectRefresh ? { detail: 'invalid_session' }
        : { access_token: 'fixture-access', refresh_token: 'fixture-refresh' });
    }
    if (!state.authenticated || !request.headers().authorization || request.headers().authorization === 'Bearer expired') return reply(401, { detail: 'invalid_session' });
    if (path === '/api/auth/v2/me') return reply(200, profile);
    if (path === '/api/auth/v2/identities') return reply(200, { providers: ['email_password'] });
    if (path === '/api/auth/v2/password-settings') return reply(200, {});
    if (path === '/api/messages') return reply(200, []);
    if (path === '/api/auth/sync') {
      state.syncBodies.push(request.postDataJSON());
      return reply(200, { status: 'ok', user: profile });
    }
    if (['/api/init', '/api/decks', '/api/folders'].includes(path)) {
      if (state.network) return route.abort('internetdisconnected');
      if (state.failed || (path === '/api/init' && options.initOnlyFailure)
          || (path === '/api/folders' && options.foldersFailure)) return reply(500, { detail: 'service_unavailable' });
      if (path === '/api/init') return reply(200, { decks, folders, user_info: profile, settings: {}, prompts: [], user_settings: {} });
      return reply(200, path === '/api/decks' ? decks : folders);
    }
    return reply(200, {});
  });
  await page.goto('/');
  return state;
}

async function login(page) {
  await page.locator('.user-signin-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('mobile@example.test');
  await dialog.getByLabel('Пароль', { exact: true }).fill('synthetic password');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectLibrary(page) {
  await expect(page.getByRole('heading', { name: 'Mobile library folder', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Mobile root deck/ })).toBeVisible();
}

test('fresh login restores server learning language, folders, decks and survives reload', async ({ page, context }) => {
  const state = await setup(page, context, { fresh: true, language: 'en' });
  await login(page);
  await expectLibrary(page);
  await page.reload();
  await expectLibrary(page);
  expect(state.syncBodies.every(body => body.active_language !== 'de')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('500 on a clean mobile session shows an error, retry restores both collections', async ({ page, context }, testInfo) => {
  const state = await setup(page, context, { failed: true });
  await expect(page.getByText('Не удалось загрузить библиотеку', { exact: true })).toBeVisible();
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-error.png'), fullPage: true });
  state.failed = false;
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expectLibrary(page);
  expect(await page.evaluate(() => localStorage.getItem('preserve-user-data'))).toBe('sentinel');
});

test('network failure with an empty Dexie cannot replace cached library or claim an empty account', async ({ page, context }) => {
  await setup(page, context, { network: true, cache: true, legacyParent: true });
  await expectLibrary(page);
  await expect(page.getByText('Показаны сохранённые данные', { exact: true })).toBeVisible();
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_init_cache')));
  expect(cached.decks).toHaveLength(2);
  expect(cached.folders).toHaveLength(2);
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toHaveCount(0);
});

test('failed init recovers through decks and folders endpoints', async ({ page, context }) => {
  const state = await setup(page, context, { initOnlyFailure: true });
  await expectLibrary(page);
  expect(state.requests.some(r => r.path === '/api/init' && r.status === 500)).toBe(true);
  expect(state.requests.some(r => r.path === '/api/decks' && r.decks === 2)).toBe(true);
  expect(state.requests.some(r => r.path === '/api/folders' && r.folders === 2)).toBe(true);
});

test('folders failure after fresh login is a load error', async ({ page, context }) => {
  await setup(page, context, { fresh: true, foldersFailure: true });
  await login(page);
  await expect(page.getByText('Не удалось загрузить библиотеку', { exact: true })).toBeVisible();
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toHaveCount(0);
});

test('same-account login preserves saved folders and decks when reloading fails', async ({ page, context }) => {
  const state = await setup(page, context, { cache: true });
  await expectLibrary(page);
  state.failed = true;
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/store/useAuthStore.js');
    await useAuthStore.getState().finishLogin({ access_token: 'fixture-access', refresh_token: 'fixture-refresh' });
  });
  await expectLibrary(page);
  await expect(page.getByText('Показаны сохранённые данные', { exact: true })).toBeVisible();
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_init_cache')));
  expect(cache.decks).toHaveLength(2);
  expect(cache.folders).toHaveLength(2);
});

test('confirmed server empty account retains the create action', async ({ page, context }) => {
  await setup(page, context, { empty: true });
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить первую колоду', exact: true })).toBeVisible();
});

test('expired access refreshes once and restores nested folder navigation', async ({ page, context }) => {
  const state = await setup(page, context, { expired: true });
  await expectLibrary(page);
  expect(state.refreshes).toBe(1);
  await page.getByRole('heading', { name: 'Mobile library folder', exact: true }).click();
  await page.getByRole('heading', { name: 'Nested mobile folder', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Mobile nested deck/ })).toBeVisible();
});

test('rejected refresh never reports an empty account', async ({ page, context }) => {
  await setup(page, context, { expired: true, rejectRefresh: true });
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Войти в аккаунт', exact: true }).first()).toBeVisible();
});

test('load error and saved-data status fit mobile widths and translated UI', async ({ page, context }, testInfo) => {
  await setup(page, context, { failed: true, cache: true });
  await expectLibrary(page);
  await expect(page.getByText('Показаны сохранённые данные', { exact: true })).toBeVisible();
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async code => (await import('/src/i18n/locale.js')).setInterfaceLanguage(code), locale);
    for (const width of [320, 375, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const retry = page.getByRole('button', { name: locale === 'ru' ? 'Повторить загрузку' : 'Retry loading', exact: true });
      await expect(retry).toBeVisible();
      expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cached-${locale}-${width}.png`), fullPage: true });
    }
  }
});
