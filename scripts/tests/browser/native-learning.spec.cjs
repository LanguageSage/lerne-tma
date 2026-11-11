const { test, expect } = require('./isolated-fixture.cjs');
const { chromium } = require('@playwright/test');
const fixture = JSON.parse(process.env.LERNE_NATIVE_LEARNING_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --learning-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Loopback fixture required');

async function setup(context, user = 1, control = {}) {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    if (!localStorage.getItem('lerne_auth_v2_session')) {
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: user, is_guest: false }));
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: user, access_token: token }));
    }
    // Tests explicitly deliver queues; no background reconnect race.
    window.addEventListener('online', event => event.stopImmediatePropagation(), true);
  }, { user, token: fixture.tokens[user] });
  await context.route('**/api/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    if (control.offline) return route.abort('internetdisconnected');
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [fixture.deck, fixture.target],
      folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: user, is_guest: false } } });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (control.blockKnowledge && pathname === '/api/knowledge/attempts/sync') return route.abort('internetdisconnected');
    try {
      const response = await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
      if (control.lose === pathname) {
        control.committed = (control.committed || 0) + 1;
        expect(response.status(), await response.text()).toBe(200);
        return await route.abort('connectionreset');
      }
      return await route.fulfill({ response });
    } catch (error) {
      // Chromium cancels an in-flight read when the test cuts its network.
      if (control.offline && /Route is already handled|context.*closed|context disposed/i.test(error.message)) return;
      throw error;
    }
  });
}

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', error => console.log(error.message));
  page.setDefaultTimeout(10000);
  await page.goto('/');
  await expect(page.getByText(fixture.deck.name, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);
  await page.evaluate(async () => {
    (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
    window.api = (await import('/src/services/api.js')).default;
    window.networkApi = (await import('/src/services/networkApi.js')).networkApi;
    window.db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    window.sync = () => import('/src/services/syncService.js').then(m => m.syncService.sync());
    window.knowledgeSync = () => import('/src/services/knowledgeSyncService.js').then(m => m.syncKnowledgeAttempts(1));
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ autoPlay: false, studyMode: 'classic', gradingCollapsed: false, gradeSoundEnabled: false });
    // Settings are a real adjacent outbox now included in overall completion.
    // Obtain its actual server ACK instead of treating startup's pending record
    // or an in-flight background lock as completed synchronization.
    await useSettingsStore.getState().saveCurrentSettingsToServer();
  });
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held
    .some(lock => lock.name === 'lerne-offline-sync'))).toBe(false);
  return page;
}

const progress = async (page, id) => page.evaluate(async id => {
  const snapshot = (await api.get('/sync/v2/pull?card_schema=2')).data;
  return snapshot.progress.find(row => row.card_id === id);
}, id);
const srsFields = row => Object.fromEntries(['queue', 'interval', 'ease_factor', 'repetitions', 'lapses',
  'step_index', 'next_review', 'last_reviewed'].map(key => [key, row[key]]));

async function showCard(page, card, offline = false) {
  await page.evaluate(async ({ deck, id, offline }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    if (!offline) await (await import('/src/services/knowledgeContentService.js')).prepareDeckKnowledge(deck.id);
    useDeckStore.setState({ currentDeck: deck, deckCards: [] });
    useSessionStore.getState().resetSession();
    useSessionStore.getState().addToHistory((await api.get(`/study/card/${id}`)).data);
    useUiStore.getState().setView('study');
  }, { deck: fixture.deck, id: card.id, offline });
}

async function answer(page, type) {
  const button = name => page.getByRole('button', { name, exact: true });
  if (['theory', 'standard'].includes(type)) await button('Перевернуть карточку').click();
  if (type === 'trainer') {
    await page.locator('.trainer-exercise input').fill('gehe');
    await button('Проверить ответы').click();
  }
  if (type === 'quiz') {
    await page.locator('.quiz-container').getByText('Ja', { exact: true }).click();
    await button('Проверить').click();
  }
  if (type === 'match') {
    for (const text of ['A', 'one', 'B', 'two']) await page.locator('.match-container').getByText(text, { exact: true }).click();
  }
  if (type === 'puzzle') {
    for (const id of [0, 1, 2]) await page.locator(`.btn-puzzle-chip[data-id="${id}"]`).click();
    await button('Проверить ответы').click();
  }
  if (type === 'word_bank') {
    await page.locator('.word-bank-exercise').getByText('gehe', { exact: true }).click();
    await button('Проверить').click();
  }
  if (['free_text', 'editable_text'].includes(type)) {
    await page.locator('.free-text-exercise textarea, .editable-text-exercise textarea').fill('Ich gehe.');
    await button('Проверить ответ').click();
  }
}

test('V2 personal flag delivery preserves newer SRS on another device', async ({ page, context, browser }) => {
  await setup(context);
  page = await open(context);
  expect((await page.evaluate(() => sync())).success).toBe(true);
  const peer = await browser.newContext();
  try {
    await setup(peer);
    const second = await open(peer);
    await second.evaluate(async ({ id, deck }) => api.post('/study/grade', {
      card_id: id, deck_id: deck, grade: 2, return_next: false,
    }), { id: fixture.probe, deck: fixture.deck.id });
    const newer = await progress(second, fixture.probe);
    await context.setOffline(true);
    await page.evaluate(async id => api.post(`/cards/${id}/flag`, { flag: 3 }), fixture.probe);
    await context.setOffline(false);
    expect((await page.evaluate(() => sync())).success).toBe(true);
    const after = await progress(second, fixture.probe);
    expect(after.flag).toBe(3);
    expect(srsFields(after)).toEqual(srsFields(newer));
  } finally { await peer.close(); }
});

test('all nine V2 types integrate study, private data, retries and lifecycle', async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  const profile = testInfo.outputPath('persistent-profile');
  let context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'block',
    viewport: { width: 375, height: 900 }, baseURL: 'http://127.0.0.1:5199' });
  const control = {};
  await setup(context, 1, control);
  let page = await open(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ids = fixture.cards.map(card => card.id);
  const peer = await browser.newContext();
  try {
    expect((await page.evaluate(() => sync())).success).toBe(true);
    // Real study components/evaluators -> hook -> HTTP grade -> Knowledge outbox.
    for (const card of fixture.cards) {
      const type = card.content_v2.card.type;
      await showCard(page, card);
      await answer(page, type);
      if (['free_text', 'editable_text'].includes(type)) {
        await expect(page.locator('.free-text-feedback')).toHaveClass(/is-success/);
      }
      await expect(page.locator('.grade-buttons button').nth(2)).toBeEnabled();
      if (type === 'trainer' || type === 'editable_text') await page.screenshot({ path: testInfo.outputPath(`${type}-study.png`), fullPage: true });
      await page.locator('.grade-buttons button').nth(2).click();
      await expect.poll(() => page.evaluate(() => db.knowledge_attempt_outbox.count())).toBe(ids.indexOf(card.id) + 1);
      await page.evaluate(async id => {
        await api.post(`/cards/${id}/flag`, { flag: 2 });
        await (await import('/src/services/cardRatings.js')).saveRating(1, id, -1, 'unclear');
        await (await import('/src/services/cardRatings.js')).saveRating(1, id, 1);
        await (await import('/src/services/cardNotes.js')).writeCardNote(id, { text: `Private owner ${id}` });
      }, card.id);
    }
    expect((await page.evaluate(() => knowledgeSync())).succeededCount).toBe(9);
    expect((await page.evaluate(() => sync())).success).toBe(true);
    const online = await page.evaluate(() => db.progress.toArray());
    const intervals = await page.evaluate(async ids => Promise.all(ids.map(async id =>
      (await api.get(`/study/card/${id}`)).data.intervals)), ids);
    // Offline grades, notes and flags use the existing Dexie queues. Ratings keep
    // their established online-only contract and roll back on a network failure.
    control.offline = true;
    await context.setOffline(true);
    expect(await page.evaluate(async ids => Promise.all(ids.map(async id =>
      (await api.get(`/study/card/${id}`)).data.intervals)), ids)).toEqual(intervals);
    for (const card of fixture.cards) {
      const type = card.content_v2.card.type;
      await showCard(page, card, true);
      await answer(page, type);
      if (['free_text', 'editable_text'].includes(type)) {
        // The existing remote checker is unavailable offline, even for exact
        // policy. This is not a wrong answer or an objective learning event.
        await expect(page.locator('.free-text-feedback')).toContainText('попытка не засчитана');
        expect(await page.evaluate(() => db.knowledge_attempt_outbox.count())).toBe(ids.indexOf(card.id));
        await page.evaluate(async card => {
          await api.post('/study/grade', { card_id: card.id, deck_id: card.deck_id, grade: 2, return_next: false });
          await (await import('/src/services/knowledgeCaptureService.js')).captureStudyKnowledgeAttempt({ userId: 1, card, grade: 2, isExtended: false });
        }, card);
      } else {
        await expect(page.locator('.grade-buttons button').nth(2)).toBeEnabled();
        await page.locator('.grade-buttons button').nth(2).click();
      }
      await expect.poll(() => page.evaluate(() => db.knowledge_attempt_outbox.count())).toBe(ids.indexOf(card.id) + 1);
      await page.evaluate(async card => {
        const { writeCardNote } = await import('/src/services/cardNotes.js');
        const note = await db.card_notes.where('card_id').equals(card.id).first();
        await writeCardNote(card.id, { ...note, text: `Private offline ${card.id}` });
        await api.post(`/cards/${card.id}/flag`, { flag: 0 });
        const { saveRating, getRating } = await import('/src/services/cardRatings.js');
        try { await saveRating(1, card.id, -1, 'error'); throw new Error('Offline rating unexpectedly saved'); }
        catch (error) { if (getRating(1, card.id)?.rating !== 1) throw error; }
      }, card);
    }
    const pending = await page.evaluate(async () => ({ reviews: await db.syncState.filter(row => row.key.startsWith('review:')).toArray(),
      attempts: await db.knowledge_attempt_outbox.toArray(), notes: await db.card_notes.toArray(), progress: await db.progress.toArray() }));
    expect(pending.reviews).toHaveLength(9);
    expect(pending.attempts).toHaveLength(9);
    for (const id of ids) expect(pending.progress.find(row => row.card_id === id).repetitions)
      .toBe(online.find(row => row.card_id === id).repetitions + 1);
    // Actual Chromium process restart; IndexedDB survives in the persistent profile.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'block', baseURL: 'http://127.0.0.1:5199' });
    control.offline = false;
    control.blockKnowledge = true;
    await setup(context, 1, control);
    page = await open(context);
    page.on('pageerror', error => errors.push(error.message));
    await expect.poll(() => page.evaluate(() => db.knowledge_attempt_outbox.filter(row => row.sync_status === 'pending').count())).toBe(9);
    control.blockKnowledge = false;
    const pendingKnowledge = await page.evaluate(() => sync());
    expect(pendingKnowledge.entities_success).toBe(true);
    expect(pendingKnowledge.success).toBe(false);
    expect(pendingKnowledge.pending.blockers['knowledge_attempt_outbox:retained']).toBe(9);
    expect((await page.evaluate(() => knowledgeSync())).succeededCount).toBe(9);
    expect(await page.evaluate(() => db.syncState.filter(row => row.key.startsWith('review:')).count())).toBe(0);
    // Commit grade but drop its HTTP response: the API fallback retains the SAME
    // action UUID. Retrying the sync batch and Knowledge event also drops receipts.
    control.lose = '/api/study/grade';
    await page.evaluate(async cards => {
      const { captureStudyKnowledgeAttempt } = await import('/src/services/knowledgeCaptureService.js');
      for (const card of cards) {
        await api.post('/study/grade', { card_id: card.id, deck_id: card.deck_id, grade: 2,
          review_context: 'forced', return_next: false });
        await captureStudyKnowledgeAttempt({ userId: 1, card, grade: 2, isExtended: false });
      }
    }, fixture.cards);
    expect(control.committed).toBe(9);
    control.lose = '/api/sync/v2/push';
    expect((await page.evaluate(() => sync())).success).toBe(false);
    const batch = await page.evaluate(() => db.syncState.get('pending'));
    expect(batch.reviews).toHaveLength(9);
    control.lose = null;
    const replayed = await page.evaluate(() => sync());
    expect(replayed.entities_success).toBe(true);
    expect(replayed.success).toBe(false); // Knowledge still awaits its own ACK.
    control.lose = '/api/knowledge/attempts/sync';
    expect((await page.evaluate(() => knowledgeSync())).transportFailed).toBe(true);
    control.lose = null;
    expect((await page.evaluate(() => knowledgeSync())).succeededCount).toBe(9);
    for (const card of fixture.cards) {
      const diagnostic = await page.evaluate(async ki => (await api.get(`/knowledge/diagnostics/items/${ki}`)).data, card.ki);
      expect(diagnostic.materialized_state.evidence_event_count).toBe(3);
      expect(diagnostic.state_matches_rebuild).toBe(true);
    }
    // Second physical browser profile; account-scoped reads of the same cards.
    await setup(peer, 2);
    const second = await open(peer);
    expect((await second.evaluate(() => sync())).success).toBe(true);
    expect(await second.evaluate(() => db.progress.count())).toBe(0);
    expect(await second.evaluate(async deck => (await networkApi.get(`/card-notes/deck/${deck}`)).data, fixture.deck.id)).toEqual([]);
    expect(await second.evaluate(async deck => (await api.get(`/card-ratings/deck/${deck}`)).data, fixture.deck.id)).toEqual([]);
    expect(await page.evaluate(async deck => {
      try { await api.get(`/decks/${deck}/cards`); return 200; }
      catch (error) { return error.response?.status; }
    }, fixture.foreign)).toBe(403);
    await second.evaluate(async id => {
      await api.put(`/card-ratings/${id}`, { rating: -1, reason: 'boring' });
      await api.post(`/cards/${id}/flag`, { flag: 3 });
      await (await import('/src/services/cardNotes.js')).writeCardNote(id, { text: 'Private second account' });
    }, ids[0]);
    expect((await progress(page, ids[0])).flag).toBe(0);
    expect((await progress(second, ids[0])).flag).toBe(3);
    const ownerDevice = await browser.newContext();
    try {
      await setup(ownerDevice);
      const third = await open(ownerDevice);
      expect((await third.evaluate(() => sync())).success).toBe(true);
      const shared = await third.evaluate(async deck => ({ snapshot: (await api.get('/sync/v2/pull?card_schema=2')).data,
        notes: (await networkApi.get(`/card-notes/deck/${deck}`)).data, ratings: (await api.get(`/card-ratings/deck/${deck}`)).data }), fixture.deck.id);
      expect(shared.notes.filter(row => !row.is_deleted)).toHaveLength(9);
      expect(shared.ratings).toHaveLength(9);
      expect(JSON.stringify(shared.snapshot)).not.toContain('Private');
      expect(shared.snapshot.card_notes).toBeUndefined();
      expect(shared.snapshot.card_ratings).toBeUndefined();
      for (const card of fixture.cards) expect(shared.snapshot.cards.find(row => row.id === card.id).content_v2).toEqual(card.content_v2);
    } finally { await ownerDevice.unrouteAll({ behavior: 'ignoreErrors' }); await ownerDevice.close(); }
    expect(errors).toEqual([]);
  } finally {
    await peer.unrouteAll({ behavior: 'ignoreErrors' });
    await peer.close();
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
