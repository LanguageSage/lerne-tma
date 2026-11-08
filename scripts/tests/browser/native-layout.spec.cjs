const { test, expect } = require('./isolated-fixture.cjs');
const fixture = JSON.parse(process.env.LERNE_LAYOUT_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --layout-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Loopback only');

test('ordered layout survives native study, editor JSON, offline save and PostgreSQL delivery', async ({ page, context }, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let offline = false;
  await context.addInitScript(token => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
    window.addEventListener('online', event => event.stopImmediatePropagation(), true);
  }, fixture.token);
  await context.route('**/api/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    if (offline) return route.abort('internetdisconnected');
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [fixture.deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    return route.fulfill({ response: await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 }) });
  });
  await page.goto('/');
  await expect(page.getByText(fixture.deck.name, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);
  await page.evaluate(async () => {
    (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
    window.api = (await import('/src/services/api.js')).default;
    window.db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    window.sync = () => import('/src/services/syncService.js').then(m => m.syncService.sync({ pendingNativeOnly: true }));
    (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ autoPlay: false, autoGenerateCardAudio: false });
  });
  const show = async (id, flipped = false) => page.evaluate(async ({ id, deck, flipped }) => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck, deckCards: [] });
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().resetSession();
    useSessionStore.getState().addToHistory((await api.get(`/study/card/${id}`)).data);
    useSessionStore.getState().setIsFlipped(flipped);
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('study');
  }, { id, deck: fixture.deck, flipped });
  for (const card of fixture.cards) {
    await show(card.id);
    const layout = page.locator('.structured-card-layout').first();
    await expect(layout.locator('[data-layout-id="intro"] strong')).toHaveText('Vor der Aufgabe.');
    await expect(layout.getByRole('img', { name: 'Haus im Garten' })).toBeVisible();
    expect(await layout.locator('[data-layout-id]').evaluateAll(nodes => nodes.map(node => node.dataset.layoutId))).toEqual(['intro', 'picture', 'exercise']);
    await expect(page.getByText('Nur nach der Antwort.', { exact: true })).toHaveCount(0);
  }
  const standard = fixture.cards.find(card => card.content_v2.card.type === 'standard');
  await show(standard.id, true);
  await expect(page.getByText('Nur nach der Antwort.', { exact: true })).toBeVisible();
  const quiz = fixture.cards.find(card => card.content_v2.card.type === 'quiz');
  await show(quiz.id);
  await page.locator('.quiz-container').getByText(quiz.content_v2.card.data.options.find(option => option.correct).text, { exact: true }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.getByText('Nur nach der Antwort.', { exact: true })).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await show(standard.id);
    await expect(page.getByRole('img', { name: 'Haus im Garten' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`layout-study-${width}.png`), fullPage: true });
    const sizes = await page.locator('.structured-card-layout').first().evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth,
      overflowing: [...node.querySelectorAll('*')].filter(child => child.scrollWidth > node.clientWidth + 1)
        .slice(0, 5).map(child => ({ tag: child.tagName, cls: child.className, width: child.clientWidth, scroll: child.scrollWidth })) }));
    expect(sizes.scroll, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.width + 1);
  }
  await page.evaluate(async ({ id, deck }) => {
    const card = (await api.get(`/cards/${id}`)).data;
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setEditingCard(card);
    (await import('/src/store/useUiStore.js')).useUiStore.setState({ view: 'editor', editorSourceView: 'decks' });
  }, { id: standard.id, deck: fixture.deck });
  const editor = page.locator('.card-layout-editor');
  await expect(editor.getByText('Порядок блоков', { exact: true })).toBeVisible();
  await editor.locator('[data-layout-editor-id="picture"]').getByRole('button', { name: 'Переместить вниз' }).click();
  await editor.getByRole('button', { name: 'Добавить текстовый блок' }).click();
  await editor.locator('.card-layout-row').last().getByRole('textbox').fill('**Neuer Text**\nZeile zwei.');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 60;
    const context = canvas.getContext('2d'); context.fillStyle = '#7d7cc9'; context.fillRect(0, 0, 120, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await editor.locator('input[type=file]').setInputFiles({ name: 'inline.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(editor.locator('.card-layout-row')).toHaveCount(6);
  await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
  const json = page.getByRole('textbox', { name: 'Полный content_v2 JSON' });
  const draft = JSON.parse(await json.inputValue());
  expect(draft.card.layout.slice(0, 3).map(item => item.id)).toEqual(['intro', 'exercise', 'picture']);
  expect(draft.card.data).toEqual(standard.content_v2.card.data);
  expect(draft.card.info.at(-1).text).toBe('**Neuer Text**\nZeile zwei.');
  await page.getByRole('button', { name: 'Типизированная форма', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: info.outputPath('layout-editor-375.png'), fullPage: true });
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(editor.getByRole('button', { name: 'Add text block', exact: true })).toBeVisible();
    expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`layout-editor-en-${width}.png`), fullPage: true });
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('ru'));
  await expect.poll(() => page.evaluate(() => db.media.count())).toBeGreaterThan(0);
  await context.setOffline(true); offline = true;
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  await expect.poll(() => page.evaluate(async id => (await db.cards.get(id))?.offline_edit?.status, standard.id)).toBe('pending');
  const saved = await page.evaluate(async id => (await db.cards.get(id)).content_v2, standard.id);
  expect(saved).toEqual(draft);
  await show(standard.id);
  await expect(page.getByRole('img', { name: 'Haus im Garten' })).toBeVisible();
  expect(await page.getByRole('img', { name: 'Haus im Garten' }).getAttribute('src')).toMatch(/^blob:/);
  await context.setOffline(false); offline = false;
  await expect.poll(() => page.evaluate(() => sync()), { timeout: 20000 }).toMatchObject({ success: true });
  const delivered = await page.evaluate(async id => (await api.get(`/cards/${id}`)).data.content_v2, standard.id);
  expect(delivered.card.layout).toEqual(draft.card.layout);
  expect(delivered.card.data).toEqual(draft.card.data);
  expect(delivered.card.info).toEqual(draft.card.info);
  expect(errors).toEqual([]);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});
