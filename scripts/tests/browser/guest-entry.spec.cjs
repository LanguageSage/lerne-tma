const { test, expect } = require('@playwright/test');

async function setup(page, context, identified = false) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(identified => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    // Reproduce production: no implicit development account on localhost.
    window.Capacitor = { isNativePlatform: () => false };
    if (identified) {
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Learner', is_guest: false }));
    }
  }, identified);
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  let authenticated = identified;
  let didLogin = false;
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const profile = { user_id: 1, first_name: 'Learner', is_guest: false };
    if (pathname === '/api/auth/v2/email-password/login') {
      authenticated = true;
      didLogin = true;
      return route.fulfill({ json: { access_token: 'isolated-test-access', refresh_token: 'isolated-test-refresh' } });
    }
    if (!authenticated) return route.fulfill({ status: 401, json: { detail: 'authentication_required' } });
    const decks = didLogin ? [{ id: 1, name: 'Existing German deck', target_language: 'de', stats: { total: 2, new: 2 } }] : [];
    if (pathname === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: profile } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: ['email_password'] } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks });
    if (pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('.view-decks')).toBeVisible();
  return errors;
}

test('fresh browser with 401 offers login instead of reporting an empty account', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  await expect(page.locator('.user-signin-button')).toBeVisible();
  await expect(page.locator('.guest-banner')).toBeVisible();
  await expect(page.locator('.empty-decks-state')).toContainText('Войдите в аккаунт');
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toHaveCount(0);
  await page.locator('.empty-decks-state').getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Вход в аккаунт', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти через Telegram', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Позже', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const entry = page.locator('.user-signin-button');
      await expect(entry).toBeVisible();
      const bounds = await entry.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath('guest-' + locale + '-' + width + '.png'), fullPage: true });
    }
  }
  await page.locator('.user-signin-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('identified empty account retains profile and the create-deck action', async ({ page, context }) => {
  const errors = await setup(page, context, true);
  await expect(page.locator('.user-name')).toHaveText('Learner');
  await expect(page.locator('.user-signin-button')).toHaveCount(0);
  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(page.getByText('У вас пока нет колод', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить первую колоду', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('login from a fresh browser restores the profile and existing decks', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.locator('.user-signin-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('isolated@example.test');
  await dialog.getByLabel('Пароль', { exact: true }).fill('isolated-test-password');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.user-name')).toHaveText('Learner');
  await expect(page.getByText('Existing German deck', { exact: true })).toBeVisible();
  await expect(page.locator('.user-signin-button')).toHaveCount(0);
  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(page.locator('.empty-decks-state')).toHaveCount(0);
  expect(errors).toEqual([]);
});
