const { test, expect } = require('@playwright/test');
// Several scenarios include full-app setup, touch gestures and five viewport captures.
test.setTimeout(60000);
const deck = { id: 1, name: 'Feedback', target_language: 'de', is_learning: true, stats: { total: 1, new: 1, due: 0, learning: 0 } };
const puzzle = { id: 13, deck_id: 1, queue: 'new', front: '@puzzle\nIch gehe heute mit Anna ins Kino.', back: 'Я иду сегодня с Анной в кино.' };

async function openStudy(page, context, card, locale = 'ru') {
  card = { ...card, requiredActions: ['answer'] }; // This fixture tests mandatory objective completion.
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(locale => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  }, locale);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname === `/api/study/card/${card.id}` || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText('Feedback', { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ cardTextColor: '#fed7aa', cardFont: 'Georgia', cardFontSize: 1.5 });
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
}

async function flip(page, value) {
  await page.evaluate(async value => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ isFlipped: value });
  }, value);
}

async function screenshotWidths(page, testInfo, name) {
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
  }
}

async function rendererHarness(page, card) {
  await page.evaluate(async card => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    window.exerciseTest = { saved: {}, answers: [], card };
    window.exerciseTest.render = (key = `${window.exerciseTest.card.id}:0`, mounted = true) => {
      root.render(mounted ? React.createElement(ExerciseRenderer, {
        card: window.exerciseTest.card, reviewKey: key,
        savedState: window.exerciseTest.saved[key],
        onSaveState: state => { window.exerciseTest.saved[key] = state; },
        onTrainerAnswer: (_id, evidence) => window.exerciseTest.answers.push(evidence),
      }) : null);
    };
    window.exerciseTest.render();
  }, card);
}

const pool = (page, id) => page.locator(`.btn-puzzle-chip[data-id="${id}"]:visible`);
const slot = (page, id) => page.locator(`.puzzle-slot-chip[data-id="${id}"]:visible`);
const boundaries = page => page.locator('.puzzle-boundary[data-part-id]:visible');
const check = page => page.getByRole('button', { name: /^(Проверить ответы|Check answers)$/ });
async function assemble(page, order) {
  for (const id of order) await pool(page, id).click();
}
const selectedOrder = page => page.locator('.puzzle-slot-chip:visible').evaluateAll(items => items.map(item => Number(item.dataset.id)));

async function dragAfter(page, fromId, toId, touch = false) {
  const from = await slot(page, fromId).boundingBox();
  const to = await slot(page, toId).boundingBox();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width * 0.8, y: to.y + to.height / 2 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(180); // Match the touch sensor's long-press activation window.
    for (let step = 1; step <= 10; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10,
      }] });
    }
    await expect(page.locator('.puzzle-drag-overlay')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await expect(page.locator('.puzzle-drag-overlay')).toBeVisible();
    await page.mouse.up();
  }
}

async function dragBetween(page, fromSelector, toSelector, after = false, touch = false) {
  await expect(page.locator(`${fromSelector}:visible`)).toBeVisible();
  const from = await page.locator(`${fromSelector}:visible`).boundingBox();
  const to = await page.locator(`${toSelector}:visible`).boundingBox();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = toSelector === '.puzzle-target-slots'
    ? { x: to.x + to.width - 14, y: to.y + to.height - 14 }
    : { x: to.x + to.width * (after ? 0.8 : 0.2), y: to.y + to.height / 2 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(180);
    for (let step = 1; step <= 12; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12
      }] });
    }
    await expect(page.locator('.puzzle-drag-overlay')).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await expect(page.locator('.puzzle-drag-overlay')).toBeVisible();
    await page.mouse.up();
  }
  await expect(page.locator('.puzzle-drag-overlay')).toHaveCount(0);
}

test('Puzzle gates grading, marks only boundaries, preserves flip state, and clears feedback on drag', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openStudy(page, context, puzzle);
  await assemble(page, [0, 2, 1, 3, 4, 5, 6]);
  await check(page).click();
  await expect(boundaries(page)).toHaveCount(6);
  await expect(page.locator('.puzzle-boundary.is-incorrect')).toHaveCount(3);
  await expect(page.locator('.puzzle-boundary.is-correct')).toHaveCount(3);
  await expect(page.locator('.puzzle-feedback-hint:visible')).toContainText('Проверь порядок возле отмеченных мест.');
  await expect(page.locator('.grade-buttons button')).toHaveCount(4);
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(0);
  await expect(page.locator('.puzzle-slot-chip:disabled')).toHaveCount(0);
  expect(await selectedOrder(page)).toEqual([0, 2, 1, 3, 4, 5, 6]);
  await expect(page.locator('.puzzle-target-slots')).not.toContainText('Ich gehe heute');
  await expect(check(page)).toBeEnabled();
  // Card customization still applies to chips, independently of status markers.
  await expect(slot(page, 0)).toHaveCSS('color', 'rgb(254, 215, 170)');
  await expect(slot(page, 0)).toHaveCSS('font-family', 'Georgia');
  await screenshotWidths(page, testInfo, 'puzzle-retry');
  await flip(page, true);
  await expect(slot(page, 0)).toHaveCount(0);
  await flip(page, false);
  await expect(boundaries(page)).toHaveCount(6);
  expect(await selectedOrder(page)).toEqual([0, 2, 1, 3, 4, 5, 6]);
  await dragAfter(page, 2, 1);
  await expect.poll(() => selectedOrder(page)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  await expect(boundaries(page)).toHaveCount(0);
  await expect(page.locator('.puzzle-feedback-hint:visible')).toHaveCount(0);
  await expect(page.locator('.grade-buttons button')).toHaveCount(4);
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(0);
  await check(page).click();
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(4);
  await expect(page.locator('.puzzle-slot-chip:disabled')).toHaveCount(7);
  await expect(check(page)).toBeDisabled();
  await screenshotWidths(page, testInfo, 'puzzle-success');
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ historyIndex: 1 });
  });
  await expect(page.locator('.puzzle-slot-chip')).toHaveCount(0);
  await expect(page.locator('.grade-buttons button')).toHaveCount(4);
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(0);
  await expect(check(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

test('Puzzle real renderer counts Checks, retains history after click/Reset/remount and calls success once', async ({ page, context }) => {
  await openStudy(page, context, puzzle, 'en');
  await rendererHarness(page, puzzle);
  const state = () => page.evaluate(() => window.exerciseTest.saved['13:0'].evaluationState);
  await assemble(page, [0, 2, 1, 3, 4, 5, 6]);
  expect(await state()).toMatchObject({ attemptCount: 0, mistakeCount: 0 });
  await check(page).click();
  await check(page).click();
  expect(await state()).toMatchObject({ attemptCount: 2, mistakeCount: 2 });
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([]);
  await slot(page, 6).click();
  await expect(boundaries(page)).toHaveCount(0);
  expect(await state()).toMatchObject({ result: null, attemptCount: 2, mistakeCount: 2 });
  await pool(page, 6).click();
  await check(page).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.puzzle-slot-chip:visible')).toHaveCount(0);
  expect(await state()).toMatchObject({ result: null, attemptCount: 3, mistakeCount: 3 });
  await page.getByRole('button', { name: 'Show translation', exact: true }).click();
  await assemble(page, [0, 1, 2]);
  await page.evaluate(() => window.exerciseTest.render('13:0', false));
  await expect(slot(page, 0)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(slot(page, 0)).toBeVisible();
  expect(await selectedOrder(page)).toEqual([0, 1, 2]);
  await expect(page.getByRole('button', { name: 'Show translation', exact: true })).toHaveCount(0);
  expect(await state()).toMatchObject({ attemptCount: 3, mistakeCount: 3 });
  await assemble(page, [3, 4, 5, 6]);
  await check(page).click();
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([{
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 4, mistakeCount: 3,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['word_order'],
      error_codes_seen: ['exercise.word_order'],
      incorrect_parts: ['puzzle:boundary:0-2', 'puzzle:boundary:2-1', 'puzzle:boundary:1-3'], final_evaluator: 'rules' },
  }]);
  await page.evaluate(() => window.exerciseTest.render('13:0', false));
  await expect(slot(page, 0)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(slot(page, 0)).toBeDisabled();
  expect(await page.evaluate(() => window.exerciseTest.answers.length)).toBe(1);
  await page.evaluate(() => window.exerciseTest.render('13:1'));
  await expect(page.locator('.puzzle-slot-chip:visible')).toHaveCount(0);
  expect(await page.evaluate(() => window.exerciseTest.saved['13:1'].evaluationState)).toMatchObject({ attemptCount: 0, mistakeCount: 0, incorrectParts: [], completed: false });
  await assemble(page, [0, 1, 2, 3, 4, 5, 6]);
  await check(page).click();
  expect(await page.evaluate(() => window.exerciseTest.answers[1])).toMatchObject({ isFirstTry: true, attemptCount: 1, mistakeCount: 0 });
  await page.evaluate(() => {
    window.exerciseTest.card = { ...window.exerciseTest.card, id: 99 };
    window.exerciseTest.render('99:0');
  });
  await expect(check(page)).toBeDisabled();
  expect(await page.evaluate(() => window.exerciseTest.saved['99:0'].evaluationState)).toMatchObject({ attemptCount: 0, incorrectParts: [], completed: false });
});

test('duplicate words use occurrence IDs, two-word reversal has one bad boundary', async ({ page, context }) => {
  const duplicate = { ...puzzle, front: '@puzzle\nIch sehe den Mann und den Hund.' };
  await openStudy(page, context, duplicate);
  await rendererHarness(page, duplicate);
  await assemble(page, [0, 1, 5, 3, 4, 2, 6]);
  await check(page).click();
  await expect(page.locator('.puzzle-boundary.is-incorrect')).toHaveCount(4);
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([]);
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await assemble(page, [0, 1, 2, 3, 4, 5, 6]);
  await check(page).click();
  expect(await page.evaluate(() => window.exerciseTest.answers[0])).toMatchObject({ attemptCount: 2, mistakeCount: 1, completed: true });
  await page.evaluate(() => {
    window.exerciseTest.card = { ...window.exerciseTest.card, id: 99, front: '@puzzle\nGuten Morgen!' };
    window.exerciseTest.render('99:0');
  });
  await expect(pool(page, 0)).toBeVisible();
  await assemble(page, [1, 0]);
  await check(page).click();
  await expect(page.locator('.puzzle-boundary.is-incorrect')).toHaveCount(1);
  expect(await page.evaluate(() => window.exerciseTest.saved['99:0'].evaluationState)).toMatchObject({ attemptCount: 1, mistakeCount: 1 });
});

test('long German chips and wrapped boundary markers fit all required widths', async ({ page, context }, testInfo) => {
  const long = { ...puzzle, front: '@puzzle\nDie Donaudampfschifffahrtsgesellschaftskapitänin besucht heute die Krankenversicherungsgesellschaft.' };
  await openStudy(page, context, long, 'en');
  await assemble(page, [0, 2, 1, 3, 4, 5]);
  await check(page).click();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.puzzle-feedback-hint:visible')).toHaveText('Check the word order around the marked points.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.puzzle-target-slots, .puzzle-pool-chips').evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth))).toBe(true);
    expect(await page.locator('.puzzle-token-with-boundary').evaluateAll(items => items.every(item => {
      const marker = item.querySelector('.puzzle-boundary');
      const chip = item.querySelector('.puzzle-slot-chip');
      return !marker || Math.abs(marker.getBoundingClientRect().y + marker.getBoundingClientRect().height / 2
        - chip.getBoundingClientRect().y - chip.getBoundingClientRect().height / 2) < 1;
    }))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`puzzle-long-${width}.png`), fullPage: true });
  }
});

test('mobile touch drag on the study card clears feedback, preserves gestures, and keeps correct boundaries movable', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await openStudy(page, context, puzzle);
  await assemble(page, [0, 2, 1, 3, 4, 5, 6]);
  await check(page).click();
  await dragAfter(page, 2, 1, true);
  await expect.poll(() => selectedOrder(page)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  await expect(boundaries(page)).toHaveCount(0);
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { isFlipped, historyIndex } = useSessionStore.getState();
    return { isFlipped, historyIndex };
  })).toEqual({ isFlipped: false, historyIndex: 0 });
  // Still editable before success, even the pair confirmed by the earlier Check.
  await slot(page, 5).click();
  await expect(pool(page, 5)).toBeEnabled();
  await expect(page.locator('.grade-buttons button:enabled')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('puzzle-touch-edit-375.png'), fullPage: true });
});

test('mouse drag reorders the source, moves words between zones, and inserts at both answer edges', async ({ page, context }) => {
  // Assert insertion geometry after each move without sampling a moving layout.
  // Other scenarios retain normal motion and exercise animated mouse/touch drags.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStudy(page, context, puzzle, 'en');
  await rendererHarness(page, puzzle);
  await expect(pool(page, 0)).toBeVisible();
  const sourceOrder = () => page.locator('.btn-puzzle-chip:visible').evaluateAll(items => items.map(item => Number(item.dataset.id)));
  const beforePoolReorder = await sourceOrder();
  await dragBetween(page, `.btn-puzzle-chip[data-id="${beforePoolReorder[0]}"]`, `.btn-puzzle-chip[data-id="${beforePoolReorder.at(-1)}"]`, true);
  const reorderedPool = [...beforePoolReorder.slice(1), beforePoolReorder[0]];
  expect(await sourceOrder()).toEqual(reorderedPool);
  await page.evaluate(() => window.exerciseTest.render('13:0', false));
  await expect(pool(page, 0)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(pool(page, 0)).toBeVisible();
  expect(await sourceOrder()).toEqual(reorderedPool);

  await assemble(page, [0, 1, 2]);
  const movedFromPool = (await sourceOrder())[1];
  await dragBetween(page, `.btn-puzzle-chip[data-id="${movedFromPool}"]`, '.puzzle-slot-chip[data-id="1"]');
  expect(await selectedOrder(page)).toEqual([0, movedFromPool, 1, 2]);
  await dragBetween(page, `.puzzle-slot-chip[data-id="${movedFromPool}"]`, `.btn-puzzle-chip[data-id="${(await sourceOrder())[0]}"]`);
  expect(await sourceOrder()).toContain(movedFromPool);
  expect(await selectedOrder(page)).toEqual([0, 1, 2]);

  await dragBetween(page, '.btn-puzzle-chip[data-id="6"]', '.puzzle-slot-chip[data-id="0"]');
  expect((await selectedOrder(page))[0]).toBe(6);
  await dragBetween(page, '.puzzle-slot-chip[data-id="0"]', '.puzzle-target-slots');
  expect((await selectedOrder(page)).at(-1)).toBe(0);
});

test('cancel and outside drops preserve committed order; touch moves across wrapped rows and both zones', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await openStudy(page, context, puzzle, 'en');
  await rendererHarness(page, puzzle);
  await assemble(page, [0, 1, 2]);
  const before = await selectedOrder(page);
  const from = await slot(page, 0).boundingBox();
  const to = await pool(page, 5).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(page.locator('.puzzle-drop-indicator')).toBeVisible();
  expect((await page.locator('.puzzle-drag-overlay').boundingBox()).height).toBeLessThanOrEqual(from.height + 2);
  await page.screenshot({ path: testInfo.outputPath('puzzle-insertion-marker-375.png'), fullPage: true });
  expect(await selectedOrder(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await selectedOrder(page)).toEqual(before);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(2, 990, { steps: 10 });
  await page.mouse.up();
  expect(await selectedOrder(page)).toEqual(before);

  await dragBetween(page, '.btn-puzzle-chip[data-id="5"]', '.puzzle-slot-chip[data-id="1"]', false, true);
  expect(await selectedOrder(page)).toEqual([0, 5, 1, 2]);
  await dragBetween(page, '.puzzle-slot-chip[data-id="5"]', '.btn-puzzle-chip[data-id="6"]', false, true);
  expect(await selectedOrder(page)).toEqual(before);

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const sourceIds = await page.locator('.btn-puzzle-chip:visible').evaluateAll(items => items.map(item => Number(item.dataset.id)));
  await dragBetween(page, `.btn-puzzle-chip[data-id="${sourceIds[0]}"]`, `.btn-puzzle-chip[data-id="${sourceIds.at(-1)}"]`, true, true);
  expect(await page.locator('.btn-puzzle-chip:visible').evaluateAll(items => items.map(item => Number(item.dataset.id))))
    .toEqual([...sourceIds.slice(1), sourceIds[0]]);
  await assemble(page, [0, 1, 2, 3, 4, 5, 6]);
  await dragBetween(page, '.puzzle-slot-chip[data-id="6"]', '.puzzle-slot-chip[data-id="0"]', false, true);
  expect(await selectedOrder(page)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  await dragBetween(page, '.puzzle-slot-chip[data-id="6"]', '.puzzle-pool-chips', false, true);
  await expect(pool(page, 6)).toBeVisible();
});

test('Puzzle keeps its own block with optional or later ::exercise and literal info markers', async ({ page, context }, testInfo) => {
  const card = {
    ...puzzle,
    front: '::task\nСобери предложение.\n@match\nЭто пример маркера.\n\n' + puzzle.front
      + '\n::exercise\nДругой текст\n::example\nПример после упражнения.',
  };
  await openStudy(page, context, card);
  await rendererHarness(page, card);
  await expect(page.locator('.btn-puzzle-chip:visible')).toHaveCount(7);
  await expect(page.locator('.exercise-info-text:visible').filter({ hasText: '@puzzle' })).toHaveCount(0);
  await expect(page.locator('.exercise-info-text:visible').filter({ hasText: 'Пример после упражнения.' })).toBeVisible();
  await assemble(page, [0, 1, 2, 3, 4, 5, 6]);
  await check(page).click();
  await expect.poll(() => page.evaluate(() => window.exerciseTest.answers.length)).toBe(1);
  await screenshotWidths(page, testInfo, 'puzzle-block-boundary');
  await page.evaluate(async card => {
    window.exerciseTest.card = { ...card, id: 100, front: card.front.replace('\n::exercise\nДругой текст', '') };
    window.exerciseTest.render('100:0');
  }, card);
  await expect(page.locator('.btn-puzzle-chip:visible')).toHaveCount(7);
});
