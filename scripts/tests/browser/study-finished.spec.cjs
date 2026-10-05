const { test, expect } = require('@playwright/test');

const decks = [
  { id: 1, folder_id: 10, name: 'Первый урок', position: 0, target_language: 'de' },
  { id: 2, folder_id: 10, name: 'Следующий урок с очень длинным названием для проверки переноса текста', position: 1, target_language: 'de' },
  { id: 3, folder_id: 11, name: 'Другая тема', position: 2, target_language: 'de' },
  { id: 4, folder_id: null, name: 'Корневая колода', position: 3, target_language: 'de' },
].map(deck => ({ ...deck, stats: { total: 3, new: 0, due: 0, learning: 0 } }));
const future = new Date(Date.now() + 8 * 86400000).toISOString();
const cards = [1, 2, 3].map(id => ({ id, deck_id: 1, position: id, front: `Wort ${id}`, back: `Слово ${id}`,
  queue: 'review', interval: 10, next_review: future, intervals: { 0: '5 мин', 1: '6 дн', 2: '13 дн', 3: '15 дн' } }));

async function setup(page, context, locale = 'ru') {
  await context.addInitScript(locale => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  }, locale);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/init') return route.fulfill({ json: { decks, folders: [{ id: 10, name: 'Тема', parent_id: null, target_language: 'de' }],
      settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (url.pathname === '/api/decks') return route.fulfill({ json: decks });
    if (url.pathname.endsWith('/cards')) return route.fulfill({ json: cards });
    if (url.pathname.endsWith('/next')) {
      const forced = url.searchParams.get('review_context') === 'forced';
      const exclude = (url.searchParams.get('exclude_ids') || '').split(',').map(Number);
      return route.fulfill({ json: forced ? cards.find(c => !exclude.includes(c.id)) || { finished: true } : { finished: true } });
    }
    if (url.pathname === '/api/study/grade') {
      const body = route.request().postDataJSON();
      const next = cards.find(c => ![...(body.exclude_ids || []), body.card_id].includes(c.id));
      return route.fulfill({ json: next || { finished: true } });
    }
    if (url.pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (url.pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, is_guest: false } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('.view-decks')).toBeVisible();
  await page.evaluate(async () => {
    window.deckStore = (await import('/src/store/useDeckStore.js')).useDeckStore;
    window.sessionStore = (await import('/src/store/useSessionStore.js')).useSessionStore;
    window.uiStore = (await import('/src/store/useUiStore.js')).useUiStore;
  });
}

async function finish(page, deckId = 1, alreadyDone = false) {
  await page.evaluate(({ deckId, alreadyDone, cards }) => {
    const deck = deckStore.getState().decks.find(d => d.id === deckId);
    deckStore.getState().setCurrentDeck(deck);
    deckStore.getState().setDeckCards(cards);
    sessionStore.getState().resetSession();
    if (!alreadyDone) sessionStore.getState().setStudyHistory(cards);
    sessionStore.getState().setIsSessionFinished(true);
    uiStore.getState().setView('study');
  }, { deckId, alreadyDone, cards });
}

test('middle deck continues via shared startStudy and returns directly to the theme', async ({ page, context }) => {
  await setup(page, context);
  await finish(page);
  await expect(page.getByRole('heading', { name: 'Колода завершена', exact: true })).toBeVisible();
  const nextRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/decks/2/next');
  await page.getByRole('button', { name: /^Продолжить →/ }).click();
  await nextRequest;
  await expect(page.getByRole('heading', { name: 'На сегодня всё выполнено' })).toBeVisible();
  expect(await page.evaluate(() => deckStore.getState().currentDeck.id)).toBe(2);
  await page.getByRole('button', { name: 'К колодам темы', exact: true }).click();
  expect(await page.evaluate(() => ({ view: uiStore.getState().view, folder: uiStore.getState().activeFolderId, history: sessionStore.getState().studyHistory })))
    .toEqual({ view: 'decks', folder: 10, history: [] });
});

test('last deck and root return have no fabricated next deck', async ({ page, context }) => {
  await setup(page, context);
  await finish(page, 2);
  await expect(page.getByRole('heading', { name: 'Тема завершена', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Продолжить →/ })).toHaveCount(0);
  await finish(page, 4);
  await page.getByRole('button', { name: 'К колодам темы', exact: true }).click();
  expect(await page.evaluate(() => uiStore.getState().activeFolderId)).toBeNull();
  await expect(page.locator('.view-decks')).toBeVisible();
});

test('already done deck permits a finite graded forced pass', async ({ page, context }) => {
  await setup(page, context);
  await finish(page, 1, true);
  await expect(page.getByRole('heading', { name: 'На сегодня всё выполнено' })).toBeVisible();
  await expect(page.getByText(/^Следующее повторение:/)).toBeVisible();
  await page.getByRole('button', { name: '↻ Повторить колоду сейчас', exact: true }).click();
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/study/grade') requests.push(request.postDataJSON()); });
  for (const card of cards) {
    await expect(page.getByText(card.front, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: /Хорошо/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Колода завершена', exact: true })).toBeVisible();
  expect(requests.map(r => r.card_id)).toEqual([1, 2, 3]);
  expect(requests.map(r => r.exclude_ids)).toEqual([[1], [1, 2], [1, 2, 3]]);
  expect(requests.every(r => r.review_context === 'forced')).toBe(true);
});

test('API failure has an error screen and retry restores the same forced session', async ({ page, context }) => {
  await setup(page, context);
  await finish(page, 1, true);
  await page.route('**/api/decks/1/next*', route => route.fulfill({ status: 500, json: { detail: 'Temporary study failure' } }));
  await page.getByRole('button', { name: '↻ Повторить колоду сейчас', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary study failure');
  await expect(page.getByRole('heading', { name: /Колода завершена|На сегодня всё выполнено/ })).toHaveCount(0);
  await page.unroute('**/api/decks/1/next*');
  await page.getByRole('button', { name: 'Повторить запрос', exact: true }).click();
  await expect(page.getByText('Wort 1', { exact: true }).first()).toBeVisible();
});

for (const locale of ['ru', 'en']) {
  for (const width of [320, 375, 430, 768, 1280]) {
    test(`completion layout ${locale} ${width}px`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, context, locale);
      await finish(page);
      await expect(page.locator('.finished-view')).toBeVisible();
      await expect.poll(() => page.locator('.finished-view').evaluate(element => {
        let opacity = 1;
        for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      })).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const buttons = await page.locator('.finished-actions button').evaluateAll(elements => elements.map(e => ({ width: e.offsetWidth, height: e.offsetHeight })));
      expect(buttons.every(b => b.height >= 44 && b.width <= width)).toBe(true);
      if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`finished-${locale}-${width}.png`), fullPage: true });
    });
  }
}
