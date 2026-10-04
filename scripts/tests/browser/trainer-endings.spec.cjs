const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Endings', target_language: 'de', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };
const front = 'Mit klein{en} Hunden bei schön[[em]] Wetter.\n{Der} Hund läuft.';
const card = { id: 1, deck_id: 1, front, front_text: front, back: 'С маленькими собаками в хорошую погоду.', queue: 'new' };

async function openCard(page, context, language = 'ru', editor = false) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(language => {
    localStorage.setItem('native_language', language);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  }, language);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/cards/save') return route.fulfill({ json: { ...route.request().postDataJSON(), id: 1 } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText('Endings', { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card, editor }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ cardTextColor: '#fed7aa', cardFont: 'Georgia', cardFontSize: 1.75, cardFontWeight: 400 });
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, editingCard: editor ? { ...card, front: 'kleinen' } : null, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView(editor ? 'editor' : 'study');
  }, { deck, card, editor });
}

test('endings stay compact and attached across viewports; choices, typing, correction and retry work', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openCard(page, context);
  const text = page.locator('.cloze-masked-text').first();
  const choice = text.getByRole('button', { name: 'Пропуск 1', exact: true });
  const input = text.getByRole('textbox', { name: 'Пропуск 2', exact: true });
  await expect(choice).toBeVisible();
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: /Заполните пропуски/ })).toBeDisabled();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await text.evaluate(element => [...element.querySelectorAll('.trainer-word')].map(word => {
      const stem = word.querySelector('.trainer-word-letter').getBoundingClientRect();
      const gap = word.querySelector('.trainer-affix-gap');
      const box = gap.getBoundingClientRect();
      const style = getComputedStyle(gap);
      return { distance: box.left - stem.right, width: box.width, color: style.color, font: style.fontFamily, topDifference: Math.abs(box.top - stem.top) };
    }));
    for (const gap of geometry) {
      expect(gap.distance).toBeLessThanOrEqual(1);
      expect(gap.width).toBeLessThan(44);
      expect(gap.topDifference).toBeLessThan(6);
      expect(gap.color).toBe('rgb(254, 215, 170)');
      expect(gap.font).toContain('Georgia');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`endings-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await choice.click();
  const menu = page.getByRole('dialog', { name: 'Пропуск 1', exact: true });
  await expect(menu.getByRole('button')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('endings-menu.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(choice).toBeFocused();
  await choice.click();
  await menu.getByRole('button', { name: 'en', exact: true }).click();
  await expect(choice).toHaveText('en');
  await input.focus();
  expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await input.fill('er');
  await text.getByRole('button', { name: 'Пропуск 3', exact: true }).click();
  await page.getByRole('dialog', { name: 'Пропуск 3', exact: true }).getByRole('button', { name: 'Der', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(text.locator('.trainer-affix-gap.is-wrong del')).toHaveText('er');
  await expect(text.locator('.trainer-affix-correction')).toHaveText('em');
  await page.screenshot({ path: testInfo.outputPath('endings-correction.png'), fullPage: true });
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await choice.click();
  await menu.getByRole('button', { name: 'en', exact: true }).click();
  await text.getByRole('button', { name: 'Пропуск 3', exact: true }).click();
  await page.getByRole('dialog', { name: 'Пропуск 3', exact: true }).getByRole('button', { name: 'Der', exact: true }).click();
  await input.fill('em');
  expect(await input.evaluate(element => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = getComputedStyle(element).font;
    return element.getBoundingClientRect().width >= context.measureText(element.value).width + 2;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-input-em.png'), fullPage: true });
  await input.press('Enter');
  await expect(text.locator('.trainer-affix-gap.is-correct')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('endings-correct.png'), fullPage: true });
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().setCard({ id: 2, deck_id: 1, front: 'Donaudampfschifffahrtsgesellschaft{en}' });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(text.getByRole('button', { name: 'Пропуск 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-long-word-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('ending command wraps a selected ending and saves the short markup; English labels work', async ({ page, context }, testInfo) => {
  await openCard(page, context, 'en', true);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Source markup', exact: true });
  await expect(source).toHaveValue('kleinen');
  await source.evaluate(element => { element.focus(); element.setSelectionRange(5, 7); });
  await page.getByRole('button', { name: 'Ending with choices', exact: true }).click();
  await expect(source).toHaveValue('klein{en}');
  await expect(page.locator('.card-editor-choice')).toHaveCount(5);
  await expect(page.locator('.card-editor-choice input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('.card-editor-inline-gap.is-affix')).toHaveText('··');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.card-editor-sentence').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ending-editor-sentence-en-320.png'), fullPage: true });
  await source.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-editor-en-320.png'), fullPage: true });
  const saved = page.waitForRequest(request => new URL(request.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Save/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: 'klein{en}', card_type: 'trainer' });
});
