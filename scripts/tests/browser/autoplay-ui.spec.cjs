const { test, expect } = require('@playwright/test');

const deck = {
  id: 1, name: 'Auto Test', target_language: 'de', is_learning: true,
  stats: { total: 3, new: 3, due: 0, learning: 0 },
};
const cards = [
  { id: 1, deck_id: 1, position: 0, queue: 'new', front: 'Guten Morgen', back: 'Доброе утро', front_text: 'Guten Morgen', back_text: 'Доброе утро' },
  { id: 2, deck_id: 1, position: 1, queue: 'new', front: 'Danke', back: 'Спасибо', front_text: 'Danke', back_text: 'Спасибо' },
  { id: 3, deck_id: 1, position: 2, queue: 'new', front: 'Bis morgen', back: 'До завтра', front_text: 'Bis morgen', back_text: 'До завтра' },
];
const audio = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

test('auto controls stay compact and open their dedicated settings tab', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_last_settings_tab', 'voice');
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: cards[0] });
    if (pathname === '/api/media/generate-card-audio') return route.fulfill({ json: { path: audio, url: audio } });
    if (pathname === '/api/user/settings') return route.fulfill({ json: { status: 'success' } });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, first_name: 'Test', is_guest: false } } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?user_id=1');
  await page.getByText('Auto Test', { exact: true }).first().click();
  await expect(page.getByText('Guten Morgen', { exact: true }).first()).toBeVisible();
  await page.getByText('Guten Morgen', { exact: true }).first().click();

  const start = page.getByRole('button', { name: 'Запустить авто-режим' });
  await expect(start).toBeVisible();
  await expect(page.getByRole('button', { name: 'Настроить' })).toHaveCount(0);
  await start.click();
  await expect(page.getByRole('button', { name: 'Настроить' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('autoplay-controls-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Настроить' }).click();

  await expect(page.getByRole('heading', { name: 'Авто-режим' })).toBeVisible();
  await expect(page.locator('#settings-tab-select')).toHaveValue('autoplay');
  await expect(page.getByText('Фраза → Перевод → Фраза → Фраза')).toBeVisible();
  await expect(page.getByText('На карточку: фраза — 6, перевод — 2.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('autoplay-settings-mobile.png'), fullPage: true });

  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lerne_last_settings_tab'))).toBe('voice');
  expect(errors).toEqual([]);
});
