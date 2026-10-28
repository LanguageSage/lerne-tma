const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Theory in practice', target_language: 'de', is_learning: true,
  role: 'owner', stats: { total: 2, new: 2, due: 0, learning: 0 } };
const front = '@theory\nWarum steht das Verb nach weil am Ende?';
const cards = [
  { id: 1, deck_id: 1, front, back: 'Weil вводит придаточное предложение.', context: 'Ich bleibe, weil ich krank bin.', card_type: 'theory', queue: 'new' },
  { id: 2, deck_id: 1, front: 'Ich [[lerne]] Deutsch.', back: 'Я учу немецкий.', card_type: 'trainer', queue: 'new' },
];

async function setup(page, context) {
  const errors = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated-test', refresh_token: 'isolated-test' }));
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {},
      user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: cards });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: cards[0] });
    if (pathname === '/api/cards/save') return route.fulfill({ json: { ...cards[0], ...route.request().postDataJSON() } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false, autoGenerateCardAudio: false });
  });
  return errors;
}

test('Theory badge, ordinary study/reveal and editing preserve the type', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  await page.locator('#deck-item-1').click();
  await page.getByRole('button', { name: 'Показать список', exact: true }).click();
  const theory = page.locator('#card-item-1');
  await expect(theory).toContainText('📚 Theory');
  await expect(theory).not.toContainText('@theory');
  await expect(page.locator('#card-item-2')).toContainText('Trainer');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(theory.getByText('📚 Theory', { exact: true })).toBeVisible();
    expect(await theory.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`theory-list-${width}.png`), fullPage: true });
  }
  await theory.locator('.card-item-text').click();
  await expect(page.locator('#tut-study-front')).toHaveText('Warum steht das Verb nach weil am Ende?');
  await expect(page.locator('.card-front')).not.toContainText('@theory');
  await expect(page.locator('.trainer-input, .btn-quiz-option, .btn-puzzle-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Перевернуть карточку', exact: true }).click();
  await expect(page.locator('.card-back')).toContainText(cards[0].back);
  await expect(page.locator('.card-back')).toContainText(cards[0].context);
  await page.screenshot({ path: testInfo.outputPath('theory-answer.png'), fullPage: true, animations: 'disabled' });

  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSessionStore.getState().setEditingCard(card);
    useUiStore.getState().setView('editor');
  }, cards[0]);
  const raw = page.getByRole('textbox', { name: 'Исходная разметка', exact: true });
  await expect(raw).toBeVisible();
  await expect(raw).toHaveValue(front);
  await raw.fill(front + '\nDas ist eine Erklärung.');
  const request = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  const payload = (await request).postDataJSON();
  expect(payload.card_type).toBe('theory');
  expect(payload.front).toBe(front + '\nDas ist eine Erklärung.');
  expect(payload.back).toBe(cards[0].back);
  expect(payload.context).toBe(cards[0].context);
  expect(errors).toEqual([]);
});

test('offline save, read and edit keep Theory in the existing card_type field', async ({ page, context }) => {
  const errors = await setup(page, context);
  const result = await page.evaluate(async ({ deck, front }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const { offlineApi } = await import('/src/services/offlineApi.js');
    const { detectCardType } = await import('/src/utils/exerciseDetector.js');
    const db = await prepareLocalDb();
    await db.decks.put(deck);
    const saved = await offlineApi.handle('post', '/cards/save', { deck_id: deck.id, front, back: 'Ответ', context: 'Правило', card_type: 'theory' });
    await offlineApi.handle('post', '/cards/save', { card_id: saved.data.id, deck_id: deck.id, back: 'Новый ответ' });
    const listed = await offlineApi.handle('get', '/decks/1/cards');
    const theory = listed.data.find(card => card.id === saved.data.id);
    return { type: theory.card_type, detected: detectCardType(theory), front: theory.front, back: theory.back, context: theory.context };
  }, { deck, front });
  expect(result).toEqual({ type: 'theory', detected: 'theory', front, back: 'Новый ответ', context: 'Правило' });
  expect(errors).toEqual([]);
});
