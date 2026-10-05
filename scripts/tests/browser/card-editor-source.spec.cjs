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

const raw = page => page.getByRole('textbox', { name: 'Исходная разметка', exact: true });
const hint = page => page.getByRole('button', { name: 'Подсказка', exact: true });

test('hint button preserves blocks, focuses source and saves canonical markup', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const exercise = '::exercise\nDas ist ein [[schönes]] Haus.';
  await openEditor(page, context, `::task\nЗаполни пропуск.\n\n${exercise}`);
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();

  const cases = [
    [`::task\nЗаполни пропуск.\n\n${exercise}`, `::task\nЗаполни пропуск.\n\n::source\n\n\n${exercise}`],
    [`::task\nЗадание.\n\n::example\nПример.\n\n${exercise}`, `::task\nЗадание.\n\n::source\n\n\n::example\nПример.\n\n${exercise}`],
    [`::task\nЗадание.\n\n::options\nschönes | neues\n\n${exercise}`, `::task\nЗадание.\n\n::source\n\n\n::options\nschönes | neues\n\n${exercise}`],
    [`::task\nЗадание.\n\n::source\nКонтекст.\n\n${exercise}`, `::task\nЗадание.\n\n::source\nКонтекст.\n\n${exercise}`],
    [exercise, `::source\n\n\n${exercise}`],
    [`::task\nПервая строка.\nВторая строка.\n\nТретья строка.\n\n${exercise}`, `::task\nПервая строка.\nВторая строка.\n\nТретья строка.\n\n::source\n\n\n${exercise}`],
  ];
  for (const [source, expected] of cases) {
    await raw(page).fill(source);
    // Reproduce an untouched textarea with its selection at the start.
    await raw(page).evaluate(el => el.setSelectionRange(0, 0));
    await hint(page).click();
    await expect(raw(page)).toHaveValue(expected);
    await expect(raw(page)).toBeFocused();
    expect(await raw(page).evaluate(el => el.selectionStart)).toBe(expected.indexOf('::source\n') + '::source\n'.length);
    await hint(page).click();
    await expect(raw(page)).toHaveValue(expected);
  }
  await page.keyboard.insertText('Подсказка пользователя.');
  const front = await raw(page).inputValue();
  expect(front).toContain('::source\nПодсказка пользователя.');
  expect(front).not.toContain('::hint');
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(front);
  expect(errors).toEqual([]);
});

test('legacy hints remain unchanged and responsive toolbar works in Russian and English', async ({ page, context }, testInfo) => {
  const source = '::task\nЗадание.\n\n::hint\nСтарая подсказка.\n\n::exercise\nHallo [[Welt]].';
  await openEditor(page, context, source);
  await expect(page.getByRole('textbox', { name: 'Исходный текст', exact: true })).toHaveValue('Старая подсказка.\n');
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  await hint(page).click();
  await expect(raw(page)).toHaveValue(source);
  await expect(raw(page)).toBeFocused();
  expect(await raw(page).evaluate(el => el.selectionStart)).toBe(source.indexOf('::hint\n') + '::hint\n'.length);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await hint(page).scrollIntoViewIfNeeded();
    await expect(hint(page)).toBeVisible();
    expect(await page.locator('.card-content-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`source-${width}.png`), fullPage: true });
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByRole('button', { name: 'Hint', exact: true })).toBeVisible();
  expect(await page.locator('.card-content-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('source-en-320.png'), fullPage: true });
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Save/ }).click();
  expect((await saved).postDataJSON().front).toBe(source);
});

