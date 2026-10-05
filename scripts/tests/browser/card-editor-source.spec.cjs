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
const command = (page, name) => page.locator('.card-editor-toolbar').getByRole('button', { name, exact: true });
async function sourceEditor(page, context, front) {
  await openEditor(page, context, front);
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();
}

test('puzzle inserts at a keyboard cursor between blocks, selects its example and saves the replacement', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const before = '::task\nЗаполни пропуск.\n\n';
  const after = '\n\n::exercise\nDas ist ein [[schönes]] Haus.';
  await sourceEditor(page, context, before + after);
  await raw(page).focus();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  expect(await raw(page).evaluate(el => el.selectionStart)).toBe(before.length);
  await command(page, 'Собрать предложение').click();
  await expect(raw(page)).toHaveValue(before + '@puzzle\nIch lerne Deutsch.' + after);
  await expect(raw(page)).toBeFocused();
  expect(await raw(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Ich lerne Deutsch.');
  await page.keyboard.insertText('Mein Satz.');
  const front = before + '@puzzle\nMein Satz.' + after;
  await expect(raw(page)).toHaveValue(front);
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(front);
  expect(errors).toEqual([]);
});

test('every toolbar command replaces selection and preserves both surrounding parts', async ({ page, context }) => {
  await sourceEditor(page, context, 'Hallo');
  const commands = await page.evaluate(async () => (await import('/src/utils/cardEditorSyntax.js')).editorCommands);
  for (const item of commands) {
    await raw(page).fill('AA\nREPLACE\nZZ');
    await raw(page).evaluate(el => { el.focus(); el.setSelectionRange(3, 10); });
    await command(page, item.label).click();
    await expect(raw(page)).toHaveValue('AA\n' + item.template + '\nZZ');
    await expect(raw(page)).toBeFocused();
  }
});

test('repeated source and inline insertions use the cursor after typing and arrow keys', async ({ page, context }) => {
  await sourceEditor(page, context, 'AA\nBB');
  await raw(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await command(page, 'Подсказка').click();
  await expect(raw(page)).toBeFocused();
  await page.keyboard.insertText('Перевод.\n');
  await command(page, 'Исходный текст').click();
  await expect(raw(page)).toHaveValue('AA\n::source\nПеревод.\n::source\nBB');
  await expect(raw(page)).toBeFocused();
  await page.keyboard.insertText('X');
  await page.keyboard.press('ArrowLeft');
  await command(page, 'Поле для ввода').click();
  await expect(raw(page)).toHaveValue('AA\n::source\nПеревод.\n::source\n[[Berlin]]XBB');
});

test('mouse cursor and keyboard toolbar activation retain the last selection', async ({ page, context }) => {
  const source = 'First line\nSecond line\nThird line';
  await sourceEditor(page, context, source);
  const lineHeight = await raw(page).evaluate(el => {
    const style = getComputedStyle(el);
    return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  });
  const padding = await raw(page).evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
  await raw(page).click({ position: { x: 30, y: padding + lineHeight * 1.5 } });
  const at = await raw(page).evaluate(el => el.selectionStart);
  expect(at).toBeGreaterThanOrEqual('First line\n'.length);
  expect(at).toBeLessThan('First line\nSecond line\n'.length);
  await command(page, 'Поле для ввода').click();
  await expect(raw(page)).toHaveValue(source.slice(0, at) + '[[Berlin]]' + source.slice(at));
  await raw(page).fill('kleinem Haus');
  await raw(page).focus();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await command(page, 'Окончание с выбором').focus();
  await page.keyboard.press('Enter');
  await expect(raw(page)).toHaveValue('klein{em} Haus');
  await expect(raw(page)).toBeFocused();
});

test('CRLF uses textarea offsets and preserves the stored format on save', async ({ page, context }) => {
  const before = '::task\r\nЗадание.\r\n\r\n';
  const after = '\r\n\r\n::exercise\r\nHallo.';
  await sourceEditor(page, context, before + after);
  await raw(page).focus();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await command(page, 'Собрать предложение').click();
  const expected = before + '@puzzle\r\nIch lerne Deutsch.' + after;
  await expect(raw(page)).toHaveValue(expected.replace(/\r\n/g, '\n'));
  expect(await raw(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Ich lerne Deutsch.');
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(expected);
});

test('long source preserves textarea and container scroll during insertion', async ({ page, context }) => {
  await sourceEditor(page, context, 'Hallo');
  await raw(page).fill(Array.from({ length: 120 }, (_, i) => 'Line ' + i).join('\n'));
  await raw(page).evaluate(el => {
    el.focus(); el.setSelectionRange(el.value.indexOf('Line 60'), el.value.indexOf('Line 60'));
    el.scrollTop = 1000;
  });
  const scroll = await raw(page).evaluate(el => el.scrollTop);
  const button = command(page, 'Поле для ввода');
  await button.scrollIntoViewIfNeeded();
  const containerScroll = await page.locator('.app-container').evaluate(el => el.scrollTop);
  await button.click();
  await expect(raw(page)).toBeFocused();
  expect(await raw(page).evaluate(el => el.scrollTop)).toBe(scroll);
  expect(await page.locator('.app-container').evaluate(el => el.scrollTop)).toBe(containerScroll);
  expect(await raw(page).inputValue()).toContain('Line 59\n[[Berlin]]Line 60');
});

test('untouched source appends at the end rather than using a fresh textarea zero offset', async ({ page, context }) => {
  await sourceEditor(page, context, 'Existing text.');
  expect(await raw(page).evaluate(el => el.selectionStart)).toBe(0);
  await command(page, 'Собрать предложение').click();
  await expect(raw(page)).toHaveValue('Existing text.\n@puzzle\nIch lerne Deutsch.');
  await expect(raw(page)).toBeFocused();
});

test('mode roundtrip retains the cursor and save failure retains the edited draft', async ({ page, context }) => {
  await sourceEditor(page, context, 'AB');
  await raw(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  await command(page, 'Поле для ввода').click();
  const source = 'A[[Berlin]]B';
  await expect(raw(page)).toHaveValue(source);
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
  expect((await saved).postDataJSON().front).toBe(source);
});

test('responsive toolbar fits narrow and desktop widths in Russian and English', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await sourceEditor(page, context, '::task\nЗадание.\n\n::source\nПодсказка.\n\n::exercise\nHallo [[Welt]].');
  for (const [width, height] of [[1920, 1080], [1366, 768], [768, 900], [430, 900], [375, 812], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await command(page, 'Банк слов').scrollIntoViewIfNeeded();
    await expect(command(page, 'Банк слов')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.card-content-editor').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('toolbar-' + width + '.png'), fullPage: true });
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await expect(command(page, 'Hint')).toBeVisible();
  await expect(command(page, 'Word bank')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('toolbar-en-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test.describe('touch toolbar', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });
  test('touch activation retains textarea selection', async ({ page, context }) => {
    await sourceEditor(page, context, 'AA\nBB');
    await raw(page).evaluate(el => { el.focus(); el.setSelectionRange(3, 3); });
    await command(page, 'Подсказка').tap();
    await expect(raw(page)).toHaveValue('AA\n::source\nBB');
    await expect(raw(page)).toBeFocused();
  });
});
