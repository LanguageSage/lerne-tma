const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Batch test', target_language: 'de', is_learning: true,
  stats: { total: 0, new: 0, due: 0, learning: 0 } };
const saved = [
  { id: 10, deck_id: 1, front: 'Hallo', back: 'Привет', card_type: 'standard' },
  { id: 11, deck_id: 1, front: 'Danke', back: 'Спасибо', card_type: 'standard' },
];
const input = 'FRONT:\nHallo\nBACK:\n\nCONTEXT:\n\n<<<LERNE_CARD>>>\nFRONT:\nDanke\nBACK:\n\nCONTEXT:\n';

async function openModal(page, context, handler) {
  await page.routeWebSocket('**/*', () => {});
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (/\/ai\/(enrich|generate)-batch$/.test(pathname)) return handler(route);
    if (pathname === '/api/cards/bulk-save') return handler(route);
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: saved });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, is_guest: false } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText('Batch test', { exact: true }).first()).toBeVisible();
  await showModal(page);
}

async function showModal(page) {
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.getState().setIsBatchModalOpen(true);
  }, deck);
  await expect(page.getByText('Массовое добавление', { exact: true })).toBeVisible();
}

function success(cards = saved) {
  return { status: cards.length === 2 ? 'success' : 'partial', cards: saved, saved_cards: cards,
    save_result: { cards, created_count: cards.length, failed_count: 2 - cards.length,
      failed: cards.length === 2 ? [] : [{ index: 1, message: 'Storage rejected' }] } };
}

test('AI enrichment renders saved cards and responsive loading/result states', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  await openModal(page, context, async route => { count++; await gate; return route.fulfill({ json: success() }); });
  await page.locator('.settings-modal textarea').fill(input);
  await page.getByRole('button', { name: /Сгенерировать с ИИ/ }).click();
  await expect(page.getByRole('button', { name: /Генерация ИИ \(/ })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('loading-320.png'), fullPage: true });
  release();
  await expect(page.getByText('Успешно добавлено карточек: 2', { exact: true })).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`result-${width}.png`), fullPage: true });
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByText('Cards added: 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('result-en-320.png'), fullPage: true });
  expect(count).toBe(1);
  expect(errors).toEqual([]);
});

test('legacy envelope and partial save show the saved count and warning', async ({ page, context }) => {
  await openModal(page, context, route => route.fulfill({ json: {
    cards: saved, saved_cards: success(saved.slice(0, 1)).save_result,
  } }));
  await page.locator('.settings-modal textarea').fill(input);
  await page.getByRole('button', { name: /Сгенерировать с ИИ/ }).click();
  await expect(page.getByText('Успешно добавлено карточек: 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Добавлено 1 карточек, пропущено с ошибкой: 1', { exact: true })).toBeVisible();
});

for (const mode of ['enrich', 'generate']) {
  test(`${mode}: retry after client response failure/reload preserves request ID`, async ({ page, context }, testInfo) => {
    const requests = [];
    await openModal(page, context, route => {
      requests.push(route.request().postDataJSON());
      // Simulate cards committed but an unusable response received by the browser.
      return route.fulfill({ json: requests.length === 1 ? { saved_cards: { unexpected: true } } : success() });
    });
    if (mode === 'generate') await page.getByRole('button', { name: 'Генерация ИИ', exact: true }).click();
    await page.locator('.settings-modal textarea').fill(mode === 'generate' ? 'Hallo\nDanke' : input);
    await page.getByRole('button', { name: mode === 'generate' ? /^Сгенерировать \(/ : /Сгенерировать с ИИ/ }).click();
    await expect(page.getByRole('button', { name: 'Проверить результат и повторить', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-retry.png`), fullPage: true });
    if (mode === 'enrich') await expect(page.getByRole('button', { name: /^Создать \(/ })).toBeDisabled();
    await page.reload();
    await expect(page.getByText('Batch test', { exact: true }).first()).toBeVisible();
    await showModal(page);
    await page.getByRole('button', { name: 'Проверить результат и повторить', exact: true }).click();
    await expect(page.getByText('Успешно добавлено карточек: 2', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
}

test('provider error retains input and displays its detail without a success screen', async ({ page, context }) => {
  await openModal(page, context, route => route.fulfill({ status: 502, json: { detail: 'Provider unavailable' } }));
  await page.locator('.settings-modal textarea').fill(input);
  await page.getByRole('button', { name: /Сгенерировать с ИИ/ }).click();
  await expect(page.getByText('Ошибка генерации ИИ: Provider unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.settings-modal textarea')).toHaveValue(input);
  await expect(page.getByText(/Успешно добавлено карточек:/)).toHaveCount(0);
});

test('ordinary import keeps its bulk-save request and never calls AI', async ({ page, context }) => {
  const requests = [];
  await openModal(page, context, route => {
    requests.push(route.request());
    return route.fulfill({ json: { status: 'success', cards: saved, created: 2, failed: [] } });
  });
  await page.locator('.settings-modal textarea').fill(input);
  await page.getByRole('button', { name: /^Создать \(/ }).click();
  await expect(page.getByText('Успешно добавлено карточек: 2', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url()).pathname).toBe('/api/cards/bulk-save');
  expect(requests[0].postDataJSON().cards.map(card => card.front)).toEqual(['Hallo', 'Danke']);
});

test('lost network response is retried with the same persisted request', async ({ page, context }) => {
  const requests = [];
  await openModal(page, context, route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1 ? route.abort('failed') : route.fulfill({ json: success() });
  });
  await page.locator('.settings-modal textarea').fill(input);
  await page.getByRole('button', { name: /Сгенерировать с ИИ/ }).click();
  await page.getByRole('button', { name: 'Проверить результат и повторить', exact: true }).click();
  await expect(page.getByText('Успешно добавлено карточек: 2', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});
