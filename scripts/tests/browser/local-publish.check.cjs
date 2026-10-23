const { test, expect } = require('@playwright/test');

test('LOCAL publish control saves, syncs and opens one-card preview; denies viewer', async ({ page, context }, testInfo) => {
  const errors = new Set();
  page.on('pageerror', error => errors.add(error.stack || error.message));
  await context.route('**/*', route => ['http:', 'ws:'].includes(new URL(route.request().url()).protocol)
    && new URL(route.request().url()).host === '127.0.0.1:5183'
    ? route.continue() : route.abort());
  await context.route('http://127.0.0.1:8050/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Только предпросмотр</p>' }));
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/local/transfer-card/202') return route.fulfill({ status: 403, json: { detail: 'Read only' } });
    if (pathname === '/api/local/transfer-card/101') return route.fulfill({ json: { url: 'http://127.0.0.1:8050/?publish_card=101' } });
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(() => localStorage.setItem('native_language', 'ru'));
  await page.goto('/publish-harness');
  expect([...errors]).toEqual([]);
  await page.evaluate(() => window.renderPublish(101));
  const button = page.getByRole('button', { name: 'Опубликовать в Supabase' });
  await expect(button).toBeVisible();
  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`publish-${width}.png`) });
  }
  const popupPromise = context.waitForEvent('page');
  await button.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('http://127.0.0.1:8050/?publish_card=101');
  expect(await page.evaluate(() => window.publishOrder)).toEqual(['save', 'sync']);
  await popup.close();
  await page.evaluate(() => window.renderPublish(202));
  await expect(button).toBeHidden();
  await page.evaluate(() => window.renderStudyHeader());
  await expect(button).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.locator('.header-compact').evaluate(el => [el.scrollWidth, el.clientWidth]);
    expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1] + 1);
    await page.screenshot({ path: testInfo.outputPath(`study-header-${width}.png`) });
  }
  expect([...errors]).toEqual([]);
});
