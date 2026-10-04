const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Feedback', target_language: 'de', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };
const wordBank = { id: 1, deck_id: 1, queue: 'new',
  front: '@wordbank\nIch <<gap-1>> <<gap-2>> <<gap-3>> <<gap-4>> <<gap-5>>.\n@options\nhabe | heute | einen | kleinen | Hund | gestern',
  back: 'gap-1=habe\ngap-2=heute\ngap-3=einen\ngap-4=kleinen\ngap-5=Hund' };
const trainer = { id: 2, deck_id: 1, queue: 'new',
  front: 'Ich [[habe]] [[heute]] einen klein[[en]] {*Hund|Katze}.', back: '' };

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

test('Word Bank keeps four confirmed gaps, restores after flip, retries one gap and opens grading on success', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openStudy(page, context, wordBank);
  const exercise = page.locator('.word-bank-exercise');
  const gaps = exercise.locator('.word-bank-gap');
  for (const value of ['habe', 'gestern', 'einen', 'kleinen', 'Hund']) {
    await exercise.locator('.word-bank-option').filter({ hasText: new RegExp(`^${value}$`) }).click();
  }
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(exercise.locator('.word-bank-gap.is-correct')).toHaveCount(4);
  await expect(gaps.nth(0)).toBeDisabled();
  await expect(gaps.nth(1)).toBeEnabled();
  await expect(gaps.nth(1)).toHaveClass(/is-active.*is-incorrect/);
  await expect(exercise.getByText('Проверь этот пропуск и выбери другой вариант.', { exact: true })).toBeVisible();
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bankBox = await exercise.locator('.word-bank-footer').boundingBox();
    const checkBox = await page.getByRole('button', { name: 'Проверить', exact: true }).boundingBox();
    expect(checkBox.y).toBeGreaterThanOrEqual(bankBox.y + bankBox.height);
    await page.screenshot({ path: testInfo.outputPath(`word-bank-retry-${width}.png`), fullPage: true });
  }
  await flip(page, true);
  await expect(exercise).toHaveCount(0);
  await flip(page, false);
  await expect(exercise.locator('.word-bank-gap.is-correct')).toHaveCount(4);
  await expect(gaps.nth(1)).toHaveText('gap-2gestern');
  await gaps.nth(1).click();
  await expect(exercise.locator('.word-bank-option').filter({ hasText: /^gestern$/ })).toBeEnabled();
  await expect(exercise.locator('.word-bank-option').filter({ hasText: /^habe$/ })).toBeDisabled();
  await exercise.locator('.word-bank-option').filter({ hasText: /^heute$/ }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выполнено', exact: true })).toBeDisabled();
  await expect(exercise.locator('.word-bank-gap.is-correct')).toHaveCount(5);
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await flip(page, true);
  await expect(exercise).toHaveCount(0);
  await flip(page, false);
  await expect(page.getByRole('button', { name: 'Выполнено', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ historyIndex: 1 });
  });
  await expect(exercise.locator('.word-bank-gap.is-correct')).toHaveCount(0);
  await expect(gaps.nth(0)).toBeEnabled();
  await expect(exercise.locator('.word-bank-option:disabled')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Trainer preserves correct inputs, keeps wrong input and choice editable, and reveals no correction', async ({ page, context }, testInfo) => {
  await openStudy(page, context, trainer);
  const text = page.locator('.cloze-masked-text').first();
  const inputs = text.getByRole('textbox');
  await inputs.nth(0).fill('habe');
  await inputs.nth(1).fill('heute');
  await inputs.nth(2).fill('er');
  await text.getByRole('button', { name: 'Пропуск 4', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Katze', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(inputs.nth(0)).toBeDisabled();
  await expect(inputs.nth(1)).toBeDisabled();
  await expect(inputs.nth(2)).toBeEnabled();
  await expect(inputs.nth(2)).toHaveValue('er');
  await expect(text.getByRole('button', { name: 'Пропуск 4', exact: true })).toBeEnabled();
  await expect(text.getByText('Проверь окончание.', { exact: true })).toBeVisible();
  await expect(text.getByText('Проверь этот вариант.', { exact: true })).toBeVisible();
  await expect(text.getByText('Hund', { exact: true })).toHaveCount(0);
  await expect(text.locator('.trainer-affix-correction')).toHaveCount(0);
  await expect(page.locator('.grade-buttons')).toHaveCount(0);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`trainer-retry-${width}.png`), fullPage: true });
  }
  await flip(page, true);
  await expect(text).toHaveCount(0);
  await flip(page, false);
  await expect(inputs.nth(0)).toHaveValue('habe');
  await expect(inputs.nth(0)).toBeDisabled();
  await expect(inputs.nth(2)).toHaveValue('er');
  await inputs.nth(2).fill('en');
  await text.getByRole('button', { name: 'Пропуск 4', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hund', exact: true }).click();
  await inputs.nth(2).press('Enter');
  await expect(page.getByRole('button', { name: 'Выполнено', exact: true })).toBeDisabled();
  await expect(inputs.nth(2)).toBeDisabled();
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().setCard({ id: 3, deck_id: 1, front: '[[neu]]', back: '' });
  });
  await expect(text.getByRole('textbox')).toHaveCount(1);
  await expect(text.getByRole('textbox')).toHaveValue('');
  await expect(text.getByRole('textbox')).toBeEnabled();
});

test('real renderer reports only cumulative success, preserves counters on remount, and starts each review clean', async ({ page, context }) => {
  await openStudy(page, context, trainer, 'en');
  await page.evaluate(async card => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    window.feedbackTest = { saved: {}, answers: [], reviewKey: '2:0' };
    window.feedbackTest.render = (key = '2:0', mounted = true) => {
      window.feedbackTest.reviewKey = key;
      root.render(mounted ? React.createElement(ExerciseRenderer, { card, reviewKey: key,
        savedState: window.feedbackTest.saved[key],
        onSaveState: state => { window.feedbackTest.saved[key] = state; },
        onTrainerAnswer: (_id, evidence) => window.feedbackTest.answers.push(evidence),
      }) : null);
    };
    window.feedbackTest.render();
  }, { ...trainer, front: '[[habe]] [[heute]]' });
  const inputs = page.locator('input[type=text]:visible');
  await inputs.nth(0).fill('habe');
  await inputs.nth(1).fill('gestern');
  await page.getByRole('button', { name: 'Check answers', exact: true }).click();
  await expect(page.getByText('Check the form entered here.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.feedbackTest.answers)).toEqual([]);
  expect(await page.evaluate(() => window.feedbackTest.saved['2:0'].evaluationState)).toMatchObject({ attemptCount: 1, mistakeCount: 1, incorrectParts: ['1'] });
  await page.evaluate(() => window.feedbackTest.render('2:0', false));
  await expect(inputs).toHaveCount(0);
  await page.evaluate(() => window.feedbackTest.render());
  await expect(inputs.nth(0)).toBeDisabled();
  await expect(inputs.nth(1)).toHaveValue('gestern');
  await inputs.nth(1).fill('heute');
  await page.getByRole('button', { name: 'Check answers', exact: true }).click();
  expect(await page.evaluate(() => window.feedbackTest.answers)).toEqual([{
    isCorrect: true, completed: true, isFirstTry: false, attemptCount: 2, mistakeCount: 1,
    gradingSummary: { final_verdict: 'correct', error_types_seen: ['other'],
      error_codes_seen: ['exercise.input_mismatch'], incorrect_parts: ['1'], final_evaluator: 'rules' },
  }]);
  await page.evaluate(() => window.feedbackTest.render('2:1'));
  await expect(inputs.nth(0)).toHaveValue('');
  expect(await page.evaluate(() => window.feedbackTest.saved['2:1'].evaluationState)).toMatchObject({ attemptCount: 0, mistakeCount: 0, completed: false, incorrectParts: [] });
});
