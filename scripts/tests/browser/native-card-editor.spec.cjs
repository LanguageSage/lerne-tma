const { test, expect } = require('./isolated-fixture.cjs');

const deck = { id: 1, name: 'Editor fixture', target_language: 'de', role: 'owner', stats: { total: 9 } };
const types = {
  standard: { prompt: 'Haus', answer: 'дом' },
  theory: { text: 'Theory', summary: 'Summary' },
  trainer: { parts: [{ type: 'input', answers: ['Haus'] }], back_note: 'Hint' },
  quiz: { prompt: 'Choose', options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }], back_note: '' },
  match: { pairs: [{ left: 'A', right: 'B' }, { left: 'C', right: 'D' }], back_note: '' },
  puzzle: { tokens: ['Das ist', 'ein Haus'], translation: 'Это дом' },
  word_bank: { options: ['Haus'], parts: [{ type: 'gap', option: 0 }] },
  free_text: { prompt: 'Write', sample_answer: 'Example', accepted_answers: ['Answer'] },
  editable_text: { source_text: 'Ich gehen.', correct_text: 'Ich gehe.', accepted_answers: [] },
};

async function setupEditor(page, context, server) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: 'editor', refresh_token: 'editor' }));
    window.SpeechRecognition = class {
      start() {
        this.onstart?.();
        this.onresult?.({ results: [[{ transcript: 'Я учу немецкий' }]] });
      }
      stop() { this.onend?.(); }
      abort() {}
    };
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/sync/v2/status') return route.fulfill({ json: { server_generation: 'a'.repeat(64), restored: false } });
    if (pathname === '/api/decks') return route.fulfill({ json: [deck] });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: server.card ? [server.card] : [] });
    if (pathname === '/api/messages' || pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname.endsWith('/images/original.webp')) return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><rect width="4" height="2" fill="#395772"/></svg>' });
    if (pathname === '/api/cards/ai-generate') {
      server.generatedDraft = route.request().postDataJSON();
      return route.fulfill({ json: { content_v2: { schema_version: 2, card: { type: 'standard',
        data: { prompt: 'Ich lerne Deutsch', answer: 'Я учу немецкий' } } } } });
    }
    if (pathname === '/api/cards/save') {
      const payload = route.request().postDataJSON();
      server.saves.push(payload);
      server.card = { id: 1, deck_id: payload.deck_id, content_v2: payload.content_v2, revision: 'created' };
      return route.fulfill({ json: server.card });
    }
    if (pathname === '/api/cards/1' && route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      server.saves.push(payload);
      if (server.conflict) return route.fulfill({ status: 409, json: { detail: { code: 'card_revision_conflict' } } });
      server.card = { ...server.card, content_v2: payload.content_v2, revision: 'server-' + server.saves.length };
      return route.fulfill({ json: server.card });
    }
    if (pathname === '/api/cards/1' || pathname === '/api/study/card/1') return route.fulfill({ json: server.card });
    if (pathname === '/api/sync/v2/pull') return route.fulfill({ json: {
      status: 'success', card_schema: 2, server_time: new Date().toISOString(),
      folders: [], decks: [deck], cards: server.card ? [server.card] : [], progress: [],
    } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible({ timeout: 20000 });
  return async function open(card, load = false) {
    await page.evaluate(async ({ deck, card, load }) => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      if (load) {
        const { default: api } = await import('/src/services/api.js');
        await api.get('/cards/' + card.id);
      }
      useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
      useSessionStore.getState().setEditingCard(card);
      useUiStore.setState({ editorSourceView: 'decks' });
      useUiStore.getState().setView('editor');
    }, { deck, card, load });
  };
}

const cachedCard = page => page.evaluate(async () => (await (await import('/src/services/localDb.js')).prepareLocalDb()).cards.get(1));

test('native editor keeps every card type and retains the draft after a conflict', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const contextField = page.locator('#card-editor-context');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  for (const [type, data] of Object.entries(types)) {
    const content = { type, data, info: [{ type: 'task', text: 'Information' }],
      level: 'B1', topics: ['one'], metadata: { extension: { arbitrary: [true, null] } } };
    server.card = { id: 1, deck_id: 1, revision: 'fixture-' + type,
      content_v2: { schema_version: 2, card: content }, image_path: 'images/original.webp' };
    const originalRevision = server.card.revision;
    await open(server.card, type === 'standard');
    await expect(page.getByRole('combobox', { name: 'Тип карточки' })).toHaveValue(type);
    await expect(page.getByRole('button', { name: 'Показать предпросмотр', exact: true }))
      .toHaveCount(['quiz', 'word_bank'].includes(type) ? 0 : 1);
    await contextField.fill('Edited ' + type);
    const request = page.waitForRequest(req => req.url().endsWith('/api/cards/1') && req.method() === 'PATCH');
    await save.click();
    const payload = (await request).postDataJSON();
    expect(payload.content_v2.card).toEqual({ ...content, explanation: 'Edited ' + type });
    expect(payload.revision).toEqual(originalRevision);
    expect(payload.image_path).toBe('images/original.webp');
    await expect(contextField).toHaveCount(0);
    await open(server.card, type === 'standard');
    await expect(contextField).toHaveValue('Edited ' + type);
  }
  // Source mode must remain literal across focus/locale/layout changes.
  const fs = require('node:fs');
  const path = require('node:path');
  const evidence = path.resolve('local/test-data/native-source-browser');
  fs.mkdirSync(evidence, { recursive: true });
  await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
  const source = page.locator('#card-editor-json');
  const literal = JSON.stringify(server.card.content_v2, null, 4) + '\n';
  await source.fill(literal);
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async locale => (await import('/src/i18n/locale.js')).setInterfaceLanguage(locale), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await source.focus();
      await expect(source).toHaveValue(literal);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: path.join(evidence, `source-${locale}-${width}.png`), fullPage: true });
    }
  }
  await source.fill('{"card":');
  await expect(source).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Card', exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(evidence, 'source-error-en.png'), fullPage: true });
  await source.fill(literal);
  await page.getByRole('button', { name: 'Typed form', exact: true }).click();
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('ru'));
  server.conflict = true;
  await contextField.fill('Retain draft');
  await save.click();
  await expect(contextField).toHaveCount(0);
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('conflict');
  await open(await cachedCard(page));
  await expect(page.getByRole('region', { name: 'Синхронизация карточки' })).toContainText('Retain draft');
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(contextField).toHaveValue('Retain draft');
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('editor-' + width + '.png'), fullPage: true });
  }
  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useUiStore.getState().setView('creator');
  });
  await page.getByRole('button', { name: 'Диктовать', exact: true }).click();
  await page.getByRole('button', { name: 'Остановить диктовку', exact: true }).click();
  await expect(page.locator('#card-editor-front')).toHaveValue('Я учу немецкий');
  await page.getByRole('button', { name: /Сгенерировать ИИ/ }).click();
  await expect(page.locator('#card-editor-front')).toHaveValue('Ich lerne Deutsch');
  await expect(page.locator('#card-editor-back')).toHaveValue('Я учу немецкий');
  expect(server.generatedDraft.content_v2.card).toMatchObject({ type: 'standard', data: { prompt: 'Я учу немецкий' } });
  expect(errors).toEqual([]);
});

const editorOrder = page => page.locator('.visual-card-editor-layout [data-layout-id]').evaluateAll(items =>
  items.map(item => item.dataset.layoutId));

const selectSentenceText = (field, start, length) => field.evaluate((element, { start, length }) => {
  element.focus();
  const range = document.createRange();
  range.setStart(element.firstChild, start);
  range.setEnd(element.firstChild, start + length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}, { start, length });

test('Quiz edits the study layout in place and saves the same Native V2 draft online and offline', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const initial = {
    type: 'quiz',
    data: { prompt: 'Welche Antworten passen?', options: [
      { text: 'Heute', correct: true }, { text: 'Gestern', correct: false }, { text: 'Nie', correct: false },
    ], back_note: 'Antwort auf der Rückseite' },
    info: [{ type: 'task', text: '**Wähle** eine Antwort.' }, { type: 'source', text: 'Hinweis' }],
    topics: ['Verben mit Präpositionen — Erweiterung'],
    explanation: 'Контекст для изучения',
    layout: [
      { id: 'task', type: 'info', index: 0, visibility: 'before_answer' },
      { id: 'quiz', type: 'exercise' },
      { id: 'source', type: 'info', index: 1, visibility: 'before_answer' },
    ],
  };
  const server = { card: { id: 1, deck_id: 1, queue: 'new', revision: 'quiz-fixture',
    content_v2: { schema_version: 2, card: initial } }, saves: [] };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const open = await setupEditor(page, context, server);
  await open(server.card, true);
  const question = page.getByRole('textbox', { name: 'Вопрос', exact: true });
  const task = page.locator('.visual-card-layout-block').filter({ has: page.locator('[data-layout-id="task"]') });
  const source = page.locator('.visual-card-layout-block').filter({ has: page.locator('[data-layout-id="source"]') });
  const exercise = page.locator('.visual-card-layout-block').filter({ has: page.locator('[data-layout-id="quiz"]') });
  await expect(task.locator('.card-markdown strong')).toHaveText('Wähle');
  await task.getByRole('textbox').fill('**Wähle** eine passende Antwort.');
  await question.fill('Welche Antworten sind im folgenden Beispiel grammatisch richtig?');
  await page.getByRole('textbox', { name: 'Вариант ответа 2', exact: true }).fill('Morgen');
  await page.getByRole('button', { name: 'Верный ответ 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Верный ответ 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Верный ответ 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.quiz-option-item').first().evaluate(option =>
    option.querySelector('[aria-pressed]').getBoundingClientRect().right
      < option.querySelector('.quiz-option-letter').getBoundingClientRect().left)).toBe(true);
  await page.getByRole('button', { name: 'Удалить вариант ответа 3', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
  const addedOption = page.getByRole('textbox', { name: 'Вариант ответа 3', exact: true });
  await expect(addedOption).toBeFocused();
  await addedOption.fill('Ein sehr langer Antwortsatz mit Wörtern für den mobilen Umbruch');
  await source.getByRole('combobox', { name: 'Роль блока' }).selectOption('example');
  await expect(source.getByRole('textbox')).toHaveValue('Hinweis');

  const handle = source.getByRole('button', { name: 'Переместить блок' });
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const target = await task.getByRole('button', { name: 'Переместить блок' }).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => editorOrder(page)).toEqual(['source', 'task', 'quiz']);
  const exerciseHandle = exercise.getByRole('button', { name: 'Переместить блок' });
  await exerciseHandle.press('ArrowUp');
  await expect.poll(() => editorOrder(page)).toEqual(['source', 'quiz', 'task']);
  await expect(exerciseHandle).toBeFocused();
  await source.getByLabel('Настройки блока', { exact: true }).click();
  await source.getByRole('combobox', { name: 'Когда показывать' }).selectOption('after_answer');
  await source.getByLabel('Настройки блока', { exact: true }).click();

  const addBlock = page.getByRole('button', { name: 'Добавить текстовый блок', exact: true });
  await addBlock.nth(1).click();
  const temporary = page.locator('[data-layout-position="1"]');
  await expect(temporary.getByRole('textbox')).toBeFocused();
  await temporary.getByRole('textbox').fill('Temporärer Block');
  await temporary.getByLabel('Настройки блока', { exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await temporary.getByRole('button', { name: 'Удалить блок', exact: true }).click();
  await expect(temporary.getByRole('textbox')).toHaveValue('Temporärer Block');
  page.once('dialog', dialog => dialog.accept());
  await temporary.getByRole('button', { name: 'Удалить блок', exact: true }).click();
  await expect.poll(() => editorOrder(page)).toEqual(['source', 'quiz', 'task']);
  await addBlock.nth(2).click();
  const inserted = page.locator('[data-layout-position="2"]');
  await inserted.getByRole('textbox').fill('Neuer Textblock');
  const order = await editorOrder(page);
  expect(order.slice(0, 2)).toEqual(['source', 'quiz']);
  expect(order[3]).toBe('task');

  await expect(source.getByRole('textbox')).toHaveValue('Hinweis');
  const topics = page.locator('.visual-card-topics');
  const topicSummary = topics.locator('summary');
  await expect(topicSummary).toHaveText('Тема');
  await expect(page.getByText('Информационные блоки и темы', { exact: true })).toHaveCount(0);
  await topicSummary.click();
  const addTopic = topics.getByRole('button', { name: 'Добавить тему', exact: true });
  await expect(topics.getByRole('textbox', { name: 'Тема 1', exact: true })).toHaveValue(initial.topics[0]);
  await addTopic.click();
  await topics.getByRole('textbox', { name: 'Тема 2', exact: true }).fill('Kasus');
  await addTopic.click();
  await topics.getByRole('textbox', { name: 'Тема 3', exact: true }).fill('Temporär');
  await topics.getByRole('button', { name: 'Удалить тему 3', exact: true }).click();
  await expect(topics.getByRole('textbox')).toHaveCount(2);

  const style = element => {
    const css = getComputedStyle(element);
    const typography = element.matches('.quiz-option-item') ? [] : [css.fontFamily, css.fontSize, css.fontWeight];
    return [...typography, css.color, css.backgroundColor, css.borderTopColor, css.borderRadius, css.padding];
  };
  const signature = async () => Promise.all(['.quiz-question', '.quiz-option-item', '.quiz-option-text', '.exercise-info-task']
    .map(selector => page.locator(selector).first().evaluate(style)));
  const editingStyle = await signature();
  const editingWidths = {};
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 1400 : 900 });
    await expect(question).toBeVisible();
    if (width === 320) {
      await source.getByLabel('Настройки блока', { exact: true }).click();
      await expect(source.getByRole('combobox', { name: 'Когда показывать' })).toBeVisible();
      await source.getByLabel('Настройки блока', { exact: true }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await topics.locator('.visual-card-topic-row').first().evaluate(row =>
      row.querySelector('input').getBoundingClientRect().right
        < row.querySelector('button').getBoundingClientRect().left)).toBe(true);
    if (width === 375 || width === 1280) {
      const surface = page.locator('.visual-card-editor-surface');
      await page.mouse.move(0, 0);
      await surface.screenshot({ path: testInfo.outputPath(`edit-${width}.png`) });
      await topics.screenshot({ path: testInfo.outputPath(`topics-${width}.png`) });
      editingWidths[width] = await surface.evaluate(element => element.offsetWidth);
    }
  }

  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect.poll(() => server.saves.length).toBe(1);
  const saved = server.saves[0];
  expect(saved.revision).toBe('quiz-fixture');
  expect(saved.content_v2.card).toMatchObject({
    data: { prompt: 'Welche Antworten sind im folgenden Beispiel grammatisch richtig?', back_note: initial.data.back_note,
      options: [{ text: 'Heute', correct: true }, { text: 'Morgen', correct: true },
        { text: 'Ein sehr langer Antwortsatz mit Wörtern für den mobilen Umbruch', correct: false }] },
    info: [{ type: 'task', text: '**Wähle** eine passende Antwort.' }, { type: 'example', text: 'Hinweis' },
      { type: 'text', text: 'Neuer Textblock' }],
    layout: [
      { id: 'source', type: 'info', index: 1, visibility: 'after_answer' }, initial.layout[1],
      { id: order[2], type: 'info', index: 2, visibility: 'before_answer' }, initial.layout[0],
    ],
    explanation: initial.explanation,
    topics: [initial.topics[0], 'Kasus'],
  });
  await expect(question).toHaveCount(0);
  await expect.poll(async () => (await cachedCard(page))?.revision).toBe(server.card.revision);
  await open(server.card);
  await expect(question).toHaveValue(saved.content_v2.card.data.prompt);
  await expect.poll(() => editorOrder(page)).toEqual(order);
  await topicSummary.click();
  await expect(topics.getByRole('textbox', { name: 'Тема 2', exact: true })).toHaveValue('Kasus');

  await context.setOffline(true);
  await question.fill('Offline-Entwurf');
  await save.click();
  await expect(question).toHaveCount(0);
  await expect.poll(async () => (await cachedCard(page))?.content_v2.card.data.prompt).toBe('Offline-Entwurf');
  expect(server.saves).toHaveLength(1);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(question).toHaveValue('Offline-Entwurf');
  await expect.poll(() => editorOrder(page)).toEqual(order);

  await page.evaluate(async ({ deck, card }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card: { ...server.card, requiredActions: ['answer'] } });
  const study = page.locator('#tut-study-card');
  await expect(study.locator('.quiz-question')).toHaveText(saved.content_v2.card.data.prompt);
  expect(await signature()).toEqual(editingStyle);
  await expect(study.locator('[data-layout-id="source"]')).toHaveCount(0);
  await expect(study.getByText('Kasus', { exact: true })).toHaveCount(0);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 1400 : 900 });
    await expect.poll(() => study.evaluate(element => element.offsetWidth)).toBe(editingWidths[width]);
    await study.screenshot({ path: testInfo.outputPath(`study-${width}.png`) });
  }
  await study.getByRole('button', { name: /Morgen/ }).click();
  await study.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(study.locator('.quiz-option-item.correct')).toHaveText(/Morgen/);
  await expect(study.locator('[data-layout-id="source"]')).toContainText('Hinweis');
  expect(errors).toEqual([]);
});

test('WordBank creates and edits linked gaps, punctuation and repeated words online and offline', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.getState().setView('creator');
  }, deck);
  const kind = page.getByRole('combobox', { name: 'Тип карточки', exact: true });
  await kind.selectOption('word_bank');
  await expect(kind).toHaveCount(1);
  const exercise = page.locator('.word-bank-editor');
  const literals = exercise.getByRole('textbox', { name: 'Текст задания', exact: true });
  const gaps = exercise.locator('.word-bank-gap.is-correct');
  const word = index => exercise.getByRole('textbox', { name: `Слово ${index}`, exact: true });
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await expect(exercise.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Показать предпросмотр', exact: true })).toHaveCount(0);
  await literals.first().fill('Wir bereiten uns vor, vor!');

  const addGap = page.getByRole('button', { name: 'Создать пропуск', exact: true });
  await literals.first().scrollIntoViewIfNeeded();
  const bounds = await literals.first().evaluate(element => {
    const range = document.createRange();
    range.setStart(element.firstChild, 4);
    range.setEnd(element.firstChild, 12);
    const { left, right, top, height } = range.getBoundingClientRect();
    return { left, right, y: top + height / 2 };
  });
  await page.mouse.move(bounds.left + 1, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.right - 1, bounds.y, { steps: 8 });
  await page.mouse.up();
  await addGap.click();
  await selectSentenceText(literals.nth(1), 5, 3);
  await expect(addGap).toBeVisible();
  await literals.nth(1).press('Alt+Enter');
  await selectSentenceText(literals.nth(2), 2, 3);
  await addGap.click();
  await expect(gaps).toHaveCount(3);
  await expect(exercise.locator('.word-bank-option.is-correct')).toHaveCount(0);
  await expect(word(2)).toHaveValue('vor');
  await expect(word(3)).toHaveValue('vor');
  await exercise.getByRole('textbox', { name: 'Пропуск 2', exact: true }).fill('voran');
  await expect(word(2)).toHaveValue('voran');
  await expect(word(3)).toHaveValue('vor');
  const removeFirstWord = exercise.getByRole('button', { name: 'Удалить слово из банка 1', exact: true });
  await expect(removeFirstWord).toBeDisabled();
  await exercise.getByRole('button', { name: 'Убрать пропуск 1', exact: true }).click();
  await expect(literals.first()).toHaveText('Wir bereiten uns');
  await expect(removeFirstWord).toBeEnabled();
  await removeFirstWord.click();
  await expect(exercise.getByRole('textbox', { name: 'Пропуск 1', exact: true })).toHaveValue('voran');
  await expect(exercise.getByRole('textbox', { name: 'Пропуск 2', exact: true })).toHaveValue('vor');
  await exercise.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
  await expect(word(3)).toBeFocused();
  await word(3).fill('lernen');
  await page.getByRole('button', { name: 'Добавить текстовый блок', exact: true }).first().click();
  await page.locator('[data-layout-position="0"]').getByRole('textbox').fill('Ergänze die Wörter.');
  await page.getByRole('combobox', { name: 'Роль блока', exact: true }).selectOption('task');
  const topics = page.locator('.visual-card-topics');
  await topics.locator('summary').click();
  await topics.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await topics.getByRole('textbox', { name: 'Тема 1', exact: true }).fill('Verben');
  const expected = {
    options: ['voran', 'vor', 'lernen'],
    parts: [{ type: 'text', text: 'Wir bereiten uns ' }, { type: 'gap', option: 0 }, { type: 'text', text: ', ' },
      { type: 'gap', option: 1 }, { type: 'text', text: '!' }],
  };
  const appearance = element => {
    const css = getComputedStyle(element);
    return [css.fontFamily, css.fontSize, css.backgroundColor, css.color, css.borderColor, css.borderRadius];
  };
  const editGapStyle = await gaps.first().evaluate(appearance);
  const editOptionStyle = await exercise.locator('.word-bank-option').first().evaluate(appearance);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await exercise.locator('.word-bank-options').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 375 || width === 1280) await exercise.screenshot({ path: testInfo.outputPath(`word-bank-edit-${width}.png`) });
  }
  await save.click();
  await expect.poll(() => server.card?.content_v2.card.data).toEqual(expected);
  expect(server.card.content_v2.card).toMatchObject({ topics: ['Verben'], info: [{ type: 'task', text: 'Ergänze die Wörter.' }] });
  await expect(exercise).toHaveCount(0);
  await open(server.card, true);
  await expect(gaps).toHaveCount(2);
  await expect(word(1)).toHaveValue('voran');
  await word(2).fill('danach');
  await expect(exercise.getByRole('textbox', { name: 'Пропуск 2', exact: true })).toHaveValue('danach');
  await context.setOffline(true);
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.content_v2.card.data.options).toEqual(['voran', 'danach', 'lernen']);
  await expect(exercise).toHaveCount(0);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(exercise.getByRole('textbox', { name: 'Пропуск 2', exact: true })).toHaveValue('danach');
  expect((await cachedCard(page)).content_v2.card.data.parts).toEqual(expected.parts);

  await page.evaluate(async ({ deck, card }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card: { ...server.card, requiredActions: ['answer'] } });
  const study = page.locator('#tut-study-card .word-bank-exercise');
  const bank = study.locator('.word-bank-option');
  expect(await bank.first().evaluate(appearance)).toEqual(editOptionStyle);
  await bank.filter({ hasText: /^voran$/ }).click();
  await bank.filter({ hasText: /^vor$/ }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(study.locator('.word-bank-gap.is-correct')).toHaveCount(2);
  await expect.poll(() => study.locator('.word-bank-gap.is-correct').first().evaluate(appearance)).toEqual(editGapStyle);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await study.screenshot({ path: testInfo.outputPath(`word-bank-study-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test.describe('WordBank on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });

  test('creates a gap from selection and saves an offline draft', async ({ page, context }) => {
    const card = { id: 1, deck_id: 1, revision: 'touch-word-bank', content_v2: { schema_version: 2, card: {
      type: 'word_bank', info: [], data: { options: ['lerne'], parts: [
        { type: 'text', text: 'Ich ' }, { type: 'gap', option: 0 }, { type: 'text', text: ' Deutsch.' },
      ] },
    } } };
    const server = { card, saves: [] };
    const open = await setupEditor(page, context, server);
    await open(card, true);
    await context.setOffline(true);
    const exercise = page.locator('.word-bank-editor');
    await selectSentenceText(exercise.getByRole('textbox', { name: 'Текст задания', exact: true }).last(), 1, 7);
    await exercise.getByRole('button', { name: 'Создать пропуск', exact: true }).tap();
    await expect(exercise.getByRole('textbox', { name: 'Пропуск 2', exact: true })).toHaveValue('Deutsch');
    await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
    await expect.poll(async () => (await cachedCard(page))?.content_v2.card.data.options).toEqual(['lerne', 'Deutsch']);
    expect(server.saves).toHaveLength(0);
  });
});

test.describe('Quiz creator on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });

  test('moves blocks by their handles and saves a topic', async ({ page, context }, testInfo) => {
    const server = { saves: [] };
    await setupEditor(page, context, server);
    await page.evaluate(async deck => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useDeckStore.setState({ currentDeck: deck });
      useUiStore.getState().setView('creator');
    }, deck);
    await page.getByRole('combobox', { name: 'Тип карточки' }).selectOption('quiz');
    await page.getByRole('textbox', { name: 'Вопрос', exact: true }).fill('Welche Antwort ist richtig?');
    await page.getByRole('textbox', { name: 'Вариант ответа 1', exact: true }).fill('Richtig');
    await page.getByRole('textbox', { name: 'Вариант ответа 2', exact: true }).fill('Falsch');
    const topics = page.locator('.visual-card-topics');
    await topics.locator('summary').tap();
    await topics.getByRole('button', { name: 'Добавить тему', exact: true }).tap();
    const topic = topics.getByRole('textbox', { name: 'Тема 1', exact: true });
    await topic.fill('Kasus');
    await expect(topic).toHaveCSS('min-height', '44px');
    await topics.screenshot({ path: testInfo.outputPath('topics-touch.png') });
    const add = page.getByRole('button', { name: 'Добавить текстовый блок', exact: true });
    await add.first().tap();
    await page.locator('[data-layout-position="0"] textarea').fill('Erster Block');
    await add.nth(1).tap();
    await page.locator('[data-layout-position="1"] textarea').fill('Zweiter Block');
    await page.locator('.visual-card-editor-type').tap();
    const [first, second, exercise] = await editorOrder(page);
    const start = page.locator('[data-layout-position="0"] .visual-card-drag-handle');
    const end = page.locator('[data-layout-position="1"] .visual-card-drag-handle');
    await start.scrollIntoViewIfNeeded();
    const a = await start.boundingBox();
    const b = await end.boundingBox();
    const session = await context.newCDPSession(page);
    const x = a.x + a.width / 2;
    const y = a.y + a.height / 2;
    const distance = b.y - a.y;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const progress of [.15, .4, .65, 1]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * progress }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => editorOrder(page)).toEqual([second, first, exercise]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const draft = (await db.cards.toArray()).find(card => card.content_v2?.card.type === 'quiz')?.content_v2.card;
      return draft && { order: draft.layout.map(item => item.id), topics: draft.topics };
    })).toEqual({ order: [second, first, exercise], topics: ['Kasus'] });
  });
});
