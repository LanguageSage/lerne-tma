const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Latency', target_language: 'de', stats: { total: 3, new: 3, due: 0, learning: 0 } };
const cards = [1, 2, 3].map(id => ({ id, deck_id: 1, position: id, front: `Instant word ${id}`, back: `Answer ${id}`,
  revision: `synthetic-${id}`, content_v2: { schema_version: 2, card: { type: 'standard',
    data: { prompt: `Instant word ${id}`, answer: `Answer ${id}` }, info: [] } },
  queue: 'new', interval: 0, intervals: { 0: '1 min', 1: '6 min', 2: '10 min', 3: '4 days' } }));

async function setup(page, context, duplicate = false, language = 'en') {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(language => {
    localStorage.setItem('native_language', language);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
    HTMLMediaElement.prototype.play = function () { window.audioPlayCalls = (window.audioPlayCalls || 0) + 1; return Promise.resolve(); };
  }, language);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/sync/v2/status') return route.fulfill({ json: { server_generation: 'a'.repeat(64), restored: false } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {},
      user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname.endsWith('/cards')) return route.fulfill({ json: cards });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: cards });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname.startsWith('/api/study/card/')) return route.fulfill({ json: cards.find(c => c.id === Number(pathname.split('/').pop())) });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('.view-decks')).toBeVisible();
  // The unrelated infinite floating arrow animation prevents Playwright's stability check.
  // Keep the actual card and flip animations enabled for these transition tests.
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  await page.evaluate(async ({ deck, cards, duplicate }) => {
    window.deckStore = (await import('/src/store/useDeckStore.js')).useDeckStore;
    window.sessionStore = (await import('/src/store/useSessionStore.js')).useSessionStore;
    window.uiStore = (await import('/src/store/useUiStore.js')).useUiStore;
    window.settingsStore = (await import('/src/store/useSettingsStore.js')).useSettingsStore;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { useStudySession } = await import('/src/hooks/useStudySession.js');
    const { useStudyNavigation } = await import('/src/hooks/useStudyNavigation.js');
    const target = document.createElement('div');
    document.body.append(target);
    createRoot(target).render(React.createElement(function Harness() {
      window.studyActions = useStudySession();
      window.studyNavigation = useStudyNavigation();
      return null;
    }));
    deckStore.getState().setCurrentDeck(duplicate ? { ...deck, id: 'duplicates' } : deck);
    deckStore.getState().setDeckCards(cards);
    deckStore.getState().setDuplicateCards(cards);
    sessionStore.getState().resetSession();
    sessionStore.getState().addToHistory(cards[0]);
    settingsStore.setState({ autoPlay: false, studyMode: 'classic' });
    uiStore.getState().setView('study');
  }, { deck, cards, duplicate });
  await page.waitForFunction(() => window.studyActions);
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
}

function holdRefresh(page) {
  const pending = [];
  return page.route('**/api/study/card/*', route => { pending.push(route); }).then(() => pending);
}

test('deck audio remains available on fresh list cards without individual GETs', async ({ page, context }) => {
  await setup(page, context);
  let reads = 0;
  await page.route('**/api/study/card/*', route => { reads++; return route.fulfill({ json: cards[0] }); });
  await page.evaluate(cards => {
    deckStore.getState().setCurrentDeck({ ...deckStore.getState().currentDeck,
      metadata: JSON.stringify({ resources: [{ type: 'audio', title: 'Shared lesson recording', path: 'lesson.mp3' }] }) });
    const session = JSON.parse(localStorage.getItem('lerne_auth_v2_session'));
    deckStore.getState().setDeckCards(cards.map(card => ({ ...card, _studyFetchedAt: Date.now(),
      _studyContext: 'scheduled', _studyIdentity: session.client_session_id || session.refresh_token || session.access_token })));
  }, cards);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => studyActions.goNext());
    await expect(page.getByText('Shared lesson recording', { exact: true }).first()).toBeVisible();
    expect(await page.locator('audio').evaluateAll(elements => elements.some(audio => audio.src.endsWith('/lesson.mp3')))).toBe(true);
  }
  expect(reads).toBe(0);
});

test('cold first card survives immediate offline grading and review delivery after reconnect', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  await page.route('**/api/decks/1/cards*', () => {});
  await page.evaluate(async deck => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    await db.cards.clear();
    await db.decks.put({ ...deck, user_id: 1, role: 'owner' });
    deckStore.setState({ deckCards: [], cardsByDeck: {} });
    await studyNavigation.startStudy(deck);
  }, deck);
  expect(await page.evaluate(async () => Boolean(await (await import('/src/services/localDb.js')).getLocalDb().cards.get(1)))).toBe(true);
  await context.setOffline(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  const reviews = () => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().syncState.filter(row => row.key.startsWith('review:')).toArray());
  await expect.poll(async () => (await reviews()).length).toBe(1);
  const [saved] = await reviews();
  await context.setOffline(false);
  let delivered;
  await page.route('**/api/sync/v2/push*', route => {
    delivered = route.request().postDataJSON().reviews;
    return route.fulfill({ json: { status: 'success', mappings: {}, review_count: delivered.length } });
  });
  await page.route('**/api/sync/v2/pull*', route => route.fulfill({ json: { status: 'success', card_schema: 2,
    folders: [], decks: [{ ...deck, user_id: 1 }], cards, progress: [] } }));
  await page.route('**/api/knowledge/attempts/sync', route => route.fulfill({ json: {
    results: route.request().postDataJSON().attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' })) } }));
  await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(1));
  const syncResult = await page.evaluate(async () => {
    localStorage.removeItem('lerne:personal-design:v2:1');
    return {
      sync: await (await import('/src/services/syncService.js')).syncService.sync(),
      cutover: await (await import('/src/services/cardCutoverPreflight.js')).inspectCardCutover(),
    };
  });
  expect(syncResult.cutover.databases[0]).toMatchObject({ pending_free: true, blockers: {} });
  expect(syncResult.sync).toMatchObject({ device_pending: false, success: true });
  expect(delivered).toHaveLength(1);
  expect(delivered[0].action_id).toBe(saved.action_id);
  expect(await reviews()).toHaveLength(0);
});

test('cold Study paints the SRS card while the full list and KI are held; early grade retains its attempt', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  let list, knowledge;
  await page.route('**/api/decks/1/cards*', route => { list = route; });
  await page.route('**/api/knowledge/decks/1*', route => { knowledge = route; });
  let cardReads = 0;
  await page.route('**/api/study/card/*', route => { cardReads++; return route.fulfill({ json: cards[0] }); });
  await page.route('**/api/study/grade', route => route.fulfill({ json: { ...cards[1],
    graded_progress: { id: 1, queue: 'review', interval: 7, intervals: { 2: '7 days' } } } }));
  await page.evaluate(deck => {
    deckStore.setState({ deckCards: [], cardsByDeck: {} });
    window.opening = studyNavigation.startStudy(deck);
  }, deck);
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => Boolean(list && knowledge)).toBe(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  const count = () => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count());
  expect(await count()).toBe(1);
  expect(await page.evaluate(async () => (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray())[0].sync_status)).toBe('awaiting_content');
  await knowledge.fulfill({ json: { revision: 'synthetic-knowledge', card_ids: [1, 2, 3],
    knowledge_items: [{ id: 10, name: 'Synthetic skill' }], card_knowledge_items: [{ card_id: 1, knowledge_item_id: 10, role: 'primary' }] } });
  await expect.poll(() => page.evaluate(async () => (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray())[0]?.knowledge_item_id)).toBe(10);
  await list.fulfill({ json: cards });
  await expect.poll(() => page.evaluate(() => deckStore.getState().deckCards.length)).toBe(3);
  await page.evaluate(() => studyActions.goBack());
  expect(await page.evaluate(() => sessionStore.getState().card.interval)).toBe(7);
  expect(await page.evaluate(() => deckStore.getState().deckCards[0].interval)).toBe(7);
  expect(cardReads).toBe(0);
});

test('fresh navigation and grade progress reuse their snapshots without study/card reads', async ({ page, context }) => {
  await setup(page, context);
  let reads = 0;
  await page.route('**/api/study/card/*', route => { reads++; return route.fulfill({ json: cards[0] }); });
  await page.evaluate(cards => {
    const identity = JSON.parse(localStorage.getItem('lerne_auth_v2_session'));
    const marker = identity.client_session_id || identity.session_id || identity.refresh_token || identity.access_token;
    const fresh = cards.map(card => ({ ...card, _studyFetchedAt: Date.now(), _studyIdentity: marker, _studyContext: 'scheduled' }));
    deckStore.getState().setDeckCards(fresh);
    sessionStore.getState().updateCardInSession(1, fresh[0]);
  }, cards);
  await page.route('**/api/study/grade', route => route.fulfill({ json: { status: 'success',
    graded_progress: { id: 1, queue: 'review', interval: 12, intervals: { 2: '12 days' } } } }));
  await page.evaluate(() => studyActions.goNext());
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => studyActions.submitGrade(2));
  await page.evaluate(() => studyActions.goBack());
  expect(await page.evaluate(() => sessionStore.getState().card.interval)).toBe(12);
  expect(reads).toBe(0);
});

test('assessment waits for its full fresh list and keeps objective attempts separate from SRS', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  const exam = { ...deck, metadata: { pedagogy: { lesson_type: 'assessment', competencies: [{ id: 'synthetic' }],
    assessment: { schema_version: 1, required_count: 1, bonus_count: 1,
      bands: [{ id: 'all', title: 'Synthetic band', min: 0, max: 1 }], review_routes: [] } } } };
  const tasks = cards.slice(0, 2).map((card, i) => ({ ...card, content_v2: { schema_version: 2,
    card: { type: i ? 'free_text' : 'trainer', metadata: { assessment: { competency_ids: ['synthetic'] } },
      data: i ? { prompt: 'Write a sentence.', sample_answer: 'Ich lerne.' }
        : { parts: [{ type: 'text', text: 'Ich ' }, { type: 'input', answers: ['lerne'] }] } } } }));
  let list, grades = 0;
  await page.route('**/api/decks/1/cards*', route => { list = route; });
  await page.route('**/api/study/grade', route => { grades++; return route.fulfill({ json: {} }); });
  await page.route('**/api/knowledge/decks/1*', route => route.fulfill({ json: { card_ids: [1, 2],
    knowledge_items: [{ id: 10, name: 'Synthetic skill' }],
    card_knowledge_items: tasks.map(card => ({ card_id: card.id, knowledge_item_id: 10, role: 'primary' })) } }));
  await page.evaluate(exam => { window.opening = studyNavigation.startStudy(exam); }, exam);
  await expect.poll(() => Boolean(list)).toBe(true);
  expect(await page.evaluate(() => sessionStore.getState().assessment)).toBeNull();
  await list.fulfill({ json: tasks });
  await page.evaluate(() => opening);
  await expect(page.locator('.assessment-view')).toBeVisible();
  await page.locator('.assessment-actions button').last().click();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStore.getState().assessment.results).length)).toBe(1);
  await page.locator('.assessment-actions button').last().click();
  await expect.poll(() => page.evaluate(() => sessionStore.getState().assessment.index)).toBe(1);
  await page.locator('.assessment-actions button').last().click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(2);
  expect(grades).toBe(0);
});

test('closing the page during KI loading retains a confirmed grade and syncs its evidence after reopen', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  let knowledge, grades = 0;
  await page.route('**/api/knowledge/decks/1*', route => { knowledge = route; });
  await page.route('**/api/study/grade', route => { grades++; return route.fulfill({ json: { status: 'success' } }); });
  await page.evaluate(() => studyNavigation.startStudy(deckStore.getState().currentDeck));
  await expect.poll(() => Boolean(knowledge)).toBe(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect.poll(() => page.evaluate(async () => {
    const row = (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray())[0];
    return row?.sync_status;
  })).toBe('awaiting_content');
  const eventId = await page.evaluate(async () => (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray())[0].client_event_id);
  await page.close();
  const reopened = await context.newPage();
  await knowledgeSetup(reopened, context);
  let sent;
  await reopened.route('**/api/knowledge/attempts/sync', route => {
    sent = route.request().postDataJSON().attempts;
    return route.fulfill({ json: { results: sent.map(row => ({ client_event_id: row.client_event_id, status: 'created' })) } });
  });
  await reopened.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(1));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ client_event_id: eventId, knowledge_item_id: 10 });
  expect(await reopened.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(0);
  expect(grades).toBe(1);
  await reopened.close();
});

async function knowledgeSetup(page, context, { mapped = true, unavailable = false } = {}) {
  await setup(page, context);
  await page.route('**/api/knowledge/decks/1*', route => route.fulfill(unavailable
    ? { status: 503, json: { detail: 'Unavailable' } }
    : { json: { card_ids: [1, 2, 3], knowledge_items: mapped ? [{ id: 10, name: 'Synthetic skill' }] : [],
      card_knowledge_items: mapped ? [{ card_id: 1, knowledge_item_id: 10, role: 'primary' }] : [] } }));
  await page.route('**/api/decks/1/next*', route => route.fulfill({ json: cards[0] }));
  await page.evaluate(async () => {
    const { stopKnowledgeSync } = await import('/src/services/knowledgeSyncOrchestrator.js');
    stopKnowledgeSync();
  });
}

test('ordinary cold start loads KI; only confirmed grade creates one attempt; sync acknowledges it', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  await page.evaluate(() => studyNavigation.startStudy(deckStore.getState().currentDeck));
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  const outbox = () => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray());
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(await outbox()).toHaveLength(0);
  await gradeRoute.fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.gradePromise);
  await expect.poll(async () => (await outbox()).length).toBe(1);
  const [attempt] = await outbox();
  expect(attempt.knowledge_item_id).toBe(10);
  expect(attempt.evaluation_data.rating).toBe('good');
  await page.route('**/api/knowledge/attempts/sync', route => route.fulfill({ json: { results:
    route.request().postDataJSON().attempts.map(a => ({ client_event_id: a.client_event_id, status: 'created' })) } }));
  const result = await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(1));
  expect(result.succeededCount).toBe(1);
  expect(await outbox()).toHaveLength(0);
});

test('opening an individual ordinary card also prepares KI before grading', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  await page.route('**/api/study/grade', route => route.fulfill({ json: { status: 'success' } }));
  await page.evaluate(() => studyNavigation.startStudyCard(deckStore.getState().currentDeck, 1));
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(1);
});

for (const unavailable of [false, true]) {
  test(`ordinary study continues without evidence when KI ${unavailable ? 'request fails' : 'mapping is absent'}`, async ({ page, context }) => {
    await knowledgeSetup(page, context, { mapped: false, unavailable });
    let grades = 0;
    await page.route('**/api/study/grade', route => { grades++; return route.fulfill({ json: { status: 'success' } }); });
    await page.evaluate(() => studyNavigation.startStudy(deckStore.getState().currentDeck));
    await page.evaluate(() => studyActions.submitGrade(2));
    expect(grades).toBe(1);
    expect(await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(0);
    expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
  });
}

test('offline ordinary grade persists progress, review and attempt until reconnect', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  await page.evaluate(async ({ deck, cards }) => {
    await studyNavigation.startStudy(deck);
    const database = (await import('/src/services/localDb.js')).getLocalDb();
    await database.decks.put({ ...deck, user_id: 1 });
    await database.cards.bulkPut(cards);
  }, { deck, cards });
  await context.setOffline(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(1);
  const persisted = await page.evaluate(async () => {
    const database = (await import('/src/services/localDb.js')).getLocalDb();
    return { progress: await database.progress.get([1, 1]),
      reviews: await database.syncState.filter(row => row.key.startsWith('review:')).toArray() };
  });
  expect(persisted.progress.is_dirty).toBe(1);
  expect(persisted.progress.last_reviewed).toBeTruthy();
  expect(persisted.reviews).toHaveLength(1);
  await context.setOffline(false);
  await page.route('**/api/knowledge/attempts/sync', route => route.fulfill({ json: { results:
    route.request().postDataJSON().attempts.map(a => ({ client_event_id: a.client_event_id, status: 'duplicate' })) } }));
  expect((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(1))).succeededCount).toBe(1);
});

test('Next/Back show cached cards with HTTP pending; refresh updates the matching history and cache', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.getByTitle('Next card', { exact: true }).click();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => ({ id: sessionStore.getState().card.id, index: sessionStore.getState().historyIndex,
    loading: uiStore.getState().loading }))).toEqual({ id: 2, index: 1, loading: false });
  await page.getByTitle('Previous card', { exact: true }).click();
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(2);
  await pending[0].fulfill({ json: { ...cards[1], queue: 'review', interval: 17, repetitions: 4 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().studyHistory[1].interval)).toBe(17);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  expect(await page.evaluate(() => deckStore.getState().deckCards[1].repetitions)).toBe(4);
  await page.getByTitle('Next card', { exact: true }).click();
  expect(await page.evaluate(() => [sessionStore.getState().historyIndex, sessionStore.getState().card.interval])).toEqual([1, 17]);
});

test('failed background refresh retains the local card and history', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goNext());
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ status: 500, json: { detail: 'Refresh failed' } });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex, sessionStore.getState().apiError])).toEqual([2, 1, null]);
});

test('Back prepends a local card immediately and duplicates retain their sequence', async ({ page, context }) => {
  await setup(page, context, true);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goBack());
  await expect.poll(() => pending.length).toBe(1);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id)])).toEqual([3, 0, [3, 1]]);
  await page.evaluate(() => studyActions.goNext());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await page.evaluate(() => studyActions.goNext());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
});

test('grade after Back immediately uses forward history and ignores older refresh and server choice', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => studyActions.goNext());
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON().card_id).toBe(1);
  expect(gradeRoute.request().postDataJSON().return_next).toBe(false);
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await gradeRoute.fulfill({ json: { ...cards[2], queue: 'review', interval: 23 } });
  await page.evaluate(() => window.gradePromise);
  await pending[0].fulfill({ json: { ...cards[1], interval: 999 } });
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id)])).toEqual([2, 1, [1, 2]]);
});

test('background grade failure remains visible, keeps newer history, and blocks regrading until acknowledged', async ({ page, context }) => {
  await setup(page, context);
  await page.route('**/api/study/grade', route => route.fulfill({ status: 500, json: { detail: 'Save failed' } }));
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.length, uiStore.getState().loading])).toEqual([2, 1, 2, false]);
  await expect(page.locator('.study-grade-error')).toContainText('Save failed');
  await page.evaluate(() => studyActions.goBack());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(() => sessionStore.getState().resetSession());
  await expect(page.locator('.study-grade-error')).toContainText('Save failed');
});

test('grade rejection is readable in Russian and does not hide the new card', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await setup(page, context, false, 'ru');
  await page.route('**/api/study/grade', route => route.fulfill({ status: 403, json: { detail: 'Нет доступа к колоде' } }));
  await page.locator('.btn-grade.grade-2').click();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect(page.locator('.study-grade-error')).toContainText('Оценка карточки №1 не подтверждена');
  await expect(page.locator('.study-grade-error button')).toHaveText('Понятно');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('grade-error-ru-375.png'), fullPage: true });
});

test('rapid grades advance independently; reverse responses cannot rewind and stale handlers cannot grade the new card', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.evaluate(() => {
    const submit = studyActions.submitGrade;
    window.firstGrade = submit(2);
    submit(2); // Same rendered card: do not rate its successor.
  });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.secondGrade = studyActions.submitGrade(3); });
  await expect(page.getByText(cards[2].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending.map(route => route.request().postDataJSON().card_id)).toEqual([1, 2]);
  await pending[1].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.secondGrade);
  await pending[0].fulfill({ json: { finished: true } });
  await page.evaluate(() => window.firstGrade);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex,
    sessionStore.getState().studyHistory.map(c => c.id), Object.keys(sessionStore.getState().pendingGrades).length])).toEqual([3, 2, [1, 2, 3], 0]);
  await page.evaluate(() => studyActions.goBack());
  await page.evaluate(() => studyActions.goBack());
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
});

test('real grade button double click sends only one request even after instant advance', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.locator('.btn-grade.grade-2').dblclick();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0].request().postDataJSON().card_id).toBe(1);
  await page.evaluate(() => studyActions.goBack());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(pending.length).toBe(1);
  await pending[0].fulfill({ json: { status: 'success' } });
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
});

test('opening-card refresh cannot rewind an instant grade or overwrite its progress', async ({ page, context }) => {
  await setup(page, context);
  const refresh = await holdRefresh(page);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(deck => studyNavigation.startStudyCard(deck, 1), deck);
  await expect.poll(() => refresh.length).toBe(1);
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await refresh[0].fulfill({ json: { ...cards[0], interval: 999 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().studyHistory[0].interval)).toBe(0);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
  await gradeRoute.fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.gradePromise);
});

test('newer refresh wins across the opening and study hook instances', async ({ page, context }) => {
  await setup(page, context);
  const refresh = await holdRefresh(page);
  await page.evaluate(deck => studyNavigation.startStudyCard(deck, 1), deck);
  await expect.poll(() => refresh.length).toBe(1);
  await page.evaluate(() => studyActions.refreshCard(sessionStore.getState().card));
  await expect.poll(() => refresh.length).toBe(2);
  await refresh[1].fulfill({ json: { ...cards[0], interval: 12 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(12);
  await refresh[0].fulfill({ json: { ...cards[0], interval: 3 } });
  const stored = await page.evaluate(() => [sessionStore.getState().card.interval,
    sessionStore.getState().studyHistory[0].interval, deckStore.getState().deckCards[0].interval]);
  expect(stored).toEqual([12, 12, 12]);
});

for (const change of ['reset', 'deck', 'navigation']) {
  test(`pending grade and refresh cannot change state after ${change}`, async ({ page, context }) => {
    await setup(page, context);
    const refresh = await holdRefresh(page);
    let gradeRoute;
    await page.route('**/api/study/grade', route => { gradeRoute = route; });
    await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
    await expect.poll(() => Boolean(gradeRoute)).toBe(true);
    await expect.poll(() => refresh.length).toBe(1);
    await page.evaluate(({ change, card }) => {
      if (change === 'reset') sessionStore.getState().resetSession();
      if (change === 'deck') {
        deckStore.getState().setCurrentDeck({ id: 99 });
        deckStore.getState().setCurrentDeck({ id: 1 }); // Even leave/return invalidates.
      }
      if (change === 'navigation') {
        uiStore.getState().setView('cards');
        uiStore.getState().setView('study');
      }
      sessionStore.getState().addToHistory(card);
    }, { change, card: { ...cards[1], interval: 44 } });
    await gradeRoute.fulfill({ json: cards[0] });
    await page.evaluate(() => window.gradePromise);
    await refresh[0].fulfill({ json: { ...cards[1], interval: 999 } });
    await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(44);
    expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(2);
  });
}

test('uncached grade waits for server selection but ignores it after navigation', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(() => deckStore.getState().setDeckCards([sessionStore.getState().card]));
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON().return_next).toBe(true);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(card => { sessionStore.getState().addToHistory(card); }, cards[2]);
  await gradeRoute.fulfill({ json: cards[1] });
  await page.evaluate(() => window.gradePromise);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(3);
});

test('forced grade uses the server context and exclusions when no forward history is available', async ({ page, context }) => {
  await setup(page, context);
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.evaluate(() => {
    sessionStore.getState().setIsLearningMore(true);
    sessionStore.getState().markForcedSeen(1);
    window.gradePromise = studyActions.submitGrade(2);
  });
  await expect.poll(() => Boolean(gradeRoute)).toBe(true);
  expect(gradeRoute.request().postDataJSON()).toMatchObject({ return_next: true, review_context: 'forced', exclude_ids: [1] });
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  await gradeRoute.fulfill({ json: cards[2] });
  await page.evaluate(() => window.gradePromise);
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().forcedSeenIds])).toEqual([3, [1, 3]]);
});

test('last uncached grade waits for earlier writes before server selection and finishes cleanly', async ({ page, context }) => {
  await setup(page, context);
  const pending = [];
  await page.route('**/api/study/grade', route => pending.push(route));
  await page.evaluate(() => { window.firstGrade = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.secondGrade = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[2].front, { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.lastGrade = studyActions.submitGrade(2); });
  await expect.poll(() => pending.length).toBe(2);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await pending[0].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.firstGrade);
  expect(pending.length).toBe(2);
  await pending[1].fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.secondGrade);
  await expect.poll(() => pending.length).toBe(3);
  expect(pending[2].request().postDataJSON()).toMatchObject({ card_id: 3, return_next: true });
  await pending[2].fulfill({ json: { finished: true } });
  await page.evaluate(() => window.lastGrade);
  expect(await page.evaluate(() => [sessionStore.getState().isSessionFinished, sessionStore.getState().card,
    Object.keys(sessionStore.getState().pendingGrades).length])).toEqual([true, null, 0]);
});

test('uncached grade rejection preserves its current card and can be acknowledged', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(() => deckStore.getState().setDeckCards([]));
  await page.route('**/api/study/grade', route => route.fulfill({ status: 422, json: { detail: 'Invalid grade' } }));
  await page.evaluate(() => studyActions.submitGrade(2));
  expect(await page.evaluate(() => [sessionStore.getState().card.id, sessionStore.getState().historyIndex])).toEqual([1, 0]);
  await expect(page.locator('.study-grade-error')).toContainText('Invalid grade');
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.locator('.study-grade-error button').click();
  await expect(page.locator('.study-grade-error')).toHaveCount(0);
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
});

test('forced Next waits for SRS instead of selecting the local neighbor', async ({ page, context }) => {
  await setup(page, context);
  let nextRoute;
  await page.route('**/api/decks/1/next*', route => { nextRoute = route; });
  await page.evaluate(() => {
    sessionStore.getState().setIsLearningMore(true);
    sessionStore.getState().markForcedSeen(1);
    window.nextPromise = studyActions.goNext();
  });
  await expect.poll(() => Boolean(nextRoute)).toBe(true);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(1);
  expect(new URL(nextRoute.request().url()).searchParams.get('review_context')).toBe('forced');
  await nextRoute.fulfill({ json: cards[2] });
  await page.evaluate(() => window.nextPromise);
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(3);
});

test('reset to the same card rejects the previous session refresh', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  await page.evaluate(() => studyActions.goNext());
  await expect.poll(() => pending.length).toBe(1);
  await page.evaluate(card => {
    sessionStore.getState().resetSession();
    sessionStore.getState().addToHistory(card);
  }, cards[1]);
  const refreshed = page.waitForResponse(response => response.url().includes('/study/card/2'));
  await pending[0].fulfill({ json: { ...cards[1], interval: 999 } });
  await refreshed;
  expect(await page.evaluate(() => sessionStore.getState().card.interval)).toBe(0);
});

test('missing audio generates and plays through existing autoPlay; late refresh preserves audio', async ({ page, context }) => {
  await setup(page, context);
  const pending = await holdRefresh(page);
  const audio = '/api/media/audio/generated.wav';
  let gradeRoute;
  await page.route('**/api/study/grade', route => { gradeRoute = route; });
  await page.route('**/api/media/generate-card-audio', route => route.fulfill({ json: { path: 'generated.wav', url: audio } }));
  await page.evaluate(() => settingsStore.setState({ autoPlay: true }));
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  await expect.poll(() => page.evaluate(() => window.audioPlayCalls || 0)).toBeGreaterThan(0);
  await expect.poll(() => pending.length).toBe(1);
  await pending[0].fulfill({ json: { ...cards[1], audio_url: null, audio_path: null, interval: 9 } });
  await expect.poll(() => page.evaluate(() => sessionStore.getState().card.interval)).toBe(9);
  expect(await page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  await gradeRoute.fulfill({ json: { status: 'success' } });
  await page.evaluate(() => window.gradePromise);
});

test('grade displays ready audio immediately without generating it', async ({ page, context }) => {
  await setup(page, context);
  const audio = '/api/media/audio/ready.wav';
  let generations = 0;
  await page.route('**/api/media/generate-card-audio', route => { generations += 1; return route.fulfill({ json: {} }); });
  await page.route('**/api/study/grade', () => {});
  await holdRefresh(page);
  await page.evaluate(({ cards, audio }) => {
    deckStore.getState().setDeckCards(cards.map(card => ({ ...card, audio_path: 'ready.wav', audio_url: audio })));
    sessionStore.getState().updateCardInSession(1, { audio_path: 'ready.wav', audio_url: audio });
    settingsStore.setState({ autoPlay: true });
  }, { cards, audio });
  await page.evaluate(() => { window.gradePromise = studyActions.submitGrade(2); });
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.audioPlayCalls || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => sessionStore.getState().card.audio_url)).toBe(audio);
  expect(generations).toBe(0);
});

for (const width of [320, 375, 430, 768, 1280]) {
  test(`card transition layout ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context);
    await holdRefresh(page);
    await page.getByTitle('Next card', { exact: true }).click();
    await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
    await expect(page.locator('#tut-study-card')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`study-${width}.png`), fullPage: true });
    await page.route('**/api/study/grade', route => route.fulfill({ status: 403, json: { detail: 'Access denied. Grade was not saved.' } }));
    await page.evaluate(() => studyActions.submitGrade(2));
    await expect(page.locator('.study-grade-error')).toContainText('Access denied');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`grade-error-${width}.png`), fullPage: true });
  });
}

test('confirmed grade updates deck card cache after leaving study view and rejects stale overwrite', async ({ page, context }) => {
  await setup(page, context);
  const pendingGrades = [];
  await page.route('**/api/study/grade', route => { pendingGrades.push(route); });
  await page.evaluate(cards => {
    const fresh = cards.map(card => ({ ...card, queue: 'new', interval: 0, repetitions: 0, _studyFetchedAt: Date.now(), _studyContext: 'scheduled' }));
    deckStore.getState().setDeckCards(fresh);
    sessionStore.getState().updateCardInSession(1, fresh[0]);
  }, cards);

  // Start grade 1 while `!localNext`? Actually when fresh card 2 exists in deck, localNext is card 2 and submitGrade navigates to card 2,
  // OR switching view to 'decks' makes scope.isCurrent() false before the server responds!
  await page.evaluate(() => { window.grade1 = studyActions.submitGrade(2); });
  await expect.poll(() => pendingGrades.length).toBe(1);
  await page.evaluate(() => uiStore.getState().setView('decks'));
  await pendingGrades[0].fulfill({ json: {
    status: 'success',
    graded_progress: { id: 1, queue: 'review', interval: 15, repetitions: 2, last_reviewed: '2026-11-17T10:00:00Z', intervals: { 2: '15 days' } },
  } });
  await page.evaluate(() => window.grade1);
  expect(await page.evaluate(() => deckStore.getState().cardsByDeck[1].find(c => c.id === 1).interval)).toBe(15);

  // Overlapping stale overwrite check: re-study card 1, start an older grade that resolves AFTER a newer progress arrives.
  pendingGrades.length = 0;
  await page.route('**/api/decks/1/next*', route => route.fulfill({ json: { ...cards[0], queue: 'review', interval: 15, repetitions: 2 } }));
  await page.evaluate(() => studyNavigation.startStudyCard(deckStore.getState().currentDeck, 1));
  await page.evaluate(() => { window.staleGrade = studyActions.submitGrade(2); });
  await expect.poll(() => pendingGrades.length).toBe(1);
  await page.evaluate(() => {
    deckStore.getState().updateCardLocal(1, {
      queue: 'review', interval: 30, repetitions: 3, last_reviewed: '2026-11-17T11:00:00Z',
      _studyProgressAt: Date.now() + 5000, _studyProgressStartedAt: Date.now() + 5000,
    }, 1);
  });
  await pendingGrades[0].fulfill({ json: {
    status: 'success',
    graded_progress: { id: 1, queue: 'review', interval: 18, repetitions: 2, last_reviewed: '2026-11-17T10:30:00Z', intervals: { 2: '18 days' } },
  } });
  await page.evaluate(() => window.staleGrade);
  expect(await page.evaluate(() => deckStore.getState().cardsByDeck[1].find(c => c.id === 1).interval)).toBe(30);
});

test('cold offline grade without local deck row retains Knowledge evidence and graded progress', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  await page.route('**/api/decks/1/cards*', () => {});
  await page.evaluate(async deck => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    await db.cards.clear();
    await db.decks.clear();
    deckStore.setState({ deckCards: [], cardsByDeck: {} });
    await studyNavigation.startStudy(deck);
  }, deck);
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(1);
  expect(await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().syncState.filter(r => r.key.startsWith('review:')).count())).toBe(1);
  expect(await page.evaluate(async () => Boolean(await (await import('/src/services/localDb.js')).getLocalDb().progress.get([1, 1])))).toBe(true);
  expect(await page.evaluate(() => Object.keys(sessionStore.getState().gradeErrors).length)).toBe(0);
  expect(Boolean(await page.evaluate(() => sessionStore.getState().apiError))).toBe(true);
  await expect(page.locator('.study-error-message')).toBeVisible();
  await expect(page.locator('#tut-study-card')).toHaveCount(0);
});

test('cold finished deck still fetches cards and renders next review date', async ({ page, context }) => {
  await setup(page, context, false, 'ru');
  const futureCards = cards.map((card, i) => ({ ...card, queue: 'review', interval: 10 + i, next_review: '2026-12-01T10:00:00Z' }));
  let cardsFetched = 0;
  await page.route('**/api/decks/1/next*', route => route.fulfill({ json: { finished: true } }));
  await page.route('**/api/decks/1/cards*', route => { cardsFetched++; return route.fulfill({ json: futureCards }); });
  await page.evaluate(async deck => {
    deckStore.setState({ deckCards: [], cardsByDeck: {}, cardsLoading: false });
    await studyNavigation.startStudy(deck);
  }, deck);
  await expect.poll(() => cardsFetched).toBe(1);
  await expect.poll(() => page.evaluate(() => deckStore.getState().cardsLoading)).toBe(false);
  expect(await page.evaluate(() => deckStore.getState().deckCards.length)).toBe(3);
  await expect(page.locator('.finished-view')).toBeVisible();
  await expect(page.locator('.finished-view')).toContainText('Следующее повторение:');
});

test('incomplete offline deck cache preserves grade and Knowledge without false completion and retries cleanly', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  const largeDeck = { ...deck, stats: { total: 10, new: 10, due: 0, learning: 0 } };
  let releaseCards;
  await page.route('**/api/decks/1/cards*', route => { releaseCards = route; });
  const nextUrls = [];
  await page.route('**/api/decks/1/next*', route => {
    nextUrls.push(route.request().url());
    return route.fulfill({ json: cards[nextUrls.length === 1 ? 0 : 1] });
  });
  await page.evaluate(async largeDeck => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    await db.cards.clear();
    await db.decks.put({ ...largeDeck, user_id: 1, role: 'owner' });
    await db.syncState.clear();
    deckStore.setState({ currentDeck: largeDeck, deckCards: [], cardsByDeck: {} });
    await studyNavigation.startStudy(largeDeck);
  }, largeDeck);
  await expect(page.getByText(cards[0].front, { exact: true }).first()).toBeVisible();
  await expect.poll(() => Boolean(releaseCards)).toBe(true);

  await releaseCards.abort('internetdisconnected');
  await context.setOffline(true);
  await page.evaluate(() => studyActions.submitGrade(2));
  await expect.poll(() => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(1);
  expect(await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().syncState.filter(r => r.key.startsWith('review:')).count())).toBe(1);
  expect(await page.evaluate(() => sessionStore.getState().isSessionFinished)).toBe(false);
  expect(await page.evaluate(() => Object.keys(sessionStore.getState().gradeErrors).length)).toBe(0);
  await expect(page.locator('.study-error-message')).toBeVisible();
  await expect(page.locator('#tut-study-card')).toHaveCount(0);

  // Retry while still offline keeps retry state and does not show completion or re-grade card 1.
  await page.getByRole('button', { name: /Повторить запрос|Retry/i }).click();
  await expect(page.locator('.study-error-message')).toBeVisible();
  expect(await page.evaluate(() => sessionStore.getState().isSessionFinished)).toBe(false);

  // Reconnect and retry loads card 2 cleanly without duplicate grade/attempt or re-presenting card 1.
  await context.setOffline(false);
  await page.getByRole('button', { name: /Повторить запрос|Retry/i }).click();
  await expect(page.getByText(cards[1].front, { exact: true }).first()).toBeVisible();
  expect(nextUrls[1]).toContain('exclude_ids=1');
  expect(await page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count())).toBe(1);
});

test('ordinary study always starts with server SRS middle card on cold and warm cache', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  const tenCards = Array.from({ length: 10 }, (_, i) => ({
    ...cards[0], id: i + 1, position: i, front: `SRS Word ${i + 1}`, back: `SRS Answer ${i + 1}`,
    content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: `SRS Word ${i + 1}`, answer: `SRS Answer ${i + 1}` }, info: [] } },
  }));
  await page.route('**/api/decks/1/next*', route => route.fulfill({ json: tenCards[5] }));
  await page.route('**/api/decks/1/cards*', route => route.fulfill({ json: tenCards }));

  // Cold start
  await page.evaluate(async deck => {
    deckStore.setState({ deckCards: [], cardsByDeck: {} });
    await studyNavigation.startStudy(deck);
  }, deck);
  await expect(page.getByText('SRS Word 6', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(6);

  // Warm start with full deckCards in memory (must NOT fall back to tenCards[0])
  await expect.poll(() => page.evaluate(() => deckStore.getState().deckCards.length)).toBe(10);
  await page.evaluate(deck => studyNavigation.startStudy(deck), deck);
  await expect(page.getByText('SRS Word 6', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => sessionStore.getState().card.id)).toBe(6);
});

test('CardList opens card from main card surface and search with 0 extra HTTP while preserving controls and scroll', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, context, false, 'ru');
  const fortyFiveCards = Array.from({ length: 45 }, (_, i) => ({
    ...cards[0], id: i + 1, position: i,
    front: `List Word ${i + 1}${i === 0 ? ' '.repeat(1) + 'long '.repeat(35) : ''}`,
    back: `List Answer ${i + 1}`,
    content_v2: { schema_version: 2, card: { type: 'standard',
      data: { prompt: `List Word ${i + 1}${i === 0 ? ' long'.repeat(35) : ''}`, answer: `List Answer ${i + 1}` }, info: [] } },
  }));
  let listCalls = 0, studyCardCalls = 0, editorCardCalls = 0;
  await page.route('**/api/decks', route => route.fulfill({ json: [{ ...deck, folder_id: null, role: 'owner', is_learning: true }] }));
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/decks/1/cards*', route => { listCalls++; return route.fulfill({ json: fortyFiveCards }); });
  await page.route('**/api/study/card/*', route => { studyCardCalls++; return route.fulfill({ json: fortyFiveCards[0] }); });
  await page.route('**/api/cards/*', route => {
    if (route.request().url().includes('/api/cards/search')) return route.fallback();
    editorCardCalls++;
    return route.fulfill({ json: fortyFiveCards[0] });
  });
  await page.route('**/api/cards/search*', route => route.fulfill({ json: { cards: [fortyFiveCards[1]] } }));

  await page.evaluate(async ({ deck, fortyFiveCards }) => {
    const fresh = fortyFiveCards.map(c => ({ ...c, _studyFetchedAt: Date.now(), _studyIdentity: JSON.parse(localStorage.getItem('lerne_auth_v2_session')).refresh_token, _studyContext: 'scheduled' }));
    deckStore.setState({ decks: [{ ...deck, folder_id: null, role: 'owner', is_learning: true }], currentDeck: { ...deck, role: 'owner' }, deckCards: fresh, cardsByDeck: { 1: fresh }, cardsLoading: false });
    uiStore.getState().setView('cards');
  }, { deck, fortyFiveCards });
  await page.locator('#card-item-1').waitFor();

  // Expand button expands text without opening study
  await page.locator('#card-item-1 .card-expand-btn').click();
  expect(await page.evaluate(() => uiStore.getState().view)).toBe('cards');

  // Action button opens action modal without opening study
  await page.locator('#card-item-1 .card-item-actions-trigger').click();
  await expect(page.locator('.modal-content, .card-action-modal')).toBeVisible();
  expect(await page.evaluate(() => uiStore.getState().view)).toBe('cards');
  await page.keyboard.press('Escape');

  // Select mode toggles selection without navigating to study
  await page.getByTitle('Выбрать несколько карточек').click();
  await page.locator('#card-item-2').click();
  expect(await page.evaluate(() => uiStore.getState().view)).toBe('cards');
  await expect(page.locator('#card-item-2')).toHaveClass(/is-selected/);
  await page.getByTitle('Выйти из режима выбора').click();

  // Scroll down, click outer card surface/padding (inside 18px radius, outside .card-item-text) -> opens card in Study with 0 study/card HTTP!
  await page.evaluate(() => { document.getElementById('app-container').scrollTop = 300; });
  studyCardCalls = 0;
  const cardItem2 = page.locator('#card-item-2');
  const box = await cardItem2.boundingBox();
  await page.mouse.click(box.x + box.width - 20, box.y + 8);
  await expect.poll(() => page.evaluate(() => [uiStore.getState().view, sessionStore.getState().card?.id])).toEqual(['study', 2]);
  expect(studyCardCalls).toBe(0);

  // Back returns to CardList preserving lastSelectedCardId & scroll position
  await page.locator('.view-study .back-btn').click({ force: true });
  await page.locator('#card-item-2').waitFor();
  expect(await page.evaluate(() => uiStore.getState().lastSelectedCardId)).toBe(2);

  // CardList search -> click card opens Study immediately with 0 HTTP!
  await page.locator('.view-cards [title*="Поиск"]').click();
  await page.locator('.view-cards .card-search-input').fill('List Word 30');
  const cornerBox = await page.locator('#card-item-30 .card-item-corner-number').boundingBox();
  await page.mouse.click(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
  await expect.poll(() => page.evaluate(() => [uiStore.getState().view, sessionStore.getState().card?.id])).toEqual(['study', 30]);
  expect(studyCardCalls).toBe(0);

  // DeckGrid search -> click card surface when deck already in memory opens CardList with 0 redundant /cards HTTP!
  await page.locator('.view-study .back-btn').click({ force: true });
  await page.locator('.view-cards .back-btn').click({ force: true });
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.locator('#deck-item-1').waitFor();
  listCalls = 0;
  await page.locator('[title*="Поиск"]').first().click();
  await page.locator('.card-search-input').first().fill('List Word 2');
  await page.locator('.search-card-item-styled').first().waitFor();
  const sBox = await page.locator('.search-card-item-styled').first().boundingBox();
  await page.mouse.click(sBox.x + sBox.width - 20, sBox.y + 8);
  await expect.poll(() => page.evaluate(() => [uiStore.getState().view, uiStore.getState().lastSelectedCardId])).toEqual(['cards', 2]);
  expect(listCalls).toBe(0);
  void editorCardCalls;
});

test('offline incomplete deck cache is never treated as fresh across deck open, CardList, global search, and Study after reconnect', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, context, false, 'ru');
  const tenCards = Array.from({ length: 10 }, (_, i) => ({
    ...cards[0], id: i + 1, position: i,
    front: `Offline Word ${i + 1}`, back: `Offline Answer ${i + 1}`,
    content_v2: { schema_version: 2, card: { type: 'standard',
      data: { prompt: `Offline Word ${i + 1}`, answer: `Offline Answer ${i + 1}` }, info: [] } },
  }));
  const largeDeck = { ...deck, folder_id: null, role: 'owner', is_learning: true, stats: { total: 10, new: 10, due: 0, learning: 0 } };
  let listCalls = 0;
  await page.route('**/api/decks', route => route.fulfill({ json: [largeDeck] }));
  await page.route('**/api/folders', route => route.fulfill({ json: [] }));
  await page.route('**/api/decks/1/next*', route => route.fulfill({ json: tenCards[0] }));
  await page.route('**/api/decks/1/cards*', route => { listCalls++; return route.fulfill({ json: tenCards }); });
  await page.route('**/api/knowledge/decks/1*', route => route.fulfill({ json: { card_ids: [], knowledge_items: [], card_knowledge_items: [] } }));
  await page.route('**/api/cards/search*', route => route.fulfill({ json: { cards: [tenCards[0]] } }));

  const seedPartialOffline = async () => {
    await context.setOffline(false);
    await page.evaluate(async ({ largeDeck, firstCard }) => {
      const db = (await import('/src/services/localDb.js')).getLocalDb();
      await db.cards.clear();
      await db.cards.put(firstCard);
      await db.decks.put({ ...largeDeck, user_id: 1, role: 'owner' });
      await db.syncState.clear();
      await db.syncState.put({ key: 'deck-cards:1', complete: false, fetched_at: Date.now() });
      deckStore.setState({ decks: [largeDeck], currentDeck: null, deckCards: [], cardsByDeck: {}, cardsCompleteByDeck: {}, cardsLoading: false });
      uiStore.getState().setView('decks');
    }, { largeDeck, firstCard: tenCards[0] });
    await page.locator('#deck-item-1').waitFor();
    await context.setOffline(true);
    await page.locator('#deck-item-1').click();
    await page.locator('.deck-intro-btn-list').click();
    await expect(page.locator('.card-item-draggable')).toHaveCount(1);
    listCalls = 0;
  };

  // 1. Re-opening deck from DeckGrid within 60s after reconnect must fetch all 10 cards.
  await seedPartialOffline();
  await page.locator('.view-cards .back-btn').click({ force: true });
  await page.getByRole('button', { name: 'Назад' }).click();
  await context.setOffline(false);
  listCalls = 0;
  await page.locator('#deck-item-1').click();
  await page.locator('.deck-intro-btn-list').click();
  await expect(page.locator('.card-item-draggable')).toHaveCount(10);
  expect(listCalls).toBeGreaterThanOrEqual(1);

  // 2. Re-entering CardList directly from DeckIntro after reconnect must fetch all 10 cards.
  await seedPartialOffline();
  await page.locator('.view-cards .back-btn').click({ force: true });
  await context.setOffline(false);
  listCalls = 0;
  await page.locator('.deck-intro-btn-list').click();
  await expect(page.locator('.card-item-draggable')).toHaveCount(10);
  expect(listCalls).toBeGreaterThanOrEqual(1);

  // 3. Selecting card #1 (already in partial cache) from global search after reconnect must fetch all 10 cards.
  await seedPartialOffline();
  await page.locator('.view-cards .back-btn').click({ force: true });
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.locator('#deck-item-1').waitFor();
  await context.setOffline(false);
  listCalls = 0;
  await page.locator('[title*="Поиск"]').first().click();
  await page.locator('.card-search-input').first().fill('Offline Word 1');
  await page.locator('.search-card-item-styled').first().click();
  await expect(page.locator('.card-item-draggable')).toHaveCount(10);
  expect(listCalls).toBeGreaterThanOrEqual(1);

  // 4. Starting ordinary Study after reconnect within 60s must not skip background full list fetch.
  await seedPartialOffline();
  await page.locator('.view-cards .back-btn').click({ force: true });
  await context.setOffline(false);
  listCalls = 0;
  await page.getByRole('button', { name: /Начать занятие|Учить/i }).first().click();
  await expect.poll(() => page.evaluate(() => deckStore.getState().deckCards.length)).toBe(10);
  expect(listCalls).toBeGreaterThanOrEqual(1);

  // 5. Staying on CardList during offline -> online transition refreshes the incomplete list automatically.
  await seedPartialOffline();
  await context.setOffline(false);
  await expect(page.locator('.card-item-draggable')).toHaveCount(10);
  expect(listCalls).toBeGreaterThanOrEqual(1);
});

test('Next on an incomplete offline deck cache never falsely finishes the session', async ({ page, context }) => {
  await knowledgeSetup(page, context);
  const largeDeck = { ...deck, stats: { total: 100, new: 100, due: 0, learning: 0 } };
  let heldCards;
  await page.route('**/api/decks/1/cards*', route => { heldCards = route; });
  await page.evaluate(async largeDeck => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    await db.cards.clear();
    await db.syncState.clear();
    await db.decks.put({ ...largeDeck, user_id: 1, role: 'owner' });
    deckStore.setState({ currentDeck: largeDeck, deckCards: [], cardsByDeck: {}, cardsCompleteByDeck: {} });
    await studyNavigation.startStudy(largeDeck);
  }, largeDeck);
  await expect.poll(() => Boolean(heldCards)).toBe(true);
  await context.setOffline(true);
  await heldCards.abort('internetdisconnected');
  await expect.poll(() => page.evaluate(() => deckStore.getState().deckCards.length)).toBe(1);
  expect(await page.evaluate(() => deckStore.getState().cardsCompleteByDeck[1])).toBe(false);
  await page.evaluate(() => studyActions.goNext());
  expect(await page.evaluate(() => sessionStore.getState().isSessionFinished)).toBe(false);
  expect(await page.evaluate(() => sessionStore.getState().card?.id)).toBe(1);
});
