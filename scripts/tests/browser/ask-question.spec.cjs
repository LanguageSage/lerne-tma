const { test, expect } = require('@playwright/test');

const wordBank = { id: 1, deck_id: 1, queue: 'new',
  front: '@wordbank\nIch <<gap-1>> <<gap-2>> <<gap-3>>.\n@options\nhabe | heute | einen | kleinen',
  back: 'gap-1=habe\ngap-2=heute\ngap-3=einen' };

const regularCard = { id: 2, deck_id: 1, queue: 'new',
  front: 'Der Apfel', back: 'Яблоко' };

async function openStudy(page, context, card, options = {}) {
  const notes = new Map();
  const cardWrites = [];
  const deck = { id: 1, name: 'Deck', target_language: 'de', role: 'viewer',
    stats: { total: 2, new: 2, due: 0, learning: 0 }, ...options.deck };
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  });
  
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const { pathname } = new URL(url);
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: options.cards || [card] });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname === `/api/study/card/${card.id}` || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    if (pathname === '/api/card-notes/deck/1') return route.fulfill({ json: [...notes.values()] });
    if (/^\/api\/card-notes\/\d+\/[a-f0-9-]+$/.test(pathname)) {
      if (options.failNoteSync) return route.fulfill({ status: 503, json: { detail: 'Retry later' } });
      const parts = pathname.split('/');
      const payload = route.request().postDataJSON();
      const row = { id: parts[4], card_id: Number(parts[3]), user_id: 1,
        revision: 1, is_deleted: false, ...notes.get(parts[4]), ...payload };
      notes.set(row.id, row);
      return route.fulfill({ json: row });
    }
    if (pathname === '/api/cards/ai-generate') {
      const postData = JSON.parse(route.request().postData());
      // Return a simulated AI answer
      if (postData.user_request === 'server_error') return route.fulfill({ status: 500, json: { error: 'Server error' } });
      if (postData.user_request === 'network_error') return route.abort('failed');
      
      // Delay for network testing
      if (postData.user_request === 'slow') await new Promise(r => setTimeout(r, 1000));
      
      return route.fulfill({ json: { context: `AI explanation for: ${postData.user_request}` } });
    }
    if (pathname.startsWith('/api/cards/') && route.request().method() === 'PUT') {
      cardWrites.push(pathname);
      return route.fulfill({ json: {} });
    }
    if (pathname === '/api/cards/save') {
      const payload = route.request().postDataJSON();
      cardWrites.push(payload);
      if (options.failCardSave) return route.fulfill({ status: 403, json: { detail: 'No edit permission' } });
      Object.assign(card, payload);
      return route.fulfill({ json: card });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/?user_id=1');
  await expect(page.getByText('Deck', { exact: true }).first()).toBeVisible();
  
  await page.evaluate(async ({ card, deck, activeDeck }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ autoGenerateCardAudio: false });
    useDeckStore.setState({ currentDeck: activeDeck, decks: [deck], deckCards: [card], cardsByDeck: { [deck.id]: [card] } });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: true });
    useUiStore.getState().setView('study');
  }, { card, deck, activeDeck: options.activeDeck || deck });
  return { notes, cardWrites, options };
}

test('Wordbank AI Question: saves question and answer as one personal note', async ({ page, context }, info) => {
  const { notes, cardWrites } = await openStudy(page, context, { ...wordBank, context: 'Shared context' });
  
  // Back of card should be visible
  const trigger = page.locator('.card-question-trigger');
  await expect(trigger).toBeVisible();
  
  await trigger.click();
  const input = page.locator('.card-question-input');
  await expect(input).toBeVisible();
  
  await input.fill('What does habe mean?');
  await page.locator('.card-question-button.primary').click();
  
  await expect(page.locator('.card-personal-notes')).toContainText('What does habe mean?');
  await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: What does habe mean?');
  await page.screenshot({ path: info.outputPath('ai-note-in-context.png') });
  await expect(page.getByRole('button', { name: 'Сохранить в Контекст' })).toHaveCount(0);
  await expect.poll(() => notes.size).toBe(1);
  expect([...notes.values()][0].text).toBe('What does habe mean?\n\nAI explanation for: What does habe mean?');
  expect(cardWrites).toEqual([]);

  const savedContext = await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    return useSessionStore.getState().card.context;
  });
  expect(savedContext).toBe('Shared context');
  
  // Verify editor is NOT opened
  const view = await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    return useUiStore.getState().view;
  });
  expect(view).toBe('study');

  await page.getByRole('button', { name: 'Действия с карточкой', exact: true }).click();
  await page.getByRole('button', { name: 'Мои заметки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Редактировать запись').fill('Мой исправленный вопрос и ответ');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toContainText('Мой исправленный вопрос и ответ');
  expect(notes.size).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toHaveCount(0);
  expect([...notes.values()][0].is_deleted).toBe(true);
});

test('Wordbank AI Question: handles server error gracefully', async ({ page, context }) => {
  const { notes } = await openStudy(page, context, wordBank);
  await page.locator('.card-question-trigger').click();
  const input = page.locator('.card-question-input');
  await input.fill('server_error');
  await page.locator('.card-question-button.primary').click();
  
  // Error should be shown via toast, input should remain visible
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('server_error');
  await expect(page.locator('.toast')).toContainText('Ошибка ИИ');
  expect(notes.size).toBe(0);
  expect(await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().card_notes.count())).toBe(0);
});

test('Wordbank AI Question: handles network error gracefully', async ({ page, context }) => {
  const { notes } = await openStudy(page, context, wordBank);
  await page.locator('.card-question-trigger').click();
  const input = page.locator('.card-question-input');
  await input.fill('network_error');
  await page.locator('.card-question-button.primary').click();
  
  await expect(input).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Ошибка сети');
  expect(notes.size).toBe(0);
});

test('Regular Card AI Question: preserves existing functionality', async ({ page, context }) => {
  await openStudy(page, context, regularCard);
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Test regular');
  await page.locator('.card-question-button.primary').click();
  
  await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: Test regular');
});

test('AI answer remains local after sync failure and retries with one UUID', async ({ page, context }) => {
  const { notes, options } = await openStudy(page, context, regularCard, { failNoteSync: true });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Keep this answer');
  await page.locator('.card-question-button.primary').click();
  await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: Keep this answer');
  const pending = await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().card_notes.toArray());
  expect(pending).toHaveLength(1);
  expect(pending[0].is_dirty).toBe(1);
  expect(notes.size).toBe(0);
  options.failNoteSync = false;
  await page.evaluate(async () => {
    const { getLocalDb } = await import('/src/services/localDb.js');
    const { syncCardNotes } = await import('/src/services/cardNotes.js');
    await syncCardNotes(getLocalDb(), 1);
  });
  expect(notes.size).toBe(1);
  expect([...notes.keys()][0]).toBe(pending[0].id);
});

test('answer generated after navigation belongs to the question card', async ({ page, context }) => {
  const { notes } = await openStudy(page, context, wordBank, { cards: [wordBank, regularCard] });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('slow');
  await page.locator('.card-question-button.primary').click();
  await page.evaluate(async ({ next }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card: next, studyHistory: [next], historyIndex: 0, isFlipped: true });
  }, { next: regularCard });
  await expect.poll(() => notes.size).toBe(1);
  expect([...notes.values()][0].card_id).toBe(wordBank.id);
  await expect(page.locator('.card-personal-notes')).toHaveCount(0);
  await page.evaluate(async ({ original }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card: original, studyHistory: [original], historyIndex: 0, isFlipped: true });
  }, { original: wordBank });
  await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: slow');
});

for (const [role, width] of [['owner', 375], ['editor', 1330], [null, 375]]) {
  test(`AI answer for ${role || 'legacy owner'} saves to context and can be edited at ${width}px`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const sharedContext = 'Общее пояснение карточки';
    const { notes, cardWrites } = await openStudy(page, context, { ...regularCard, context: sharedContext }, { deck: { role } });
    await page.locator('.card-question-trigger').click();
    await page.locator('.card-question-input').fill('Почему здесь der?');
    await page.locator('.card-question-button.primary').click();
    const answer = 'AI explanation for: Почему здесь der?';
    const preview = page.locator('.ai-explanation-block');
    await expect(preview).toContainText(answer);
    expect(cardWrites).toEqual([]);
    await page.screenshot({ path: info.outputPath(`answer-preview-${role}-${width}.png`), fullPage: true });
    await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
    await expect(preview).toHaveCount(0);
    const expectedContext = `${answer}\n\n${sharedContext}`;
    await expect(page.locator('.card-context-wrapper')).toContainText(answer);
    expect(cardWrites).toHaveLength(1);
    expect(cardWrites[0]).toMatchObject({ card_id: regularCard.id, context: expectedContext, auto_generate_audio: false });
    expect(notes.size).toBe(0);
    await expect(page.locator('.card-personal-notes')).toHaveCount(0);

    await page.locator('#tut-study-edit-card').click();
    const input = page.getByRole('textbox', { name: 'Контекст', exact: true });
    await expect(input).toHaveValue(expectedContext);
    const edited = expectedContext.replace(answer, 'Мой исправленный ответ: der — определённый артикль.');
    await input.fill(edited);
    await page.screenshot({ path: info.outputPath(`answer-context-${role}-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.view-editor').getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
    await expect(page.locator('.view-study')).toBeVisible();
    await expect(page.locator('.card-context-wrapper')).toContainText('Мой исправленный ответ');
    await page.locator('#tut-study-edit-card').click();
    await expect(input).toHaveValue(edited);
    expect(notes.size).toBe(0);
  });
}

test('public read-only deck without a role saves AI answer only as a note', async ({ page, context }) => {
  const { notes, cardWrites } = await openStudy(page, context, regularCard, { deck: { role: null, is_global_readonly: true } });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Read only');
  await page.locator('.card-question-button.primary').click();
  await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: Read only');
  expect(notes.size).toBe(1);
  expect(cardWrites).toEqual([]);
  await expect(page.getByRole('button', { name: 'Сохранить в Контекст', exact: true })).toHaveCount(0);
});

test('rejected context save retains the answer for retry without creating a note', async ({ page, context }) => {
  const { notes, options } = await openStudy(page, context, { ...regularCard, context: 'Original' },
    { deck: { role: 'owner' }, failCardSave: true });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Keep answer');
  await page.locator('.card-question-button.primary').click();
  const preview = page.locator('.ai-explanation-block');
  await expect(preview).toContainText('AI explanation for: Keep answer');
  await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Не удалось сохранить контекст');
  await expect(preview).toContainText('AI explanation for: Keep answer');
  expect(notes.size).toBe(0);
  options.failCardSave = false;
  await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.card-context-wrapper')).toContainText('AI explanation for: Keep answer');
});

test('editable answer arriving after navigation stays with its source card and appends to the latest context', async ({ page, context }) => {
  const original = { ...wordBank, context: 'Before question' };
  const { notes, cardWrites } = await openStudy(page, context, original,
    { deck: { role: 'editor' }, cards: [original, regularCard] });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('slow');
  await page.locator('.card-question-button.primary').click();
  await page.evaluate(async ({ next, original }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card: next, studyHistory: [original, next], historyIndex: 1, isFlipped: true });
  }, { next: regularCard, original });
  await expect.poll(() => page.locator('.card-loading-overlay').count()).toBe(0);
  await expect(page.locator('.ai-explanation-block')).toHaveCount(0);
  expect(notes.size).toBe(0);
  expect(cardWrites).toEqual([]);
  await page.evaluate(async ({ original }) => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card: { ...original, context: 'Edited while waiting' }, historyIndex: 0, isFlipped: true });
  }, { original });
  const preview = page.locator('.ai-explanation-block');
  await expect(preview).toContainText('AI explanation for: slow');
  await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(cardWrites).toHaveLength(1);
  expect(cardWrites[0]).toMatchObject({ card_id: original.id, context: 'AI explanation for: slow\n\nEdited while waiting' });
});

test('owner can save a generated answer offline without losing other card fields', async ({ page, context }) => {
  const source = { ...regularCard, context: 'Original context' };
  const { notes, cardWrites } = await openStudy(page, context, source, { deck: { role: 'owner' } });
  await page.locator('.card-question-trigger').click();
  await page.locator('.card-question-input').fill('Offline answer');
  await page.locator('.card-question-button.primary').click();
  const preview = page.locator('.ai-explanation-block');
  await expect(preview).toContainText('AI explanation for: Offline answer');
  await page.evaluate(async ({ source }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    await db.decks.put({ id: 1, user_id: 1, role: 'owner', name: 'Deck' });
    await db.cards.put({ id: source.id, deck_id: 1, front_text: source.front, back_text: source.back,
      context: source.context, position: 0, audio_path: 'existing.mp3' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, { source });
  await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
  await expect(preview).toHaveCount(0);
  const stored = await page.evaluate(async id => (await import('/src/services/localDb.js')).getLocalDb().cards.get(id), source.id);
  expect(stored).toMatchObject({ id: source.id, front_text: source.front, back_text: source.back,
    context: 'AI explanation for: Offline answer\n\nOriginal context', audio_path: 'existing.mp3', is_dirty: 1 });
  expect(notes.size).toBe(0);
  expect(cardWrites).toEqual([]);
});

for (const role of ['owner', 'viewer']) {
  test(`duplicates use the source deck ${role} permission for an AI answer`, async ({ page, context }) => {
    const { notes, cardWrites } = await openStudy(page, context, { ...regularCard, creator_id: 1 },
      { deck: { role }, activeDeck: { id: 'duplicates', name: 'Duplicates', role: role === 'owner' ? 'viewer' : 'owner' } });
    await page.locator('.card-question-trigger').click();
    await page.locator('.card-question-input').fill('Source permission');
    await page.locator('.card-question-button.primary').click();
    if (role === 'owner') {
      const preview = page.locator('.ai-explanation-block');
      await expect(preview).toContainText('AI explanation for: Source permission');
      expect(cardWrites).toEqual([]);
      await preview.getByRole('button', { name: 'Сохранить в Контекст', exact: true }).click();
      await expect(preview).toHaveCount(0);
      expect(cardWrites).toHaveLength(1);
      const sourceCache = await page.evaluate(async () => {
        const { useDeckStore } = await import('/src/store/useDeckStore.js');
        return useDeckStore.getState().cardsByDeck[1][0];
      });
      expect(sourceCache.context).toBe('AI explanation for: Source permission');
      expect(notes.size).toBe(0);
    } else {
      await expect(page.locator('.card-personal-notes')).toContainText('AI explanation for: Source permission');
      await expect(page.locator('.ai-explanation-block')).toHaveCount(0);
      expect(notes.size).toBe(1);
      expect(cardWrites).toEqual([]);
    }
  });
}
