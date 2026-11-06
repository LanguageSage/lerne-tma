const { test, expect } = require('./isolated-fixture.cjs');

const fixture = JSON.parse(process.env.LERNE_OFFLINE_CREATE_FIXTURE || 'null');
test.skip(!fixture, 'Run structured_cards_postgres.py --offline-create-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Expected a loopback HTTP fixture');

const prompt = 'Österreichische Grüße [[literal]]';
const answer = 'Синтетический ответ';
const deck = fixture && { id: fixture.deck_id, name: 'Offline Standard fixture',
  user_id: 1, target_language: 'de', role: 'owner', stats: { total: 0 } };
const profile = { user_id: 1, first_name: 'Test learner', is_guest: false };

async function setupDevice(context, getPhase, observeSave) {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ token, profile }) => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify(profile));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
    if (sessionStorage.getItem('offline-fixture')) {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    }
  }, { token: fixture.access_token, profile });
  await context.route('**/api/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    const phase = getPhase();
    if (phase === 'offline') return route.abort('internetdisconnected');
    const fetchFromServer = () => route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
    if (pathname === '/api/cards/save') {
      const payload = route.request().postDataJSON();
      if (phase === 'reject') {
        observeSave(payload);
        return route.fulfill({ status: 503, json: { detail: 'Synthetic unavailable' } });
      }
      const response = await fetchFromServer();
      observeSave(payload, response.status(), await response.json());
      if (phase === 'lose-response') return route.abort('connectionreset');
      return route.fulfill({ response });
    }
    if (/^\/api\/(sync\/v2\/|cards\/\d+|decks\/\d+\/cards)/.test(pathname)) {
      return route.fulfill({ response: await fetchFromServer() });
    }
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [],
      settings: {}, prompts: {}, user_settings: {}, user_info: profile } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/decks') return route.fulfill({ json: [deck] });
    if (pathname === '/api/folders' || pathname === '/api/messages') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

async function inspectLocal(page, tempId) {
  return page.evaluate(async ({ tempId, legacyId }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return {
      operations: await db.syncState.where('key').startsWith('card-create-v2:').toArray(),
      alias: (await db.syncState.get('aliases'))?.mappings.cards?.[tempId],
      cards: await db.cards.filter(c => !!c.content_v2).toArray(),
      legacy: await Promise.all([db.cards.get(legacyId), db.cards.get('legacy-draft'),
        db.progress.get([legacyId, 1]), db.syncState.get('pending'), db.syncState.get('review:legacy')]),
    };
  }, { tempId, legacyId: fixture.legacy_id });
}

async function openList(page) {
  await page.evaluate(async deck => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.getState().setView('cards');
    await useDeckStore.getState().fetchDeckCards(deck.id);
  }, deck);
}

test('persists Standard offline, replays a committed write and pulls it on a separate device', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(90000);
  const attempts = [];
  let phase = 'ready';
  await setupDevice(context, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();

  await page.evaluate(async ({ id, deck }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    const old = { id, deck_id: deck.id, front_text: 'Preserve legacy prompt', back_text: 'Legacy answer', is_dirty: 0 };
    const draft = { ...old, id: 'legacy-draft', is_dirty: 1 };
    const progress = { card_id: id, user_id: 1, is_dirty: 1, repetitions: 3 };
    const review = { key: 'review:legacy', card_id: id, rating: 2 };
    await db.cards.bulkAdd([old, draft]);
    await db.progress.add(progress);
    await db.syncState.bulkAdd([review, { key: 'pending', request_id: crypto.randomUUID(),
      userId: 1, folders: [], decks: [], cards: [draft], progress: [progress], reviews: [review] }]);
  }, { id: fixture.legacy_id, deck });
  const before = await inspectLocal(page);
  await openList(page);

  phase = 'offline';
  await page.evaluate(() => {
    sessionStorage.setItem('offline-fixture', 'true');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  });
  await context.setOffline(true);
  await page.evaluate(async () => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useUiStore.setState({ editorSourceView: 'cards' });
    useUiStore.getState().setView('creator');
  });
  await page.locator('#card-editor-front').fill('   ');
  await page.locator('#card-editor-back').fill(answer);
  await page.locator('.btn-save-action').click();
  await expect(page.getByText(/Заполните вопрос, ответ/)).toBeVisible();
  expect((await inspectLocal(page)).operations).toHaveLength(0);
  await page.locator('#card-editor-front').fill(prompt);
  await page.evaluate(async () => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    const add = db.syncState.add;
    db.syncState.add = () => {
      db.syncState.add = add;
      throw new Error('Synthetic outbox failure');
    };
  });
  await page.locator('.btn-save-action').click();
  await expect(page.getByText(/Synthetic outbox failure/)).toBeVisible();
  expect((await inspectLocal(page)).cards).toEqual([]);
  expect((await inspectLocal(page)).operations).toEqual([]);
  await page.locator('.btn-save-action').click();
  await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toBeVisible();
  await expect(page.getByText('Ожидает синхронизации')).toBeVisible();
  const local = await inspectLocal(page);
  expect(local.cards).toHaveLength(1);
  const [operation] = local.operations;
  const tempId = local.cards[0].id;
  expect(tempId).toBeLessThan(0);
  expect(operation.tempId).toBe(tempId);
  expect(operation.payload.content_v2).toMatchObject({ schema_version: 2, card: {
    type: 'standard', data: { prompt, answer } } });
  expect(attempts).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('pending-375.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Vite can serve the shell on reload while every API call remains disconnected.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await openList(page);
  await expect(page.getByText('Ожидает синхронизации')).toBeVisible();
  expect((await inspectLocal(page, tempId)).operations).toEqual([operation]);

  phase = 'reject';
  await page.evaluate(() => {
    sessionStorage.removeItem('offline-fixture');
    delete navigator.onLine;
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText(/Ошибка синхронизации\. Карточка сохранена/)).toBeVisible();
  expect((await inspectLocal(page, tempId)).operations).toEqual([operation]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('sync-error-1280.png') });

  await expect.poll(() => page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.isSyncing)).toBe(false);
  phase = 'lose-response';
  const sync = () => page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.sync());
  expect((await sync()).success).toBe(false);
  const firstReceipt = attempts.find(attempt => attempt.status === 200).receipt;
  expect(firstReceipt.id).toBeGreaterThan(0);
  expect(firstReceipt.content_v2.card.data).toEqual({ prompt, answer });
  const unacknowledged = await inspectLocal(page, tempId);
  expect(unacknowledged.operations).toEqual([operation]);
  expect(unacknowledged.alias).toBeUndefined();
  expect(unacknowledged.cards.map(card => card.id)).toEqual([tempId]);

  phase = 'ready';
  await page.reload();
  await expect(page.getByText('Карточка синхронизирована', { exact: true })).toBeVisible();
  await expect.poll(async () => (await inspectLocal(page, tempId)).alias).toBe(firstReceipt.id);
  await openList(page);
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Ожидает синхронизации')).toHaveCount(0);
  const confirmed = await inspectLocal(page, tempId);
  expect(confirmed.operations).toEqual([]);
  expect(confirmed.cards.map(card => card.id)).toEqual([firstReceipt.id]);
  expect(confirmed.legacy).toEqual(before.legacy);
  expect(attempts.filter(a => a.status === 200).map(a => a.receipt)).toEqual([firstReceipt, firstReceipt]);
  for (const attempt of attempts) expect(attempt.payload).toEqual(operation.payload);
  const byServerId = await page.evaluate(async id => {
    const { default: api } = await import('/src/services/api.js');
    return (await api.get('/cards/' + id)).data;
  }, firstReceipt.id);
  expect(byServerId.content_v2).toEqual(firstReceipt.content_v2);
  const byTemporaryId = await page.evaluate(async id => (await (await import('/src/services/api.js')).default.get('/cards/' + id)).data.id, tempId);
  expect(byTemporaryId).toBe(firstReceipt.id);

  const second = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await setupDevice(second, () => 'ready', () => { throw new Error('Second device must only pull'); });
    const other = await second.newPage();
    await other.goto('http://127.0.0.1:5199/');
    await expect(other.getByText(deck.name, { exact: true }).first()).toBeVisible();
    const pull = other.waitForResponse(response => response.url().includes('/api/sync/v2/pull') && response.ok());
    await other.evaluate(async () => {
      localStorage.setItem('offline_mode', 'true');
      return (await import('/src/services/syncService.js')).syncService.sync();
    });
    expect((await (await pull).json()).cards).toHaveLength(1);
    const secondLocal = await inspectLocal(other);
    expect(secondLocal.cards.map(card => [card.id, card.content_v2])).toEqual([[firstReceipt.id, firstReceipt.content_v2]]);
    await openList(other);
    await expect(other.getByText(prompt, { exact: true }).first()).toBeVisible();
  } finally {
    await second.close();
  }
});
