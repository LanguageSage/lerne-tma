const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../reports/lesson-qa/relativsaetze.snapshot.json'), 'utf8'));
const cardById = id => ({ ...snapshot.cards.find(c => c.id === id), front: snapshot.cards.find(c => c.id === id).front_text,
  back: snapshot.cards.find(c => c.id === id).back_text, queue: 'new' });

async function setup(page, context, deckId = 7139, authenticated = false) {
  const total = snapshot.cards.filter(c => c.deck_id === deckId).length;
  const deck = { ...snapshot.decks.find(d => d.id === deckId), stats: { total, new: total, due: 0, learning: 0 }, role: 'owner' };
  const writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(authenticated => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    if (authenticated) {
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated-test', refresh_token: 'isolated-test' }));
    }
  }, authenticated);
  await page.route('**/api/**', route => {
    const request = route.request(), { pathname } = new URL(request.url());
    if (request.method() !== 'GET') writes.push({ path: pathname, body: request.postData() });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname.endsWith('/cards') || pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname.endsWith('/next')) return route.fulfill({ json: { finished: true } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator(`#deck-item-${deckId}`)).toBeVisible();
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useSettingsStore.setState({ studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false });
    useUiStore.getState().setView('study');
  }, deck);
  return { writes, errors };
}

async function show(page, card) {
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false,
      isSessionFinished: false, exerciseStates: {}, trainerAnswered: false });
  }, card);
  await expect(page.locator('.card-front')).toBeVisible();
}

test('real puzzle 348683 never renders its raw target as an information block', async ({ page, context }, testInfo) => {
  await setup(page, context, 6985);
  await show(page, cardById(348683));
  await expect(page.locator('.btn-puzzle-chip')).toHaveCount(9);
  await expect(page.locator('.exercise-info-blocks')).not.toContainText('@puzzle');
  await expect(page.locator('.exercise-info-blocks')).not.toContainText('Das ist die Frau, die bei der Bank arbeitet.');
  await page.screenshot({ path: testInfo.outputPath('puzzle-348683.png'), fullPage: true });
});

test('all 48 real D14 cards can be answered, manually graded, advanced and completed in an isolated session', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  const { writes } = await setup(page, context, 7139, true);
  const cards = snapshot.cards.filter(c => c.deck_id === 7139).sort((a, b) => a.position - b.position || a.id - b.id).map(c => cardById(c.id));
  await page.route('**/api/study/grade', route => {
    const body = route.request().postDataJSON();
    const next = cards.find(c => ![...(body.exclude_ids || []), body.card_id].includes(c.id));
    writes.push({ path: '/api/study/grade', body: JSON.stringify(body) });
    return route.fulfill({ json: next || { finished: true } });
  });
  await page.route('**/api/ai/evaluate-answer', route => route.fulfill({ json: {
    result: { verdict: 'correct', accepted: true, evaluator: 'ai' }, grading_policy: { mode: 'controlled_text', max_retries: 3 },
  } }));
  await page.evaluate(async cards => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useDeckStore.setState({ deckCards: cards });
    useSessionStore.getState().resetSession();
    useSessionStore.setState({ card: cards[0], studyHistory: [cards[0]], historyIndex: 0, isLearningMore: true, forcedSeenIds: [cards[0].id] });
  }, cards);
  const { parseClozeData } = await import('../../../app/src/utils/clozeParser.js');
  for (const card of cards) {
    await expect.poll(() => page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card?.id)).toBe(card.id);
    if (card.id === 358408) {
      await page.getByRole('textbox', { name: 'Ваш ответ' }).fill('Ich suche eine Stelle, bei der ich viel lernen kann.');
      await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Ваш ответ' })).toBeDisabled();
    } else {
      const { gaps } = parseClozeData(card, 'classic');
      let inputIndex = 0, choiceIndex = 0;
      for (const gap of gaps) {
        const answer = gap.correctAnswer.split('|')[0];
        if (gap.mode === 'input') await page.locator('.cloze-masked-text input[type=text]').nth(inputIndex++).fill(answer);
        else {
          await page.locator('.trainer-choice-gap').nth(choiceIndex++).click();
          await page.locator('.gap-dropdown-popover').getByRole('button', { name: answer, exact: true }).click();
        }
      }
      await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Выполнено', exact: true })).toBeDisabled();
    }
    await page.getByRole('button', { name: /^Хорошо/ }).click();
  }
  await expect(page.locator('.lesson-completion-overlay')).toBeVisible();
  const grades = writes.filter(w => w.path === '/api/study/grade').map(w => JSON.parse(w.body));
  expect(grades.map(g => g.card_id)).toEqual(cards.map(c => c.id));
  expect(grades.every(g => g.review_context === 'forced')).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('d14-session-completed.png'), fullPage: true });
});

for (const deck of snapshot.decks) test(`render every real card in deck ${deck.id}`, async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  const { errors, writes } = await setup(page, context, deck.id);
  const { detectExerciseType } = await import('../../../app/src/utils/exerciseDetector.js');
  const { parseClozeData } = await import('../../../app/src/utils/clozeParser.js');
  const { parseQuizData } = await import('../../../app/src/utils/quizParser.js');
  const cards = snapshot.cards.filter(c => c.deck_id === deck.id);
  for (const raw of cards) {
    const card = cardById(raw.id), type = detectExerciseType(card);
    await show(page, card);
    if (type === 'trainer') {
      const data = parseClozeData(card, 'classic');
      await expect(page.locator('.cloze-masked-text input[type=text]')).toHaveCount(data.gaps.filter(g => g.mode === 'input').length);
      await expect(page.locator('.cloze-masked-text .trainer-choice-gap')).toHaveCount(data.gaps.filter(g => g.mode === 'choice').length);
    } else if (type === 'quiz') await expect(page.locator('.quiz-option-item')).toHaveCount(parseQuizData(card).options.length);
    else if (type === 'puzzle') await expect(page.locator('.btn-puzzle-chip').first()).toBeVisible();
    else if (type === 'free_text') await expect(page.locator('.free-text-exercise textarea')).toBeVisible();
    else if (type === 'match') await expect(page.getByText('Сопоставьте части предложений:', { exact: true })).toBeVisible();
    else await expect(page.locator('.text-front').first()).toBeVisible();
    // A UI count alone cannot detect a raw answer leaked beside the renderer.
    if (type) {
      const info = await page.locator('.exercise-info-text').allTextContents();
      expect(info.join('\n'), `raw answer syntax on card ${card.id}`).not.toMatch(/\[\[|@puzzle/);
    }
  }
  await page.screenshot({ path: testInfo.outputPath(`deck-${deck.id}-last.png`), fullPage: true });
  expect(errors).toEqual([]);
  expect(writes.filter(w => /grade|knowledge|sync\/push/.test(w.path))).toEqual([]);
});

test('D14 real input rejects empty and wrong answers, accepts reference and proceeds', async ({ page, context }, testInfo) => {
  await setup(page, context);
  await show(page, cardById(358397));
  const input = page.locator('.cloze-masked-text input[type=text]');
  await expect(input).toHaveValue('');
  await input.fill('den bei einer Bank arbeitet');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(input).toBeEnabled();
  // Classic cards without requiredActions retain manual SRS grading. A failed
  // exercise must not submit a grade automatically; this is not an exam lock.
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await input.fill('der bei einer Bank arbeitet');
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(page.locator('.grade-buttons')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('d14-input-success.png'), fullPage: true });
  await show(page, cardById(358398));
  await expect(page.locator('.cloze-masked-text input[type=text]')).toHaveValue('');
});

test('D14 real free answer stays ungraded when evaluator is unavailable; content alone is not success', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const { writes } = await setup(page, context);
  await page.route('**/api/ai/evaluate-answer', route => route.fulfill({ json: { result: { verdict: 'unavailable', accepted: false }, grading_policy: { mode: 'controlled_text', max_retries: 3 } } }));
  await show(page, cardById(358408));
  const input = page.getByRole('textbox', { name: 'Ваш ответ' });
  await expect(page.getByRole('button', { name: 'Проверить ответ', exact: true })).toBeDisabled();
  await input.fill('Das ist Unsinn.');
  await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
  await expect(page.getByText('Не удалось проверить ответ. Попробуйте ещё раз — попытка не засчитана.')).toBeVisible();
  await expect(input).toHaveValue('Das ist Unsinn.');
  await expect(page.locator('.grade-buttons')).toBeVisible();
  expect(writes.filter(w => /grade|knowledge|sync\/push/.test(w.path))).toEqual([]);
  await expect(page.getByRole('button', { name: 'Показать пример ответа' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('d14-free-unavailable-375.png'), fullPage: true });
});

test('D14 currently permits manual grades and answer reveal before solving', async ({ page, context }) => {
  await setup(page, context);
  await show(page, cardById(358397));
  await expect(page.locator('.grade-buttons button').first()).toBeEnabled();
  await page.getByRole('button', { name: 'Перевернуть карточку', exact: true }).click();
  await expect(page.locator('.card-back')).toBeVisible();
  await expect(page.locator('.card-back')).toContainText('Nominativ');
});

test('real puzzle instruction and long D14 input fit phone, tablet and desktop widths', async ({ page, context }, testInfo) => {
  await setup(page, context);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of [348683, 358405]) {
      await show(page, cardById(id));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${id}-${width}.png`), fullPage: true });
    }
  }
});

test('skipping every real D14 card finishes without invented correct answers or grades', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  const { writes } = await setup(page, context);
  // This navigation button floats forever; make only the decorative animation
  // deterministic while retaining Playwright's visibility/enabled/hit checks.
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  const cards = snapshot.cards.filter(c => c.deck_id === 7139).sort((a, b) => a.position - b.position || a.id - b.id).map(c => cardById(c.id));
  await page.route('**/api/decks/7139/next*', route => {
    const excluded = (new URL(route.request().url()).searchParams.get('exclude_ids') || '').split(',').map(Number);
    return route.fulfill({ json: cards.find(c => !excluded.includes(c.id)) || { finished: true } });
  });
  await page.evaluate(async cards => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useDeckStore.setState({ deckCards: cards });
    useSessionStore.getState().resetSession();
    useSessionStore.setState({ isLearningMore: true, forcedSeenIds: [cards[0].id] });
  }, cards);
  await show(page, cards[0]);
  for (const card of cards) {
    await expect.poll(() => page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card?.id)).toBe(card.id);
    await page.getByRole('button', { name: 'Следующая карточка', exact: true }).click();
  }
  await expect(page.locator('.lesson-completion-overlay')).toBeVisible();
  await expect(page.locator('.lesson-completion-overlay')).not.toContainText('100%');
  await expect(page.locator('.lesson-completion-overlay')).toContainText('Подробная статистика появится позже');
  expect(writes.filter(w => /grade|knowledge|sync\/push/.test(w.path))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('d14-skipped-no-score.png'), fullPage: true });
});
