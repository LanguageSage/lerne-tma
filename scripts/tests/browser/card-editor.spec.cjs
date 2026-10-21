const { test, expect } = require('./isolated-fixture.cjs');

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
const toggleAdvanced = page => page.getByRole('button', { name: 'Дополнительно', exact: true });

const analysisQuiz = '::task\nWählen Sie die richtige Antwort.\n\n::exercise\nWomit fährt Anna?\n\nA) Mit dem Auto\n*B) Mit dem Bus\nC) Mit dem Zug';

test('quiz analysis preserves source and sits between card sides', async ({ page, context }, testInfo) => {
  await openEditor(page, context, analysisQuiz);
  const action = page.getByRole('button', { name: '📝 Разбор теста', exact: true });
  await expect(action).toHaveCount(1);
  await expect(page.getByRole('button', { name: /генерировать/i })).toHaveCount(0);
  await expect(page.locator('.card-editor-mode').getByRole('button', { name: 'Выполнить просьбу', exact: true })).toBeVisible();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 375, 430, 768, 1330]) {
    await page.setViewportSize({ width, height: 900 });
    const positions = await page.evaluate(() => ({
      front: document.querySelector('#tut-creator-front').getBoundingClientRect().bottom,
      actions: document.querySelector('.ai-quick-actions').getBoundingClientRect(),
      back: document.querySelector('#card-editor-back').getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth > innerWidth,
      more: document.querySelector('.card-editor-mode > button').getBoundingClientRect(),
      request: document.querySelector('.card-editor-mode .card-question-trigger').getBoundingClientRect(),
    }));
    expect(positions.overflow).toBe(false);
    expect(positions.request.left).toBeGreaterThanOrEqual(positions.more.right);
    expect(positions.request.top).toBeLessThan(positions.more.bottom);
    expect(positions.actions.top).toBeGreaterThanOrEqual(positions.front);
    expect(positions.actions.bottom).toBeLessThan(positions.back);
    await page.screenshot({ path: testInfo.outputPath(`quiz-analysis-${width}.png`), fullPage: true });
  }
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  await page.route('**/api/cards/ai-generate', async route => {
    count++;
    expect(route.request().postDataJSON()).toMatchObject({ phrase: analysisQuiz, action_type: 'quiz_analysis' });
    await gate;
    return route.fulfill({ json: { front: 'Broken\\n*B)', back: 'Полный перевод\n2. ✅ На автобусе',
      context: 'Объяснение всех вариантов\nСловарный запас\nГрамматика', level: 'C2', tags: 'changed' } });
  });
  await action.click();
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сохранить/ })).toBeDisabled();
  release();
  await expect(page.locator('#card-editor-back')).toHaveValue('Полный перевод\n2. ✅ На автобусе');
  const draft = await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().editingCard);
  expect(draft.front).toBe(analysisQuiz);
  expect(draft.tags).not.toBe('changed');
  expect(count).toBe(1);
  expect(errors).toEqual([]);
});

test('single quiz analysis error leaves entire draft intact without client retry', async ({ page, context }) => {
  await openEditor(page, context, analysisQuiz);
  const original = await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().editingCard);
  let count = 0;
  await page.route('**/api/cards/ai-generate', route => {
    count++;
    return route.fulfill({ json: { error: 'Не удалось получить полный разбор теста после двух попыток. Карточка не изменена.' } });
  });
  await page.getByRole('button', { name: '📝 Разбор теста', exact: true }).click();
  await expect(page.getByText(/Ошибка ИИ: Не удалось получить полный разбор/)).toBeVisible();
  await expect(page.getByRole('button', { name: '📝 Разбор теста', exact: true })).toBeEnabled();
  const current = await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().editingCard);
  expect(current).toEqual(original);
  expect(count).toBe(1);
});

test('quiz custom request remains available without changing the question', async ({ page, context }) => {
  await openEditor(page, context, analysisQuiz);
  await page.route('**/api/cards/ai-generate', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ phrase: analysisQuiz, action_type: 'custom_directive', user_request: 'Объясни падеж' });
    return route.fulfill({ json: { front: '', back: '', context: 'Пояснение падежа' } });
  });
  await page.getByRole('button', { name: 'Выполнить просьбу', exact: true }).click();
  await page.locator('.card-question-input').fill('Объясни падеж');
  await page.getByRole('button', { name: 'Выполнить ✨', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Примеры и пояснения', exact: true })).toHaveValue('Пояснение падежа\n\nNote');
  const draft = await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().editingCard);
  expect(draft.front).toBe(analysisQuiz);
  expect(draft.context).toContain('Пояснение падежа');
});

test('single quiz fix keeps standard editor and new card generation available', async ({ page, context }) => {
  await openEditor(page, context, 'Guten Morgen');
  await expect(page.getByRole('button', { name: /генерировать/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выполнить просьбу', exact: true })).toBeVisible();
  await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator'));
  await expect(page.getByRole('button', { name: /генерировать/i })).toBeVisible();
});

test('B1-29-D02 compact quiz labels render in the editor and study card', async ({ page, context }, testInfo) => {
  const fixture = require('../../../tests/fixtures/quiz_b1_29_d02.json');
  const front = `::task\n${fixture.task}\n::exercise\n${fixture.question}\n\nA)${fixture.answers[0]}\nB)${fixture.answers[1]}\nC)*${fixture.answers[fixture.correct]}`;
  await openEditor(page, context, front);
  const question = page.getByRole('textbox', { name: 'Вопрос / лицевая сторона', exact: true });
  await expect(question).toHaveText(fixture.question);
  expect(await question.textContent()).toBe(fixture.question);
  await expect(page.locator('.card-editor-quiz-option')).toHaveCount(3);
  for (const [index, answer] of fixture.answers.entries()) {
    await expect(page.getByRole('textbox', { name: `Вариант ${index + 1}`, exact: true })).toHaveValue(answer);
  }
  await expect(page.getByRole('checkbox', { name: 'Правильный вариант 3', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click();
  await expect(raw(page)).toHaveValue(front);

  await page.evaluate(async ({ front, deck }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const card = { id: 99, deck_id: deck.id, front, back: 'Объяснение', queue: 'new' };
    useSettingsStore.setState({ studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false,
      isSessionFinished: false, exerciseStates: {}, trainerAnswered: false });
    useUiStore.getState().setView('study');
  }, { front, deck });
  await expect(page.locator('.quiz-question')).toHaveText(fixture.question);
  expect(await page.locator('.quiz-question').textContent()).toBe(fixture.question);
  await expect(page.locator('.quiz-option-item')).toHaveCount(3);
  for (const answer of fixture.answers) await expect(page.locator('.quiz-option-item').filter({ hasText: answer })).toHaveCount(1);
  for (const width of [375, 1330]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`quiz-study-${width}.png`), fullPage: true });
  }
  await page.locator('.quiz-option-item').filter({ hasText: fixture.answers[0] }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.quiz-option-item.wrong')).toHaveCount(1);
  await page.locator('.quiz-option-item').filter({ hasText: fixture.answers[fixture.correct] }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('.quiz-option-item.correct')).toHaveCount(1);
});

test('simple creation uses the existing save API and has no technical cheatsheet', async ({ page, context }, testInfo) => {
  await openEditor(page, context);
  await expect(page.getByText('Тренажёр:', { exact: true })).toHaveCount(0);
  await expect(raw(page)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Вопрос / лицевая сторона' }).fill('Hallo');
  await page.getByRole('textbox', { name: 'Ответ / обратная сторона' }).fill('Hello');
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.card-content-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`simple-${width}.png`), fullPage: true });
  }
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: 'Hallo', back: 'Hello', card_type: 'standard' });
});

test('visual fields, raw toggle, cursor insertion and menu dismissal', async ({ page, context }) => {
  const source = '::exercise\n@match\nBerlin => Deutschland\nWien => Österreich';
  await openEditor(page, context, source);
  const left = page.getByRole('textbox', { name: 'Левая сторона', exact: true });
  await expect(left).toHaveCount(2);
  await left.first().fill('Paris');
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue(source.replace('Berlin', 'Paris'));
  await raw(page).fill('AA\nBB');
  await raw(page).evaluate(el => { el.focus(); el.setSelectionRange(3, 3); });
  const more = page.locator('.card-editor-cluster-marker .card-editor-btn-more');
  await more.click();
  await page.locator('.card-editor-popover').getByRole('menuitem', { name: 'Пример', exact: true }).click();
  await expect(raw(page)).toHaveValue('AA\n::example\nBB');
  await expect(raw(page)).toBeFocused();
  await more.focus();
  await page.keyboard.press('Enter');
  const summary = page.locator('.card-editor-popover').getByRole('menuitem', { name: 'Содержимое упражнения', exact: true });
  await expect(summary).toBeVisible();
  await raw(page).click();
  await expect(summary).toHaveCount(0);
});

test('legacy and unknown raw source survives viewing, mode switches and save', async ({ page, context }) => {
  const source = '::future\r\nKEEP  EXACTLY\r\n@wordbank\r\n<<1>>';
  const browserSource = source.replace(/\r\n/g, '\n');
  await openEditor(page, context, source);
  await expect(page.locator('.card-editor-readable')).toHaveText('KEEP  EXACTLY\n<<1>>');
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue(browserSource);
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveCount(0);
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue(browserSource);
  const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(source);
});

test('responsive visual and raw editor in Russian and English', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page, context, '::task\nVerbinde.\n::exercise\n@match\nBerlin => Deutschland\nWien => Österreich');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('textbox', { name: 'Левая сторона' }).first()).toHaveValue('Berlin');
    await toggleAdvanced(page).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`visual-${width}.png`), fullPage: true });
    await toggleAdvanced(page).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`raw-${width}.png`), fullPage: true });
    await toggleAdvanced(page).click();
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  const englishToggle = page.getByRole('button', { name: 'Advanced', exact: true });
  await expect(englishToggle).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await englishToggle.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('english-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});


test('raw changes roundtrip and save failure retain the draft', async ({ page, context }) => {
  await openEditor(page, context, 'Hallo');
  await toggleAdvanced(page).click();
  const source = '::task\nSchreibe.\n::exercise\n@free\nEin Satz.';
  await raw(page).fill(source);
  await toggleAdvanced(page).click();
  await expect(page.getByRole('textbox', { name: 'Свободный ответ', exact: true })).toHaveValue('Ein Satz.');
  await toggleAdvanced(page).click();
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
  expect((await saved).postDataJSON()).toMatchObject({ front: source, card_type: 'free_text' });
});

test('match pairs and puzzle content can be edited visually', async ({ page, context }) => {
  await openEditor(page, context, '::exercise\n@match\nBerlin => Deutschland\nWien => Österreich');
  await page.getByRole('textbox', { name: 'Левая сторона' }).first().fill('Paris');
  await page.getByRole('textbox', { name: 'Правая сторона' }).first().fill('France');
  await page.getByRole('button', { name: 'Добавить пару', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Левая сторона', exact: true })).toHaveCount(3);
  await toggleAdvanced(page).click();
  expect(await raw(page).inputValue()).toContain('Paris => France');
  await raw(page).fill('::exercise\n@puzzle\nIch wohne in Berlin.');
  await toggleAdvanced(page).click();
  await page.getByRole('textbox', { name: 'Собрать предложение', exact: true }).fill('Ich wohne in Berlin.');
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue('::exercise\n@puzzle\nIch wohne in Berlin.');
});
