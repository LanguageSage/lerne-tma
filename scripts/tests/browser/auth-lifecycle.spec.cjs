const { test, expect } = require('@playwright/test');

// Isolated browser/provider/transport boundaries. No real accounts or backend.
async function setup(page, context, { miniApp = false, rejectProof = false, blocked = false } = {}) {
  const state = { authenticated: false, confirmed: false, miniCalls: 0, refreshes: 0, expired: false, errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(({ miniApp, blocked }) => {
    if (!localStorage.getItem('auth_fixture_seeded')) {
      for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
        lerne_has_selected_language: 'true', lerne_target_language: 'de', lerne_welcome_seen: 'true',
        lerne_tut_seen_welcome: 'true', auth_fixture_seeded: 'true' })) localStorage.setItem(key, value);
      if (!miniApp) localStorage.setItem('lerne_force_guest', 'true');
    }
    if (blocked) window.open = () => null;
    if (miniApp) window.Telegram = { WebApp: { initData: 'synthetic-proof', initDataUnsafe: { user: { id: 101 } },
      ready() {}, expand() {}, disableClosingConfirmation() {},
      openTelegramLink(url) { window.fixtureTelegramUrl = url; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} } } };
  }, { miniApp, blocked });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    if (['t.me', 'accounts.google.com'].includes(url.hostname)) {
      state.confirmed = true;
      return route.fulfill({ contentType: 'text/html', body: '<p>Fixture provider confirmed</p>' });
    }
    return route.abort();
  });
  const profile = { user_id: -123, first_name: 'Learner', is_guest: false };
  const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh' };
  await context.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const fail = (status, detail) => route.fulfill({ status, json: { detail } });
    if (pathname === '/api/auth/v2/challenges') {
      const provider = request.postDataJSON().provider;
      return route.fulfill({ json: { challenge_id: 'fixture', secret: 's'.repeat(43),
        expires_at: new Date(Date.now() + 300000).toISOString(),
        authorization_url: provider === 'telegram' ? 'https://t.me/fixture_bot?start=auth_fixture' : 'https://accounts.google.com/fixture' } });
    }
    if (pathname.endsWith('/exchange')) {
      if (!state.confirmed) return fail(401, 'invalid_challenge');
      state.authenticated = true;
      return route.fulfill({ json: tokens });
    }
    if (pathname === '/api/auth/v2/telegram/mini-app') {
      state.miniCalls++;
      if (rejectProof) return fail(401, 'provider_proof_replayed');
      state.authenticated = true;
      return route.fulfill({ json: tokens });
    }
    if (pathname === '/api/auth/v2/refresh') {
      state.refreshes++;
      state.expired = false;
      return route.fulfill({ json: tokens });
    }
    if (!state.authenticated || state.expired) return fail(401, 'invalid_session');
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: ['telegram', 'google'] } });
    if (pathname === '/api/auth/v2/password-settings') return route.fulfill({ json: { email: null } });
    const decks = [{ id: 1, name: 'Existing auth fixture deck', target_language: 'de', stats: { total: 2, new: 2 } }];
    if (pathname === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: profile } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks });
    if (pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  return state;
}

for (const provider of ['Telegram', 'Google']) {
  test(`${provider} opens reserved browser tab and session survives reload with expired access`, async ({ page, context }) => {
    const state = await setup(page, context);
    await page.locator('.user-signin-button').click();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: new RegExp(`Войти через ${provider}$`) }).click(),
    ]);
    await expect(popup.getByText('Fixture provider confirmed')).toBeVisible();
    await page.bringToFront();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.user-name')).toHaveText('Learner');
    state.expired = true;
    await page.reload();
    await expect(page.locator('.user-name')).toHaveText('Learner');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.refreshes).toBe(1);
    expect(state.errors).toEqual([]);
  });
}

test('blocked popup exposes usable link, survives reload, and allows timeout/retry', async ({ page, context }, testInfo) => {
  const state = await setup(page, context, { blocked: true });
  await page.locator('.user-signin-button').click();
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Окно входа не открылось');
  const link = page.getByRole('link', { name: 'Окно не открылось? Нажмите здесь ↗' });
  await expect(link).toHaveAttribute('href', /https:\/\/t\.me\//);
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('link')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`blocked-${locale}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('ru'));
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(link).toBeVisible();
  await page.evaluate(() => {
    const key = 'lerne_auth_v2_pending';
    const pending = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.setItem(key, JSON.stringify({ ...pending, expiresAt: '2000-01-01T00:00:00Z' }));
  });
  await page.getByRole('button', { name: 'Я подтвердил, продолжить' }).click();
  await expect(page.getByRole('alert')).toContainText('Время подтверждения истекло');
  await expect(page.getByRole('button', { name: 'Войти через Telegram', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  const popupPromise = context.waitForEvent('page');
  await link.click(); // Native anchor navigation works even if window.open is blocked.
  const popup = await popupPromise;
  await expect(popup.getByText('Fixture provider confirmed')).toBeVisible();
  await page.bringToFront();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('Mini App uses initData once and restores tokens on subsequent reloads', async ({ page, context }) => {
  const state = await setup(page, context, { miniApp: true });
  await expect(page.locator('.user-name')).toHaveText('Learner');
  await page.reload();
  await expect(page.locator('.user-name')).toHaveText('Learner');
  expect(state.miniCalls).toBe(1);
  expect(context.pages()).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('Mini App with consumed initData opens bot confirmation and completes', async ({ page, context }) => {
  const state = await setup(page, context, { miniApp: true, rejectProof: true });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.fixtureTelegramUrl)).toContain('https://t.me/');
  state.confirmed = true;
  await page.getByRole('button', { name: 'Я подтвердил, продолжить' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.user-name')).toHaveText('Learner');
  expect(state.errors).toEqual([]);
});
