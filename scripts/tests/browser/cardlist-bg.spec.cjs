const { test, expect } = require('@playwright/test');

const deck = {
  id: 1,
  name: 'German B1 Deck',
  target_language: 'de',
  is_learning: true,
  stats: { total: 3, new: 3, due: 0, learning: 0 },
};

const cards = [
  { id: 1, deck_id: 1, position: 0, queue: 'new', front: 'Hallo Welt', back: 'Привет мир' },
  { id: 2, deck_id: 1, position: 1, queue: 'new', front: 'Guten Tag', back: 'Добрый день' },
];

test('Card list background tab allows selecting preset and custom colors and updates the card list and live preview', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_last_settings_tab', 'design');
  });

  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') {
      return route.fulfill({
        json: {
          is_admin: true,
          decks: [deck],
          folders: [],
          settings: {},
          prompts: {},
          user_settings: { previewCardBg: 'dark_emerald' },
          user_info: { user_id: 1, first_name: 'Admin', is_guest: false },
        }
      });
    }
    if (pathname === '/api/admin/design/draft') {
      return route.fulfill({ json: { config: null } });
    }
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/user/settings') return route.fulfill({ json: { status: 'success' } });
    if (pathname === '/api/auth/sync') {
      return route.fulfill({ json: { status: 'ok', user: { user_id: 1, first_name: 'Admin', is_guest: false } } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/?user_id=1&admin=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();

  // 1. Open settings
  await page.locator('#tut-main-settings').click();
  await expect(page.locator('.settings-modal')).toBeVisible();

  // 2. Select design tab
  const select = page.locator('#settings-tab-select');
  await select.selectOption('design');

  // 3. Click 'Список' tab in DesignSectionTabs
  const listTabBtn = page.getByRole('button', { name: /Список/i });
  await expect(listTabBtn).toBeVisible();
  await listTabBtn.click();

  // 4. Check sub-tabs in CardListDesignSection
  await expect(page.getByRole('button', { name: 'Лицевая сторона', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обратная сторона', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Разделитель', exact: true })).toBeVisible();
  
  const bgTabBtn = page.getByRole('button', { name: 'Цвет фона', exact: true });
  await expect(bgTabBtn).toBeVisible();
  await bgTabBtn.click();

  // 5. Verify the content of the "Цвет фона" tab
  await expect(page.getByText('Готовые темы фона')).toBeVisible();
  await expect(page.getByText('Выбор цвета фона')).toBeVisible();

  // Check preset themes exist
  await expect(page.getByRole('button', { name: /Строгий графит/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Полуночный синий/i })).toBeVisible();

  // 6. Click 'Строгий графит 🖤'
  await page.getByRole('button', { name: /Строгий графит/i }).click();

  // Take screenshot of the Design modal preview with graphite background
  await page.screenshot({ path: testInfo.outputPath('design-cardlist-graphite.png'), fullPage: true });

  // 7. Close settings modal
  await page.locator('.close-btn').click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);

  // 8. Open the deck
  await page.locator('#deck-item-1').click();
  await expect(page.getByText('Hallo Welt', { exact: true })).toBeVisible();

  // Verify the card items are displayed with graphite background (not green emerald!)
  const firstCard = page.locator('#card-item-1');
  await expect(firstCard).toBeVisible();
  await expect(firstCard).toHaveClass(/bg-dark-obsidian/);

  await page.screenshot({ path: testInfo.outputPath('deck-cardlist-applied.png'), fullPage: true });

  expect(errors).toEqual([]);
});

test('Selecting a custom swatch color updates the card list background', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_last_settings_tab', 'design');
  });

  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') {
      return route.fulfill({
        json: {
          is_admin: true,
          decks: [deck],
          folders: [],
          settings: {},
          prompts: {},
          user_settings: { previewCardBg: 'dark_emerald' },
          user_info: { user_id: 1, first_name: 'Admin', is_guest: false },
        }
      });
    }
    if (pathname === '/api/admin/design/draft') return route.fulfill({ json: { config: null } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/user/settings') return route.fulfill({ json: { status: 'success' } });
    if (pathname === '/api/auth/sync') {
      return route.fulfill({ json: { status: 'ok', user: { user_id: 1, first_name: 'Admin', is_guest: false } } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/?user_id=1&admin=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();

  // 1. Open settings
  await page.locator('#tut-main-settings').click();
  await expect(page.locator('.settings-modal')).toBeVisible();

  // 2. Select design tab
  const select = page.locator('#settings-tab-select');
  await select.selectOption('design');

  // 3. Click 'Список' tab in DesignSectionTabs
  const listTabBtn = page.getByRole('button', { name: /Список/i });
  await expect(listTabBtn).toBeVisible();
  await listTabBtn.click();

  // 4. Click 'Цвет фона' subtab
  const bgTabBtn = page.getByRole('button', { name: 'Цвет фона', exact: true });
  await expect(bgTabBtn).toBeVisible();
  await bgTabBtn.click();

  // 5. Click the '#1e293b' color swatch button
  const swatch = page.locator('.design-cardlist-bg-controls .design-color-swatch[title="#1e293b"]');
  await expect(swatch).toBeVisible();
  await swatch.click();

  // 6. Close settings modal
  await page.locator('.close-btn').click();
  await expect(page.locator('.settings-modal')).toHaveCount(0);

  // 7. Open deck
  await page.locator('#deck-item-1').click();
  await expect(page.getByText('Hallo Welt', { exact: true })).toBeVisible();

  // Verify the card has custom inline background rgb(30, 41, 59) (#1e293b) and does NOT have bg-dark-emerald
  const firstCard = page.locator('#card-item-1');
  await expect(firstCard).toBeVisible();
  const cardStyle = await firstCard.getAttribute('style');
  expect(cardStyle).toContain('background: rgb(30, 41, 59)');
  expect(await firstCard.getAttribute('class')).not.toContain('bg-dark-emerald');

  await page.screenshot({ path: testInfo.outputPath('deck-cardlist-swatch-applied.png'), fullPage: true });
  expect(errors).toEqual([]);
});
