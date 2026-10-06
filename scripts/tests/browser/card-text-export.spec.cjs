const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

const folder = { id: 10, name: 'Учебная папка', parent_id: null, target_language: 'de', role: 'viewer' };
const decks = [
  { id: 1, name: 'Meine Übungen — Карточки', folder_id: 10, position: 0, role: 'owner' },
  { id: 2, name: 'Вторая колода', folder_id: 10, position: 1, role: 'viewer' },
  { id: 3, name: 'Пустая колода', folder_id: null, position: 2, role: 'owner' }
].map(deck => ({ ...deck, target_language: 'de', metadata: {}, stats: { total: deck.id === 3 ? 0 : 2, new: 2, learning: 0, due: 0 } }));
const cards = {
  1: [
    { id: 2, deck_id: 1, position: 0, front: '::task\nЗаполни пропуск.\n\n::source\nИсходный текст.\n\n::example\nПример.\n\n::exercise\nIch [[lerne]] Deutsch.', back: 'Я учу немецкий.', context: 'Заметка', level: 'B1', topics: 'Verben' },
    { id: 1, deck_id: 1, position: 1, front: '@wordbank\nIch lerne <<1>>.\n@options\nDeutsch | Englisch', back: '1=Deutsch', context: '' }
  ],
  2: [{ id: 3, deck_id: 2, position: 0, front: '@match\nHaus => дом\nBaum => дерево', back: 'Сопоставление пар', context: '' }],
  3: []
};

async function setup(page, context) {
  const backend = { reads: [], writes: [], failDeck: null, pending: null, limitations: false };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET' && /^\/api\/(cards|decks|folders)(\/|$)/.test(pathname)) backend.writes.push(pathname);
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks, folders: [folder], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false }
    } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks });
    if (pathname === '/api/folders') return route.fulfill({ json: [folder] });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    const match = /^\/api\/decks\/(\d+)\/cards$/.exec(pathname);
    if (match) {
      const id = Number(match[1]);
      backend.reads.push(id);
      if (backend.pending) await backend.pending;
      if (backend.failDeck === id) return route.fulfill({ status: 403, json: { detail: 'Access denied' } });
      const rows = cards[id].map(card => backend.limitations
        ? { ...card, image_path: 'image.png', tags: 'custom', context: 'One\n\nTwo' } : card);
      return route.fulfill({ json: rows });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('#folder-item-10')).toBeVisible();
  return backend;
}

const menu = (page, type, id) => page.locator(`#${type}-item-${id} .card-item-actions-trigger`).click();
const exportButton = page => page.locator('.card-text-export-action');
async function openFolder(page) {
  await page.locator('#folder-item-10 .deck-main-action').click();
  await expect(page.locator('#deck-item-1')).toBeVisible();
}
async function downloadText(page, click) {
  const event = page.waitForEvent('download');
  await click();
  const download = await event;
  return { text: await fs.readFile(await download.path(), 'utf8'), name: download.suggestedFilename() };
}
async function parseExport(page, text) {
  return page.evaluate(async text => {
    const { parseBatchCardsText } = await import('/src/utils/batchCardParser.js');
    return parseBatchCardsText(text);
  }, text);
}

test('deck menu downloads UTF-8 text that round-trips and can be pasted into quick import', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = await setup(page, context);
  await openFolder(page);
  await menu(page, 'deck', 1);
  const file = await downloadText(page, () => exportButton(page).click());
  expect(file.name).toBe('Meine Übungen — Карточки.txt');
  const imported = await parseExport(page, file.text);
  expect(imported.map(card => card.front)).toEqual(cards[1].map(card => card.front));
  expect(imported.map(card => card.back)).toEqual(cards[1].map(card => card.back));
  expect(imported[0].topics).toBe('Verben');
  expect(backend.reads).toEqual([1]);
  expect(backend.writes).toEqual([]);
  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ currentDeck: useDeckStore.getState().decks.find(deck => deck.id === 1) });
    useUiStore.getState().setIsBatchModalOpen(true);
  });
  await page.locator('.settings-modal textarea').fill(file.text);
  await expect(page.locator('.settings-modal')).toContainText('Найдено карточек: 2');
  expect(errors).toEqual([]);
});

test('folder menu is available to a viewer and exports all its decks without navigating', async ({ page, context }) => {
  const backend = await setup(page, context);
  await menu(page, 'folder', 10);
  const file = await downloadText(page, () => exportButton(page).click());
  expect(file.name).toBe('Учебная папка.txt');
  expect(file.text).toContain('# Deck: Meine Übungen — Карточки');
  expect(file.text).toContain('# Deck: Вторая колода');
  const imported = await parseExport(page, file.text);
  expect(imported.map(card => card.front)).toEqual([...cards[1], ...cards[2]].map(card => card.front));
  expect(backend.reads).toEqual([1, 2]);
  expect(backend.writes).toEqual([]);
  await expect(page.locator('#folder-item-10')).toBeVisible();
});

test('pending exports disable duplicate clicks; failed folder reads produce no partial file and allow retry', async ({ page, context }) => {
  const backend = await setup(page, context);
  const downloads = [];
  page.on('download', event => downloads.push(event));
  let release;
  backend.pending = new Promise(resolve => { release = resolve; });
  backend.failDeck = 2;
  await menu(page, 'folder', 10);
  await exportButton(page).click();
  await expect(exportButton(page)).toBeDisabled();
  await expect(exportButton(page)).toHaveAttribute('aria-busy', 'true');
  expect(backend.reads).toEqual([1]);
  backend.pending = null;
  release();
  await expect(page.locator('.toast.error')).toContainText('Не удалось экспортировать');
  expect(downloads).toHaveLength(0);
  await expect(exportButton(page)).toBeEnabled();
  backend.failDeck = null;
  await downloadText(page, () => exportButton(page).click());
  expect(downloads).toHaveLength(1);
});

test('empty exports and limitations are explicit', async ({ page, context }) => {
  const backend = await setup(page, context);
  const downloads = [];
  page.on('download', event => downloads.push(event));
  await menu(page, 'deck', 3);
  await exportButton(page).click();
  await expect(page.locator('.toast')).toHaveText('Нет карточек для экспорта');
  expect(downloads).toHaveLength(0);
  await page.locator('#folder-item-10 .deck-main-action').click();
  backend.limitations = true;
  await menu(page, 'deck', 1);
  const file = await downloadText(page, () => exportButton(page).click());
  await expect(page.locator('.toast')).toContainText('Ограничения импорта:');
  expect(file.text).toContain('# Изображения и видео не восстанавливаются текстовым импортом.');
  expect((await parseExport(page, file.text)).length).toBe(2);
});

test('offline export reads local cards including unsynced edits', async ({ page, context }) => {
  const backend = await setup(page, context);
  await openFolder(page);
  await page.evaluate(async ({ deck, card }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    await db.decks.put(deck);
    await db.cards.put({ ...card, front_text: 'Локальная правка [[Deutsch]]', back_text: 'Unsynced', is_dirty: 1 });
    localStorage.setItem('offline_mode', 'true');
  }, { deck: decks[0], card: cards[1][0] });
  await menu(page, 'deck', 1);
  const file = await downloadText(page, () => exportButton(page).click());
  const imported = await parseExport(page, file.text);
  expect(imported.map(card => card.front)).toEqual(['Локальная правка [[Deutsch]]']);
  expect(imported[0].back).toBe('Unsynced');
  expect(backend.reads).toEqual([]);
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`export menus fit ${width}px in Russian and English`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context);
    for (const language of ['ru', 'en']) {
      await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), language);
      await menu(page, 'folder', 10);
      await expect(exportButton(page)).toHaveText(language === 'ru' ? 'Экспортировать папку' : 'Export folder');
      await expect.poll(async () => (await exportButton(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
      const folderBounds = await exportButton(page).boundingBox();
      expect(folderBounds.x).toBeGreaterThanOrEqual(0);
      expect(folderBounds.x + folderBounds.width).toBeLessThanOrEqual(width);
      expect(folderBounds.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`folder-${width}-${language}.png`) });
      await menu(page, 'folder', 10);
      await openFolder(page);
      await menu(page, 'deck', 1);
      await expect(exportButton(page)).toHaveText(language === 'ru' ? 'Экспортировать колоду' : 'Export deck');
      await expect.poll(async () => (await exportButton(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
      const deckBounds = await exportButton(page).boundingBox();
      expect(deckBounds.x).toBeGreaterThanOrEqual(0);
      expect(deckBounds.x + deckBounds.width).toBeLessThanOrEqual(width);
      expect(deckBounds.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`deck-${width}-${language}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setActiveFolderId(null));
    }
  });
}
