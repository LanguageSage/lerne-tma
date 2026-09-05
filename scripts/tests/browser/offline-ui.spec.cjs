const { test, expect } = require('@playwright/test');

test('real application displays synced local decks on desktop and mobile', async ({ page, context, request }, testInfo) => {
  const health = await request.get('http://127.0.0.1:8199/api/health').catch(() => null);
  test.skip(!health?.ok(), 'Start scripts/tests/offline_sandbox.py for the full UI smoke test');
  const errors = [];
  page.on('pageerror', error => { if (errors.length < 3) errors.push(error.stack); });
  await page.routeWebSocket('**/*', () => {});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.fulfill({ body: '', contentType: 'text/plain' });
    const response = await route.fetch();
    return route.fulfill({ response });
  });
  await context.addInitScript(() => {
    localStorage.setItem('offline_mode', 'true');
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  await page.route('**/api/**', async route => {
    const original = new URL(route.request().url());
    if (original.pathname === '/api/sync/v2/pull' || original.pathname === '/api/sync/v2/push' || original.pathname === '/api/auth/sync') {
      const response = await route.fetch({ url: `http://127.0.0.1:8199${original.pathname}${original.search}` });
      return route.fulfill({ response });
    }
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?offline=1&user_id=1');
  await expect(page.getByText('Офлайн-проверка', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('offline-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('offline-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText('Офлайн-проверка', { exact: true }).first().click();
  await expect(page.getByText('Guten Morgen', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('offline-cards-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
