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
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
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
const toggleAdvanced = page => page.locator('.card-editor-mode > button');

const analysisQuiz = '::task\nWählen Sie die richtige Antwort.\n\n::exercise\nWomit fährt Anna?\n\nA) Mit dem Auto\n*B) Mit dem Bus\nC) Mit dem Zug';

for (const fixture of require('../../../local/test-data/fixtures/quiz_boundaries.json').examples) {
  test(`numbered Quiz condition stays in the question: ${fixture.name}`, async ({ page, context }, testInfo) => {
    const front = fixture.preamble + fixture.question + fixture.gap
      + fixture.answers.map((text, i) => `${i === fixture.correct ? '[*]' : '[ ]'} ${text}`).join('\n');
    await openEditor(page, context, front);
    await expect(page.locator('.card-front-preview .quiz-question')).toHaveText(fixture.question);
    await expect(page.locator('.card-front-preview .quiz-option-item')).toHaveCount(3);
    for (const answer of fixture.answers) {
      await expect(page.locator('.card-front-preview .quiz-option-item').filter({ hasText: answer })).toHaveCount(1);
    }
    await toggleAdvanced(page).click();
    await expect(raw(page)).toHaveValue(front);
    await toggleAdvanced(page).click();
    for (const width of [320, 1330]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: testInfo.outputPath(`quiz-boundary-editor-${width}.png`), fullPage: true });
    }
    const saved = page.waitForRequest(r => new URL(r.url()).pathname === '/api/cards/save');
    await page.getByRole('button', { name: /^Сохранить/ }).click();
    expect((await saved).postDataJSON()).toMatchObject({ front, card_type: 'quiz' });

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
    await expect(page.locator('.quiz-option-item')).toHaveCount(3);
    for (const answer of fixture.answers) await expect(page.locator('.quiz-option-item').filter({ hasText: answer })).toHaveCount(1);
    for (const width of [320, 1330]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`quiz-boundary-study-${width}.png`), fullPage: true });
    }
  });
}

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
  await expect(page.getByRole('textbox', { name: 'Контекст', exact: true })).toHaveValue('Пояснение падежа\n\nNote');
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

test('preview uses the study quiz renderer while source edits preserve Markdown and correctness', async ({ page, context }, testInfo) => {
  const front = '**Welche Stadt** [in Deutschland] ?\n\n[*] Berlin ist *richtig* [Hauptstadt] .\n[ ] **Bonn** [früher] .\n[x] Hamburg *heute* .';
  await openEditor(page, context, front);
  const preview = page.locator('.card-front-preview');
  await expect(preview.locator('.quiz-question')).toHaveText('Welche Stadt [in Deutschland]?');
  for (const text of ['Berlin ist richtig [Hauptstadt].', 'Bonn [früher].', 'Hamburg heute.']) {
    await expect(preview.locator('.quiz-option-item').filter({ hasText: text })).toHaveCount(1);
  }
  await expect(preview.getByRole('button').first()).toBeDisabled();
  await expect(raw(page)).toHaveCount(0);
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue(front);
  const changed = front.replace('[in Deutschland]', '[heute]').replace('[ ] **Bonn** [früher] .', '[*] **Bonn** [früher] !');
  await raw(page).fill(changed);
  await expect(preview.locator('.quiz-question')).toHaveText('Welche Stadt [heute]?');
  await expect(preview.locator('.quiz-option-item').filter({ hasText: 'Bonn [früher]!' })).toHaveCount(1);
  for (const width of [320, 1330]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`quiz-preview-${width}.png`) });
  }
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: changed, card_type: 'quiz' });
});

test('new card opens the editor, previews typing immediately and uses the existing save API', async ({ page, context }) => {
  await openEditor(page, context);
  await expect(raw(page)).toBeVisible();
  await raw(page).fill('Hallo');
  await expect(page.locator('.card-front-preview .text-front')).toHaveText('Hallo');
  await expect(page.getByRole('textbox', { name: 'Контекст', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Обратная сторона', exact: true }).fill('Hello');
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: 'Hallo', back: 'Hello', card_type: 'standard' });
});

test('assigning and changing a marker preserves order, selection, one-step undo/redo and saved text', async ({ page, context }, testInfo) => {
  const front = 'Прочитайте предложение. Выберите правильное окончание. Ich sehe einen kleinen Hund.';
  const selected = 'Выберите правильное окончание.';
  await openEditor(page, context, front);
  await toggleAdvanced(page).click();
  const select = async text => raw(page).evaluate((el, text) => {
    el.focus(); const start = el.value.indexOf(text); el.setSelectionRange(start, start + text.length);
  }, text);
  const command = name => page.locator('.card-editor-toolbar').getByRole('button', { name, exact: true });
  await select(selected);
  await command('Задание').click();
  const marked = await raw(page).inputValue();
  await expect(page.locator('.card-front-preview .exercise-info-task')).toHaveText(selected);
  await expect(page.locator('.card-front-preview > *')).toHaveText([
    'Прочитайте предложение.', selected, 'Ich sehe einen kleinen Hund.',
  ]);
  expect(await raw(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(selected);
  await page.keyboard.press('Control+z');
  await expect(raw(page)).toHaveValue(front);
  await expect(page.locator('.card-front-preview .exercise-info-task')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(raw(page)).toHaveValue(marked);
  await command('Пример').click();
  const changed = marked.replace('::task', '::example');
  await expect(raw(page)).toHaveValue(changed);
  await expect(page.locator('.card-front-preview .exercise-info-example')).toHaveText(selected);
  await page.keyboard.press('Control+z');
  await expect(raw(page)).toHaveValue(marked);
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveCount(0);
  await toggleAdvanced(page).click();
  await expect(raw(page)).toHaveValue(marked);
  for (const width of [320, 375, 430, 768, 1330]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.card-content-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`marker-editor-${width}.png`) });
  }
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(marked);
  await page.evaluate(async ({ front, deck }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const card = { id: 99, deck_id: deck.id, front, back: 'Answer', queue: 'new' };
    useSettingsStore.setState({ studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false,
      isSessionFinished: false, exerciseStates: {}, trainerAnswered: false });
    useUiStore.getState().setView('study');
  }, { front: marked, deck });
  await expect(page.locator('.study-flashcard .card-front .card-face .text-front')).toHaveText([
    'Прочитайте предложение.', 'Ich sehe einen kleinen Hund.',
  ]);
  await expect(page.locator('.study-flashcard .exercise-info-task')).toHaveText(selected);
  const order = await page.locator('.study-flashcard .card-front .card-face').evaluate(el =>
    [...el.querySelectorAll('.text-front, .exercise-info-text')].map(node => node.textContent.trim()));
  expect(order).toEqual(['Прочитайте предложение.', selected, 'Ich sehe einen kleinen Hund.']);
});

test('legacy unknown source and CRLF survive preview, opening, closing and save', async ({ page, context }) => {
  const source = '::future\r\nKEEP  EXACTLY\r\nLiteral [text]';
  await openEditor(page, context, source);
  await expect(page.locator('.card-front-preview')).toContainText('KEEP  EXACTLY');
  for (let i = 0; i < 2; i++) {
    await toggleAdvanced(page).click();
    await expect(raw(page)).toHaveValue(source.replace(/\r\n/g, '\n'));
    await toggleAdvanced(page).click();
  }
  const saved = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await saved).postDataJSON().front).toBe(source);
});

test('match and puzzle previews use the exercise renderers and update after source edits', async ({ page, context }) => {
  await openEditor(page, context, '::exercise\n@match\nBerlin => Deutschland\nWien => Österreich');
  await expect(page.locator('.card-front-preview')).toContainText('Berlin');
  await toggleAdvanced(page).click();
  const source = '::exercise\n@match\nA -> B — C = D => цель — отдохнуть\nWien => Österreich';
  await raw(page).fill(source);
  await expect(page.locator('.card-front-preview')).toContainText('A -> B — C = D');
  await expect(page.locator('.card-front-preview')).toContainText('цель — отдохнуть');
  await raw(page).fill('::task\nСоберите предложение.\n::exercise\n@puzzle\nIch wohne in Berlin.');
  await expect(page.locator('.card-front-preview .exercise-info-task')).toHaveText('Соберите предложение.');
  await expect(page.locator('.card-front-preview')).toContainText('Berlin.');
  await expect(page.locator('.card-front-preview')).not.toContainText('@puzzle');
});

test('failed save retains the source and the live free-text preview makes no evaluation requests', async ({ page, context }) => {
  await openEditor(page, context, 'Hallo');
  await toggleAdvanced(page).click();
  let evaluations = 0;
  await page.route('**/api/**evaluate**', route => { evaluations++; return route.fulfill({ json: {} }); });
  const source = '::task\nSchreibe.\n::exercise\n@free\nEin Satz.';
  await raw(page).fill(source);
  await expect(page.locator('.card-front-preview')).toContainText('Ein Satz.');
  await expect(page.locator('.card-front-preview textarea')).toBeDisabled();
  await page.route('**/api/cards/save', route => route.fulfill({ status: 400, json: { detail: 'Test save failure' } }));
  const failed = page.waitForResponse('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await failed).status()).toBe(400);
  await expect(raw(page)).toHaveValue(source);
  expect(evaluations).toBe(0);
});

test('preview and study share published typography and the explicitly enabled local draft', async ({ page, context }) => {
  const front = '::task\nRead carefully.\n::exercise\nDonaudampfschifffahrtsgesellschaft — пример текста.';
  await openEditor(page, context, front);
  const typography = locator => locator.evaluate(el => {
    const css = getComputedStyle(el);
    return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'textAlign', 'lineHeight']
      .map(key => [key, css[key]]));
  });
  for (const localDraft of [false, true]) {
    await page.evaluate(async ({ localDraft, front, deck }) => {
      const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
      const { useUiStore } = await import('/src/store/useUiStore.js');
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      const { DEFAULT_DESIGN_CONFIG_V2 } = await import('/src/design/designConfig.js');
      const { applyPublishedDesignTokens } = await import('/src/design/designTokens.js');
      const published = structuredClone(DEFAULT_DESIGN_CONFIG_V2);
      published.front.mainText = { font: 'Georgia', size: 1.2, weight: '400', style: 'italic',
        color: '#a5f3fc', align: 'right', lineHeight: 1.6 };
      const draft = structuredClone(published);
      draft.front.mainText.color = '#fed7aa';
      draft.front.mainText.size = 1.35;
      useSettingsStore.setState({ publishedDesignV2: { config: published }, adminDraftDesignV2: draft,
        isLocalDesignPreviewActive: localDraft, studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false });
      applyPublishedDesignTokens(localDraft ? draft : published);
      useDeckStore.setState({ currentDeck: deck });
      useSessionStore.getState().setEditingCard({ id: 1, deck_id: 1, front, back: 'Answer' });
      useUiStore.getState().setView('editor');
    }, { localDraft, front, deck });
    const preview = page.locator('.card-front-preview .text-front');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS('font-family', 'Georgia');
    await expect(preview).toHaveCSS('color', localDraft ? 'rgb(254, 215, 170)' : 'rgb(165, 243, 252)');
    const previewTypography = await typography(preview);
    await page.evaluate(async ({ front, deck }) => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      const card = { id: 99, deck_id: deck.id, front, back: 'Answer', queue: 'new' };
      useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false,
        isSessionFinished: false, exerciseStates: {}, trainerAnswered: false });
      useUiStore.getState().setView('study');
    }, { front, deck });
    const study = page.locator('.study-flashcard .card-front .text-front');
    await expect(study).toBeVisible();
    expect(await typography(study)).toEqual(previewTypography);
  }
});
