const { test, expect } = require('./isolated-fixture.cjs');

const deck = { id: 601, name: 'Длинное название колоды — Deutsch für den Alltag', role: 'owner',
  metadata: JSON.stringify({ resources: [
    { type: 'link', url: 'https://example.test', title: 'Deutsch — материалы' },
    { type: 'audio', url: '/api/audio.wav', title: 'Hören' },
    { type: 'image', path: 'images/first.png', show_in_cards: false },
    { type: 'video', url: '/api/video.mp4' },
    { type: 'image', path: 'images/second.png', url: '/api/media/images/second.png' },
  ], imageHeight: 180, authored: 'preserve' }),
  target_language: 'de', folder_id: 11, stats: { total: 1, new: 1 } };
const folders = [{ id: 11, name: 'Deutsch', parent_id: null },
  { id: 12, name: 'Упражнения для самостоятельного повторения', parent_id: 11 }];
const card = { id: 601, deck_id: 601, front: 'Guten Morgen', back: 'Доброе утро', queue: 'new' };

test.beforeEach(async ({ page }) => {
  page.mediaErrors = [];
  page.on('pageerror', error => page.mediaErrors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.mediaErrors).toEqual([]); });

async function setup(page, context) {
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated', refresh_token: 'isolated' }));
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/api/media/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#7c3aed"/><text x="40" y="180" fill="white" font-size="32">Deutsch — Bild</text></svg>' });
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
    window.mediaCalls = [];
    useDeckStore.setState({ currentDeck: deck, deckCards: [card], folders, cardsLoading: false,
      updateDeckMetadata: async (id, metadata) => {
        window.mediaCalls.push(['metadata', id, metadata]);
        useDeckStore.setState(s => ({ currentDeck: { ...s.currentDeck, metadata } }));
      } });
    useUiStore.setState({ view: 'cards', showToast: (...args) => window.mediaCalls.push(['toast', ...args]) });
  }, { deck, folders, card });
  await expect(page.locator('#card-item-601')).toBeVisible();
}


test('media preserves sources, metadata, resize and original resource upload index', async ({ page, context }) => {
  await setup(page, context);
  const images = page.locator('.deck-images-gallery img');
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveAttribute('src', '/api/media/images/first.png');
  await expect.poll(() => images.first().evaluate(el => el.naturalWidth)).toBe(640);
  await page.evaluate(() => { window.open = (...args) => { window.openedImage = args; }; });
  await images.first().click();
  expect(await page.evaluate(() => window.openedImage)).toEqual(['/api/media/images/first.png', '_blank']);
  await expect(page.locator('audio')).toHaveAttribute('src', '/api/audio.wav');
  await expect(page.locator('video')).toHaveAttribute('src', '/api/video.mp4');
  await expect(page.locator('video')).toHaveAttribute('playsinline', '');
  await expect(page.getByRole('link', { name: 'Deutsch — материалы' })).toHaveAttribute('rel', 'noopener noreferrer');
  const checks = page.locator('.deck-images-gallery input');
  await expect(checks.first()).not.toBeChecked();
  await expect(checks.last()).toBeChecked();
  await checks.last().uncheck();
  expect(await page.evaluate(() => window.mediaCalls.filter(c => c[0] === 'metadata').at(-1)[2].resources[4].show_in_cards)).toBe(false);
  await page.getByTitle('Потяни чтобы изменить высоту').first().dispatchEvent('mousedown', { clientY: 200 });
  await page.dispatchEvent('body', 'mousemove', { clientY: 260 });
  await page.dispatchEvent('body', 'mouseup', { clientY: 260 });
  await expect.poll(() => images.first().evaluate(el => el.style.maxHeight)).toBe('240px');
  expect(await page.evaluate(() => window.mediaCalls.filter(c => c[0] === 'metadata').at(-1)[2].imageHeight)).toBe(240);
  await page.locator('.deck-images-gallery').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await page.getByTitle('Редактировать изображение списка').last().click();
  await expect(page.getByText('Настройка фото списка', { exact: true })).toBeVisible();
  await page.route('**/api/media/upload-image', route => route.fulfill({ json: { path: 'images/edited.png', url: '/api/media/images/edited.png' } }));
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.mediaCalls.filter(c => c[0] === 'metadata').at(-1)[2].resources[4].path)).toBe('images/edited.png');
  const saved = await page.evaluate(() => window.mediaCalls.filter(c => c[0] === 'metadata').at(-1));
  expect(saved[1]).toBe(601);
  expect(saved[2].resources).toHaveLength(5);
  expect(saved[2].resources[2]).toEqual(JSON.parse(deck.metadata).resources[2]);
  expect(saved[2].resources[4].show_in_cards).toBe(false);
  expect(saved[2].authored).toBe('preserve');
  await expect(page.locator('#card-item-601')).toBeVisible();
});

test('media follows deck changes and preserves role controls and empty fallback', async ({ page, context }) => {
  await setup(page, context);
  for (const role of ['owner', 'editor', 'viewer']) {
    await page.evaluate(async role => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      useDeckStore.setState(s => ({ currentDeck: { ...s.currentDeck, role } }));
    }, role);
    // Preserve existing gallery visibility; authorization stays in store/server.
    await expect(page.getByTitle('Редактировать изображение списка')).toHaveCount(2);
    await expect(page.locator('.deck-images-gallery input')).toHaveCount(2);
    await page.getByTitle('Опции колоды', { exact: true }).click();
    await expect(page.getByText('📎 Ресурсы колоды', { exact: true })).toHaveCount(role === 'viewer' ? 0 : 1);
    if (role !== 'viewer') {
      await page.getByText('📎 Ресурсы колоды', { exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Ресурсы колоды' })).toBeVisible();
      await page.locator('.settings-overlay .close-btn').click();
    } else {
      await page.getByTitle('Опции колоды', { exact: true }).click();
    }
  }
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState(s => ({ currentDeck: { ...s.currentDeck, id: 602, metadata: { resources: [{ type: 'image', url: '/api/media/images/new.png' }], imageHeight: 300 } } }));
  });
  await expect(page.locator('.deck-images-gallery img')).toHaveCount(1);
  await expect.poll(() => page.locator('.deck-images-gallery img').evaluate(el => el.style.maxHeight)).toBe('300px');
  await expect(page.locator('audio, video')).toHaveCount(0);
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState(s => ({ currentDeck: { ...s.currentDeck, metadata: 'invalid' } }));
  });
  await expect(page.locator('.deck-images-gallery')).toHaveCount(0);
  await expect(page.locator('#card-item-601')).toBeVisible();
});

test('media fits 320/375/430/768/1280 with paging inside gallery', async ({ page, context }, testInfo) => {
  await setup(page, context);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const gallery = page.locator('.deck-images-gallery');
    await gallery.scrollIntoViewIfNeeded();
    const bounds = await gallery.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => { const app = document.getElementById('app-container'); return app.scrollWidth <= app.clientWidth; })).toBe(true);
    await expect(page.getByRole('link', { name: 'Deutsch — материалы' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`resources-${width}.png`), fullPage: true });
    await gallery.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect(page.getByTitle('Редактировать изображение списка').last()).toBeInViewport();
    await gallery.evaluate(el => { el.scrollLeft = 0; });
  }
});
