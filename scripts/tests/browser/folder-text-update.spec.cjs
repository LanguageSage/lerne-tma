const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

const folders = [
  { id: 10, name: 'Deutsch B1 — учебная папка', parent_id: null, role: 'owner' },
  { id: 11, name: 'Вложенные упражнения', parent_id: 10, role: 'editor' },
  { id: 12, name: 'Глубокая папка', parent_id: 11, role: 'owner' },
  { id: 20, name: 'Read only', parent_id: null, role: 'viewer' }
].map(folder => ({ ...folder, target_language: 'de' }));
const decks = [
  { id: 1, name: '01 Теория подробно', folder_id: 10 },
  { id: 2, name: '02 Теория простыми словами', folder_id: 11 },
  { id: 3, name: '03 Базовая практика', folder_id: 12 },
  { id: 4, name: 'Untouched', folder_id: 10 }
].map(deck => ({ ...deck, role: 'owner', metadata: {}, target_language: 'de', stats: { total: 2, new: 2, learning: 0, due: 0 } }));
const original = [101, 102, 201, 202, 301, 401].map(id => ({ id, deck_id: Math.floor(id/100), position: id % 100,
  front: 'Haus '+id, back: 'дом', context: 'One\n\nTwo', topics: '', level: null }));
const block = (deckId, id, front = 'Edited') => `::deck_id ${deckId}\n${id ? `::card_id ${id}\n` : ''}FRONT:\n${front}\nBACK:\nдом\nCONTEXT:\nOne\n\nTwo\n`;
const source = [block(1, 101), block(1, 102, 'Haus 102'), block(2, 201), block(2, 202, 'Haus 202'), block(3, 301)].join('\n<<<LERNE_CARD>>>\n');
const withNew = source+'\n<<<LERNE_CARD>>>\n'+block(2, null, 'New');
const dialog = page => page.getByRole('dialog');
const apply = page => dialog(page).getByRole('button', { name: /Применить изменения|Apply changes|Застосувати зміни/ });
const counts = rows => Object.fromEntries(Object.entries({ updated: 'update', unchanged: 'unchanged', new: 'new', missing: 'missing', errors: 'error' })
  .map(([key, status]) => [key, rows.filter(row => row.status === status).length]));

async function setup(page, context) {
  const backend = { cards: structuredClone(original), previews: [], applies: [], receipts: new Map(), stale: false, lost: false, paused: null, readonlyDeck: null };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true', lerne_has_selected_language: 'true', lerne_target_language: 'de',
      lerne_user_profile: JSON.stringify({ user_id: 1, is_guest: false }), lerne_auth_v2_session: JSON.stringify({ access_token: 'test', refresh_token: 'test' }) })) localStorage.setItem(key, value);
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/init') return route.fulfill({ json: { decks, folders, settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (path === '/api/decks') return route.fulfill({ json: decks });
    if (path === '/api/folders') return route.fulfill({ json: folders });
    if (path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    const getCards = /^\/api\/decks\/(\d+)\/cards$/.exec(path);
    if (getCards) return route.fulfill({ json: backend.cards.filter(card => card.deck_id === Number(getCards[1])) });
    if (path === '/api/folders/10/text-update/preview') {
      const { cards } = route.request().postDataJSON();
      backend.previews.push(cards);
      if (backend.paused) await backend.paused;
      const rows = cards.map(card => {
        const candidate = backend.cards.find(row => row.id === card.card_id);
        const errors = card.deck_id === 555 ? ['missing_deck'] : !decks.some(deck => deck.id === card.deck_id) ? ['deck_outside_folder'] :
          card.deck_id === backend.readonlyDeck ? ['readonly_deck'] : candidate && candidate.deck_id !== card.deck_id ? ['foreign_card_id'] : [];
        const before = errors.length ? null : candidate;
        const changed = before ? ['front', 'back', 'context', 'topics'].filter(key => (before[key] || '') !== (card[key] || '')) : [];
        return { number: card.number, card_id: card.card_id, deck_id: card.deck_id, errors, before, after: card, changed_fields: changed,
          status: errors.length ? 'error' : !card.card_id ? 'new' : !before ? 'missing' : changed.length ? 'update' : 'unchanged' };
      });
      const groups = [...new Set(cards.map(card => card.deck_id))].map(id => {
        const groupRows = rows.filter(row => row.deck_id === id);
        return { deck_id: id, deck_name: decks.find(deck => deck.id === id)?.name, cards: groupRows, ...counts(groupRows) };
      });
      const summary = counts(rows);
      return route.fulfill({ json: { ...summary, total: rows.length, deck_count: groups.length, cards: rows, decks: groups,
        can_apply: !summary.errors && !summary.missing, preview_token: 'b'.repeat(64) } });
    }
    if (path.endsWith('/text-update/apply')) {
      const payload = route.request().postDataJSON();
      backend.applies.push({ path, payload });
      if (backend.stale) return route.fulfill({ status: 409, json: { detail: { code: 'preview_changed' } } });
      let result = backend.receipts.get(payload.request_id);
      if (!result) {
        const byDeck = new Map();
        for (const card of payload.cards) {
          if (!byDeck.has(card.deck_id)) byDeck.set(card.deck_id, { deck_id: card.deck_id, updated: 0, created: 0, unchanged: 0, skipped_new: 0 });
          const group = byDeck.get(card.deck_id);
          const before = backend.cards.find(row => row.id === card.card_id);
          if (before) {
            if (['front', 'back', 'context', 'topics'].some(key => (before[key] || '') !== (card[key] || ''))) { Object.assign(before, card); group.updated++; }
            else group.unchanged++;
          } else if (!card.card_id && payload.include_new) { backend.cards.push({ ...card, id: 1000+backend.cards.length }); group.created++; }
          else if (!card.card_id) group.skipped_new++;
        }
        const groups = [...byDeck.values()];
        result = { decks: groups, ...Object.fromEntries(['updated', 'created', 'unchanged', 'skipped_new'].map(key => [key, groups.reduce((sum, row) => sum+row[key], 0)])) };
        backend.receipts.set(payload.request_id, result);
      }
      if (backend.lost) { backend.lost = false; return route.abort('failed'); }
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('#folder-item-10')).toBeVisible();
  return backend;
}

async function open(page) {
  await page.locator('#folder-item-10 .card-item-actions-trigger').click();
  await page.locator('.folder-text-update-action').click();
  await expect(dialog(page).getByRole('button', { name: /Закрыть|Close|Закрити/ })).toBeEnabled();
}
async function upload(page, text = source) {
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'Deutsch B1.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(dialog(page).getByRole('button', { name: /Выбрать файл|Choose file|Вибрати файл/ })).toBeEnabled();
}

test('folder export → edit → grouped preview → one apply for all nested decks', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = await setup(page, context);
  await page.locator('#folder-item-10 .card-item-actions-trigger').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('.card-text-export-action').click();
  const download = await downloadEvent;
  const file = (await fs.readFile(await download.path(), 'utf8')).replace('Haus 101', 'Edited one').replace('Haus 201', 'Edited two').replaceAll('# Deck:', '# Deck: Renamed');
  await page.locator('#folder-item-10 .card-item-actions-trigger').click();
  await open(page);
  await upload(page, file);
  await expect(dialog(page).locator('.text-update-deck')).toHaveCount(4);
  await expect(dialog(page).locator('dl')).toContainText('Будет обновлено2');
  expect(backend.applies).toHaveLength(0);
  const group = dialog(page).locator('.text-update-deck').filter({ hasText: '01 Теория подробно' });
  await group.locator(':scope > summary').click();
  await group.locator('.text-update-card summary').first().click();
  await expect(group).toContainText('Haus 101');
  await expect(group).toContainText('Edited one');
  await apply(page).click();
  await expect(dialog(page)).toContainText('Обновлено: 2. Добавлено: 0.');
  expect(backend.applies).toHaveLength(1);
  expect(backend.applies[0].path).toBe('/api/folders/10/text-update/apply');
  expect(backend.cards).toHaveLength(6);
  expect(decks[0].name).toBe('01 Теория подробно');
  expect(errors).toEqual([]);
});

test('new candidates are unchecked; opt-in adds only to declared nested deck', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, withNew);
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await apply(page).click();
  await expect(dialog(page)).toContainText('Обновлено: 3. Добавлено: 1. Без изменений: 2.');
  expect(backend.cards).toHaveLength(7);
  expect(backend.cards.at(-1).deck_id).toBe(2);
  expect(backend.cards.find(card => card.id === 401).front).toBe('Haus 401');
});

test('all metadata/syntax errors and unknown/foreign IDs block the whole file', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, [block(1, 101), block(2, 201, '[[broken'), block(3, 301).replace('::deck_id 3\n', '')].join('\n<<<LERNE_CARD>>>\n'));
  await expect(dialog(page)).toContainText('Колода ID 2, Карточка 2:');
  await expect(dialog(page)).toContainText('Колода не указана, Карточка 3:');
  await expect(apply(page)).toBeDisabled();
  await upload(page, [block(1, 12345), block(555, 201), block(999, 301), block(2, 101)].join('\n<<<LERNE_CARD>>>\n'));
  await expect(dialog(page)).toContainText('Некоторые ID не найдены');
  await expect(dialog(page)).toContainText('Колода с указанным ID не найдена');
  await expect(dialog(page)).toContainText('не входит в выбранную папку');
  await expect(dialog(page)).toContainText('не принадлежит выбранной колоде');
  await expect(apply(page)).toBeDisabled();
  expect(backend.applies).toHaveLength(0);
});

test('viewer folder disables action; a readonly deck in editable folder blocks every update', async ({ page, context }) => {
  const backend = await setup(page, context);
  await page.locator('#folder-item-20 .card-item-actions-trigger').click();
  await expect(page.locator('.folder-text-update-action')).toBeDisabled();
  await page.locator('#folder-item-20 .card-item-actions-trigger').click();
  await open(page);
  backend.readonlyDeck = 2;
  await upload(page);
  await expect(dialog(page)).toContainText('Нет права редактировать эту колоду');
  await expect(apply(page)).toBeDisabled();
  expect(backend.applies).toHaveLength(0);
});

test('stale folder preview retains input and offers refresh', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page);
  backend.stale = true;
  await apply(page).click();
  await expect(dialog(page)).toContainText('Затронутые колоды папки изменились');
  await expect(dialog(page)).toContainText('Deutsch B1.txt');
  await expect(apply(page)).toBeDisabled();
  backend.stale = false;
  await dialog(page).getByRole('button', { name: 'Обновить предпросмотр' }).click();
  await expect(apply(page)).toBeEnabled();
});

test('lost response persists across reload, blocks overlapping deck update, and retries once', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, withNew);
  await dialog(page).getByRole('checkbox').check();
  backend.lost = true;
  await apply(page).click();
  await expect(dialog(page)).toContainText('Результат запроса пока неизвестен');
  await dialog(page).getByRole('button', { name: 'Отмена' }).click();
  await page.locator('#folder-item-10 .deck-main-action').click();
  await page.locator('#deck-item-1 .card-item-actions-trigger').click();
  await page.locator('.card-text-update-action').click();
  await expect(dialog(page).getByRole('button', { name: 'Выбрать файл' })).toBeEnabled();
  await upload(page, block(1, 101));
  await expect(dialog(page)).toContainText('Сначала проверьте результат предыдущего обновления');
  await page.reload();
  await open(page);
  await expect(dialog(page)).toContainText('Результат запроса пока неизвестен');
  await dialog(page).getByRole('button', { name: 'Проверить результат и повторить' }).click();
  await expect(dialog(page)).toContainText('Добавлено: 1.');
  expect(backend.applies).toHaveLength(2);
  expect(backend.applies[0].payload).toEqual(backend.applies[1].payload);
  expect(backend.cards).toHaveLength(7);
});

test('loading blocks Back and duplicate requests; empty and oversized files are explained', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, '');
  await expect(dialog(page)).toContainText('В файле нет карточек');
  await upload(page, 'a'.repeat(5 * 1024 * 1024 + 1));
  await expect(dialog(page)).toContainText('Максимум 5 МБ');
  await upload(page, Array.from({ length: 5001 }, (_, index) => block(1, index+1)).join('\n<<<LERNE_CARD>>>\n'));
  await expect(dialog(page)).toContainText('больше 5000 карточек');
  expect(backend.previews).toHaveLength(0);
  let release;
  backend.paused = new Promise(resolve => { release = resolve; });
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'folder.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(dialog(page).getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  await expect(apply(page)).toBeDisabled();
  await page.evaluate(async () => (await import('/src/utils/navigation.js')).navigateUp());
  await expect(dialog(page)).toBeVisible();
  release();
  await expect(apply(page)).toBeEnabled();
  expect(backend.previews).toHaveLength(1);
});

test('local dirty affected folders block preview; unrelated dirty deck does not', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await page.evaluate(async () => {
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    await db.cards.put({ id: 401, deck_id: 4, front_text: 'Unrelated dirty', is_dirty: 1 });
  });
  await upload(page);
  await expect(apply(page)).toBeEnabled();
  await page.evaluate(async () => {
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    await db.folders.put({ id: 10, parent_id: null, is_dirty: 1 });
  });
  await upload(page);
  await expect(dialog(page)).toContainText('Сначала синхронизируйте локальные изменения затронутых колод и папок');
  expect(backend.previews).toHaveLength(1);
  await expect(apply(page)).toBeDisabled();
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`folder preview fits ${width}px in ru/en/uk with expandable deck/card changes`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context);
    await open(page);
    await upload(page, withNew);
    await expect(dialog(page).locator('.text-update-deck')).toHaveCount(3);
    const group = dialog(page).locator('.text-update-deck').first();
    await group.locator(':scope > summary').click();
    await group.locator('.text-update-card summary').first().click();
    for (const language of ['ru', 'en', 'uk']) {
      await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), language);
      const bounds = await dialog(page).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeLessThanOrEqual(900);
      expect(await dialog(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await dialog(page).locator('.text-update-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await dialog(page).locator('button').all()) {
        const bounds = await button.boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`folder-update-${width}-${language}.png`) });
    }
  });
}
