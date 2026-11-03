const { test, expect } = require('./isolated-fixture.cjs');

const deck = { id: 601, name: 'Длинное название колоды — Deutsch für den Alltag', role: 'owner',
  target_language: 'de', folder_id: 11, stats: { total: 1, new: 1 } };
const folders = [{ id: 11, name: 'Deutsch', parent_id: null },
  { id: 12, name: 'Упражнения для самостоятельного повторения', parent_id: 11 }];
const card = { id: 601, deck_id: 601, front: 'Guten Morgen', back: 'Доброе утро', queue: 'new' };

test.beforeEach(async ({ page }) => {
  page.menuErrors = [];
  page.on('pageerror', error => page.menuErrors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.menuErrors).toEqual([]); });

async function setup(page, context) {
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated', refresh_token: 'isolated' }));
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [{ ...deck, folder_id: null, is_learning: true }], folders, settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks/601/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-601')).toBeVisible();
  await page.evaluate(async ({ deck, folders, card }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    window.menuCalls = [];
    const record = name => async (...args) => {
      window.menuCalls.push([name, ...args]);
      if (window.failMenuAction && name !== 'toast') throw new Error('synthetic failure');
      return { success: true, type: 'copy' };
    };
    useDeckStore.setState({ currentDeck: deck, deckCards: [card], folders, cardsLoading: false,
      handleShareDeck: record('share'), handleSyncDeck: record('sync'), moveDeckToFolder: record('move'),
      copyDeckToFolder: record('copy'), handleResetProgress: record('reset'), handleDeleteDeck: record('delete') });
    useUiStore.setState({ view: 'cards', showToast: record('toast') });
    window.headerClicks = 0;
    document.addEventListener('click', event => {
      if (event.target.closest('.header-actions')) window.headerClicks++;
    });
  }, { deck, folders, card });
  await expect(page.locator('#card-item-601')).toBeVisible();
}

async function open(page) {
  await page.getByTitle('Опции колоды', { exact: true }).click();
  await expect(page.locator('.deck-dropdown-menu')).toBeVisible();
  return page.locator('.deck-dropdown-menu');
}

test('deck menu preserves permissions, inbox restrictions and media/rename/access entry points', async ({ page, context }) => {
  await setup(page, context);
  for (const [role, readonly, inbox, count] of [
    ['owner', false, false, 10], ['editor', false, false, 10], ['viewer', false, false, 1],
    [null, false, false, 10], [null, true, false, 1], ['owner', false, true, 1], ['viewer', false, true, 0],
  ]) {
    await page.evaluate(async ({ role, readonly, inbox }) => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      useDeckStore.setState(s => ({ currentDeck: { ...s.currentDeck, role, is_global_readonly: readonly, is_inbox: inbox } }));
    }, { role, readonly, inbox });
    const menu = await open(page);
    await expect(menu.locator(':scope > .dropdown-item')).toHaveCount(count);
    if (inbox && count) await expect(menu).toHaveText('📎 Ресурсы колоды');
    await page.locator('.study-deck-hero-btn').dispatchEvent('mousedown');
    await expect(menu).toHaveCount(0);
  }
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ currentDeck: { ...useDeckStore.getState().currentDeck, role: 'owner', is_inbox: false } });
  });
  await (await open(page)).getByText('📎 Ресурсы колоды', { exact: true }).click();
  await expect(page.locator('.deck-dropdown-menu')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ресурсы колоды' })).toBeVisible();
  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    window.menuUi = useUiStore;
  });
  await page.locator('.settings-overlay .close-btn').click();
  await (await open(page)).getByText('✍️ Переименовать', { exact: true }).click();
  expect(await page.evaluate(() => [window.menuUi.getState().isRenameModalOpen, window.menuUi.getState().deckToRename.id])).toEqual([true, 601]);
  await page.evaluate(() => window.menuUi.setState({ isRenameModalOpen: false }));
  await (await open(page)).getByText('👥 Совместный доступ', { exact: true }).click();
  expect(await page.evaluate(() => window.menuUi.getState().collaboratorsTarget)).toEqual({ type: 'deck', id: 601, name: deck.name });
  expect(await page.evaluate(() => window.headerClicks)).toBe(0);
});

test('deck menu dispatches actions once, closes submenus, and preserves confirmations and errors', async ({ page, context }) => {
  await setup(page, context);
  for (const [label, action] of [['📁 Переместить в', 'move'], ['📋 Скопировать в', 'copy']]) {
    const menu = await open(page);
    await menu.getByText(label, { exact: true }).click();
    await expect(menu.locator('.dropdown-sub-item.current')).toHaveText('Deutsch');
    await menu.getByText(folders[1].name, { exact: true }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => window.menuCalls.filter(c => c[0] === 'move' || c[0] === 'copy')))
      .toContainEqual([action, 601, 12]);
    await open(page);
    await expect(page.locator('.dropdown-sub-menu')).toHaveCount(0);
    await page.locator('.study-deck-hero-btn').dispatchEvent('touchstart');
  }
  await (await open(page)).getByText('🔗 Поделиться', { exact: true }).click();
  await (await open(page)).getByText('🔄 Обновить', { exact: true }).click();
  for (const accept of [false, true]) {
    page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
    await (await open(page)).getByText('🧹 Сбросить прогресс', { exact: true }).click();
  }
  expect(await page.evaluate(() => window.menuCalls.filter(c => ['share', 'sync', 'reset'].includes(c[0]))))
    .toEqual([['share', 601], ['sync', 601], ['reset', 601]]);
  await page.evaluate(() => { window.failMenuAction = true; });
  await (await open(page)).getByText('📋 Скопировать в', { exact: true }).click();
  await page.getByText('Без папки (Главная)', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.menuCalls.at(-1))).toEqual(['toast', 'Ошибка при копировании колоды', 'error']);
  await page.evaluate(() => { window.failMenuAction = false; });
  const classifications = [];
  await page.route('**/api/cards/classify-batch', route => {
    const body = route.request().postDataJSON();
    classifications.push(body);
    return route.fulfill({ json: { status: 'ok', operation_id: body.operation_id, completed_count: 1,
      total_count: 1, next_batch: 1, remaining_count: 0, complete: true } });
  });
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ fetchDeckCards: async id => window.menuCalls.push(['refresh', id]) });
  });
  await (await open(page)).getByText('✨ Обновить CEFR-уровни', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.menuCalls.some(c => c[0] === 'refresh'))).toBe(true);
  expect(classifications).toHaveLength(1);
  expect(classifications[0]).toMatchObject({ deck_id: 601, target_language: 'de', batch_index: 0 });
  expect(classifications[0].operation_id).toBeTruthy();
  page.once('dialog', dialog => dialog.dismiss());
  await (await open(page)).getByText('🗑️ Удалить колоду', { exact: true }).click();
  await expect(page.locator('#card-item-601')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await (await open(page)).getByText('🗑️ Удалить колоду', { exact: true }).click();
  expect(await page.evaluate(() => window.menuCalls.filter(c => c[0] === 'delete'))).toEqual([['delete', 601]]);
  expect(await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().view)).toBe('decks');
});

test('deck menu and nested folders fit mobile and desktop', async ({ page, context }, testInfo) => {
  await setup(page, context);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const menu = await open(page);
    await menu.getByText('📁 Переместить в', { exact: true }).click();
    await menu.getByText('📋 Скопировать в', { exact: true }).click();
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await menu.getByText('🧹 Сбросить прогресс').scrollIntoViewIfNeeded();
    await expect(menu.getByText('🧹 Сбросить прогресс')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`), fullPage: true });
    await page.getByTitle('Опции колоды', { exact: true }).click();
  }
});

test('header controls stay inside viewport and menu stays above the add button', async ({ page, context }, testInfo) => {
  await setup(page, context);
  const defects = [];
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const menu = await open(page);
    await menu.getByText('📁 Переместить в', { exact: true }).click();
    await menu.getByText('📋 Скопировать в', { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`header-menu-${width}.png`), fullPage: true });
    const result = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.view-cards .header-compact button')]
        .filter(el => !el.closest('.deck-dropdown-menu'));
      const clipped = buttons.some(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; });
      const menu = document.querySelector('.deck-dropdown-menu');
      const fab = document.querySelector('.fab-add-card').getBoundingClientRect();
      const r = menu.getBoundingClientRect();
      const x = (Math.max(r.left, fab.left) + Math.min(r.right, fab.right)) / 2;
      const y = (Math.max(r.top, fab.top) + Math.min(r.bottom, fab.bottom)) / 2;
      const overlap = x < Math.min(r.right, fab.right) && y < Math.min(r.bottom, fab.bottom);
      return { clipped, covered: overlap && !menu.contains(document.elementFromPoint(x, y)),
        overflow: document.getElementById('app-container').scrollWidth > document.getElementById('app-container').clientWidth };
    });
    if (result.clipped || result.covered || result.overflow) defects.push({ width, ...result });
    await page.getByTitle('Опции колоды', { exact: true }).click();
  }
  expect(defects).toEqual([]);
});

test.describe('touch and keyboard', () => {
  test.use({ hasTouch: true });
  test('long folders scroll by touch, keyboard reaches final actions, Escape restores focus', async ({ page, context }, testInfo) => {
    test.setTimeout(90000);
    await setup(page, context);
    await page.evaluate(async () => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      useDeckStore.setState({ folders: Array.from({ length: 20 }, (_, i) => ({ id: i + 20,
        name: `Папка ${String(i).padStart(2, '0')} — Donaudampfschifffahrtsgesellschaft`, parent_id: null })) });
    });
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 640 });
      const trigger = page.getByTitle('Опции колоды', { exact: true });
      await trigger.tap();
      const menu = page.locator('.deck-dropdown-menu');
      await menu.getByText('📁 Переместить в', { exact: true }).tap();
      const sub = menu.locator('.dropdown-sub-menu');
      const rect = await sub.boundingBox();
      const client = await context.newCDPSession(page);
      const x = rect.x + rect.width / 2, y = rect.y + rect.height - 12;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let offset = 10; offset <= 80; offset += 10) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
      await expect.poll(() => sub.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await trigger.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      await menu.getByText('📁 Переместить в', { exact: true }).click();
      await trigger.focus();
      let reachedReset = false;
      for (let step = 0; step < 40; step++) {
        await page.keyboard.press('Tab');
        const focused = page.locator(':focus');
        await expect(focused).toBeInViewport({ ratio: 1 });
        if ((await focused.textContent()).includes('Сбросить прогресс')) { reachedReset = true; break; }
      }
      expect(reachedReset).toBe(true);
      await expect(menu.getByText('🧹 Сбросить прогресс')).toBeInViewport({ ratio: 1 });
      await expect.poll(() => page.evaluate(() => {
        const app = document.getElementById('app-container');
        return app.scrollWidth <= app.clientWidth;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`long-keyboard-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await trigger.tap();
      await page.touchscreen.tap(20, 20);
      await expect(menu).toHaveCount(0);
      await page.evaluate(async () => {
        const { useUiStore } = await import('/src/store/useUiStore.js');
        useUiStore.setState({ userProfile: { first_name: 'ОченьДлинноеИмяDonaudampfschifffahrtsgesellschaft', is_guest: false } });
      });
      await expect.poll(() => page.evaluate(() => {
        const app = document.getElementById('app-container');
        return app.scrollWidth <= app.clientWidth;
      })).toBe(true);
      await page.evaluate(async () => {
        const { useUiStore } = await import('/src/store/useUiStore.js');
        useUiStore.setState({ userProfile: { is_guest: true } });
      });
    }
  });
});
