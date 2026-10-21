const { test, expect } = require('./isolated-fixture.cjs');

test.use({ launchOptions: { args: ['--enable-automation'], ignoreDefaultArgs: ['--disable-popup-blocking'] } });

// Isolated browser/provider/transport boundaries. No real accounts or backend.
async function setup(page, context, { miniApp = false, rejectProof = false, blocked = false, holdChallenge = false, autoConfirm = true } = {}) {
  const state = { authenticated: false, confirmed: false, miniCalls: 0, refreshes: 0, expired: false, errors: [], challenges: [], exchanges: [], opens: [] };
  let releaseChallenge;
  const challengeGate = holdChallenge ? new Promise(resolve => { releaseChallenge = resolve; }) : Promise.resolve();
  state.releaseChallenge = releaseChallenge;
  await page.exposeFunction('fixtureOpen', () => state.opens.push('open'));
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(({ miniApp, blocked }) => {
    if (!localStorage.getItem('auth_fixture_seeded')) {
      for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
        lerne_has_selected_language: 'true', lerne_target_language: 'de', lerne_welcome_seen: 'true',
        lerne_tut_seen_welcome: 'true', auth_fixture_seeded: 'true' })) localStorage.setItem(key, value);
      if (!miniApp) localStorage.setItem('lerne_force_guest', 'true');
    }
    const open = window.open.bind(window);
    window.open = (...args) => { window.fixtureOpen?.(); return blocked ? null : open(...args); };
    if (miniApp) window.Telegram = { WebApp: { initData: 'synthetic-proof', initDataUnsafe: { user: { id: 101 } },
      ready() {}, expand() {}, disableClosingConfirmation() {},
      openTelegramLink(url) { window.fixtureTelegramUrl = url; },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} } } };
  }, { miniApp, blocked });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    if (['t.me', 'accounts.google.com'].includes(url.hostname)) {
      if (autoConfirm) state.confirmed = true;
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
      state.challenges.push(request.postDataJSON());
      await challengeGate;
      return route.fulfill({ json: { challenge_id: 'fixture', secret: 's'.repeat(43),
        expires_at: new Date(Date.now() + 300000).toISOString(),
        authorization_url: provider === 'telegram' ? 'https://t.me/fixture_bot?start=auth_fixture' : 'https://accounts.google.com/fixture' } });
    }
    if (pathname.endsWith('/exchange')) {
      state.exchanges.push(request.postDataJSON());
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
  test(`${provider} opens once and session survives reload with expired access`, async ({ page, context }) => {
    const state = await setup(page, context);
    await page.locator('.user-signin-button').click();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      (provider === 'Telegram' ? page.getByRole('link', { name: 'Войти через Telegram', exact: true })
        : page.getByRole('button', { name: /Войти через Google$/ })).click(),
    ]);
    await expect(popup.getByText('Fixture provider confirmed')).toBeVisible();
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    expect(context.pages()).toHaveLength(2);
    if (provider === 'Telegram') {
      expect(state.opens).toHaveLength(0);
      expect(state.challenges).toEqual([{ provider: 'telegram', purpose: 'login' }]);
    }
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

test('Chrome popup policy blocks an unsolicited script popup', async ({ page, context }) => {
  await setup(page, context);
  // Playwright evaluate grants a gesture; CDP can exercise the actual policy
  // without granting user activation to this script.
  const cdp = await context.newCDPSession(page);
  const command = await cdp.send('Browser.getBrowserCommandLine');
  expect(command.arguments).not.toContain('--disable-popup-blocking');
  // Setup/navigation may leave transient activation in automated Chrome.
  // Wait for its real expiry before checking a delayed script invocation.
  await expect.poll(async () => (await cdp.send('Runtime.evaluate', {
    expression: 'navigator.userActivation.isActive', returnByValue: true, userGesture: false,
  })).result.value, { timeout: 10000 }).toBe(false);
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: "window.open('about:blank', '_blank') === null", returnByValue: true, userGesture: false,
  });
  expect(result.value).toBe(true);
  expect(context.pages()).toHaveLength(1);
});

test('native Telegram link works with window.open blocked, including keyboard and mobile layout', async ({ page, context }, testInfo) => {
  const state = await setup(page, context, { blocked: true });
  await page.locator('.user-signin-button').click();
  const telegram = page.getByRole('link', { name: 'Войти через Telegram', exact: true });
  await expect(telegram).toHaveAttribute('href', 'https://t.me/fixture_bot?start=auth_fixture');
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('a.auth-telegram')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`native-${locale}-${width}.png`), fullPage: true });
    }
  }
  const pendingBefore = await page.evaluate(() => sessionStorage.getItem('lerne_auth_v2_pending'));
  expect(pendingBefore).toBeNull(); // Preflight alone cannot start a login/polling.
  await page.locator('a.auth-telegram').focus();
  const popupPromise = context.waitForEvent('page');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await expect(popup.getByText('Fixture provider confirmed')).toBeVisible();
  await page.bringToFront();
  await expect(page.locator('.user-name')).toHaveText('Learner');
  expect(state.opens).toHaveLength(0);
  expect(state.challenges).toHaveLength(1);
  expect(context.pages()).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

for (const blocked of [false, true]) {
  test(`early click shares preflight and ${blocked ? 'blocked popup navigates current tab and restores' : 'uses one reserved tab'}`, async ({ page, context }) => {
    const state = await setup(page, context, { blocked, holdChallenge: true });
    await page.locator('.user-signin-button').click();
    await expect.poll(() => state.challenges.length).toBe(1);
    await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    await expect.poll(() => state.opens.length).toBe(1);
    expect(context.pages()).toHaveLength(blocked ? 1 : 2);
    state.releaseChallenge();
    const providerPage = blocked ? page : context.pages().find(candidate => candidate !== page);
    await expect(providerPage.getByText('Fixture provider confirmed')).toBeVisible();
    if (blocked) {
      // The original pending challenge is saved before leaving; return/reload
      // exchanges it without a second POST /challenges or another window.open.
      expect(await page.evaluate(() => sessionStorage.getItem('lerne_auth_v2_pending'))).toBeNull();
      await page.goBack();
    } else {
      await page.bringToFront();
    }
    await expect(page.locator('.user-name')).toHaveText('Learner');
    expect(state.exchanges.at(-1)).toEqual({ secret: 's'.repeat(43) });
    expect(state.challenges).toHaveLength(1);
    expect(state.opens).toHaveLength(1);
    expect(context.pages()).toHaveLength(blocked ? 1 : 2);
    expect(state.errors).toEqual([]);
  });
}

test('rapid repeat clicks do not open more tabs or challenges', async ({ page, context }) => {
  const state = await setup(page, context, { autoConfirm: false });
  await page.locator('.user-signin-button').click();
  const telegram = page.getByRole('link', { name: 'Войти через Telegram', exact: true });
  await expect(telegram).toBeVisible();
  await telegram.dblclick();
  await expect.poll(() => context.pages().length).toBe(2);
  expect(state.challenges).toHaveLength(1);
  expect(state.opens).toHaveLength(0);
  state.confirmed = true;
  await page.getByRole('button', { name: 'Я подтвердил, продолжить' }).click();
  await expect(page.locator('.user-name')).toHaveText('Learner');
});

test('pending native login exposes last-resort link, survives reload and expires', async ({ page, context }, testInfo) => {
  const state = await setup(page, context, { autoConfirm: false });
  await page.locator('.user-signin-button').click();
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Войти через Telegram', exact: true }).click();
  const firstPopup = await popupPromise;
  await expect(firstPopup.getByText('Fixture provider confirmed')).toBeVisible();
  await firstPopup.close();
  const link = page.getByRole('dialog').locator('a:not(.auth-telegram)');
  await expect(link).toHaveAttribute('href', /https:\/\/t\.me\//);
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(link).toBeVisible();
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
  await expect(page.getByRole('link', { name: 'Войти через Telegram', exact: true })).toBeVisible();
  const retryPopupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Войти через Telegram', exact: true }).click();
  const retryPopup = await retryPopupPromise;
  await expect(retryPopup.getByText('Fixture provider confirmed')).toBeVisible();
  await retryPopup.close();
  const manualPopupPromise = context.waitForEvent('page');
  await link.click(); // Native anchor navigation works even if window.open is blocked.
  const popup = await manualPopupPromise;
  await expect(popup.getByText('Fixture provider confirmed')).toBeVisible();
  state.confirmed = true;
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
