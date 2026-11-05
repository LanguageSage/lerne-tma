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

test('native editor keeps every card type and retains the draft after a conflict', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
  const saves = [];
  let current;
  let conflict = false;
  let generatedDraft;
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname.endsWith('/images/original.webp')) return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><rect width="4" height="2" fill="#395772"/></svg>' });
    if (pathname === '/api/cards/ai-generate') {
      generatedDraft = route.request().postDataJSON();
      return route.fulfill({ json: { content_v2: { schema_version: 2, card: { type: 'standard',
        data: { prompt: 'Ich lerne Deutsch', answer: 'Я учу немецкий' } } } } });
    }
    if (pathname === '/api/cards/1' && route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      saves.push(payload);
      if (conflict) return route.fulfill({ status: 409, json: { detail: { code: 'card_revision_conflict' } } });
      current = { ...current, content_v2: payload.content_v2, revision: 'server-' + saves.length };
      return route.fulfill({ json: current });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  async function open(card) {
    await page.evaluate(async ({ deck, card }) => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
      useSessionStore.getState().setEditingCard(card);
      useUiStore.setState({ editorSourceView: 'decks' });
      useUiStore.getState().setView('editor');
    }, { deck, card });
  }
  const contextField = page.locator('#card-editor-context');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  for (const [type, data] of Object.entries(types)) {
    const content = { type, data, info: [{ type: 'task', text: 'Information' }],
      level: 'B1', topics: ['one'], metadata: { extension: { arbitrary: [true, null] } } };
    current = { id: 1, deck_id: 1, revision: 'fixture-' + type,
      content_v2: { schema_version: 2, card: content }, image_path: 'images/original.webp' };
    const originalRevision = current.revision;
    await open(current);
    await expect(page.getByRole('combobox', { name: 'Тип карточки' })).toHaveValue(type);
    await contextField.fill('Edited ' + type);
    const request = page.waitForRequest(req => req.url().endsWith('/api/cards/1') && req.method() === 'PATCH');
    await save.click();
    const payload = (await request).postDataJSON();
    expect(payload.content_v2.card).toEqual({ ...content, explanation: 'Edited ' + type });
    expect(payload.revision).toEqual(originalRevision);
    expect(payload.image_path).toBe('images/original.webp');
    await expect(contextField).toHaveCount(0);
    await open(current);
    await expect(contextField).toHaveValue('Edited ' + type);
  }
  conflict = true;
  await contextField.fill('Retain draft');
  await save.click();
  await expect(page.getByText(/Карточка изменилась на сервере/)).toBeVisible();
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
  expect(generatedDraft.content_v2.card).toMatchObject({ type: 'standard', data: { prompt: 'Я учу немецкий' } });
  expect(errors).toEqual([]);
});
