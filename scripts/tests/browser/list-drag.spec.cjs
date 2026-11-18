const { test, expect } = require('./isolated-fixture.cjs');

const user = { user_id: 1, first_name: 'Test', is_guest: false };
const decks = Array.from({ length: 20 }, (_, position) => ({
  id: 601 + position, name: `Übungen ${position + 1}`, position, role: 'owner',
  target_language: 'de', folder_id: null, is_learning: true,
  stats: { total: 90, new: 90, learning: 0, due: 0 },
}));
const cards = Array.from({ length: 90 }, (_, position) => ({
  id: 1001 + position, deck_id: decks[0].id, position,
  queue: 'new', content_v2: { schema_version: 2, card: { type: 'standard', info: [],
    data: { prompt: `Übung ${position + 1}`, answer: 'Пример ответа' } } },
}));

async function openHome(page) {
  await page.addInitScript(user => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify(user));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated', refresh_token: 'isolated' }));
  }, user);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: user } });
    if (pathname === '/api/decks/601/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: user });
    if (pathname === '/api/sync/v2/status') return route.fulfill({ json: { server_generation: 'a'.repeat(64), restored: false } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-601')).toBeVisible();
}

async function openList(page) {
  await openHome(page);
  await page.locator('#deck-item-601 .deck-main-action').click();
  await page.getByRole('button', { name: 'Показать список' }).click();
  await expect(page.locator('#card-item-1001')).toBeVisible();
}

async function grab(page, item) {
  const handle = page.locator(`${item} .deck-drag-handle-bottom`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8);
  await expect(page.locator('.is-drag-overlay')).toBeVisible();
  return { x, y };
}

const scrollTop = page => page.locator('#app-container').evaluate(el => el.scrollTop);

test('leaving a card drag at the edge stops scrolling on the main screen', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 800 });
  await openList(page);
  const { x } = await grab(page, '#card-item-1003');
  const start = await scrollTop(page);
  await page.mouse.move(x, 796, { steps: 6 });
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(start + 60);

  await page.evaluate(async () => {
    const { navigateUp } = await import('/src/utils/navigation.js');
    navigateUp(); // Card list → deck intro.
    navigateUp(); // Deck intro → main screen.
  });
  await expect(page.locator('#deck-item-601')).toBeVisible();
  await page.mouse.up();
  const container = page.locator('#app-container');
  await container.evaluate(el => { el.scrollTop = 150; });
  await page.waitForTimeout(250);
  expect(await scrollTop(page)).toBe(150);
  await page.mouse.move(212, 400);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => scrollTop(page)).toBe(50);
});

test('keeps the dropped card in place while its new order is saving', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 950 });
  await openList(page);
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ reorderCards: ids => new Promise(resolve => {
      window.finishReorder = () => {
        const cardsById = new Map(useDeckStore.getState().deckCards.map(card => [card.id, card]));
        useDeckStore.setState({ deckCards: ids.map(id => cardsById.get(id)) });
        resolve();
      };
    }) });
  });
  const { x, y } = await grab(page, '#card-item-1001');
  const first = await page.locator('#card-item-1001').boundingBox();
  const second = await page.locator('#card-item-1002').boundingBox();
  await page.mouse.move(x, y + second.y - first.y, { steps: 5 });
  await page.mouse.up();

  const rows = page.locator('.card-list > .card-item');
  await expect(rows.nth(1)).toHaveId('card-item-1001');
  await expect.poll(async () => Math.round((await rows.nth(1).boundingBox()).y - second.y)).toBe(0);
  await expect(page.locator('.is-drag-overlay')).toHaveCount(0);
  await page.evaluate(() => window.finishReorder());
  await expect(rows.nth(1)).toHaveId('card-item-1001');
});

test.describe('touch input on the main screen', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' });

  test('touch cancellation stops edge scrolling and keyboard sorting still works', async ({ page }) => {
    await openHome(page);
    const container = page.locator('#app-container');
    const handle = page.locator('#deck-item-603 .deck-drag-handle-bottom');
    await handle.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await handle.boundingBox();
    const touch = await page.context().newCDPSession(page);
    const finger = { x: x + width / 2, y: y + height / 2 };
    const sendTouch = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', { type, touchPoints });
    await sendTouch('touchStart', [finger]);
    await sendTouch('touchMove', [{ ...finger, y: finger.y - 12 }]);
    await expect(page.locator('.is-drag-overlay')).toBeVisible();
    const start = await scrollTop(page);
    await sendTouch('touchMove', [{ ...finger, y: 796 }]);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(start + 60);
    await sendTouch('touchCancel', []);
    await expect(page.locator('.is-drag-overlay')).toHaveCount(0);
    await container.evaluate(el => { el.scrollTop = 150; });
    await page.waitForTimeout(250);
    expect(await scrollTop(page)).toBe(150);

    const rows = page.locator('.reorder-group-list > [id^="deck-item-"]');
    await expect(rows.nth(2)).toHaveId('deck-item-603');
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.is-drag-overlay')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByText('Draggable item 603 was moved over droppable area 604.')).toBeAttached();
    await page.keyboard.press('Space');
    await expect(rows.nth(3)).toHaveId('deck-item-603');
    await expect(handle).toBeFocused();
  });
});
