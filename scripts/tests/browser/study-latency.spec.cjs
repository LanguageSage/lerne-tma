const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Latency', target_language: 'de', stats: { total: 3, new: 3, due: 0, learning: 0 } };
const cards = [1, 2, 3].map(id => ({ id, deck_id: 1, position: id, front: `Instant word ${id}`, back: `Answer ${id}`,
  queue: 'new', interval: 0, intervals: { 0: '1 min', 1: '6 min', 2: '10 min', 3: '4 days' } }));

async function setup(page, context, duplicate = false, language = 'en') {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(language => {
    localStorage.setItem('native_language', language);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
    HTMLMediaElement.prototype.play = function () { window.audioPlayCalls = (window.audioPlayCalls || 0) + 1; return Promise.resolve(); };
  }, language);
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
    const { useStudyNavigation } = await import('/src/hooks/useStudyNavigation.js');
    const target = document.createElement('div');
    document.body.append(target);
    createRoot(target).render(React.createElement(function Harness() {
      window.studyActions = useStudySession();
      window.studyNavigation = useStudyNavigation();
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

test('grade after Back immediately uses forward history and ignores older refresh and server choice', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => studyActions.goNext());
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON().card_id).toBe(1);
  expect(gradeRoute.request().postDataJSON().return_next).toBe(false);
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await gradeRoute.fulfill({ json: { ...cards[2], queue: 'review', interval: 23 } });
  await page.evaluate(() => window.gradePromise);
  await pending[0].fulfill({ json: { ...cards[1], interval: 999 } });
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id)])).toEqual([2, 1, [1, 2]]);
});

test('background grade failure remains visible, keeps newer history, and blocks regrading until acknowledged', async ({ page, context }) => {
  await setup(page, context);
  await page.route('**/api/study/grade', route => route.fulfill({ status: 500, json: { detail: 'Save failed' } }));
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.length, uiStore.getState().loading])).toEqual([2, 1, 2, false]);
  await expect(page.locator('.study-grade-error')).toContainText('Save failed');
  await page.evaluate(() => studyActions.goBack());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(() => sessionStore.getState().resetSession());
  await expect(page.locator('.study-grade-error')).toContainText('Save failed');
});

test('grade rejection is readable in Russian and does not hide the new card', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await setup(page, context, false, 'ru');
  await page.route('**/api/study/grade', route => route.fulfill({ status: 403, json: { detail: 'Нет доступа к колоде' } }));
  await page.locator('.btn-grade.grade-2').click();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect(page.locator('.study-grade-error')).toContainText('Оценка карточки №1 не подтверждена');
  await expect(page.locator('.study-grade-error button')).toHaveText('Понятно');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('grade-error-ru-375.png'), fullPage: true });
});

test('rapid grades advance independently; reverse responses cannot rewind and stale handlers cannot grade the new card', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.evaluate(() => {
    const submit = studyActions.submitGrade;
    window.firstGrade = submit(2);
    submit(2); // Same rendered card: do not rate its successor.
  });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.secondGrade = studyActions.submitGrade(3); });
  await expect(page.getByText(cards[2].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending.map(route => route.request().postDataJSON().card_id)).toEqual([1, 2]);
  await pending[1].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.secondGrade);
  await pending[0].fulfill({ json: { finished: true } });
  await page.evaluate(() => window.firstGrade);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id), Object.keys(sessionStore.getState().pendingGrades).length])).toEqual([3, 2, [1, 2, 3], 0]);
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => studyActions.goBack());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
});

test('real grade button double click sends only one request even after instant advance', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.locator('.btn-grade.grade-2').dblclick();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0].request().postDataJSON().card_id).toBe(1);
  await page.evaluate(() => studyActions.goBack());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(pending.length).toBe(1);
  await pending[0].fulfill({ json: { status: 'success' } });
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
});

test('opening-card refresh cannot rewind an instant grade or overwrite its progress', async ({ page, context }) => {
  await setup(page, context);
  const refresh = await holdRefresh(page);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(deck => studyNavigation.startStudyCard(deck, 1), deck);
  await expect.poll(() => refresh.length).toBe(1);
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await refresh[0].fulfill({ json: { ...cards[0], interval: 999 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().studyHistory[0].interval)).toBe(0);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
  await gradeRoute.fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.gradePromise);
});

test('newer refresh wins across the opening and study hook instances', async ({ page, context }) => {
  await setup(page, context);
  const refresh = await holdRefresh(page);
  await page.evaluate(deck => studyNavigation.startStudyCard(deck, 1), deck);
  await expect.poll(() => refresh.length).toBe(1);
  await page.evaluate(() => studyActions.refreshCard(sessionStore.getState().card));
  await expect.poll(() => refresh.length).toBe(2);
  await refresh[1].fulfill({ json: { ...cards[0], interval: 12 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(12);
  await refresh[0].fulfill({ json: { ...cards[0], interval: 3 } });
  const stored = await page.evaluate(() => [sessionStore.getState().card.interval,
    sessionStore.getState().studyHistory[0].interval, deckStore.getState().deckCards[0].interval]);
  expect(stored).toEqual([12, 12, 12]);
});

for (const change of ['reset', 'deck', 'navigation']) {
  test(`pending grade and refresh cannot change state after ${change}`, async ({ page, context }) => {
    await setup(page, context);
    const refresh = await holdRefresh(page);
    let gradeRoute;
    await page.route('**/api/study/grade', route => { gradeRoute = route; });
    await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
    await expect.poll(() => Boolean(gradeRoute)).toBe(true);
    await expect.poll(() => refresh.length).toBe(1);
    await page.evaluate(({ change, card }) => {
      if (change === 'reset') sessionStore.getState().resetSession();
      if (change === 'deck') {
        deckStore.getState().setCurrentDeck({ id: 99 });
        deckStore.getState().setCurrentDeck({ id: 1 }); // Even leave/return invalidates.
      }
      if (change === 'navigation') {
        uiStore.getState().setView('cards');
        uiStore.getState().setView('study');
      }
      sessionStore.getState().addToHistory(card);
    }, { change, card: { ...cards[1], interval: 44 } });
    await gradeRoute.fulfill({ json: cards[0] });
    await page.evaluate(() => window.gradePromise);
    await refresh[0].fulfill({ json: { ...cards[1], interval: 999 } });
    await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(44);
    expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
  });
}

test('uncached grade waits for server selection but ignores it after navigation', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(() => deckStore.getState().setDeckCards([sessionStore.getState().card]));
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON().return_next).toBe(true);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(card => { sessionStore.getState().addToHistory(card); }, cards[2]);
  await gradeRoute.fulfill({ json: cards[1] });
  await page.evaluate(() => window.gradePromise);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(3);
});

test('forced grade uses the server context and exclusions when no forward history is available', async ({ page, context }) => {
  await setup(page, context);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => {
    sessionStore.getState().setIsLearningMore(true);
    sessionStore.getState().markForcedSeen(1);
    window.gradePromise = studyActions.submitGrade(2);
  });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON()).toMatchObject({ return_next: true, review_context: 'forced', exclude_ids: [1] });
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await gradeRoute.fulfill({ json: cards[2] });
  await page.evaluate(() => window.gradePromise);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().forcedSeenIds])).toEqual([3, [1, 3]]);
});

test('last uncached grade waits for earlier writes before server selection and finishes cleanly', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.evaluate(() => { window.firstGrade = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.secondGrade = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[2].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.lastGrade = studyActions.submitGrade(2); });
  await expect.poll(() => pending.length).toBe(2);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await pending[0].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.firstGrade);
  expect(pending.length).toBe(2);
  await pending[1].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.secondGrade);
  await expect.poll(() => pending.length).toBe(3);
  expect(pending[2].request().postDataJSON()).toMatchObject({ card_id: 3, return_next: true });
  await pending[2].fulfill({ json: { finished: true } });
  await page.evaluate(() => window.lastGrade);
  expect(await page.evaluate(() => [sessionStore.getState().isSessionFinished, sessionStore.getState().card,
    Object.keys(sessionStore.getState().pendingGrades).length])).toEqual([true, null, 0]);
});

test('uncached grade rejection preserves its current card and can be acknowledged', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(() => deckStore.getState().setDeckCards([]));
  await page.route('**/api/study/grade', route => route.fulfill({ status: 422, json: { detail: 'Invalid grade' } }));
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex])).toEqual([1, 0]);
  await expect(page.locator('.study-grade-error')).toContainText('Invalid grade');
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.locator('.study-grade-error button').click();
  await expect(page.locator('.study-grade-error')).toHaveCount(0);
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
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
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.route('**/api/media/generate-card-audio', route => route.fulfill({ json: { path: 'generated.wav', url: audio } }));
  await page.evaluate(() => settingsStore.setState({ autoPlay: true }));
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  await expect.poll(() => page.evaluate(() => window.audioPlayCalls || 0)).toBeGreaterThan(0);
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ json: { ...cards[1], audio_url: null, audio_path: null, interval: 9 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(9);
  expect(await page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  await gradeRoute.fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.gradePromise);
});

test('grade displays ready audio immediately without generating it', async ({ page, context }) => {
  await setup(page, context);
  const audio = '/api/media/audio/ready.wav';
  let generations = 0;
  await page.route('**/api/media/generate-card-audio', route => { generations += 1; return route.fulfill({ json: {} }); });
  await page.route('**/api/study/grade', () => {});
  await holdRefresh(page);
  await page.evaluate(({ cards, audio }) => {
    deckStore.getState().setDeckCards(cards.map(card => ({ ...card, audio_path: 'ready.wav', audio_url: audio })));
    sessionStore.getState().updateCardInSession(1, { audio_path: 'ready.wav', audio_url: audio });
    settingsStore.setState({ autoPlay: true });
  }, { cards, audio });
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.audioPlayCalls || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  expect(generations).toBe(0);
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
    await page.route('**/api/study/grade', route => route.fulfill({ status: 403, json: { detail: 'Access denied. Grade was not saved.' } }));
    await page.evaluate(() => studyActions.submitGrade(2));
    await expect(page.locator('.study-grade-error')).toContainText('Access denied');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`grade-error-${width}.png`), fullPage: true });
  });
}
