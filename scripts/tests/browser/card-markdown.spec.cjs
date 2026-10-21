const { test, expect } = require('./isolated-fixture.cjs');

const table = '| Падеж | Вопрос | Пример | Перевод | Пояснение |\n'
  + '| --- | --- | --- | --- | --- |\n'
  + '| Nominativ | Wer? | **Der Hund** | *Собака* | ДлинноеНемецкоеСловоDonaudampfschifffahrtsgesellschaft |';
const markdown = '# Перевод\n\n**Жирный** и *курсив*.\n\nПервый абзац.\n\nВторой абзац.\n\n'
  + '- Один\n- Два\n\n1. Первый\n2. Второй\n\n' + table;
const unsafe = '\n\n<script>window.markdownExecuted = true</script>\n\n'
  + '<img src=x onerror="window.markdownExecuted = true">\n\n'
  + '<iframe src="javascript:window.markdownExecuted=true"></iframe>\n\n'
  + '[опасная ссылка](javascript:window.markdownExecuted=true)';
const card = { id: 1, deck_id: 1, queue: 'new', front: '**Original**\n\n::source\nQuelle',
  back: markdown + unsafe, context: '## Контекст\n\n' + table + unsafe };
const deck = { id: 1, name: 'Markdown test', target_language: 'de', role: 'owner', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };

async function setup(page, context) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated-test', refresh_token: 'isolated-test' }));
  });
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {},
      user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/cards/save') return route.fulfill({ json: { id: 1, ...route.request().postDataJSON() } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  await page.evaluate(async ({ deck }) => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useSettingsStore.setState({ studyMode: 'classic', autoShowAnswer: false, autoPlayAudio: false,
      autoGenerateCardAudio: false, publishedDesignV2: null, isLocalDesignPreviewActive: false,
      cardFont: 'Georgia', cardFontSize: 1.15, backCardFont: 'Georgia', backCardFontSize: 1.15,
      backTextColor: '#fed7aa', contextFont: 'Georgia', contextFontSize: 1,
      contextTextColor: '#a5f3fc', previewCardLines: 0 });
    useDeckStore.setState({ currentDeck: deck });
  }, { deck });
  return errors;
}

async function showStudy(page, nextCard = card, mode = 'classic') {
  await page.evaluate(async ({ card, mode }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ studyMode: mode });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false, exerciseStates: {} });
    useUiStore.getState().setView('study');
  }, { card: nextCard, mode });
  await expect(page.locator('.study-flashcard')).toBeVisible();
}

async function checkTables(page, scope) {
  const tables = scope.locator('.markdown-table-scroll');
  expect(await tables.count()).toBeGreaterThan(0);
  for (const wrapper of await tables.all()) {
    await expect(wrapper.locator('th')).toHaveCount(5);
    await expect(wrapper.locator('tbody strong')).toHaveText('Der Hund');
    const geometry = await wrapper.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth,
      right: el.getBoundingClientRect().right, viewport: innerWidth }));
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
    if (geometry.viewport <= 400) {
      expect(geometry.content).toBeGreaterThan(geometry.width);
      await wrapper.evaluate(el => { el.scrollLeft = 100; });
      expect(await wrapper.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(scope.locator('script, iframe, img[onerror]')).toHaveCount(0);
  expect(await scope.locator('a').evaluateAll(links => links.some(a => /^javascript:/i.test(a.getAttribute('href') || '')))).toBe(false);
  expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined();
}

test('back/context render Markdown safely, inherit card styles and scroll within the card', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  await showStudy(page);
  await expect(page.locator('#tut-study-front')).toHaveText('Original');
  await expect(page.locator('.card-front .card-markdown')).toHaveCount(0);
  await page.getByRole('button', { name: 'Перевернуть карточку', exact: true }).click();
  const answer = page.locator('#tut-study-answer');
  await expect(answer.locator('h1')).toHaveText('Перевод');
  await expect(answer.locator('ul > li')).toHaveCount(2);
  await expect(answer.locator('ol > li')).toHaveCount(2);
  await expect(answer.locator('p').filter({ hasText: /^Первый абзац\.$/ })).toHaveCount(1);
  await expect(answer.locator('p').filter({ hasText: /^Второй абзац\.$/ })).toHaveCount(1);
  await expect(answer.locator('em').first()).toHaveText('курсив');
  await expect(answer.locator('.card-markdown')).toHaveCSS('font-family', 'Georgia');
  await expect(answer.locator('.card-markdown')).toHaveCSS('color', 'rgb(254, 215, 170)');
  await expect(answer.locator('.card-markdown')).toHaveCSS('font-size', '18.4px');
  await expect(page.locator('.text-context .card-markdown')).toHaveCSS('color', 'rgb(165, 243, 252)');
  for (const width of [320, 360, 375, 400, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkTables(page, page.locator('.card-back'));
    await page.screenshot({ path: testInfo.outputPath(`markdown-${width}.png`), fullPage: true });
    await page.locator('.text-context').screenshot({ path: testInfo.outputPath(`context-${width}.png`) });
  }
  await answer.locator('.markdown-table-scroll').click();
  await expect(page.locator('.card-back')).toBeVisible();
  expect(errors).toEqual([]);
});

test('all exercise answer blocks and reverse bind Markdown to saved back only', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.setViewportSize({ width: 375, height: 900 });
  const fronts = ['@theory\n**Original**', 'Ich [[lerne]] Deutsch.',
    '@wordbank\nIch <<1>> Deutsch.\n@options\nlerne | lernt',
    '@puzzle\nIch lerne Deutsch.', '@match\nHaus = дом\nHund = собака',
    'Was passt?\nA) Nein\n*B) Ja', '@free\nSchreiben Sie einen Satz.'];
  for (const [index, front] of fronts.entries()) {
    await showStudy(page, { ...card, id: index + 10, front });
    await page.evaluate(async () => {
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      useSessionStore.setState({ isFlipped: true });
    });
    await expect(page.locator('#tut-study-answer h1')).toHaveText('Перевод');
    await checkTables(page, page.locator('.card-back'));
  }
  await showStudy(page, card, 'reverse');
  await expect(page.locator('#tut-study-front h1')).toHaveText('Перевод');
  await checkTables(page, page.locator('#tut-study-front'));
  await page.getByRole('button', { name: 'Перевернуть карточку', exact: true }).click();
  await expect(page.locator('#tut-study-answer')).toHaveText('Original');
  await expect(page.locator('#tut-study-answer .card-markdown')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('trainer and puzzle translation disclosures preserve full Markdown and exercise interaction', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.setViewportSize({ width: 320, height: 900 });
  await showStudy(page, { ...card, front: 'Ich [[lerne]] Deutsch.' });
  await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
  await expect(page.locator('.trainer-line-trans h1')).toHaveText('Перевод');
  await checkTables(page, page.locator('.trainer-line-trans'));
  await page.getByRole('textbox', { name: 'Пропуск 1', exact: true }).fill('lerne');
  await page.locator('.trainer-footer-action').click();
  await expect(page.locator('.trainer-footer-action')).toHaveText('Выполнено');
  await showStudy(page, { ...card, id: 2, front: '@puzzle\nIch lerne Deutsch.' });
  await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
  await expect(page.locator('.card-front .text-back h1')).toHaveText('Перевод');
  await checkTables(page, page.locator('.card-front .text-back'));
  await expect(page.locator('.btn-puzzle-chip').first()).toBeEnabled();
  expect(errors).toEqual([]);
});

test('editor previews and list use Markdown while saved front/back/context remain exact', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  const editorCard = { ...card, front: '::future\r\nKEEP  EXACTLY\r\n@wordbank\r\n<<1>>' };
  await page.evaluate(async card => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().setEditingCard(card);
    useUiStore.getState().setView('editor');
  }, editorCard);
  await expect(page.locator('#card-editor-back')).toHaveValue(card.back);
  const backPreview = page.locator('.card-back-markdown-preview');
  const contextPreview = page.locator('.card-context-markdown-preview');
  await backPreview.locator('summary').click();
  await contextPreview.locator('summary').click();
  for (const width of [320, 375, 400, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkTables(page, backPreview);
    await checkTables(page, contextPreview);
    await page.screenshot({ path: testInfo.outputPath(`editor-markdown-${width}.png`), fullPage: true });
    await backPreview.screenshot({ path: testInfo.outputPath(`back-preview-${width}.png`) });
    await contextPreview.screenshot({ path: testInfo.outputPath(`context-preview-${width}.png`) });
  }
  await expect(page.locator('#tut-creator-front .card-markdown')).toHaveCount(0);
  const request = page.waitForRequest('**/api/cards/save');
  await page.getByRole('button', { name: /^Сохранить/ }).click();
  expect((await request).postDataJSON()).toMatchObject({ front: editorCard.front, back: card.back, context: card.context });
  await expect(page.locator('#card-item-1')).toBeVisible();
  for (const width of [320, 375, 400, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkTables(page, page.locator('#card-item-1 .back-min'));
  }
  expect(errors).toEqual([]);
});

test('free-text example from back or context keeps Markdown and the existing reveal gate', async ({ page, context }) => {
  const errors = await setup(page, context);
  await page.route('**/api/ai/evaluate-answer', route => route.fulfill({ json: {
    grading_policy: { mode: 'controlled_text', max_retries: 1 },
    result: { verdict: 'incorrect', accepted: false, evaluator: 'ai', error_type: 'meaning', hint: 'Попробуйте ещё раз.' },
  } }));
  for (const [index, back] of [markdown + unsafe, ''].entries()) {
    await showStudy(page, { ...card, id: index + 20, front: '@free\nSchreiben Sie einen Satz.', back });
    await expect(page.getByRole('button', { name: 'Показать пример ответа' })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Ваш ответ', exact: true }).fill('Meine Antwort.');
    await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
    await page.getByRole('button', { name: 'Показать пример ответа' }).click();
    const example = page.locator('.free-text-example');
    await expect(example.locator(back ? 'h1' : 'h2')).toHaveText(back ? 'Перевод' : 'Контекст');
    for (const width of [320, 375, 400, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await checkTables(page, example);
    }
  }
  expect(errors).toEqual([]);
});
