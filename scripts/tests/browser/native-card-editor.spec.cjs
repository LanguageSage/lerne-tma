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
  const decks = server.decks ?? [deck];
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
    if (pathname === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/sync/v2/status') return route.fulfill({ json: { server_generation: 'a'.repeat(64), restored: false } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: server.cards ?? (server.card ? [server.card] : []) });
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
      folders: [], decks, cards: server.cards ?? (server.card ? [server.card] : []), progress: [],
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
    }, { deck: decks.find(item => item.id === deck.id) ?? deck, card, load });
  };
}

const cachedCard = page => page.evaluate(async () => (await (await import('/src/services/localDb.js')).prepareLocalDb()).cards.get(1));

test('cover height stays in the edit draft until save and updates deck metadata once', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const fixtureDeck = { ...deck, metadata: JSON.stringify({ imageHeight: 180, authored: 'preserve' }) };
  const card = { id: 1, deck_id: 1, revision: 'cover-height', image_path: 'images/original.webp',
    content_v2: { schema_version: 2, card: { type: 'standard', data: types.standard } } };
  const server = { card, decks: [fixtureDeck], saves: [] };
  const open = await setupEditor(page, context, server);
  const metadataWrites = [];
  await page.route('**/api/decks/1/metadata', route => {
    const metadata = route.request().postDataJSON();
    metadataWrites.push(metadata);
    fixtureDeck.metadata = JSON.stringify(metadata);
    return route.fulfill({ json: { metadata: fixtureDeck.metadata } });
  });
  const slider = page.locator('#tut-creator-front').getByRole('slider');
  const cover = page.locator('.image-preview-box img');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  const resize = async value => {
    await slider.fill(String(value));
    await slider.dispatchEvent('mouseup');
    await expect(cover).toHaveCSS('height', value + 'px');
  };

  await open(server.card, true);
  await expect(cover).toHaveCSS('height', '180px');
  await resize(260);
  await resize(300);
  await page.locator('.view-editor .back-btn').press('Enter');
  await expect(slider).toHaveCount(0);
  await open(server.card, true);
  expect(metadataWrites).toEqual([]);
  expect(server.saves).toEqual([]);
  await expect(cover).toHaveCSS('height', '180px');
  await resize(260);
  await slider.press('ArrowRight');
  await expect(cover).toHaveCSS('height', '270px');
  expect(metadataWrites).toEqual([]);
  await save.click();
  await expect(slider).toHaveCount(0);
  await expect.poll(() => server.saves.length).toBe(1);
  await expect.poll(() => metadataWrites).toEqual([{ imageHeight: 270, authored: 'preserve' }]);
  expect(server.saves[0]).not.toHaveProperty('draftImageHeight');
  expect(server.saves[0].image_path).toBe(card.image_path);
  await open(server.card, true);
  await expect(cover).toHaveCSS('height', '270px');
  await expect.poll(() => cover.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('.image-preview-box').screenshot({ path: testInfo.outputPath('cover-height-375.png') });
  await slider.press('ArrowRight');
  await slider.press('ArrowLeft');
  await save.click();
  await expect(slider).toHaveCount(0);
  await expect.poll(() => server.saves.length).toBe(2);
  expect(metadataWrites).toHaveLength(1);
});

test('cover height for a new card updates the selected destination deck', async ({ page, context }) => {
  const destination = { ...deck, id: 2, name: 'Destination', metadata: { imageHeight: 310, authored: 'destination' } };
  const server = { decks: [deck, destination], saves: [] };
  await setupEditor(page, context, server);
  const metadataWrites = [];
  await page.route('**/api/decks/*/metadata', route => {
    const metadata = route.request().postDataJSON();
    metadataWrites.push([new URL(route.request().url()).pathname, metadata]);
    return route.fulfill({ json: { metadata } });
  });
  await page.route('**/api/media/upload-image', route =>
    route.fulfill({ json: { path: 'images/original.webp', url: '/api/media/images/original.webp' } }));
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useUiStore.setState({ view: 'creator', editorSourceView: 'decks' });
  }, deck);
  const creator = page.locator('.view-creator');
  await creator.locator('select.form-input').first().selectOption('2');
  await page.locator('#card-editor-front').fill('Ein neues Bild');
  await page.getByText('Медиа и оформление', { exact: true }).click();
  await page.getByRole('button', { name: 'Картинка', exact: true }).click();
  await page.locator('.image-picker-dialog input[type=file]').first().setInputFiles({
    name: 'cover.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'),
  });
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.locator('.image-preview-box img')).toHaveCSS('height', '310px');
  await expect(page.locator('.image-picker-dialog')).toHaveCount(0);
  await creator.locator('#tut-creator-front').getByRole('slider').fill('350');
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  await expect(creator).toHaveCount(0);
  expect(server.saves[0]).toMatchObject({ deck_id: 2, image_path: 'images/original.webp' });
  await expect.poll(() => metadataWrites).toEqual([['/api/decks/2/metadata', { imageHeight: 350, authored: 'destination' }]]);
});

test('Share sends Native V2 content through the share sheet and still copies the link on desktop', async ({ page, context }) => {
  await setupEditor(page, context, { saves: [] });
  await page.route('**/api/share/generate/card/1', route => route.fulfill({ json: { share_id: 'native-fixture' } }));
  const showShare = (type, data, desktop = false) => page.evaluate(async ({ type, data, desktop, deck }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const card = { id: 1, deck_id: 1, front: 'legacy front', back: 'legacy back',
      content_v2: { schema_version: 2, card: { type, data } } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: desktop ? { writeText: async url => { window.copiedLink = url; } } : undefined });
    Object.defineProperty(navigator, 'share', { configurable: true,
      value: async payload => { window.sharePayload = payload; } });
    window.sharePayload = null;
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useUiStore.setState({ actionCard: card, isCardActionModalOpen: true });
  }, { type, data, desktop, deck });

  const link = 'https://t.me/LerneDeutsch287_bot?start=native-fixture';
  for (const [type, title, text] of [
    ['standard', 'Haus', 'Haus — дом'],
    ['puzzle', 'Das ist ein Haus', 'Das ist ein Haus — Это дом'],
    ['word_bank', 'Haus', 'Haus'],
  ]) {
    await showShare(type, types[type]);
    await page.getByText('Поделиться', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sharePayload)).toEqual({
      title: 'Учи слово в Lerne: ' + title,
      text: 'Изучай немецкий язык с карточкой: "' + text + '"',
      url: link,
    });
  }
  await showShare('standard', types.standard, true);
  await page.getByText('Поделиться', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.copiedLink)).toBe(link);
  expect(await page.evaluate(() => window.sharePayload)).toBeNull();
});

test('auto CEFR updates the editor draft synchronously and keeps the fallback for unsupported languages', async ({ page, context }) => {
  const englishDeck = { ...deck, id: 2, name: 'English fixture', target_language: 'en' };
  const open = await setupEditor(page, context, { decks: [deck, englishDeck], saves: [] });
  const prompt = 'Obwohl er krank war, hätte er arbeiten müssen, wenn es erforderlich gewesen wäre.';
  const card = { id: 1, deck_id: 1, revision: 'cefr-fixture', content_v2: { schema_version: 2, card: {
    type: 'standard', level: 'A1', data: { prompt, answer: '' },
  } } };

  for (const [deck_id, target_language] of [[2, ' DE '], [1, undefined], [2, 'en']]) {
    await open({ ...card, deck_id, target_language });
    await page.getByTitle('Ручная смена уровня CEFR').click();
    const result = await page.getByRole('button', { name: /Авто \(распознать\)/ }).evaluate(async (button, phrase) => {
      const { useSessionStore } = await import('/src/store/useSessionStore.js');
      const { classifySentenceFast } = await import('/src/services/classifier/index.js');
      const expected = classifySentenceFast(phrase, 'de').level;
      button.click();
      const { level, metadata } = useSessionStore.getState().editingCard.content_v2.card;
      return { level, expected, source: metadata?.cefr?.source };
    }, prompt);
    expect(result.expected).not.toBe('A1');
    expect(result).toEqual({ level: result.expected, expected: result.expected, source: 'local' });
  }
});

async function setupOfflineStudy(page, context, { emptyDeckCards = false, historyIndices = [0], offline = true, initialView = 'study' } = {}) {
  const source = { ...deck, folder_id: null, stats: { total: 2 } };
  const destination = { ...deck, id: 2, folder_id: null, name: 'Destination', stats: { total: 0 } };
  const cards = ['Erste Karte', 'Nächste Karte'].map((prompt, index) => ({
    id: index + 1, deck_id: 1, position: index + 1, revision: 'a'.repeat(64),
    content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt, answer: '' } } },
  }));
  const startupPull = page.waitForResponse(response => response.url().includes('/api/sync/v2/pull') && response.ok());
  await setupEditor(page, context, { card: cards[0], cards, decks: [source, destination], saves: [] });
  await startupPull;
  await page.evaluate(async ({ source, destination, cards, emptyDeckCards, historyIndices, offline, initialView }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    await navigator.locks.request('lerne-offline-sync', () => {});
    await useDeckStore.getState().getPendingLibraryLoad('decks');
    const db = await prepareLocalDb();
    await db.decks.bulkPut([source, destination]);
    await db.cards.bulkPut(cards);
    if (offline) Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    useSettingsStore.setState({ autoPlay: false });
    useDeckStore.setState({
      decks: [source, destination],
      currentDeck: source,
      deckCards: emptyDeckCards ? [] : cards,
    });
    const session = useSessionStore.getState();
    session.resetSession();
    for (const index of historyIndices) session.addToHistory(cards[index]);
    useUiStore.getState().setView(initialView);
  }, { source, destination, cards, emptyDeckCards, historyIndices, offline, initialView });
  return { cards };
}

async function runCardActionFromModal(page, action) {
  const dialog = page.getByRole('dialog', { name: 'Управление карточкой' });
  if (action === 'move') {
    await dialog.getByRole('button', { name: 'Перенести в другую колоду' }).click();
    await dialog.getByRole('button', { name: /Destination/ }).click();
  } else {
    await dialog.getByRole('button', { name: /Удалить карточку/ }).click();
  }
}

for (const action of ['move', 'delete']) {
  test(`Study continues with the next card after ${action} from card actions`, async ({ page, context }) => {
    await setupOfflineStudy(page, context);
    await page.locator('.study-card-actions-button').click();
    await runCardActionFromModal(page, action);
    await expect.poll(() => page.evaluate(async () =>
      (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card?.id)).toBe(2);
    await expect(page.locator('#tut-study-card')).toContainText('Nächste Karte');
  });

  test(`Study continues without preloaded deckCards and finishes after last ${action}`, async ({ page, context }) => {
    await setupOfflineStudy(page, context, { emptyDeckCards: true });
    await page.locator('.study-card-actions-button').click();
    await runCardActionFromModal(page, action);
    await expect.poll(() => page.evaluate(async () =>
      (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card?.id)).toBe(2);
    await expect(page.locator('#tut-study-card')).toContainText('Nächste Karte');

    await page.locator('.study-card-actions-button').click();
    await runCardActionFromModal(page, action);
    await expect.poll(() => page.evaluate(async () => {
      const s = (await import('/src/store/useSessionStore.js')).useSessionStore.getState();
      return { id: s.card?.id ?? null, finished: s.isSessionFinished };
    })).toEqual({ id: null, finished: true });
    await expect(page.getByRole('heading', { name: 'На сегодня всё выполнено' })).toBeVisible();
  });

  test(`Study keeps active card when a non-current card undergoes ${action}`, async ({ page, context }) => {
    const { cards } = await setupOfflineStudy(page, context, { historyIndices: [0, 1] });
    await page.evaluate(async ({ card }) => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useUiStore.setState({ actionCard: card, isCardActionModalOpen: true });
    }, { card: cards[0] });
    await runCardActionFromModal(page, action);
    await expect.poll(() => page.evaluate(async () => {
      const s = (await import('/src/store/useSessionStore.js')).useSessionStore.getState();
      const d = (await import('/src/store/useDeckStore.js')).useDeckStore.getState();
      return {
        cardId: s.card?.id ?? null,
        finished: s.isSessionFinished,
        historyIds: s.studyHistory.map(c => c.id),
        deckCardIds: d.deckCards.map(c => c.id),
      };
    })).toEqual({ cardId: 2, finished: false, historyIds: [2], deckCardIds: [2] });
    await expect(page.locator('#tut-study-card')).toContainText('Nächste Karte');
  });
}

test('delayed delete does not close another card editor or a new session', async ({ page, context }) => {
  const { cards } = await setupOfflineStudy(page, context, { offline: false });
  let releaseDelete;
  const deleteGate = new Promise(resolve => { releaseDelete = resolve; });
  const deleteRequest = page.waitForRequest('**/api/cards/batch-delete');
  await page.route('**/api/cards/batch-delete', async route => {
    await deleteGate;
    await route.fulfill({ json: { status: 'success', card: { ...cards[0], is_deleted: true, revision: 'b'.repeat(64) } } });
  });

  await page.locator('.study-card-actions-button').click();
  await runCardActionFromModal(page, 'delete');
  await deleteRequest;

  await page.evaluate(async ({ nextCard }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const session = useSessionStore.getState();
    session.resetSession();
    session.addToHistory(nextCard);
    session.openEditingCard(nextCard);
    useUiStore.setState({ editorSourceView: 'study', view: 'editor' });
  }, { nextCard: cards[1] });
  await expect(page.locator('#card-editor-front')).toHaveValue('Nächste Karte');

  const deleteResponse = page.waitForResponse('**/api/cards/batch-delete');
  releaseDelete();
  await deleteResponse;
  await expect.poll(() => page.evaluate(async () =>
    (await import('/src/store/useUiStore.js')).useUiStore.getState().loading)).toBe(false);

  await expect(page.locator('#card-editor-front')).toHaveValue('Nächste Karte');
  expect(await page.evaluate(async () => {
    const s = (await import('/src/store/useSessionStore.js')).useSessionStore.getState();
    const u = (await import('/src/store/useUiStore.js')).useUiStore.getState();
    return { view: u.view, editingId: s.editingCard?.id ?? null, studyCardId: s.card?.id ?? null };
  })).toEqual({ view: 'editor', editingId: 2, studyCardId: 2 });
});

test('deleting current card from Study editor awaits history back before loading next card', async ({ page, context }) => {
  const { cards } = await setupOfflineStudy(page, context, { offline: false, initialView: 'cards' });
  await expect(page.locator('.view-cards')).toBeVisible();
  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const ui = useUiStore.getState();
    ui.setStudySourceView('cards');
    ui.setView('study');
  });
  await expect(page.locator('#tut-study-card')).toBeVisible();
  await page.evaluate(async ({ card }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const ui = useUiStore.getState();
    ui.setEditorSourceView('study');
    useSessionStore.getState().openEditingCard(card);
    ui.setView('editor');
    window.history.pushState({ level: 3, view: 'editor', folderId: null, modalOpen: false }, '');
    const reactUrl = performance.getEntriesByType('resource').find(r => /\/node_modules\/\.vite\/deps\/react\.js/.test(r.name))?.name;
    const reactDomUrl = performance.getEntriesByType('resource').find(r => /\/node_modules\/\.vite\/deps\/react-dom_client\.js/.test(r.name))?.name;
    const [reactMod, reactDomMod, { useCardActions }] = await Promise.all([
      import(reactUrl),
      import(reactDomUrl),
      import('/src/hooks/useCardActions.js'),
    ]);
    const React = reactMod.default ?? reactMod;
    const ReactDOM = reactDomMod.default ?? reactDomMod;
    const host = document.createElement('div');
    document.body.appendChild(host);
    function DeleteTrigger() {
      const { handleDeleteCard } = useCardActions();
      return React.createElement('button', {
        type: 'button',
        'data-testid': 'test-editor-delete-trigger',
        onClick: () => { void handleDeleteCard(card.id, true); },
      }, 'Delete');
    }
    ReactDOM.createRoot(host).render(React.createElement(DeleteTrigger));
  }, { card: cards[0] });
  await expect(page.locator('#card-editor-front')).toHaveValue('Erste Karte');

  await page.route('**/api/cards/batch-delete', route => route.fulfill({
    json: { status: 'success', card: { ...cards[0], is_deleted: true, revision: 'b'.repeat(64) } },
  }));
  let releaseNext;
  const nextGate = new Promise(resolve => { releaseNext = resolve; });
  const nextRequested = page.waitForRequest(req => new URL(req.url()).pathname === '/api/decks/1/next');
  await page.route('**/api/decks/1/next*', async route => {
    await nextGate;
    await route.fulfill({ json: cards[1] });
  });

  await page.getByTestId('test-editor-delete-trigger').click();
  await expect.poll(() => page.evaluate(async () =>
    (await import('/src/store/useUiStore.js')).useUiStore.getState().view)).toBe('study');
  await nextRequested;
  releaseNext();

  await expect.poll(() => page.evaluate(async () =>
    (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card?.id)).toBe(2);
  await expect(page.locator('#tut-study-card')).toContainText('Nächste Karte');

  await page.locator('.view-study .back-btn').press('Enter');
  await expect.poll(() => page.evaluate(async () => ({
    view: (await import('/src/store/useUiStore.js')).useUiStore.getState().view,
    historyView: window.history.state?.view ?? null,
  }))).toEqual({ view: 'cards', historyView: 'cards' });
});

test('cover upload attaches to the latest draft after a delayed response', async ({ page, context }) => {
  const card = { id: 1, deck_id: 1, revision: 'cover-fixture', content_v2: { schema_version: 2,
    card: { type: 'standard', data: types.standard, explanation: 'Earlier context' } } };
  const open = await setupEditor(page, context, { card, saves: [] });
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/media/upload-image', async route => {
    await response;
    await route.fulfill({ json: { path: 'images/original.webp', url: '/api/media/images/original.webp' } });
  });
  await open(card);
  await page.getByText('Медиа и оформление', { exact: true }).click();
  await page.getByRole('button', { name: 'Картинка', exact: true }).click();
  await page.locator('.image-picker-dialog input[type=file]').first().setInputFiles({
    name: 'cover.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'),
  });
  const upload = page.waitForRequest('**/api/media/upload-image');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await upload;
  await page.locator('#card-editor-context').fill('Newest context');
  await page.locator('#card-editor-front').fill('Ein neues Haus');
  finish();
  await expect(page.locator('.image-preview-box img')).toBeVisible();
  await expect(page.locator('#card-editor-context')).toHaveValue('Newest context');
  await expect(page.locator('#card-editor-front')).toHaveValue('Ein neues Haus');
});

test('inline upload waits for valid source and an invalid image caption can be corrected', async ({ page, context }) => {
  const card = { id: 1, deck_id: 1, revision: 'image-layout-fixture', content_v2: { schema_version: 2,
    card: { type: 'standard', data: types.standard } } };
  const open = await setupEditor(page, context, { card, saves: [] });
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/media/upload-image', async route => {
    await response;
    await route.fulfill({ json: { path: 'images/original.webp' } });
  });
  await open(card);
  await page.getByText('Изображения', { exact: true }).click();
  const upload = page.waitForRequest('**/api/media/upload-image');
  await page.locator('.card-layout-editor input[type=file]').setInputFiles({
    name: 'layout.webp', mimeType: 'image/webp', buffer: Buffer.from('synthetic image'),
  });
  await upload;
  await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Полный content_v2 JSON' });
  const invalid = structuredClone(card.content_v2);
  invalid.card.layout = [{ id: 'exercise', type: 'exercise' },
    { id: 'existing', type: 'image', path: 'images/original.webp', caption: { ru: 'Подпись' } }];
  const literal = JSON.stringify(invalid);
  await source.fill(literal);
  await expect(source).toHaveAttribute('aria-invalid', 'true');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await expect(save).toBeDisabled();
  finish();
  await expect(page.getByText('Загруженные изображения будут добавлены после исправления JSON.')).toBeVisible();
  await expect(source).toHaveValue(literal);

  invalid.card.layout[1].caption = 'Подпись';
  invalid.card.data.prompt = 'Korrigierte Frage';
  await source.fill(JSON.stringify(invalid));
  await expect(save).toBeEnabled();
  await expect(source).not.toHaveAttribute('aria-invalid', 'true');
  const corrected = JSON.parse(await source.inputValue());
  expect(corrected.card.data.prompt).toBe('Korrigierte Frage');
  expect(corrected.card.layout.map(item => [item.type, item.path, item.caption])).toEqual([
    ['exercise', undefined, undefined], ['image', 'images/original.webp', 'Подпись'], ['image', 'images/original.webp', ''],
  ]);
  await page.getByRole('button', { name: 'Типизированная форма', exact: true }).click();
  await expect(page.locator('.visual-card-editor-layout figure')).toHaveCount(2);
});

test('Standard visual editor creates, reopens and edits the same draft online and offline', async ({ page, context }, testInfo) => {
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const errors = [];
  const validations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().endsWith('/api/cards/validate')) validations.push(request.url());
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
  }, deck);
  const typeField = page.getByRole('combobox', { name: 'Тип карточки' });
  await expect(typeField).toHaveCount(1);
  await expect(typeField).toHaveValue('standard');
  const front = 'Was hast du gestern gemacht?';
  const back = 'Ich habe gestern **Deutsch** gelernt.';
  const frontField = page.locator('#card-editor-front');
  const backField = page.locator('#card-editor-back');
  await frontField.fill(front);
  await backField.fill(back);

  const insert = page.getByRole('button', { name: 'Добавить текстовый блок', exact: true });
  const block = position => page.locator(`[data-layout-position="${position}"]`);
  await insert.first().click();
  const hint = 'Ответьте одним предложением в Perfekt.';
  await expect(block(0).getByRole('textbox')).toBeFocused();
  await block(0).getByRole('textbox').fill(hint);
  await block(0).getByRole('combobox', { name: 'Роль блока' }).selectOption('source');
  const [hintId, exerciseId] = await editorOrder(page);
  const handle = page.getByRole('button', { name: 'Переместить блок', exact: true });
  await handle.first().press('ArrowDown');
  await expect.poll(() => editorOrder(page)).toEqual([exerciseId, hintId]);
  await expect(handle.last()).toBeFocused();
  await handle.last().scrollIntoViewIfNeeded();
  const from = await handle.last().boundingBox();
  const to = await handle.first().boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => editorOrder(page)).toEqual([hintId, exerciseId]);
  await insert.nth(1).click();
  await block(1).getByRole('textbox').fill('Löschen?');
  await block(1).locator('summary').click();
  const remove = block(1).getByRole('button', { name: 'Удалить блок', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  await expect(block(1).getByRole('textbox')).toHaveValue('Löschen?');
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect.poll(() => editorOrder(page)).toEqual([hintId, exerciseId]);

  const topics = page.locator('.visual-card-topics');
  await topics.locator('summary').click();
  await topics.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await topics.getByRole('textbox', { name: 'Тема 1', exact: true }).fill('Perfekt');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect(frontField).toHaveCount(0);
  expect(server.saves).toHaveLength(1);
  expect(server.card.content_v2.card).toMatchObject({ type: 'standard', data: { prompt: front, answer: back },
    info: [{ type: 'source', text: hint }], topics: ['Perfekt'] });
  expect(server.card.content_v2.card.layout.map(item => item.id)).toEqual([hintId, exerciseId]);

  await open(server.card, true);
  await expect(frontField).toHaveValue(front);
  await expect(backField).toHaveValue(back);
  const backSide = page.locator('.visual-card-form-back');
  await expect(backSide.locator('.visual-card-inline-display strong')).toHaveText('Deutsch');
  await expect(backField).toBeVisible();
  await topics.locator('summary').click();
  await expect(topics.getByRole('textbox', { name: 'Тема 1', exact: true })).toHaveValue('Perfekt');
  await topics.locator('summary').click();
  await expect(page.getByRole('textbox', { name: 'Контекст', exact: true })).toBeVisible();
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeHidden({ timeout: 8000 });
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.visual-card-editor-layout').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (width === 375 || width === 1280) {
      await page.locator('.visual-card-editor-surface').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`standard-${width}.png`) });
      await backSide.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`standard-back-${width}.png`) });
    }
  }
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    useSettingsStore.getState().setPersonalDesignV2(normalizeDesignConfig({
      front: { mainText: { font: 'monospace', color: '#f1dca7', style: 'italic' }, card: { background: '#123456' } },
      back: { answerText: { font: 'serif', color: '#cceeaa' }, card: { background: '#234567' } },
    }));
  });
  await expect(frontField).toHaveCSS('font-family', 'monospace');
  await expect(frontField).toHaveCSS('font-style', 'italic');
  await expect(backField).toHaveCSS('color', 'rgb(204, 238, 170)');
  await expect(page.locator('#tut-creator-front .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(backSide.locator('.bg-v2')).toHaveCSS('background-color', 'rgb(35, 69, 103)');
  await context.setOffline(true);
  const longAnswer = `${back}\n${'Donaudampfschifffahrtsgesellschaft'.repeat(8)}`;
  await backField.fill(longAnswer);
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  expect(server.saves).toHaveLength(1);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(backField).toHaveValue(longAnswer);
  expect(validations).toEqual([]);
  expect(errors).toEqual([]);
});

test('Theory visual editor preserves Markdown, layout and topics through online and offline saves', async ({ page, context }, testInfo) => {
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
  }, deck);
  const type = page.getByRole('combobox', { name: 'Тип карточки' });
  await expect(type).toHaveCount(1);
  await type.selectOption('theory');
  const text = '## Порядок слов после *weil*\n\nГлагол стоит в конце придаточного предложения.\n\n**Примеры:**\n\n- Ich lerne Deutsch, **weil** ich in Deutschland arbeite.\n- Ich bleibe zu Hause, **weil** ich krank bin.';
  const summary = 'После **weil** глагол стоит в конце.';
  const example = 'Причина и её объяснение.';
  const theory = page.getByRole('textbox', { name: 'Теоретический текст', exact: true });
  const conclusion = page.getByRole('textbox', { name: 'Краткий вывод', exact: true });
  await theory.fill(text);
  await conclusion.fill(summary);
  const insert = page.getByRole('button', { name: 'Добавить текстовый блок', exact: true });
  await insert.last().click();
  const newBlock = page.locator('[data-layout-position="1"]');
  await expect(newBlock.getByRole('textbox')).toBeFocused();
  await newBlock.getByRole('textbox').fill(example);
  await newBlock.getByRole('combobox', { name: 'Роль блока' }).selectOption('example');
  const order = await editorOrder(page);
  const topics = page.locator('.visual-card-topics');
  await topics.locator('summary').click();
  await topics.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await topics.getByRole('textbox', { name: 'Тема 1', exact: true }).fill('Nebensätze');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect(theory).toHaveCount(0);
  const saved = server.card.content_v2.card;
  expect(saved).toMatchObject({ type: 'theory', data: { text, summary }, topics: ['Nebensätze'],
    info: [{ type: 'example', text: example }] });
  expect(saved.layout.map(item => item.id)).toEqual(order);

  await open(server.card, true);
  await expect(theory).toHaveValue(text);
  await expect(conclusion).toHaveValue(summary);
  await expect(page.locator('.visual-card-inline-display h2 em')).toHaveText('weil');
  await expect(page.locator('.visual-card-inline-display li')).toHaveCount(2);
  const backSide = page.locator('.visual-card-form-back');
  await expect(backSide.locator('.visual-card-inline-display strong')).toHaveText('weil');
  const contextField = page.getByRole('textbox', { name: 'Контекст', exact: true });
  const explanation = 'Союз выражает причину.\n' + 'Придаточное предложение заканчивается глаголом.\n'.repeat(10);
  await expect(contextField).toBeVisible();
  await contextField.fill(explanation);
  const frontSide = page.locator('.visual-card-editor-surface');
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeHidden({ timeout: 8000 });
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('.visual-card-editor-layout').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375 || width === 1280) {
      await frontSide.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`theory-${width}.png`) });
      await backSide.screenshot({ path: testInfo.outputPath(`theory-back-${width}.png`) });
    }
  }

  await context.setOffline(true);
  const longText = `${text}\n\n${'Donaudampfschifffahrtsgesellschaft'.repeat(8)}\n\n${'Ein langer Absatz.\n\n'.repeat(16)}`;
  await theory.fill(longText);
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  expect(server.saves).toHaveLength(1);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(theory).toHaveValue(longText);
  await expect(conclusion).toHaveValue(summary);
  await expect(contextField).toHaveValue(explanation);
  expect(await editorOrder(page)).toEqual(order);
  await topics.locator('summary').click();
  await expect(topics.getByRole('textbox', { name: 'Тема 1', exact: true })).toHaveValue('Nebensätze');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await frontSide.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect.poll(() => contextField.evaluate(field => field.scrollHeight <= field.clientHeight + 1)).toBe(true);
  expect(errors).toEqual([]);
});

const matchRows = [
  ['der Arzt', 'врач'], ['die Schule', 'школа'], ['der Beruf', 'профессия'], ['das Krankenhaus', 'больница'],
];
const pairValues = page => page.locator('.match-editor-pair').evaluateAll(rows =>
  rows.map(row => Array.from(row.querySelectorAll('textarea'), field => field.value)));

test('Match visual editor links, reorders and saves complete pairs online and offline', async ({ page, context }, testInfo) => {
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
  }, deck);
  const type = page.getByRole('combobox', { name: 'Тип карточки' });
  await expect(type).toHaveCount(1);
  await type.selectOption('match');
  const field = (side, index) => page.getByRole('textbox', { name: `${side} ${index + 1}`, exact: true });
  const add = page.getByRole('button', { name: 'Добавить пару', exact: true });
  const remove = index => page.getByRole('button', { name: `Удалить пару ${index + 1}`, exact: true });
  const handle = index => page.getByRole('button', { name: `Переместить пару ${index + 1}`, exact: true });
  await expect(remove(1)).toBeDisabled();
  for (const [index, [left, right]] of matchRows.entries()) {
    if (index >= 2) {
      await add.click();
      await expect(field('Слева', index)).toBeFocused();
    }
    await field('Слева', index).fill(left);
    await field('Справа', index).fill(right);
  }
  await handle(0).press('ArrowDown');
  await expect(handle(1)).toBeFocused();
  await expect.poll(() => pairValues(page)).toEqual([matchRows[1], matchRows[0], ...matchRows.slice(2)]);
  await handle(1).scrollIntoViewIfNeeded();
  const from = await handle(1).boundingBox();
  const to = await handle(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => pairValues(page)).toEqual(matchRows);
  await add.click();
  await field('Слева', 4).fill('Löschen?');
  page.once('dialog', dialog => dialog.dismiss());
  await remove(4).click();
  await expect(field('Слева', 4)).toHaveValue('Löschen?');
  page.once('dialog', dialog => dialog.accept());
  await remove(4).click();
  await expect.poll(() => pairValues(page)).toEqual(matchRows);

  const task = 'Сопоставьте слова и их значения.';
  await page.getByRole('button', { name: 'Добавить текстовый блок', exact: true }).first().click();
  const info = page.locator('[data-layout-position="0"]');
  await info.getByRole('textbox').fill(task);
  await info.getByRole('combobox', { name: 'Роль блока' }).selectOption('task');
  const order = await editorOrder(page);
  const back = page.locator('#card-editor-back');
  const note = 'Примеры употребления слов в предложениях.';
  await back.fill(note);
  const topics = page.locator('.visual-card-topics');
  await topics.locator('summary').click();
  await topics.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await topics.getByRole('textbox', { name: 'Тема 1', exact: true }).fill('Berufe');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect(back).toHaveCount(0);
  const saved = server.card.content_v2.card;
  expect(saved).toMatchObject({ type: 'match', data: { back_note: note,
    pairs: matchRows.map(([left, right]) => ({ left, right })) }, topics: ['Berufe'], info: [{ type: 'task', text: task }] });
  expect(saved.layout.map(item => item.id)).toEqual(order);

  await open(server.card, true);
  await expect.poll(() => pairValues(page)).toEqual(matchRows);
  await expect(back).toHaveValue(note);
  await expect(page.locator('.match-editor .match-item[data-design-state="correct"]')).toHaveCount(8);
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeHidden({ timeout: 8000 });
  const frontSide = page.locator('.visual-card-editor-surface');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await frontSide.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (width === 375 || width === 1280) {
      await frontSide.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`match-${width}.png`) });
      await page.locator('.visual-card-form-back').screenshot({ path: testInfo.outputPath(`match-back-${width}.png`) });
    }
  }
  await context.setOffline(true);
  const longText = 'Straßenbahnfahrkartenverkaufsstelle'.repeat(8);
  await field('Слева', 3).fill(longText);
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  expect(server.saves).toHaveLength(1);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  expect(await pairValues(page)).toEqual([...matchRows.slice(0, 3), [longText, matchRows[3][1]]]);
  expect(await editorOrder(page)).toEqual(order);
  await topics.locator('summary').click();
  await expect(topics.getByRole('textbox', { name: 'Тема 1', exact: true })).toHaveValue('Berufe');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await frontSide.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('Match pair drag on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
  test('keeps both sides attached and the exercise in its layout position', async ({ page, context }) => {
    const server = { saves: [] };
    const open = await setupEditor(page, context, server);
    await open({ id: 1, deck_id: 1, revision: 'fixture-match',
      content_v2: { schema_version: 2, card: { type: 'match',
        data: { pairs: matchRows.map(([left, right]) => ({ left, right })) }, info: [{ type: 'task', text: 'Task' }] } } });
    const order = await editorOrder(page);
    const start = page.getByRole('button', { name: 'Переместить пару 1', exact: true });
    const end = page.getByRole('button', { name: 'Переместить пару 2', exact: true });
    // Keep the drop target away from the viewport edge: dnd-kit auto-scrolls there and shifts the target.
    await start.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await expect(start).toHaveCSS('min-width', '44px');
    const from = await start.boundingBox();
    const to = await end.boundingBox();
    const session = await context.newCDPSession(page);
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const progress of [.15, .4, .65, 1]) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x, y: y + (to.y + to.height / 2 - y) * progress }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => pairValues(page)).toEqual([matchRows[1], matchRows[0], ...matchRows.slice(2)]);
    expect(await editorOrder(page)).toEqual(order);
  });
});

test('FreeText visual editor saves the sample, variants and grading rules without loss', async ({ page, context }, testInfo) => {
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const evaluationRequests = [];
  page.on('request', request => {
    if (/\/(evaluate-answer|cards\/validate)$/.test(new URL(request.url()).pathname)) evaluationRequests.push(request.url());
  });
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
  }, deck);
  const type = page.getByRole('combobox', { name: 'Тип карточки' });
  await expect(type).toHaveCount(1);
  await type.selectOption('free_text');
  const prompt = 'Напишите 4–5 предложений о своём рабочем дне.';
  const sample = '**Zuerst** stehe ich um sieben Uhr auf. Dann frühstücke ich und fahre zur Arbeit.';
  const front = page.locator('#card-editor-front');
  const back = page.getByRole('textbox', { name: 'Образец ответа', exact: true });
  const contextField = page.getByRole('textbox', { name: 'Контекст', exact: true });
  await front.fill(prompt);
  await back.fill(sample);
  await contextField.fill('Тема для практики письма.');
  await page.getByRole('button', { name: 'Добавить текстовый блок', exact: true }).last().click();
  const info = page.locator('[data-layout-position="1"]');
  await info.getByRole('textbox').fill('Используйте: zuerst, dann, danach, am Abend.');
  await info.getByRole('combobox', { name: 'Роль блока' }).selectOption('source');
  const order = await editorOrder(page);
  const topics = page.locator('.visual-card-topics');
  await topics.locator('summary').click();
  await topics.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await topics.getByRole('textbox', { name: 'Тема 1', exact: true }).fill('Alltag');

  const settings = page.locator('.answer-grading');
  const summary = settings.locator('summary');
  const rule = name => settings.getByRole('combobox', { name, exact: true });
  const variant = index => settings.getByRole('textbox', { name: `Вариант ответа ${index}`, exact: true });
  await expect(rule('Режим проверки')).toBeHidden();
  expect(await settings.evaluate(section =>
    Boolean(section.compareDocumentPosition(document.querySelector('.visual-card-topics')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await summary.click();
  await expect(rule('Режим проверки')).toHaveValue('open_text');
  const answers = ['Ich stehe früh auf.\nDann frühstücke ich.', 'Mein Tag beginnt um sieben Uhr.'];
  for (const [index, answer] of answers.entries()) {
    await settings.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
    await variant(index + 1).fill(answer);
  }
  await settings.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
  await variant(3).fill('Ein entfernter Entwurf.');
  await settings.getByRole('button', { name: 'Удалить вариант 3', exact: true }).click();
  await expect(variant(3)).toHaveCount(0);
  const options = [
    ['Режим проверки', 'mode', 'controlled_text'],
    ['Допускать опечатки', 'typo_tolerance', false],
    ['Принимать ответы с тем же смыслом', 'semantic_equivalence', true],
    ['Просить исправить грамматику', 'grammar_requires_retry', false],
    ['Учитывать регистр', 'case_sensitive', true],
    ['Учитывать пунктуацию', 'punctuation_sensitive', false],
    ['Лимит попыток', 'max_retries', 4],
  ];
  for (const [label, , value] of options) await rule(label).selectOption(String(value));
  const policy = Object.fromEntries(options.map(([, field, value]) => [field, value]));
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect(front).toHaveCount(0);
  const saved = server.card.content_v2.card;
  expect(saved).toMatchObject({ type: 'free_text', data: { prompt, sample_answer: sample,
    accepted_answers: answers, grading_policy: policy }, topics: ['Alltag'] });
  expect(saved.layout.map(item => item.id)).toEqual(order);

  await open(server.card, true);
  await expect(front).toHaveValue(prompt);
  await expect(back).toHaveValue(sample);
  await expect(back).toBeVisible();
  await expect(contextField).toBeVisible();
  await expect(contextField).toHaveValue('Тема для практики письма.');
  await expect(page.locator('.visual-card-form-back .visual-card-inline-display strong')).toHaveText('Zuerst');
  await expect(settings).not.toHaveAttribute('open', '');
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeHidden({ timeout: 8000 });
  const surface = page.locator('.visual-card-editor-surface');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (width === 375 || width === 1280) {
      await surface.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`free-text-${width}.png`) });
      await page.locator('.visual-card-form-back').screenshot({ path: testInfo.outputPath(`free-text-back-${width}.png`) });
    }
  }
  await summary.click();
  await expect(variant(1)).toHaveValue(answers[0]);
  for (const [label, , value] of options) await expect(rule(label)).toHaveValue(String(value));
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await settings.screenshot({ path: testInfo.outputPath('free-text-grading-375.png') });
  await context.setOffline(true);
  await rule('Лимит попыток').selectOption('5');
  await variant(2).fill('Ein neuer Beispielsatz.');
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  expect(server.saves).toHaveLength(1);
  const cached = await cachedCard(page);
  expect(cached.content_v2.card).toEqual({ ...saved, data: { ...saved.data,
    accepted_answers: [answers[0], 'Ein neuer Beispielsatz.'], grading_policy: { ...policy, max_retries: 5 } } });
  await open(cached);
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await summary.click();
  await expect(variant(2)).toHaveValue('Ein neuer Beispielsatz.');
  await expect(rule('Лимит попыток')).toHaveValue('5');
  expect(evaluationRequests).toEqual([]);
});

test('EditableText edits source and correction in place and preserves grading through offline reopening', async ({ page, context }, testInfo) => {
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const checks = [];
  page.on('request', request => {
    if (/\/(evaluate-answer|cards\/validate)$/.test(new URL(request.url()).pathname)) checks.push(request.url());
  });
  await page.evaluate(async deck => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
  }, deck);
  const type = page.getByRole('combobox', { name: 'Тип карточки' });
  await expect(type).toHaveCount(1);
  await type.selectOption('editable_text');
  const source = page.getByRole('textbox', { name: 'Исходный текст', exact: true });
  const correction = page.getByRole('textbox', { name: 'Исправленный текст', exact: true });
  const contextField = page.getByRole('textbox', { name: 'Контекст', exact: true });
  const sourceText = 'Ich bin gestern zu Hause sein.\nAm Abend ich lerne Deutsch.';
  const correctText = 'Ich bin gestern zu Hause gewesen.\nAm Abend lerne ich Deutsch.';
  const explanation = 'В Perfekt используем вспомогательный глагол и причастие.';
  await source.fill(sourceText);
  await correction.fill(correctText);
  await contextField.fill(explanation);
  await page.getByRole('button', { name: 'Добавить текстовый блок', exact: true }).last().click();
  const info = page.locator('[data-layout-position="1"]');
  await info.getByRole('textbox').fill('Проверьте порядок слов и форму глагола.');
  await info.getByRole('combobox', { name: 'Роль блока' }).selectOption('source');
  const order = await editorOrder(page);

  const settings = page.locator('.answer-grading');
  const summary = settings.locator('summary');
  const rule = name => settings.getByRole('combobox', { name, exact: true });
  await expect(rule('Режим проверки')).toBeHidden();
  await summary.click();
  await expect(rule('Режим проверки')).toHaveValue('controlled_text');
  await expect(rule('Режим проверки').locator('option')).toHaveCount(2);
  await rule('Режим проверки').selectOption('exact');
  await rule('Допускать опечатки').selectOption('false');
  await rule('Учитывать пунктуацию').selectOption('true');
  await rule('Лимит попыток').selectOption('2');
  await settings.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
  const variant = settings.getByRole('textbox', { name: 'Вариант ответа 1', exact: true });
  const answer = 'Gestern bin ich zu Hause gewesen.\nAm Abend habe ich Deutsch gelernt.';
  await variant.fill(answer);
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await save.click();
  await expect(source).toHaveCount(0);
  const stored = server.card.content_v2.card;
  expect(stored.data).toEqual({ source_text: sourceText, correct_text: correctText, accepted_answers: [answer],
    grading_policy: { mode: 'exact', typo_tolerance: false, punctuation_sensitive: true, max_retries: 2 } });
  expect(stored.explanation).toBe(explanation);
  expect(stored.layout.map(item => item.id)).toEqual(order);

  await open(server.card, true);
  await expect(source).toBeVisible();
  await expect(correction).toBeVisible();
  await expect(contextField).toBeVisible();
  await expect(source).toHaveValue(sourceText);
  await expect(correction).toHaveValue(correctText);
  await expect(rule('Режим проверки')).toBeHidden();
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeHidden({ timeout: 8000 });
  const surface = page.locator('.visual-card-editor-surface');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (width === 375 || width === 1280) {
      await surface.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`editable-text-${width}.png`) });
      await page.locator('.visual-card-form-back').screenshot({ path: testInfo.outputPath(`editable-text-back-${width}.png`) });
    }
  }
  await summary.click();
  await expect(variant).toHaveValue(answer);
  await expect(rule('Режим проверки')).toHaveValue('exact');
  await context.setOffline(true);
  await rule('Лимит попыток').selectOption('3');
  const changed = `${correctText}\n${'Donaudampfschifffahrtsgesellschaft'.repeat(8)}`;
  await correction.fill(changed);
  await save.click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  expect(server.saves).toHaveLength(1);
  const cached = await cachedCard(page);
  expect(cached.content_v2.card).toEqual({ ...stored, data: { ...stored.data,
    correct_text: changed, grading_policy: { ...stored.data.grading_policy, max_retries: 3 } } });
  await open(cached);
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(correction).toHaveValue(changed);
  await expect(contextField).toHaveValue(explanation);
  expect(checks).toEqual([]);
});

test('trainer choices stay visible and keep a correct option per gap through save and reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const parts = [
    { type: 'text', text: 'Ich ' },
    { type: 'choice', options: [{ text: 'habe', correct: false }, { text: 'bin', correct: true }] },
    { type: 'text', text: ' gestern zu meinem Freund gegangen.\nWir ' },
    { type: 'choice', options: [{ text: 'fahren', correct: false }, { text: 'sind gefahren', correct: true }] },
    { type: 'text', text: ' am Wochenende nach Berlin.' },
  ];
  const tail = [
    { type: 'text', text: '\nDu ' },
    { type: 'input', answers: ['übst', 'lernst'] },
    { type: 'text', text: ' heute. Er ' },
    { type: 'choice', distractors: 'auto', options: [{ text: 'war', correct: true }] },
    { type: 'text', text: ' schon dort.' },
  ];
  const original = { type: 'trainer', data: { parts: [...parts, ...tail], back_note: 'Perfekt mit sein' },
    explanation: 'Bewegung und Ortswechsel', topics: ['Perfekt'], info: [{ type: 'task', text: 'Wähle die passenden Formen.' }] };
  const server = { saves: [], card: { id: 1, deck_id: 1, revision: 'trainer-choice',
    content_v2: { schema_version: 2, card: original } } };
  const open = await setupEditor(page, context, server);
  await open(server.card, true);

  const gap = index => page.getByRole('group', { name: `Пропуск ${index}`, exact: true });
  const option = index => page.getByRole('textbox', { name: `Вариант ответа ${index}`, exact: true });
  const chip = index => page.locator('.trainer-gap').filter({ has: option(index) });
  const mark = (kind, index) => page.getByRole('button', { name: `Отметить как ${kind} ${index}`, exact: true });
  const add = index => gap(index).getByRole('button', { name: `Добавить вариант · Пропуск ${index}`, exact: true });
  const back = page.locator('#card-editor-back');
  const explanation = page.locator('#card-editor-context');
  await expect(back).toBeVisible();
  await expect(explanation).toBeVisible();
  await expect(back).toHaveValue(original.data.back_note);
  await expect(explanation).toHaveValue(original.explanation);
  for (const [index, value, state] of [['1.1', 'habe', 'wrong'], ['1.2', 'bin', 'correct'],
    ['2.1', 'fahren', 'wrong'], ['2.2', 'sind gefahren', 'correct']]) {
    await expect(option(index)).toBeVisible();
    await expect(option(index)).toHaveValue(value);
    await expect(chip(index)).toHaveClass(new RegExp(`is-${state}`));
  }
  await expect(option('3.2')).toHaveValue('lernst');
  await expect(gap(4).getByText('Автоматические варианты', { exact: true })).toBeVisible();
  await option('1.1').click();
  await page.getByRole('button', { name: 'Удалить вариант 1.1', exact: true }).click();
  await expect(option('1.1')).toHaveValue('bin');
  await expect(gap(1).getByText('Автоматические варианты', { exact: true })).toBeVisible();
  await expect(mark('неправильный', '1.1')).toHaveCount(0);
  await add(1).click();
  await option('1.1').fill('habe');
  await option('1.2').fill('bin');
  await mark('правильный', '1.2').click();
  await option('1.1').click();
  await mark('неправильный', '1.1').click();
  const exercise = page.locator('.trainer-editor');
  await option('1.2').click();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await exercise.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (width === 375 || width === 1280) await exercise.screenshot({ path: testInfo.outputPath(`trainer-choice-${width}.png`) });
  }

  await mark('неправильный', '1.2').click();
  await expect(page.getByRole('alert')).toHaveText('Нужен хотя бы один правильный вариант.');
  await expect(mark('правильный', '1.2')).toHaveAttribute('aria-pressed', 'true');
  await option('1.1').fill('war');
  await option('1.1').press('Tab');
  await expect(mark('правильный', '1.1')).toBeFocused();
  await mark('правильный', '1.1').press('Enter');
  await expect(gap(1).locator('.is-correct')).toHaveCount(2);
  await option('1.2').click();
  await mark('неправильный', '1.2').click();
  await expect(chip('1.1')).toHaveClass(/is-correct/);
  await expect(chip('1.2')).toHaveClass(/is-wrong/);
  await add(1).click();
  await expect(option('1.3')).toBeFocused();
  const longOption = 'Donaudampfschifffahrtsgesellschaft'.repeat(4);
  await option('1.3').fill(longOption);
  const newSentence = ' gestern im Park geblieben.\nWir ';
  await page.getByRole('textbox', { name: 'Текст 3', exact: true }).fill(newSentence);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await exercise.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  await expect.poll(async () => (await cachedCard(page))?.offline_edit?.status).toBe('pending');
  const cached = await cachedCard(page);
  const expectedParts = structuredClone(original.data.parts);
  expectedParts[1].options = [{ text: 'war', correct: true }, { text: 'bin', correct: false },
    { text: longOption, correct: false }];
  expectedParts[2].text = newSentence;
  expect(cached.content_v2.card).toEqual({ ...original, data: { ...original.data, parts: expectedParts } });
  expect(server.saves).toEqual([]);
  await open(cached);
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(chip('1.1')).toHaveClass(/is-correct/);
  await expect(gap(1).locator('.is-wrong')).toHaveCount(2);
  await expect(option('1.3')).toHaveValue(longOption);
  await expect(back).toBeVisible();
  await expect(explanation).toBeVisible();
});

test.describe('Trainer on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });

  test('creates a choice exercise in place and saves it through the normal form', async ({ page, context }) => {
    const server = { saves: [] };
    await setupEditor(page, context, server);
    await page.evaluate(async deck => {
      (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
      (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
    }, deck);
    await page.getByRole('combobox', { name: 'Тип карточки', exact: true }).selectOption('trainer');
    const text = ordinal => page.getByRole('textbox', { name: `Текст ${ordinal}`, exact: true });
    const option = index => page.getByRole('textbox', { name: `Вариант ответа ${index}`, exact: true });
    const partsMenu = page.getByRole('button', { name: 'Добавить часть', exact: true });
    await text(1).fill('Ich ');
    await option('1.1').tap();
    await partsMenu.tap();
    await page.getByRole('button', { name: 'Пропуск с выбором', exact: true }).tap();
    await expect(option('2.1')).toBeFocused();
    await option('2.1').fill('bin');
    const choiceGap = page.getByRole('group', { name: 'Пропуск 2', exact: true });
    await expect(choiceGap.getByText('Автоматические варианты', { exact: true })).toBeVisible();
    await choiceGap.getByRole('button', { name: 'Добавить вариант · Пропуск 2' }).tap();
    await option('2.2').fill('habe');

    await option('1.1').tap();
    const removePart = page.getByRole('button', { name: 'Удалить выбранную часть', exact: true });
    page.once('dialog', dialog => dialog.dismiss());
    await removePart.tap();
    await expect(option('2.1')).toHaveValue('bin');
    page.once('dialog', dialog => dialog.accept());
    await removePart.tap();
    await expect(option('1.1')).toHaveValue('bin');
    await expect(option('1.2')).toHaveValue('habe');

    await option('1.1').tap();
    await partsMenu.tap();
    await page.getByRole('button', { name: 'Текст', exact: true }).tap();
    const tail = ' gestern nach Hause gegangen.';
    await expect(text(3)).toBeFocused();
    await text(3).fill(tail);
    await page.locator('#card-editor-back').fill('Das Perfekt von gehen benutzt sein.');
    await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).tap();
    await expect.poll(() => server.saves.length).toBe(1);
    expect(server.saves[0].content_v2.card).toMatchObject({ type: 'trainer', data: {
      parts: [{ type: 'text', text: 'Ich ' },
        { type: 'choice', options: [{ text: 'bin', correct: true }, { text: 'habe', correct: false }] },
        { type: 'text', text: tail }],
      back_note: 'Das Perfekt von gehen benutzt sein.',
    } });
  });
});

test('native editor keeps every card type and retains the draft after a conflict', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  const contextField = page.locator('#card-editor-context');
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  const videos = { video_front_path: 'videos/front.webm', video_back_path: 'videos/back.webm' };
  for (const [type, data] of Object.entries(types)) {
    const content = { type, data, info: [{ type: 'task', text: 'Information' }],
      level: 'B1', topics: ['one'], metadata: { extension: { arbitrary: [true, null] } } };
    server.card = { id: 1, deck_id: 1, revision: 'fixture-' + type,
      content_v2: { schema_version: 2, card: content }, image_path: 'images/original.webp',
      ...(type === 'standard' ? videos : {}) };
    const originalRevision = server.card.revision;
    await open(server.card, type === 'standard');
    await expect(page.getByRole('combobox', { name: 'Тип карточки' })).toHaveValue(type);
    await expect(page.getByRole('button', { name: 'Показать предпросмотр', exact: true })).toHaveCount(0);
    await expect(page.locator('.creator-form input[accept="video/*"]')).toHaveCount(0);
    if (type === 'puzzle') {
      await page.locator('.puzzle-editor .puzzle-slot-chip').first().click();
      const sentence = page.getByRole('textbox', { name: 'Правильное предложение', exact: true });
      await expect(sentence).toHaveValue(data.tokens.join(' '));
      await sentence.press('Tab');
    }
    await expect(contextField).toBeVisible();
    if (!['word_bank', 'puzzle'].includes(type)) await expect(page.locator('#card-editor-back')).toBeVisible();
    await contextField.fill('Edited ' + type);
    const request = page.waitForRequest(req => req.url().endsWith('/api/cards/1') && req.method() === 'PATCH');
    await save.click();
    const payload = (await request).postDataJSON();
    expect(payload.content_v2.card).toEqual({ ...content, explanation: 'Edited ' + type });
    expect(payload.revision).toEqual(originalRevision);
    expect(payload.image_path).toBe('images/original.webp');
    if (type === 'standard') expect(payload).toMatchObject(videos);
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

test('Puzzle edits the entire sentence and translation in the card, online and offline', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = { saves: [] };
  const open = await setupEditor(page, context, server);
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { DEFAULT_DESIGN_CONFIG_V2 } = await import('/src/design/designConfig.js');
    const design = structuredClone(DEFAULT_DESIGN_CONFIG_V2);
    Object.assign(design.front.mainText, { font: 'monospace', size: 1.15 });
    Object.assign(design.back.answerText, { font: 'serif', color: '#ffeebb' });
    Object.assign(design.exercises.puzzle.correct, { bg: '#12382a', borderColor: '#46d48c' });
    useSettingsStore.getState().setPersonalDesignV2(design);
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.getState().setView('creator');
  }, deck);
  const kind = page.getByRole('combobox', { name: 'Тип карточки', exact: true });
  await kind.selectOption('puzzle');
  await expect(kind).toHaveCount(1);
  const editor = page.locator('.puzzle-editor');
  const tiles = editor.locator('.puzzle-slot-chip');
  const editSentence = editor.getByRole('button', { name: /^Редактировать предложение/ });
  const sentence = editor.getByRole('textbox', { name: 'Правильное предложение', exact: true });
  const translation = editor.getByRole('textbox', { name: 'Перевод', exact: true });
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  const insert = page.getByRole('button', { name: 'Добавить текстовый блок', exact: true });
  const blocks = page.locator('.visual-card-layout-block');
  await expect(editor.locator('.puzzle-pool-chips, .puzzle-check-action, .puzzle-reset-action')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Показать перевод|Показать предпросмотр)$/ })).toHaveCount(0);

  await editSentence.click();
  await expect(sentence).toBeFocused();
  await sentence.fill('  „Wir“\tgehen,\u00a0gehen,\nund kommen zurück!  ');
  await expect(tiles.first()).toBeHidden();
  await sentence.press('Enter');
  const tokens = ['„Wir“', 'gehen,', 'gehen,', 'und', 'kommen', 'zurück!'];
  await expect(tiles).toHaveText(tokens);
  await expect(editSentence).toBeFocused();
  await translation.fill('   ');
  await save.click();
  await expect(page.getByText('Ошибка сохранения: Введите перевод', { exact: true })).toBeVisible();
  await expect(tiles).toHaveText(tokens);
  expect(server.saves).toHaveLength(0);
  await translation.fill('Мы идём и **возвращаемся**.');
  await insert.first().click();
  await blocks.nth(0).getByRole('textbox').fill('Соберите предложение по-немецки.');
  await blocks.nth(0).getByRole('combobox', { name: 'Роль блока' }).selectOption('task');
  await expect(editor.locator('.puzzle-editor-instruction')).toHaveCount(0);
  await insert.nth(1).click();
  await blocks.nth(1).getByRole('textbox').fill('Wir lernen Deutsch.');
  await blocks.nth(1).getByRole('combobox', { name: 'Роль блока' }).selectOption('example');
  await expect(blocks.nth(1).getByRole('combobox')).toHaveCount(1);
  const [task, example, exercise] = await editorOrder(page);
  const handles = page.getByRole('button', { name: 'Переместить блок', exact: true });
  await handles.nth(0).scrollIntoViewIfNeeded();
  const start = await handles.nth(1).boundingBox();
  const target = await handles.nth(0).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => editorOrder(page)).toEqual([example, task, exercise]);
  await blocks.nth(0).getByLabel('Настройки блока', { exact: true }).click();
  await blocks.nth(0).getByRole('combobox', { name: 'Когда показывать' }).selectOption('after_answer');
  await blocks.nth(0).getByLabel('Настройки блока', { exact: true }).click();
  await expect(editor.locator('.text-back strong')).toHaveText('возвращаемся');
  await expect(editor.locator('.text-back')).toHaveCSS('color', 'rgb(255, 238, 187)');
  await expect(tiles.first()).toHaveCSS('font-family', 'monospace');
  await expect(tiles.first()).toHaveCSS('background-color', 'rgb(18, 56, 42)');
  const appearance = element => {
    const css = getComputedStyle(element);
    return [css.fontFamily, css.fontSize, css.fontWeight, css.color, css.backgroundColor, css.borderColor, css.borderRadius, css.padding];
  };
  const tileAppearance = await tiles.first().evaluate(appearance);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await editSentence.evaluate(row => row.scrollWidth <= row.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 375 || width === 1280) {
      await page.locator('.visual-card-editor-surface').screenshot({ path: testInfo.outputPath(`puzzle-edit-${width}.png`) });
    }
  }

  await save.click();
  await expect(editor).toHaveCount(0);
  expect(server.card.content_v2.card.data).toEqual({ tokens, translation: 'Мы идём и **возвращаемся**.' });
  expect(server.card.content_v2.card.layout[0]).toMatchObject({ id: example, visibility: 'after_answer' });
  await open(server.card, true);
  await expect(tiles).toHaveText(tokens);
  await tiles.nth(3).click();
  await expect(sentence).toHaveValue(tokens.join(' '));
  await sentence.fill('');
  await sentence.press('Tab');
  await expect(editSentence).toHaveText('Введите предложение');
  await save.click();
  await expect(page.getByText('Ошибка сохранения: Введите предложение', { exact: true })).toBeVisible();
  expect(server.saves).toHaveLength(1);
  await editSentence.click();
  await sentence.fill('Jetzt wird online gespeichert.');
  await save.click();
  await expect(editor).toHaveCount(0);
  const onlineData = { tokens: ['Jetzt', 'wird', 'online', 'gespeichert.'], translation: 'Мы идём и **возвращаемся**.' };
  await expect.poll(() => server.card.content_v2.card.data).toEqual(onlineData);
  await expect.poll(async () => (await cachedCard(page))?.revision).toBe(server.card.revision);
  await open(server.card, true);
  await expect(tiles).toHaveText(onlineData.tokens);

  await context.setOffline(true);
  await translation.fill('Локальный перевод.');
  await tiles.last().click();
  await sentence.fill('Ich übe, übe, übe!');
  await save.click();
  await expect(editor).toHaveCount(0);
  const offlineData = { tokens: ['Ich', 'übe,', 'übe,', 'übe!'], translation: 'Локальный перевод.' };
  await expect.poll(async () => (await cachedCard(page))?.content_v2.card.data).toEqual(offlineData);
  expect(server.saves).toHaveLength(2);
  await open(await cachedCard(page));
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(tiles).toHaveText(offlineData.tokens);
  await expect(translation).toHaveValue(offlineData.translation);
  await expect.poll(() => editorOrder(page)).toEqual([example, task, exercise]);

  await page.evaluate(async ({ deck, card }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card: { ...server.card, requiredActions: ['answer'] } });
  const study = page.locator('#tut-study-card .puzzle-exercise');
  const pool = study.locator('.btn-puzzle-chip');
  await expect(pool).toHaveCount(onlineData.tokens.length);
  expect(await pool.allTextContents()).not.toEqual(onlineData.tokens);
  for (const token of onlineData.tokens) await study.getByRole('button', { name: token, exact: true }).click();
  await study.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(study).toHaveClass(/is-correct/);
  expect(await study.locator('.puzzle-slot-chip').first().evaluate(appearance)).toEqual(tileAppearance);
  expect(errors).toEqual([]);
});

test.describe('Puzzle on a touch screen', () => {
  test.use({ viewport: { width: 320, height: 850 }, hasTouch: true, isMobile: true });

  test('replaces the whole sentence and creates a Puzzle offline', async ({ page, context }) => {
    const server = { saves: [] };
    await setupEditor(page, context, server);
    await context.setOffline(true);
    await page.evaluate(async deck => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useDeckStore.setState({ currentDeck: deck });
      useUiStore.getState().setView('creator');
    }, deck);
    await page.getByRole('combobox', { name: 'Тип карточки', exact: true }).selectOption('puzzle');
    const editor = page.locator('.puzzle-editor');
    const translation = editor.getByRole('textbox', { name: 'Перевод', exact: true });
    await editor.getByRole('button', { name: 'Редактировать предложение', exact: true }).tap();
    const sentence = editor.getByRole('textbox', { name: 'Правильное предложение', exact: true });
    await expect(sentence).toBeFocused();
    await sentence.fill('Das Wort Kraftfahrzeughaftpflichtversicherung ist lang.');
    await translation.tap();
    await expect(sentence).toHaveCount(0);
    await translation.fill('Очень длинное слово.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await editor.locator('.puzzle-slot-chip').nth(2).tap();
    await expect(sentence).toHaveValue('Das Wort Kraftfahrzeughaftpflichtversicherung ist lang.');
    await sentence.fill('Jetzt übe ich, ich übe!');
    await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).tap();
    await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      return (await db.cards.toArray()).find(card => card.id < 0)?.content_v2.card.data;
    })).toEqual({ tokens: ['Jetzt', 'übe', 'ich,', 'ich', 'übe!'], translation: 'Очень длинное слово.' });
    expect(server.saves).toHaveLength(0);
  });
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

for (const type of ['quiz', 'standard']) test.describe(`${type} creator on a touch screen`, () => {
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
    await page.getByRole('combobox', { name: 'Тип карточки' }).selectOption(type);
    await page.getByRole('textbox', { name: 'Вопрос', exact: true }).fill('Welche Antwort ist richtig?');
    if (type === 'quiz') {
      await page.getByRole('textbox', { name: 'Вариант ответа 1', exact: true }).fill('Richtig');
      await page.getByRole('textbox', { name: 'Вариант ответа 2', exact: true }).fill('Falsch');
    }
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
    await expect.poll(() => page.evaluate(async type => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const draft = (await db.cards.toArray()).find(card => card.content_v2?.card.type === type)?.content_v2.card;
      return draft && { order: draft.layout.map(item => item.id), topics: draft.topics };
    }, type)).toEqual({ order: [second, first, exercise], topics: ['Kasus'] });
  });
});

test('Standard creator allows saving a card with an empty back side online and offline', async ({ page, context }) => {
  const server = { saves: [] };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupEditor(page, context, server);
  const openCreator = () => page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.setState({ editorSourceView: 'decks' });
    useUiStore.getState().setView('creator');
  }, deck);

  await openCreator();
  await page.locator('#card-editor-front').fill('Nur Vorderseite');
  await expect(page.locator('#card-editor-back')).toHaveValue('');
  const request = page.waitForRequest(req => req.url().endsWith('/api/cards/save') && req.method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  const payload = (await request).postDataJSON();
  expect(payload.content_v2.card).toMatchObject({
    type: 'standard',
    data: { prompt: 'Nur Vorderseite', answer: '' },
  });
  await expect(page.getByText('Карточка сохранена', { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });
  await openCreator();
  await page.locator('#card-editor-front').fill('Offline ohne Rückseite');
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    return (await db.cards.toArray()).find(card => card.id < 0)?.content_v2.card.data;
  })).toEqual({ prompt: 'Offline ohne Rückseite', answer: '' });
  expect(errors).toEqual([]);
});

test('editor shell keeps deck selection and draft through settings, then returns to the list after saving', async ({ page, context }) => {
  const server = { saves: [], decks: [deck, { ...deck, id: 2, name: 'Second fixture deck' }] };
  await setupEditor(page, context, server);
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [], cardsLoading: false });
    useUiStore.setState({ userProfile: { user_id: 1, is_guest: false }, view: 'cards' });
  }, deck);

  await page.locator('#tut-fab-add').click();
  const creator = page.locator('.view-creator');
  const deckPicker = creator.locator('select.form-input').first();
  const save = page.getByRole('button', { name: 'Сохранить карточку', exact: true });
  await expect(creator.getByRole('heading', { name: 'Новая карточка' })).toBeVisible();
  await expect(creator.getByTitle('Добавить карточку')).toBeDisabled();
  await expect(deckPicker).toHaveValue('1');
  await creator.locator('#card-editor-front').fill('Der Entwurf');
  await deckPicker.selectOption('2');
  await creator.getByTitle('Настройки', { exact: true }).click();
  await expect(page.locator('.settings-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  await expect(deckPicker).toHaveValue('2');
  await expect(creator.locator('#card-editor-front')).toHaveValue('Der Entwurf');
  await deckPicker.selectOption('1');
  await save.click();

  const openSavedCard = async () => {
    await page.locator('#card-item-1 .card-item-actions-trigger').click();
    await page.getByText('Редактировать', { exact: true }).click();
    await expect(page.locator('.view-editor').getByRole('heading', { name: 'Правка карточки' })).toBeVisible();
  };
  await openSavedCard();
  await expect(page.locator('#card-editor-front')).toHaveValue('Der Entwurf');
  await page.locator('.view-editor .back-btn').press('Enter');
  await expect(page.locator('#card-item-1')).toBeVisible();
  await openSavedCard();
  await page.locator('#card-editor-front').fill('Der geänderte Entwurf');
  await save.click();
  await expect(page.locator('#card-item-1')).toBeVisible();
  await expect.poll(() => server.saves.length).toBe(2);
  expect(server.saves[0]).toMatchObject({ deck_id: 1, content_v2: { card: { data: { prompt: 'Der Entwurf' } } } });
  expect(server.saves[1]).toMatchObject({ revision: 'created', content_v2: { card: { data: { prompt: 'Der geänderte Entwurf' } } } });
  for (const { request_id } of server.saves) expect(request_id).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  expect(server.saves[1].request_id).not.toBe(server.saves[0].request_id);
});
