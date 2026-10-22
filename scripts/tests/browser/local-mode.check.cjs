const { test, expect } = require('@playwright/test');

test('LOCAL isolates sessions, IndexedDB and network; banner fits supported widths', async ({ page, context }, testInfo) => {
  const errors = [];
  const externalRequests = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) externalRequests.push(request.url());
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5173'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'synthetic-cloud-access', refresh_token: 'synthetic-cloud-refresh' }));
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 123, first_name: 'Cloud fixture' }));
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    apiRequests.push({ pathname, authorization: request.headers().authorization });
    const profile = { user_id: 900000001, first_name: 'Local Test', is_guest: false,
      has_selected_language: true, active_language: 'de', native_language: 'ru', is_admin: true };
    if (pathname === '/api/auth/local/login') return route.fulfill({ json: {
      access_token: 'synthetic-local-access', refresh_token: 'synthetic-local-refresh' } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [], folders: [], settings: {}, prompts: [], user_settings: {}, user_info: profile } });
    if (pathname === '/api/decks' || pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  const banner = page.getByRole('status').filter({ hasText: 'LOCAL — тестовые данные' });
  await expect(banner).toBeVisible();
  await expect(page.locator('.user-name')).toContainText('Local Test');
  const state = await page.evaluate(async () => {
    const { getLocalDb } = await import('/src/services/localDb.js');
    const { API_BASE_URL } = await import('/src/services/apiConfig.js');
    const { getAudioUrl } = await import('/src/utils/media.js');
    return { database: getLocalDb().name, base: API_BASE_URL, audio: getAudioUrl('synthetic.mp3'),
      cloudSession: JSON.parse(localStorage.getItem('lerne_auth_v2_session')),
      localSession: JSON.parse(localStorage.getItem('lerne_local:lerne_auth_v2_session')) };
  });
  expect(state.database).toBe('LerneTestDB_900000001');
  expect(state.base).toBe('/api');
  expect(state.audio).toBe('/api/media/audio/synthetic.mp3');
  expect(state.cloudSession.access_token).toBe('synthetic-cloud-access');
  expect(state.localSession.access_token).toBe('synthetic-local-access');
  expect(apiRequests.some(request => request.pathname === '/api/auth/local/login')).toBe(true);
  expect(apiRequests.some(request => request.authorization === 'Bearer synthetic-cloud-access')).toBe(false);
  await expect(page.locator('.empty-decks-state')).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(banner).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`local-${width}.png`) });
  }
  await page.reload();
  await expect(page.locator('.user-name')).toContainText('Local Test');
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
