const { test, expect } = require('@playwright/test');
const deck = { id: 1, name: 'Feedback', target_language: 'de', is_learning: true, stats: { total: 1, new: 1, due: 0, learning: 0 } };
const match = { id: 11, deck_id: 1, queue: 'new', front: '@match\nA => eins\nB => zwei\nC => drei', back: 'Match' };
const quiz = { id: 12, deck_id: 1, queue: 'new', front: 'Choose\n\n- Wrong\n* Right\n- Also wrong', back: 'Quiz' };

async function openStudy(page, context, card, locale = 'ru') {
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

test('Match keeps wrong tiles available, confirms pairs incrementally, restores progress and gates grading', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openStudy(page, context, match);
  const left = id => page.getByRole('button').filter({ has: page.getByText(String.fromCharCode(64 + id), { exact: true }) });
  const right = value => page.getByRole('button', { name: new RegExp(`${value}$`) });
  await left(1).click();
  await left(1).click(); // cancel is not a pair interaction
  await left(1).click();
  await right('zwei').click();
  await expect(left(1)).toBeEnabled();
  await expect(right('zwei')).toBeEnabled();
  await expect(left(1)).toHaveAttribute('aria-invalid', 'true');
  await expect(left(1).getByRole('status')).toHaveText('Эти элементы не образуют правильную пару.');
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  await expect(page.getByText('Правильные соответствия:', { exact: true })).toHaveCount(0);
  await screenshotWidths(page, testInfo, 'match-retry');
  await right('eins').click(); // reverse direction also works
  await left(1).click();
  await expect(left(1)).toBeDisabled();
  await expect(right('eins')).toBeDisabled();
  await expect(page.locator('.match-progress')).toContainText('1/3');
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  await flip(page, true);
  await expect(left(1)).toHaveCount(0);
  await flip(page, false);
  await expect(left(1)).toBeDisabled();
  await expect(right('eins')).toBeDisabled();
  await left(2).click();
  await right('zwei').click();
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  await left(3).click();
  await right('drei').click();
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await expect(page.locator('[data-part-id^="match:"]:disabled')).toHaveCount(3);
  await screenshotWidths(page, testInfo, 'match-success');
  await flip(page, true);
  await expect(left(1)).toHaveCount(0);
  await flip(page, false);
  await expect(left(1)).toBeDisabled();
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ historyIndex: 1 });
  });
  await expect(left(1)).toBeEnabled();
  await expect(page.locator('.match-progress')).toContainText('0/3');
  await expect(left(1).getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Quiz retries without revealing a solution, preserves option order after flip and grades only success', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openStudy(page, context, quiz);
  const option = id => page.locator('.quiz-option-item').filter({ has: page.getByText(['Wrong', 'Right', 'Also wrong'][id], { exact: true }) });
  const check = page.getByRole('button', { name: 'Проверить', exact: true });
  const initialOrder = await page.locator('.quiz-option-item').evaluateAll(items => items.map(item => item.dataset.partId));
  await expect(check).toBeDisabled();
  await option(0).click();
  await option(2).click(); // selection alone does not count a check
  await option(0).click();
  await check.click();
  await expect(option(0)).toBeDisabled();
  await expect(option(0)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Попробуй другой вариант.', { exact: true })).toBeVisible();
  await expect(option(1)).toBeEnabled();
  await expect(page.locator('.quiz-option-item.correct')).toHaveCount(0);
  await expect(check).toBeDisabled();
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  await screenshotWidths(page, testInfo, 'quiz-retry');
  await flip(page, true);
  await expect(option(0)).toHaveCount(0);
  await flip(page, false);
  await expect(option(0)).toBeDisabled();
  expect(await page.locator('.quiz-option-item').evaluateAll(items => items.map(item => item.dataset.partId))).toEqual(initialOrder);
  await option(1).click();
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  await check.click();
  await expect(option(1)).toHaveClass(/correct/);
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await expect(check).toHaveCount(0);
  await screenshotWidths(page, testInfo, 'quiz-success');
  await flip(page, true);
  await expect(option(1)).toHaveCount(0);
  await flip(page, false);
  await expect(option(1)).toBeDisabled();
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ historyIndex: 1 });
  });
  await expect(option(0)).toBeEnabled();
  await expect(page.locator('.quiz-option-item.wrong, .quiz-option-item.correct')).toHaveCount(0);
  await expect(check).toBeDisabled();
  expect(errors).toEqual([]);
});

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

test('Match real renderer counts only completed interactions, sends cumulative success once and resets new reviews/cards', async ({ page, context }) => {
  await openStudy(page, context, match, 'en');
  await rendererHarness(page, match);
  const left = id => page.locator(`[data-part-id="match:left-${id}"]:visible`);
  const right = value => page.getByRole('button', { name: new RegExp(`${value}$`) });
  await left(1).click();
  await left(1).click();
  expect(await page.evaluate(() => window.exerciseTest.saved['11:0'].evaluationState)).toMatchObject({ attemptCount: 0, interactionCount: 0 });
  await left(1).click();
  await right('zwei').click();
  await expect(page.getByText('These items do not form a correct pair.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([]);
  await left(1).click();
  await right('eins').click();
  await page.evaluate(() => window.exerciseTest.render('11:0', false));
  await expect(left(1)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(left(1)).toBeDisabled();
  for (const [id, value] of [[2, 'zwei'], [3, 'drei']]) {
    await left(id).click();
    await right(value).click();
  }
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([{
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['other'],
      error_codes_seen: ['exercise.wrong_match'], incorrect_parts: ['match:left-1'],
      final_evaluator: 'rules', interaction_count: 4 },
  }]);
  await page.evaluate(() => window.exerciseTest.render('11:0', false));
  await expect(left(1)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(left(1)).toBeDisabled();
  expect(await page.evaluate(() => window.exerciseTest.answers.length)).toBe(1);
  await page.evaluate(() => window.exerciseTest.render('11:1'));
  await expect(left(1)).toBeEnabled();
  expect(await page.evaluate(() => window.exerciseTest.saved['11:1'].evaluationState)).toMatchObject({ attemptCount: 0, mistakeCount: 0, completed: false, interactionCount: 0 });
  await page.evaluate(() => {
    window.exerciseTest.card = { ...window.exerciseTest.card, id: 99 };
    window.exerciseTest.render('99:0');
  });
  await expect(left(1)).toBeEnabled();
  expect(await page.evaluate(() => window.exerciseTest.saved['99:0'].evaluationState)).toMatchObject({ incorrectParts: [], attemptCount: 0 });
});

test('Quiz real renderer emits one cumulative success, restores retries, accepts starred alternatives and starts new reviews clean', async ({ page, context }) => {
  await openStudy(page, context, quiz, 'en');
  await rendererHarness(page, { ...quiz, front: 'Choose\n\n- Wrong\n* Right\n* Alternative' });
  const option = id => page.locator(`[data-part-id="option-${id}"]:visible`);
  const check = page.getByRole('button', { name: 'Check', exact: true });
  await option(0).click();
  await check.click();
  await expect(page.getByText('Try another option.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([]);
  await page.evaluate(() => window.exerciseTest.render('12:0', false));
  await expect(option(0)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(option(0)).toBeDisabled();
  await option(2).click();
  await check.click();
  expect(await page.evaluate(() => window.exerciseTest.answers)).toEqual([{
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['word_choice'],
      error_codes_seen: ['exercise.wrong_choice'], incorrect_parts: ['option-0'], final_evaluator: 'rules' },
  }]);
  await page.evaluate(() => window.exerciseTest.render('12:0', false));
  await expect(option(2)).toHaveCount(0);
  await page.evaluate(() => window.exerciseTest.render());
  await expect(option(2)).toBeDisabled();
  expect(await page.evaluate(() => window.exerciseTest.answers.length)).toBe(1);
  await page.evaluate(() => window.exerciseTest.render('12:1'));
  await expect(option(0)).toBeEnabled();
  expect(await page.evaluate(() => window.exerciseTest.saved['12:1'].evaluationState)).toMatchObject({ incorrectParts: [], attemptCount: 0, completed: false });
  await option(1).click();
  await check.click();
  expect(await page.evaluate(() => window.exerciseTest.answers[1])).toMatchObject({ isFirstTry: true, attemptCount: 1, mistakeCount: 0 });
  await page.evaluate(() => {
    window.exerciseTest.card = { ...window.exerciseTest.card, id: 99 };
    window.exerciseTest.render('99:0');
  });
  await expect(option(1)).toBeEnabled();
  await expect(check).toBeDisabled();
});

test('LiD exam keeps selection ungraded while practice keeps its existing immediate correction', async ({ page, context }) => {
  await openStudy(page, context, quiz, 'en');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { LidQuestionCard } = await import('/src/components/lid/LidQuestionCard.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const question = { id: 1, question: 'Capital?', correctOption: 'b', options: [{ id: 'a', text: 'Wrong' }, { id: 'b', text: 'Right' }] };
    window.lidTest = { selections: [] };
    window.lidTest.render = (examMode, selectedAnswer = null) => root.render(React.createElement(LidQuestionCard, {
      question, examMode, selectedAnswer, onSelectAnswer: (_id, answer) => {
        window.lidTest.selections.push(answer);
        window.lidTest.render(examMode, answer);
      },
    }));
    window.lidTest.render('exam');
  });
  const options = page.locator('.lid-option-item:visible');
  await options.filter({ hasText: 'Wrong' }).click();
  await expect(page.locator('.lid-option-item.correct-revealed:visible')).toHaveCount(0);
  await expect(page.locator('.lid-option-item.wrong-revealed:visible')).toHaveCount(0);
  await page.evaluate(() => window.lidTest.render('practice'));
  await options.filter({ hasText: 'Wrong' }).click();
  await expect(options.filter({ hasText: 'Wrong' })).toHaveClass(/wrong-revealed/);
  await expect(options.filter({ hasText: 'Right' })).toHaveClass(/correct-revealed/);
});
