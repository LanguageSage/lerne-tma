const { test, expect } = require('@playwright/test');

const decks = [
  { id: 1, name: 'Adjektivdeklination — базовая практика', role: 'owner' },
  { id: 2, name: 'Read only', role: 'viewer' }
].map(deck => ({ ...deck, folder_id: null, target_language: 'de', metadata: {}, stats: { total: 3, new: 3, learning: 0, due: 0 } }));
const original = [
  { id: 101, deck_id: 1, front: 'der [[bequeme]] Schuh', back: 'удобная обувь', context: '', topics: '', level: 'B1' },
  { id: 102, deck_id: 1, front: 'Haus', back: 'дом', context: '', topics: '', level: null },
  { id: 103, deck_id: 1, front: 'Baum', back: 'дерево', context: '', topics: '', level: null }
];
const modified = '::deck_id 1\n::card_id 101\nFRONT:\nder [[bequeme|удобный]] Schuh\nBACK:\nудобная обувь\nCONTEXT:\n::level B1';
const newCard = '\n<<<LERNE_CARD>>>\nFRONT:\nNeu\nBACK:\nновый\nCONTEXT:\n';
const dialog = page => page.getByRole('dialog', { name: /Обновить колоду из файла|Update deck from file/ });
const apply = page => dialog(page).getByRole('button', { name: /Применить изменения|Apply changes/ });

async function setup(page, context) {
  const backend = { cards: structuredClone(original), previews: [], applies: [], receipts: new Map(), loseResponse: false, stale: false, pause: null };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true', lerne_has_selected_language: 'true', lerne_target_language: 'de',
      lerne_user_profile: JSON.stringify({ user_id: 1, is_guest: false }), lerne_auth_v2_session: JSON.stringify({ access_token: 'test', refresh_token: 'test' }) })) localStorage.setItem(key, value);
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (path === '/api/decks') return route.fulfill({ json: decks });
    if (path === '/api/folders' || path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: backend.cards });
    if (path.endsWith('/text-update/preview')) {
      const { cards } = route.request().postDataJSON();
      backend.previews.push(cards);
      if (backend.pause) await backend.pause;
      const rows = cards.map(card => {
        const before = backend.cards.find(row => row.id === card.card_id);
        const changed = before ? ['front', 'back', 'context', 'level', 'topics'].filter(key => (before[key] || '') !== (card[key] || before[key] && key === 'level' && before[key] || '')) : [];
        const errors = card.card_id === 999 ? ['foreign_card_id'] : [];
        return { number: card.number, card_id: card.card_id, status: errors.length ? 'error' : !card.card_id ? 'new' : !before ? 'missing' : changed.length ? 'update' : 'unchanged',
          changed_fields: changed, before: before || null, after: card, errors };
      });
      const counts = Object.fromEntries(Object.entries({ updated: 'update', unchanged: 'unchanged', new: 'new', missing: 'missing', errors: 'error' }).map(([key, status]) => [key, rows.filter(row => row.status === status).length]));
      return route.fulfill({ json: { ...counts, total: cards.length, cards: rows, can_apply: !counts.errors && !counts.missing, preview_token: 'a'.repeat(64) } });
    }
    if (path.endsWith('/text-update/apply')) {
      const payload = route.request().postDataJSON();
      backend.applies.push(payload);
      if (backend.stale) return route.fulfill({ status: 409, json: { detail: { code: 'preview_changed' } } });
      let result = backend.receipts.get(payload.request_id);
      if (!result) {
        result = { updated: 0, created: 0, unchanged: 0 };
        for (const card of payload.cards) {
          const before = backend.cards.find(row => row.id === card.card_id);
          if (before) { Object.assign(before, card); result.updated++; }
          else if (!card.card_id && payload.include_new) { backend.cards.push({ ...card, id: 1000 }); result.created++; }
        }
        backend.receipts.set(payload.request_id, result);
      }
      if (backend.loseResponse) { backend.loseResponse = false; return route.abort('failed'); }
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  return backend;
}

async function open(page) {
  await page.locator('#deck-item-1 .card-item-actions-trigger').click();
  await page.locator('.card-text-update-action').click();
  await expect(dialog(page).getByRole('button', { name: 'Закрыть' })).toBeEnabled();
}
async function upload(page, text = modified) {
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'Übungen.txt', mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
  await expect(dialog(page).getByRole('button', { name: /Выбрать файл|Choose file/ })).toBeEnabled();
}

test('preview has before/after; applying changes same card and leaves omitted cards', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = await setup(page, context);
  await open(page);
  await upload(page);
  expect(backend.applies).toHaveLength(0);
  await expect(dialog(page).locator('dl')).toContainText('Будет обновлено1');
  await dialog(page).locator('summary').click();
  await expect(dialog(page)).toContainText('der [[bequeme]] Schuh');
  await expect(dialog(page)).toContainText('der [[bequeme|удобный]] Schuh');
  await apply(page).click();
  await expect(dialog(page)).toContainText('Обновлено: 1. Добавлено: 0.');
  expect(backend.cards).toHaveLength(3);
  expect(backend.cards[0].id).toBe(101);
  expect(backend.cards[1].front).toBe('Haus');
  expect(errors).toEqual([]);
});

test('new cards need explicit checkbox; lost response can be retried after reload without duplicates', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, modified + newCard);
  const checkbox = dialog(page).getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  backend.loseResponse = true;
  await apply(page).click();
  await expect(dialog(page)).toContainText('Результат запроса пока неизвестен');
  await expect(dialog(page).getByRole('button', { name: 'Проверить результат и повторить' })).toBeEnabled();
  await page.reload();
  await open(page);
  await expect(dialog(page)).toContainText('Результат запроса пока неизвестен');
  await dialog(page).getByRole('button', { name: 'Проверить результат и повторить' }).click();
  await expect(dialog(page)).toContainText('Добавлено: 1.');
  expect(backend.applies).toHaveLength(2);
  expect(backend.applies[0]).toEqual(backend.applies[1]);
  expect(backend.cards).toHaveLength(4);
});

test('all syntax errors, unknown IDs and foreign IDs block apply', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, 'FRONT:\nBACK:\nEmpty\n<<<LERNE_CARD>>>\nFRONT:\n[[broken\nBACK:\nanswer');
  await expect(dialog(page)).toContainText('Карточка 1:');
  await expect(dialog(page)).toContainText('Карточка 2:');
  await expect(apply(page)).toBeDisabled();
  await upload(page, modified.replace('card_id 101', 'card_id 12345'));
  await expect(dialog(page)).toContainText('Некоторые ID не найдены');
  await expect(apply(page)).toBeDisabled();
  await upload(page, modified.replace('card_id 101', 'card_id 999'));
  await expect(dialog(page)).toContainText('не принадлежит выбранной колоде');
  await expect(apply(page)).toBeDisabled();
  expect(backend.applies).toHaveLength(0);
});

test('stale preview offers refresh and keeps file; read-only deck disables maintenance', async ({ page, context }) => {
  const backend = await setup(page, context);
  await page.locator('#deck-item-2 .card-item-actions-trigger').click();
  await expect(page.locator('.card-text-update-action')).toBeDisabled();
  await page.locator('#deck-item-2 .card-item-actions-trigger').click();
  await open(page);
  await upload(page);
  backend.stale = true;
  await apply(page).click();
  await expect(dialog(page)).toContainText('Колода изменилась после предпросмотра');
  await expect(dialog(page)).toContainText('Übungen.txt');
  backend.stale = false;
  await dialog(page).getByRole('button', { name: 'Обновить предпросмотр' }).click();
  await expect(apply(page)).toBeEnabled();
});

test('offline and dirty local content stop preview; empty and oversized files are explained', async ({ page, context }) => {
  const backend = await setup(page, context);
  await open(page);
  await upload(page, '');
  await expect(dialog(page)).toContainText('В файле нет карточек');
  await page.evaluate(() => localStorage.setItem('offline_mode', 'true'));
  await upload(page);
  await expect(dialog(page)).toContainText('выйдите из автономного режима');
  expect(backend.previews).toHaveLength(0);
  await page.evaluate(async () => {
    localStorage.removeItem('offline_mode');
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    await db.cards.put({ id: 101, deck_id: 1, front_text: 'Dirty', is_dirty: 1 });
  });
  await upload(page);
  await expect(dialog(page)).toContainText('Сначала синхронизируйте');
  expect(backend.previews).toHaveLength(0);
  await upload(page, 'a'.repeat(5 * 1024 * 1024 + 1));
  await expect(dialog(page)).toContainText('Максимум 5 МБ');
  await expect(apply(page)).toBeDisabled();
});

test('loading blocks repeated actions and closing, then allows retry', async ({ page, context }) => {
  const backend = await setup(page, context);
  let release;
  backend.pause = new Promise(resolve => { release = resolve; });
  await open(page);
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'cards.txt', mimeType: 'text/plain', buffer: Buffer.from(modified) });
  await expect(dialog(page).getByRole('button', { name: 'Закрыть' })).toBeDisabled();
  await expect(apply(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await page.evaluate(async () => (await import('/src/utils/navigation.js')).navigateUp());
  await expect(dialog(page)).toBeVisible();
  release();
  await expect(apply(page)).toBeEnabled();
  expect(backend.previews).toHaveLength(1);
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`maintenance dialog fits ${width}px with long content and translations`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context);
    await open(page);
    await upload(page, modified + newCard);
    await dialog(page).locator('summary').first().click();
    for (const language of ['ru', 'en', 'uk']) {
      await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), language);
      const bounds = await page.getByRole('dialog').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeLessThanOrEqual(900);
      for (const button of await page.getByRole('dialog').locator('button').all()) {
        const box = await button.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`update-${width}-${language}.png`) });
    }
  });
}
