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

async function openEditor(page, context, front = null) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
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
    if (pathname === '/api/cards/save') return route.fulfill({ json: { ...route.request().postDataJSON(), id: 10 } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: cards[0] });
    if (pathname === '/api/user/settings') return route.fulfill({ json: { status: 'success' } });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, first_name: 'Test', is_guest: false } } });
    return route.fulfill({ json: {} });
  });


  await page.goto('/?user_id=1');
  await expect(page.getByText('Auto Test', { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ front, deck }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useSessionStore.getState().setEditingCard(front === null ? null : { id: 1, deck_id: 1, front, back: 'Answer', context: 'Note' });
    useUiStore.getState().setView(front === null ? 'creator' : 'editor');
  }, { front, deck });
  await expect(page.locator('.card-content-editor')).toBeVisible();
}
const advanced = page => page.getByRole('button', { name: 'Дополнительно: исходная разметка' });
const raw = page => page.getByRole('textbox', { name: 'Исходная разметка', exact: true });
const simple = page => page.getByRole('button', { name: 'Обычный редактор' });
async function add(page, name) {
  await page.locator('.card-editor-add summary').click();
  await page.locator('.card-editor-add').getByRole('button', { name, exact: true }).click();
}

test('simple creation uses the existing save API and has no technical cheatsheet', async ({ page, context }, testInfo) => {
  await openEditor(page, context);
  await expect(page.getByText('Тренажёр:', { exact: true })).toHaveCount(0);
  await expect(raw(page)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Вопрос / лицевая сторона' }).fill('Hallo');
  await page.getByRole('textbox', { name: 'Ответ / обратная сторона' }).fill('Hello');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.card-content-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`simple-${width}.png`), fullPage: true });
  }
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: 'Hallo', back: 'Hello', card_type: 'standard' });
});

test('visual fields, mode roundtrip, cursor insertion and keyboard dismissal', async ({ page, context }) => {
  await openEditor(page, context);
  await page.getByRole('textbox', { name: 'Вопрос / лицевая сторона' }).fill('Wo?');
  await add(page, 'Задание');
  await page.getByRole('textbox', { name: 'Задание', exact: true }).fill('Wähle ');
  await expect(page.getByRole('textbox', { name: 'Задание', exact: true })).toHaveValue('Wähle ');
  await add(page, 'Варианты ответа');
  await page.getByRole('textbox', { name: 'Вариант 1', exact: true }).fill('New York');
  await add(page, 'Поле для ввода');
  await page.getByRole('textbox', { name: 'Правильный ответ', exact: true }).fill('hier');
  await advanced(page).click();
  const value = await raw(page).inputValue();
  expect(value).toContain('{*New York|Hamburg|München}[[hier]]');
  await simple(page).click();
  await advanced(page).click();
  await expect(raw(page)).toHaveValue(value);
  await raw(page).evaluate(el => { el.focus(); el.setSelectionRange(0, 0); });
  await page.locator('.card-editor-commands').getByRole('button', { name: 'Пример', exact: true }).click();
  await expect(raw(page)).toHaveValue('::example\n' + value);
  await simple(page).click();
  const summary = page.locator('.card-editor-add summary');
  await summary.click();
  await page.locator('.card-editor-add button').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-editor-add')).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
});

test('legacy and unknown raw source survives viewing, mode switches and save', async ({ page, context }) => {
  const source = '::future\r\nKEEP  EXACTLY\r\n@wordbank\r\n<<1>>';
  await openEditor(page, context, source);
  await expect(page.getByText('Эта карточка содержит сложную разметку. Содержимое сохранено без изменений.')).toBeVisible();
  await advanced(page).click();
  await simple(page).click();
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(source);
});

test('responsive visual and raw editor in Russian and English', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page, context, '::task\nVerbinde.\n::exercise\n@match\nBerlin => Deutschland\nWien => Österreich');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('textbox', { name: 'Левая сторона' }).first()).toHaveValue('Berlin');
    await page.locator('.card-editor-add summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`visual-${width}.png`), fullPage: true });
    await page.locator('.card-editor-add summary').click();
    await advanced(page).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`raw-${width}.png`), fullPage: true });
    await simple(page).click();
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await expect(page.getByRole('button', { name: 'Advanced: source markup' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.card-editor-add summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('english-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});


test('raw changes, preference persistence and save failure retain the draft', async ({ page, context }) => {
  await openEditor(page, context, 'Hallo');
  await advanced(page).click();
  const source = '::task\nSchreibe.\n::exercise\n@free\nEin Satz.';
  await raw(page).fill(source);
  await simple(page).click();
  await expect(page.getByRole('textbox', { name: 'Свободный ответ', exact: true })).toHaveValue('Ein Satz.');
  await advanced(page).click();
  expect(await page.evaluate(() => localStorage.getItem('lerne.cardEditor.mode'))).toBe('advanced');
  let fail = true;
  await page.route('**/api/cards/save', route => fail
    ? route.fulfill({ status: 400, json: { detail: 'Test save failure' } })
    : route.fulfill({ json: { ...route.request().postDataJSON(), id: 1 } }));
  const failed = page.waitForResponse('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await failed).status()).toBe(400);
  await expect(raw(page)).toHaveValue(source);
  await expect(page.getByRole('button', { name: /^Сохранить/ })).toBeEnabled();
  fail = false;
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: source, card_type: 'free_text' });
});

test('match pairs and puzzle content can be edited visually', async ({ page, context }) => {
  await openEditor(page, context);
  await add(page, 'Соединение пар');
  await page.getByRole('textbox', { name: 'Левая сторона' }).first().fill('Paris');
  await page.getByRole('textbox', { name: 'Правая сторона' }).first().fill('France');
  await page.getByRole('button', { name: 'Добавить пару', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Левая сторона' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Удалить пару', exact: true }).last().click();
  await advanced(page).click();
  expect(await raw(page).inputValue()).toContain('Paris => France');
  await raw(page).fill('');
  await simple(page).click();
  await add(page, 'Собрать предложение');
  await page.getByRole('textbox', { name: 'Собрать предложение', exact: true }).fill('Ich wohne in Berlin.');
  await advanced(page).click();
  await expect(raw(page)).toHaveValue('::exercise\n@puzzle\nIch wohne in Berlin.');
});
