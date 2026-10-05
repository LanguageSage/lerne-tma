const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Latency', target_language: 'de', stats: { total: 3, new: 3, due: 0, learning: 0 } };
const cards = [1, 2, 3].map(id => ({ id, deck_id: 1, position: id, front: `Instant word ${id}`, back: `Answer ${id}`,
  queue: 'new', interval: 0, intervals: { 0: '1 min', 1: '6 min', 2: '10 min', 3: '4 days' } }));

async function setup(page, context, duplicate = false) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'en');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
    HTMLMediaElement.prototype.play = function () { window.audioPlayCalls = (window.audioPlayCalls || 0) + 1; return Promise.resolve(); };
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {},
      user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname.endsWith('/cards')) return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: cards });
    if (pathname.startsWith('/api/study/card/')) return route.fulfill({ json: cards.find(c => c.id === Number(pathname.split('/').pop())) });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('.view-decks')).toBeVisible();
  // The unrelated infinite floating arrow animation prevents Playwright's stability check.
  // Keep the actual card and flip animations enabled for these transition tests.
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  await page.evaluate(async ({ deck, cards, duplicate }) => {
    window.deckStore = (await import('/src/store/useDeckStore.js')).useDeckStore;
    window.sessionStore = (await import('/src/store/useSessionStore.js')).useSessionStore;
    window.uiStore = (await import('/src/store/useUiStore.js')).useUiStore;
    window.settingsStore = (await import('/src/store/useSettingsStore.js')).useSettingsStore;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { useStudySession } = await import('/src/hooks/useStudySession.js');
    const target = document.createElement('div');
    document.body.append(target);
    createRoot(target).render(React.createElement(function Harness() {
      window.studyActions = useStudySession();
      return null;
    }));
    deckStore.getState().setCurrentDeck(duplicate ? { ...deck, id: 'duplicates' } : deck);
    deckStore.getState().setDeckCards(cards);
    deckStore.getState().setDuplicateCards(cards);
    sessionStore.getState().resetSession();
    sessionStore.getState().addToHistory(cards[0]);
    settingsStore.setState({ autoPlay: false, studyMode: 'classic' });
    uiStore.getState().setView('study');
  }, { deck, cards, duplicate });
  await page.waitForFunction(() => window.studyActions);
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
}

function holdRefresh(page) {
  const pending = [];
  return page.route('**/api/study/card/*', route => { pending.push(route); }).then(() => pending);
}

test('Next/Back show cached cards with HTTP pending; refresh updates the matching history and cache', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.getByTitle('Next card', { exact: true }).click();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => ({ id: sessionStore.getState().card.id, index: sessionStore.getState().historyIndex,
    loading: uiStore.getState().loading }))).toEqual({ id: 2, index: 1, loading: false });
  await page.getByTitle('Previous card', { exact: true }).click();
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(2);
  await pending[0].fulfill({ json: { ...cards[1], queue: 'review', interval: 17, repetitions: 4 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().studyHistory[1].interval)).toBe(17);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  expect(await page.evaluate(() => deckStore.getState().deckCards[1].repetitions)).toBe(4);
  await page.getByTitle('Next card', { exact: true }).click();
  expect(await page.evaluate(() => [sessionStore.getState().historyIndex, sessionStore.getState().card.interval])).toEqual([1, 17]);
});

test('failed background refresh retains the local card and history', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goNext());
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ status: 500, json: { detail: 'Refresh failed' } });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex, sessionStore.getState().apiError])).toEqual([2, 1, null]);
});

test('Back prepends a local card immediately and duplicates retain their sequence', async ({ page, context }) => {
  await setup(page, context, true);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goBack());
  await expect.poll(() => pending.length).toBe(1);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id)])).toEqual([3, 0, [3, 1]]);
  await page.evaluate(() => studyActions.goNext());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await page.evaluate(() => studyActions.goNext());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
});

test('grade waits for server choice, keeps correct history index after Back, and ignores older refresh', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => studyActions.goNext());
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON().card_id).toBe(1);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await gradeRoute.fulfill({ json: { ...cards[2], queue: 'review', interval: 23 } });
  await page.evaluate(() => window.gradePromise);
  await expect(page.getByText(cards[2].front, { exact: true }).first()).toBeVisible();
  await pending[0].fulfill({ json: { ...cards[1], interval: 999 } });
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id)])).toEqual([3, 2, [1, 2, 3]]);
});

test('grade failure never advances the card or history', async ({ page, context }) => {
  await setup(page, context);
  await page.route('**/api/study/grade', route => route.fulfill({ status: 500, json: { detail: 'Save failed' } }));
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.length, uiStore.getState().loading])).toEqual([1, 0, 1, false]);
});

test('forced Next waits for SRS instead of selecting the local neighbor', async ({ page, context }) => {
  await setup(page, context);
  let nextRoute;
  await page.route('**/api/decks/1/next*', route => { nextRoute = route; });
  await page.evaluate(() => {
    sessionStore.getState().setIsLearningMore(true);
    sessionStore.getState().markForcedSeen(1);
    window.nextPromise = studyActions.goNext();
  });
  await expect.poll(() => Boolean(nextRoute)).toBe(true);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  expect(new URL(nextRoute.request().url()).searchParams.get('review_context')).toBe('forced');
  await nextRoute.fulfill({ json: cards[2] });
  await page.evaluate(() => window.nextPromise);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(3);
});

test('reset to the same card rejects the previous session refresh', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goNext());
  await expect.poll(() => pending.length).toBe(1);
  await page.evaluate(card => {
    sessionStore.getState().resetSession();
    sessionStore.getState().addToHistory(card);
  }, cards[1]);
  const refreshed = page.waitForResponse(response => response.url().includes('/study/card/2'));
  await pending[0].fulfill({ json: { ...cards[1], interval: 999 } });
  await refreshed;
  expect(await page.evaluate(() => sessionStore.getState().card.interval)).toBe(0);
});

test('missing audio generates and plays through existing autoPlay; late refresh preserves audio', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  const audio = '/api/media/audio/generated.wav';
  await page.route('**/api/media/generate-card-audio', route => route.fulfill({ json: { path: 'generated.wav', url: audio } }));
  await page.evaluate(() => settingsStore.setState({ autoPlay: true }));
  await page.evaluate(() => studyActions.goNext());
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  await expect.poll(() => page.evaluate(() => window.audioPlayCalls || 0)).toBeGreaterThan(0);
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ json: { ...cards[1], audio_url: null, audio_path: null, interval: 9 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(9);
  expect(await page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`card transition layout ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context);
    await holdRefresh(page);
    await page.getByTitle('Next card', { exact: true }).click();
    await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
    await expect(page.locator('#tut-study-card')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`study-${width}.png`), fullPage: true });
  });
}
