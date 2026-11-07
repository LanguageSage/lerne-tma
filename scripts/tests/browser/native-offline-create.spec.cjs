const { test, expect } = require('./isolated-fixture.cjs');

const fixture = JSON.parse(process.env.LERNE_OFFLINE_CREATE_FIXTURE || 'null');
test.skip(!fixture, 'Run structured_cards_postgres.py with an offline browser scenario');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Expected a loopback HTTP fixture');

const prompt = 'Österreichische Grüße [[literal]]';
const answer = 'Синтетический ответ';
const deck = fixture && { id: fixture.deck_id, name: fixture.deck_name || 'Offline Standard fixture',
  user_id: fixture.card || fixture.edit_cards ? 2 : fixture.user_id ?? 1, target_language: 'de',
  role: fixture.card || fixture.edit_cards ? 'editor' : 'owner', stats: { total: 0 } };
const profile = { user_id: fixture?.user_id ?? 1, first_name: 'Test learner', is_guest: false };

async function setupDevice(context, getPhase, observeSave, owner = false, controlWrite, controlPull) {
  const startOffline = getPhase() === 'offline';
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ token, profile, manualSync, isolation, startOffline }) => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    if (!isolation || !localStorage.getItem('lerne_auth_v2_session')) {
      localStorage.setItem('lerne_user_profile', JSON.stringify(profile));
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: profile.user_id, access_token: token }));
    }
    if (sessionStorage.getItem('offline-fixture') || (startOffline && !sessionStorage.getItem('fixture-reconnected'))) {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    }
    if (manualSync) {
      // Keep network transitions deterministic. Startup sync still runs on reload.
      window.addEventListener('online', event => event.stopImmediatePropagation(), true);
    }
  }, { token: owner ? fixture.owner_token : fixture.access_token, profile: { ...profile, user_id: owner ? 2 : profile.user_id },
    manualSync: (Boolean(fixture.card || fixture.edit_cards) && !owner) || fixture.isolation
      || Boolean(fixture.move || fixture.lifecycle || fixture.list),
    isolation: fixture.isolation, startOffline });
  await context.route('**/api/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    const phase = getPhase();
    if (phase === 'offline') return route.abort('internetdisconnected');
    const cardPath = '/api/cards/' + fixture.card?.id;
    const updating = /^\/api\/cards\/\d+$/.test(pathname) && route.request().method() === 'PATCH';
    const fetchFromServer = () => route.fetch({
      url: fixture.origin + pathname + search, maxRetries: 0,
      ...(updating && phase === 'unauthorized' ? { headers: { ...route.request().headers(), authorization: 'Bearer invalid' } } : {}),
    });
    const listWrite = fixture.list && route.request().method() === 'POST'
      && ['/api/cards/batch-delete', '/api/cards/reorder'].includes(pathname);
    const lifecycleWrite = fixture.lifecycle && route.request().method() === 'POST'
      && (pathname === '/api/cards/batch-delete' || /^\/api\/trash\/card\/\d+\/restore$/.test(pathname));
    if (pathname === '/api/cards/save' || (fixture.move && (pathname === '/api/cards/batch-move' || (fixture.batch && pathname === '/api/cards/batch-copy'))) || updating || lifecycleWrite || listWrite) {
      const payload = route.request().postDataJSON();
      if (controlWrite) return controlWrite({ route, pathname, payload, fetchFromServer });
      if (phase === 'reject') {
        observeSave(payload);
        return route.fulfill({ status: 503, json: { detail: 'Synthetic unavailable' } });
      }
      const response = await fetchFromServer();
      observeSave(payload, response.status(), await response.json());
      if (phase === 'lose-response') return route.abort('connectionreset');
      return route.fulfill({ response });
    }
    if (pathname === cardPath && phase === 'conflict-read-down') return route.abort('connectionreset');
    if (pathname === '/api/sync/v2/pull' && controlPull) return controlPull({ route, fetchFromServer });
    if (fixture.isolation && pathname === '/api/sync/collab-pull') {
      return route.fulfill({ response: await fetchFromServer() });
    }
    if ((fixture.list && ['/api/cards/search', '/api/cards/duplicates', '/api/trash'].includes(pathname))
        || (fixture.lifecycle && pathname === '/api/trash')
        || /^\/api\/(sync\/v2\/|cards\/\d+|decks\/\d+\/cards|collaborative\/deck\/\d+\/role)/.test(pathname)) {
      try {
        return await route.fulfill({ response: await fetchFromServer() });
      } catch (error) {
        // Restarting a profile cancels in-flight reads. Keep every write and
        // every non-cancellation failure observable to the assertions below.
        if (route.request().method() === 'GET' && route.request().failure()
          && /Route is already handled|context.*closed|context disposed/i.test(error.message)) return;
        throw error;
      }
    }
    const asSecond = fixture.isolation && route.request().headers().authorization === 'Bearer ' + fixture.second_session.access_token;
    const visibleDecks = fixture.list ? [fixture.list.source, fixture.list.shared, fixture.list.foreign] : fixture.move
      ? [fixture.move.source, fixture.move.target, fixture.move.denied]
      : [asSecond ? fixture.private_deck : deck];
    if (fixture.isolation && pathname === '/api/auth/v2/me') return route.fulfill({ response: await fetchFromServer() });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: visibleDecks, folders: [],
      settings: {}, prompts: {}, user_settings: {}, user_info: asSecond ? { ...profile, user_id: 2 } : profile } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { ...profile, user_id: owner ? 2 : profile.user_id } });
    if (pathname === '/api/decks') return route.fulfill({ json: visibleDecks });
    if (pathname === '/api/folders' || pathname === '/api/messages') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

async function inspectLocal(page, tempId) {
  return page.evaluate(async ({ tempId, legacyId }) => {
    const { prepareLocalDb } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    const aliases = (await db.syncState.get('aliases'))?.mappings.cards;
    return {
      operations: await db.syncState.where('key').startsWith('card-create-v2:').toArray(),
      alias: aliases?.[tempId],
      aliases,
      cards: await db.cards.filter(c => !!c.content_v2).toArray(),
      legacy: legacyId == null ? [] : await Promise.all([db.cards.get(legacyId), db.cards.get('legacy-draft'),
        db.progress.get([legacyId, 1]), db.syncState.get('pending'), db.syncState.get('review:legacy')]),
    };
  }, { tempId, legacyId: fixture.legacy_id });
}

async function openList(page, targetDeck = deck) {
  await page.evaluate(async deck => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ currentDeck: deck });
    useUiStore.getState().setView('cards');
    await useDeckStore.getState().fetchDeckCards(deck.id);
  }, targetDeck);
}

test('persists Standard offline, replays a committed write and pulls it on a separate device', async ({ page, context, browser }, testInfo) => {
  test.skip(Boolean(fixture?.card || fixture?.isolation || fixture?.move || fixture?.contents), 'Standard creation fixture only');
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

  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'lerne-offline-sync'))).toBe(false);
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

test('creates all nine V2 types offline across a Chromium restart and replays the same payloads', async ({ browser }, testInfo) => {
  test.skip(!fixture?.contents, 'All-types creation fixture only');
  test.setTimeout(120000);
  const attempts = [];
  const observeSave = (payload, status, receipt) => attempts.push({ payload, status, receipt });
  const errors = [];
  const origin = 'http://127.0.0.1:5199';
  const profileDir = testInfo.outputPath('device-one');
  let phase = 'ready';
  let device;
  let otherDevice;
  async function launchDevice() {
    device = await browser.browserType().launchPersistentContext(profileDir, {
      viewport: { width: 375, height: 844 }, serviceWorkers: 'block',
    });
    await setupDevice(device, () => phase, observeSave);
    const page = device.pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
    return page;
  }
  const sync = (page, options = { pendingNativeOnly: true }) => page.evaluate(async options =>
    (await import('/src/services/syncService.js')).syncService.sync(options), options);

  try {
    let page = await launchDevice();
    await openList(page);
    phase = 'offline';
    await device.setOffline(true);

    // Exercise the regular creator for a non-Standard type.
    await page.evaluate(async () => {
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useUiStore.setState({ editorSourceView: 'cards' });
      useUiStore.getState().setView('creator');
    });
    const theory = fixture.contents.theory.card;
    await page.getByRole('combobox', { name: 'Тип карточки' }).selectOption('theory');
    await page.locator('#card-editor-front').fill(theory.data.text);
    await page.locator('#card-editor-back').fill(theory.data.summary);
    await page.locator('#card-editor-context').fill(theory.explanation);
    await page.locator('.btn-save-action').click();
    await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toBeVisible();
    await expect(page.getByText('Ожидает синхронизации')).toBeVisible();

    const saved = [];
    for (const [kind, content] of Object.entries(fixture.contents)) {
      if (kind === 'theory') continue;
      await page.evaluate(async () => {
        (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('creator');
      });
      await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
      await page.getByRole('textbox', { name: 'Полный content_v2 JSON' }).fill(JSON.stringify(content, null, 2));
      await page.getByRole('button', { name: 'Типизированная форма', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Тип карточки' })).toHaveValue(kind);
      await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Полный content_v2 JSON' })).toHaveValue(JSON.stringify(content, null, 2));
      await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Полный content_v2 JSON' })).toHaveCount(0);
      const state = await inspectLocal(page);
      const operation = state.operations.find(op => op.payload.content_v2.card.type === kind);
      saved.push({ card: state.cards.find(card => card.id === operation.tempId), payload: operation.payload });
    }
    const bad = await page.evaluate(async deckId => {
      const { default: api } = await import('/src/services/api.js');
      const payload = { content_v2: { schema_version: 2, card: { type: 'match', data: {} } },
        deck_id: deckId, request_id: crypto.randomUUID() };
      const { data: card } = await api.post('/cards/save', payload);
      return { card, payload };
    }, deck.id);
    const queued = await inspectLocal(page);
    expect(queued.cards).toHaveLength(10);
    expect(queued.operations).toHaveLength(10);
    expect(new Set(queued.operations.map(op => op.tempId)).size).toBe(10);
    for (const { card, payload } of [...saved, bad]) {
      expect(queued.operations.find(op => op.tempId === card.id).payload).toEqual(payload);
      expect(queued.cards.find(row => row.id === card.id).content_v2).toEqual(payload.content_v2);
    }
    for (const op of queued.operations) {
      expect(op.tempId).toBeLessThan(0);
      expect(op.key).toBe('card-create-v2:' + op.payload.request_id);
      expect(queued.cards.find(card => card.id === op.tempId).offline_create_status).toBe('pending');
    }
    expect(attempts).toHaveLength(0);

    // Restart Chromium with its original profile. Vite serves the shell while
    // API traffic stays disconnected.
    await device.close();
    page = await launchDevice();
    expect(await inspectLocal(page)).toEqual(queued);
    await openList(page);
    await expect(page.getByText('Ожидает синхронизации')).toHaveCount(10);

    phase = 'lose-response';
    await page.evaluate(() => {
      sessionStorage.setItem('fixture-reconnected', 'true');
      delete navigator.onLine;
    });
    expect((await sync(page)).success).toBe(false);
    const committed = attempts.filter(attempt => attempt.status === 200);
    expect(committed).toHaveLength(9);
    const interrupted = await inspectLocal(page);
    expect(interrupted.operations).toEqual(queued.operations);
    expect(interrupted.aliases).toBeUndefined();
    expect(interrupted.cards.map(card => card.id)).toEqual(queued.cards.map(card => card.id));

    phase = 'ready';
    const rejected = await sync(page);
    expect(rejected).toMatchObject({ success: false, reason: expect.stringContaining('pairs') });
    const confirmed = await inspectLocal(page);
    const badOperation = queued.operations.find(op => op.tempId === bad.card.id);
    expect(confirmed.operations).toEqual([{ ...badOperation, rejected: true }]);
    expect(confirmed.cards.find(card => card.id === bad.card.id)).toMatchObject({
      content_v2: bad.payload.content_v2, offline_create_status: 'error', offline_create_error: expect.stringContaining('pairs'),
    });
    const delivered = confirmed.cards.filter(card => card.id > 0);
    expect(delivered).toHaveLength(9);
    expect(new Set(delivered.map(card => card.id)).size).toBe(9);
    for (const operation of queued.operations) {
      const writes = attempts.filter(attempt => attempt.payload.request_id === operation.payload.request_id);
      expect(writes.map(write => write.payload)).toEqual([operation.payload, operation.payload]);
      if (operation.tempId === bad.card.id) {
        expect(writes.map(write => write.status)).toEqual([422, 422]);
        expect(confirmed.aliases[operation.tempId]).toBeUndefined();
        continue;
      }
      expect(writes.map(write => write.status)).toEqual([200, 200]);
      const [first, replay] = writes;
      expect(replay.receipt).toEqual(first.receipt);
      expect(confirmed.aliases[operation.tempId]).toBe(first.receipt.id);
      const content = fixture.contents[operation.payload.content_v2.card.type];
      expect(first.receipt.content_v2).toEqual(content);
      expect(delivered.find(card => card.id === first.receipt.id).content_v2).toEqual(content);
    }

    await page.reload();
    await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
    await expect.poll(() => sync(page, {})).toMatchObject({ success: true, server_time: expect.any(String) });
    await openList(page);
    const invalidCard = page.locator('#card-item-' + bad.card.id);
    await expect(invalidCard.getByRole('status')).toContainText('Карточка сохранена на устройстве.');
    await expect(invalidCard.getByRole('status')).toContainText('pairs');
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await invalidCard.getByRole('status').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 844 });
    await invalidCard.screenshot({ path: testInfo.outputPath('invalid-v2-375.png') });
    expect((await inspectLocal(page)).operations).toEqual(confirmed.operations);
    expect(attempts).toHaveLength(20);

    otherDevice = await browser.newContext({ serviceWorkers: 'block' });
    await setupDevice(otherDevice, () => 'ready', () => { throw new Error('Second device must only pull'); });
    const other = await otherDevice.newPage();
    other.on('pageerror', error => errors.push(error.message));
    await other.goto(origin);
    await expect(other.getByText(deck.name, { exact: true }).first()).toBeVisible();
    await expect.poll(() => sync(other, { pullOnly: true }))
      .toMatchObject({ success: true, server_time: expect.any(String) });
    const otherLocal = await inspectLocal(other);
    expect(otherLocal.operations).toEqual([]);
    expect(otherLocal.cards.map(card => [card.id, card.content_v2])).toEqual(
      delivered.map(card => [card.id, card.content_v2]));
    expect(errors).toEqual([]);
  } finally {
    await otherDevice?.close();
    await device?.close();
  }
});

test('edits all nine V2 types, replays after Chromium restarts and resolves conflicts', async ({ browser }, testInfo) => {
  test.skip(!fixture?.edit_cards, 'All-types edit fixture only');
  test.setTimeout(150000);
  const cards = Object.entries(fixture.edit_cards);
  const attempts = [];
  let phase = 'ready';
  let device, page;
  async function launch() {
    device = await browser.browserType().launchPersistentContext(testInfo.outputPath('edit-device'), {
      viewport: { width: 375, height: 844 }, serviceWorkers: 'block',
    });
    await setupDevice(device, () => phase, () => {}, false, async ({ route, payload, fetchFromServer }) => {
      const queued = (await inspect()).operations.find(op => op.payload.request_id === payload.request_id)?.payload;
      const response = await fetchFromServer();
      attempts.push({ payload, queued, status: response.status(), receipt: await response.json() });
      return phase === 'lose-response' ? route.abort('connectionreset') : route.fulfill({ response });
    });
    page = device.pages()[0];
    page.setDefaultTimeout(10000);
    await page.goto('http://127.0.0.1:5199/');
    await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
    await openList(page);
  }
  const inspect = () => page.evaluate(async deckId => {
    const { prepareLocalDb, CARD_EDIT_KEY } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return db.transaction('r', db.cards, db.syncState, async () => ({
      cards: await db.cards.where('deck_id').equals(deckId).toArray(),
      operations: await db.syncState.where('key').startsWith(CARD_EDIT_KEY).toArray(),
    }));
  }, deck.id);
  const sync = () => page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.sync());
  const item = id => page.locator('#card-item-' + id);
  const openEditor = async id => {
    await item(id).getByRole('button', { name: 'Действия с карточкой' }).click();
    await page.getByRole('button', { name: /Редактировать/ }).click();
  };
  const openDraft = id => item(id).getByRole('button', { name: 'Открыть локальную правку' }).click();
  const contextField = () => page.locator('#card-editor-context');
  const save = () => page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  const panel = () => page.getByRole('region', { name: 'Синхронизация карточки' });
  const reconnect = () => page.evaluate(() => {
    sessionStorage.setItem('fixture-reconnected', 'true');
    delete navigator.onLine;
  });
  const withExplanation = (content, explanation) => ({ ...content, card: { ...content.card, explanation } });
  const expected = new Map(cards.map(([kind, card]) => [card.id,
    withExplanation(card.content_v2, 'Änderung ' + kind + '\nКонтекст [[literal]]')]));

  try {
    await launch();
    phase = 'offline';
    await device.setOffline(true);
    for (const [index, [kind, card]] of cards.entries()) {
      await openEditor(card.id);
      await expect(page.getByRole('combobox', { name: 'Тип карточки' })).toHaveValue(kind);
      await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
      const source = page.getByRole('textbox', { name: 'Полный content_v2 JSON' });
      expect(JSON.parse(await source.inputValue())).toEqual(card.content_v2);
      const literal = JSON.stringify(expected.get(card.id), null, 4) + '\n';
      await source.fill('{"schema_version":');
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Сохранить карточку', exact: true })).toBeDisabled();
      await source.fill(literal);
      await source.blur();
      await expect(source).toHaveValue(literal);
      if (index === 0) {
        for (const width of [320, 375, 430, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath('source-' + width + '.png'), fullPage: true });
        }
        await page.setViewportSize({ width: 375, height: 844 });
      }
      await page.getByRole('button', { name: 'Типизированная форма', exact: true }).click();
      await expect(contextField()).toHaveValue(expected.get(card.id).card.explanation);
      await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
      expect(JSON.parse(await source.inputValue())).toEqual(expected.get(card.id));
      await page.getByRole('button', { name: 'Типизированная форма', exact: true }).click();
      await contextField().fill(expected.get(card.id).card.explanation);
      if (index % 2) await page.getByRole('button', { name: 'Исходный JSON', exact: true }).click();
      if (index === cards.length - 1) {
        // The same Save button must commit locally even while connected.
        phase = 'lose-response';
        await device.setOffline(false);
        await reconnect();
      }
      await save();
      await expect(item(card.id)).toBeVisible();
      if (phase === 'offline') await expect(item(card.id).getByRole('status')).toHaveText('Ожидает синхронизации');
    }

    await expect.poll(() => attempts.length, { timeout: 20000 }).toBe(9);
    await expect.poll(async () => (await inspect()).cards.map(card => card.offline_edit?.status))
      .toEqual(Array(9).fill('error'));
    const interrupted = await inspect();
    expect(interrupted.operations).toHaveLength(9);
    expect(new Set(interrupted.operations.map(op => op.payload.request_id)).size).toBe(9);
    for (const [, card] of cards) {
      const op = interrupted.operations.find(op => op.cardId === card.id);
      expect(op.payload).toMatchObject({ revision: card.revision, content_v2: expected.get(card.id) });
      expect(interrupted.cards.find(row => row.id === card.id).content_v2).toEqual(expected.get(card.id));
      expect(attempts.find(write => write.payload.request_id === op.payload.request_id))
        .toMatchObject({ status: 200, payload: op.payload, queued: op.payload, receipt: { content_v2: expected.get(card.id) } });
    }

    phase = 'offline';
    await device.close();
    await launch();
    expect(await inspect()).toEqual(interrupted);
    phase = 'ready';
    await reconnect();
    expect((await sync()).success).toBe(true);
    const confirmed = await inspect();
    expect(confirmed.operations).toEqual([]);
    for (const op of interrupted.operations) {
      const writes = attempts.filter(write => write.payload.request_id === op.payload.request_id);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual(writes[0]);
      expect(confirmed.cards.find(row => row.id === op.cardId)).toMatchObject({
        revision: writes[0].receipt.revision, content_v2: op.payload.content_v2,
      });
    }

    for (const kind of ['quiz', 'word_bank']) {
      const { id } = fixture.edit_cards[kind];
      const base = confirmed.cards.find(card => card.id === id);
      await openEditor(id);
      const mine = withExplanation(base.content_v2, 'Lokaler Entwurf ' + kind);
      const theirs = withExplanation(base.content_v2, 'Серверная версия ' + kind);
      await contextField().fill(mine.card.explanation);
      const remote = await device.request.patch(fixture.origin + '/api/cards/' + id, {
        headers: { Authorization: 'Bearer ' + fixture.owner_token },
        data: { content_v2: theirs, revision: base.revision, request_id: require('node:crypto').randomUUID() },
      });
      expect(remote.ok()).toBe(true);
      const remoteCard = await remote.json();
      await save();
      await expect(item(id).getByRole('status')).toHaveText('Конфликт версий');
      await expect.poll(async () => (await inspect()).cards.find(card => card.id === id).offline_edit?.server?.revision)
        .toBe(remoteCard.revision);
      await openDraft(id);
      const conflict = (await inspect()).cards.find(card => card.id === id);
      expect(conflict.content_v2).toEqual(mine);
      expect(conflict.offline_edit.server.content_v2).toEqual(theirs);
      const keepLocal = kind === 'quiz';
      if (keepLocal) await panel().screenshot({ path: testInfo.outputPath('quiz-conflict-375.png') });
      await panel().getByRole('button', { name: keepLocal ? 'Сохранить мою версию' : 'Оставить серверную версию' }).click();
      await expect.poll(async () => (await inspect()).operations).toEqual([]);
      expect((await inspect()).cards.find(card => card.id === id).content_v2).toEqual(keepLocal ? mine : theirs);
      if (keepLocal) {
        const rejected = attempts.find(write => write.payload.request_id === conflict.offline_edit.requestId);
        const resolved = attempts.at(-1);
        expect(rejected.status).toBe(409);
        expect(resolved).toMatchObject({ status: 200, payload: { revision: remoteCard.revision, content_v2: mine } });
        expect(resolved.payload.request_id).not.toBe(rejected.payload.request_id);
      }
      await page.locator('.view-editor .back-btn').press('Enter');
      await expect.poll(sync).toMatchObject({ success: true });
    }

    const { id } = fixture.edit_cards.quiz;
    await openEditor(id);
    const correctAnswer = page.getByRole('checkbox', { name: 'Верный ответ', exact: true }).nth(1);
    await correctAnswer.uncheck();
    await save();
    await expect(item(id).getByRole('status')).toContainText('Ошибка синхронизации');
    const rejected = (await inspect()).operations[0];
    expect(rejected.payload.content_v2.card.data.options.every(option => !option.correct)).toBe(true);
    expect(attempts.at(-1)).toMatchObject({ status: 422, payload: rejected.payload });
    expect((await sync()).success).toBe(true);
    expect(attempts.filter(write => write.payload.request_id === rejected.payload.request_id)).toHaveLength(1);
    await openDraft(id);
    await expect(panel().getByRole('alert')).toContainText('options');
    await panel().getByRole('button', { name: 'Продолжить редактирование' }).click();
    await correctAnswer.check();
    await page.locator('#card-editor-front').fill('Korrigierte Quizfrage?');
    await save();
    await expect.poll(async () => (await inspect()).operations).toEqual([]);
    expect(attempts.at(-1)).toMatchObject({ status: 200, payload: { revision: rejected.payload.revision } });
    expect(attempts.at(-1).payload.request_id).not.toBe(rejected.payload.request_id);
  } finally {
    await device?.close();
  }
});

test('resolves Standard revisions across two devices and preserves the draft on auth errors', async ({ page, context, browser }, testInfo) => {
  test.skip(!fixture?.card || fixture.second_card, 'Conflict fixture only');
  test.setTimeout(150000);
  const attempts = [];
  let phase = 'ready';
  const { id, revision: originalRevision } = fixture.card;
  const localPrompt = 'Lokale Änderung ' + 'Donaudampfschifffahrtsgesellschaft'.repeat(3);
  const mergedPrompt = 'Manually merged Standard prompt';
  const serverOne = 'Серверная версия R2';
  const serverTwo = 'Серверная версия R3';
  const serverThree = 'Серверная версия R4';
  await setupDevice(context, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
  const second = await browser.newContext({ serviceWorkers: 'block' });
  await setupDevice(second, () => 'ready', () => {}, true);
  try {
    const other = await second.newPage();
    await other.goto('http://127.0.0.1:5199/');
    await page.setViewportSize({ width: 375, height: 844 });
    await page.bringToFront();
    page.setDefaultTimeout(10000);
    await page.goto('/');
    await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
    await openList(page);
    const inspect = () => page.evaluate(async id => {
      const { prepareLocalDb, CARD_EDIT_KEY } = await import('/src/services/localDb.js');
      const db = await prepareLocalDb();
      return { card: await db.cards.get(id), operation: await db.syncState.get(CARD_EDIT_KEY + id),
        alias: (await db.syncState.get('aliases'))?.mappings.cards?.[id] };
    }, id);
    const remote = (prompt = null) => other.evaluate(async ({ id, prompt }) => {
      const { networkApi } = await import('/src/services/networkApi.js');
      const path = '/cards/' + id;
      const { data: card } = await networkApi.get(path);
      if (!prompt) return card;
      card.content_v2.card.data.prompt = prompt;
      return (await networkApi.patch(path, { content_v2: card.content_v2, revision: card.revision,
        request_id: crypto.randomUUID() })).data;
    }, { id, prompt });
    const setRole = role => other.evaluate(async ({ role, deckId }) => {
      const { networkApi } = await import('/src/services/networkApi.js');
      await networkApi.put('/collaborative/deck/' + deckId + '/role', { user_id_to_update: 1, role });
    }, { role, deckId: deck.id });
    const disconnect = async () => {
      phase = 'offline';
      await page.evaluate(() => {
        sessionStorage.setItem('offline-fixture', 'true');
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      });
      await context.setOffline(true);
    };
    const connect = async nextPhase => {
      await context.setOffline(false);
      phase = nextPhase;
      await page.evaluate(() => {
        sessionStorage.removeItem('offline-fixture');
        delete navigator.onLine;
      });
    };
    const reloadOffline = async () => {
      // Only the local Vite shell is reachable for reload.
      await context.setOffline(false);
      await page.reload();
      await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
      await openList(page);
    };
    const sync = () => page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.sync());
    const edit = async () => {
      await page.getByRole('button', { name: 'Действия с карточкой' }).click();
      await page.getByRole('button', { name: /Редактировать/ }).click();
    };
    const openDraft = () => page.getByRole('button', { name: 'Открыть локальную правку' }).click();
    const leaveEditor = () => page.locator('.view-editor .back-btn').press('Enter');
    const save = () => page.locator('.btn-save-action').click();
    const promptField = page.locator('#card-editor-front');
    const panel = page.getByRole('region', { name: 'Синхронизация карточки' });
    const confirmMine = () => panel.getByRole('button', { name: 'Сохранить мою версию' }).click();
    const offlineEdit = async prompt => {
      await disconnect();
      await edit();
      await promptField.fill(prompt);
      await save();
      await expect(page.getByText('Ожидает синхронизации', { exact: true })).toBeVisible();
    };

    expect((await inspect()).card.revision).toBe(originalRevision);
    await disconnect();
    await edit();
    await expect(promptField).toHaveValue(fixture.card.content_v2.card.data.prompt);
    await promptField.fill(localPrompt);
    await page.evaluate(async () => {
      const db = (await import('/src/services/localDb.js')).getLocalDb();
      const add = db.syncState.add;
      db.syncState.add = () => {
        db.syncState.add = add;
        throw new Error('Synthetic edit outbox failure');
      };
    });
    await save();
    await expect(page.getByText(/Synthetic edit outbox failure/)).toBeVisible();
    expect((await inspect()).card.content_v2).toEqual(fixture.card.content_v2);
    expect((await inspect()).operation).toBeUndefined();
    await save();
    await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toBeVisible();
    await expect(page.getByText('Ожидает синхронизации', { exact: true })).toBeVisible();
    const queued = await inspect();
    expect(queued.card.id).toBe(id);
    expect(queued.operation.payload.revision).toBe(originalRevision);
    expect(queued.operation.payload.content_v2.card).toMatchObject({
      id: 'authored-id', metadata: { fixture: ['ä', 'я'] }, data: { prompt: localPrompt },
    });
    await reloadOffline();
    expect(await inspect()).toEqual(queued);
    await openDraft();
    await expect(panel.getByText(localPrompt, { exact: true })).toBeVisible();
    await page.getByRole('heading', { name: 'Правка карточки' }).waitFor();
    await leaveEditor();

    await connect('lose-response');
    expect((await sync()).success).toBe(false);
    await expect(page.getByText(/Ошибка синхронизации\. Карточка сохранена/)).toBeVisible();
    const receipt = await remote();
    expect(receipt.content_v2).toEqual(queued.operation.payload.content_v2);
    expect((await inspect()).operation).toEqual(queued.operation);
    expect((await inspect()).card.revision).toBe(originalRevision);
    phase = 'ready';
    expect((await sync()).success).toBe(true);
    await expect(page.getByText('Карточка синхронизирована', { exact: true })).toBeVisible();
    const confirmed = await inspect();
    expect(confirmed.operation).toBeUndefined();
    expect(confirmed.alias).toBeUndefined();
    expect(confirmed.card.revision).toBe(receipt.revision);
    expect(attempts.map(a => [a.payload, a.receipt.revision])).toEqual([
      [queued.operation.payload, receipt.revision], [queued.operation.payload, receipt.revision],
    ]);
    await openList(page);

    await offlineEdit('Локальный черновик для сравнения');
    const serverVersionOne = await remote(serverOne);
    await connect('conflict-read-down');
    expect((await sync()).success).toBe(false);
    const rejected = await inspect();
    expect(rejected.card.offline_edit).toMatchObject({ status: 'conflict' });
    expect(rejected.card.offline_edit.server).toBeUndefined();
    expect(attempts.at(-1)).toMatchObject({ status: 409, payload: { revision: receipt.revision } });
    const attemptsBeforeRead = attempts.length;
    phase = 'ready';
    expect((await sync()).success).toBe(true);
    expect(attempts).toHaveLength(attemptsBeforeRead);
    const conflicted = await inspect();
    expect(conflicted.operation).toEqual(rejected.operation);
    expect(conflicted.card.offline_edit.server.revision).toBe(serverVersionOne.revision);
    expect(conflicted.card.content_v2.card.data.prompt).toBe('Локальный черновик для сравнения');
    await disconnect();
    await reloadOffline();
    expect(await inspect()).toEqual(conflicted);
    await openDraft();
    await expect(panel.getByText('Конфликт версий')).toBeVisible();
    await expect(panel.getByText('Локальная версия')).toBeVisible();
    await expect(panel.getByText('Серверная версия', { exact: true })).toBeVisible();
    await expect(panel.getByText('Локальный черновик для сравнения', { exact: true })).toBeVisible();
    await expect(panel.getByText(serverOne, { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Оставить серверную версию' }).click();
    await expect(promptField).toHaveValue(serverOne);
    expect((await inspect()).operation).toBeUndefined();
    expect((await inspect()).card.revision).toBe(serverVersionOne.revision);
    expect(attempts).toHaveLength(attemptsBeforeRead);
    await leaveEditor();

    await offlineEdit(localPrompt);
    const serverVersionTwo = await remote(serverTwo);
    await connect('ready');
    expect((await sync()).success).toBe(true);
    await openDraft();
    await expect(panel.getByText(serverTwo, { exact: true })).toBeVisible();
    // The previous offline save displays a toast for six seconds.
    await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toHaveCount(0, { timeout: 7000 });
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(panel.getByRole('button', { name: 'Сохранить мою версию' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if ([320, 1280].includes(width)) await page.screenshot({ path: testInfo.outputPath('conflict-' + width + '.png') });
    }
    await panel.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await promptField.fill(mergedPrompt);
    await save();
    await expect(panel.getByText(mergedPrompt, { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Сохранить мою версию' })).toBeEnabled();
    const merged = await inspect();
    expect(merged.card.content_v2.card.data.prompt).toBe(mergedPrompt);
    expect(merged.operation.payload.content_v2.card.data.prompt).toBe(localPrompt);
    await disconnect();
    await reloadOffline();
    expect(await inspect()).toEqual(merged);
    await openDraft();
    const serverVersionThree = await remote(serverThree);
    await connect('ready');
    await confirmMine();
    await expect(panel.getByText(serverThree, { exact: true })).toBeVisible();
    const repeated = await inspect();
    expect(repeated.operation.payload).toMatchObject({ revision: serverVersionTwo.revision, content_v2: merged.card.content_v2 });
    expect(repeated.operation.payload.request_id).not.toBe(merged.operation.payload.request_id);
    expect(repeated.card.offline_edit.server.revision).toBe(serverVersionThree.revision);
    expect(attempts.at(-1).status).toBe(409);
    expect((await remote()).revision).toBe(serverVersionThree.revision);

    await setRole('viewer');
    await confirmMine();
    await expect(panel.getByText(/Сервер запретил изменение/)).toBeVisible();
    const forbidden = await inspect();
    expect(forbidden.operation.payload.revision).toBe(serverVersionThree.revision);
    expect(forbidden.card.content_v2).toEqual(merged.card.content_v2);
    expect(attempts.at(-1).status).toBe(403);
    const viewer = await page.evaluate(async deckId => {
      const { syncService } = await import('/src/services/syncService.js');
      const { getLocalDb } = await import('/src/services/localDb.js');
      const { default: api } = await import('/src/services/api.js');
      const pulled = await syncService.sync({ pullOnly: true });
      const role = (await getLocalDb().decks.get(deckId)).role;
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      try {
        await api.post('/cards/save', { deck_id: deckId, request_id: crypto.randomUUID(),
          content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Viewer draft', answer: 'Denied' } } } });
        return { pulled, role, accepted: true };
      } catch (error) {
        return { pulled, role, accepted: false, message: error.message };
      } finally {
        delete navigator.onLine;
      }
    }, deck.id);
    expect(viewer).toMatchObject({ pulled: { success: true }, role: 'viewer', accepted: false,
      message: 'У вас доступ только для чтения' });

    expect((await remote()).revision).toBe(serverVersionThree.revision);

    await setRole('editor');
    phase = 'unauthorized';
    await panel.getByRole('button', { name: 'Повторить синхронизацию' }).click();
    await expect.poll(async () => (await inspect()).card.offline_edit.httpStatus).toBe(401);
    expect(attempts.at(-1).status).toBe(401);
    expect((await inspect()).operation).toEqual(forbidden.operation);
    expect((await remote()).revision).toBe(serverVersionThree.revision);
    phase = 'ready';
    await page.reload();
    await expect(page.getByText('Карточка синхронизирована', { exact: true })).toBeVisible();
    const final = await inspect();
    expect(final.operation).toBeUndefined();
    expect(final.card.offline_edit).toBeUndefined();
    expect(final.alias).toBeUndefined();
    expect(final.card.id).toBe(id);
    expect(final.card.content_v2).toEqual(merged.card.content_v2);
    expect(final.card.revision).toBe((await remote()).revision);
    expect(attempts.slice(-3).map(a => a.payload)).toEqual(Array(3).fill(forbidden.operation.payload));
  } finally {
    await second.close();
  }
});

test('survives interrupted Standard delivery and preserves later drafts', async ({ page, context }, testInfo) => {
  test.skip(!fixture?.second_card, 'Delivery fixture only');
  test.setTimeout(120000);
  const { card, second_card: second } = fixture;
  const attempts = [];
  const editPath = '/api/cards/' + card.id;
  let intercept = () => undefined;
  await setupDevice(context, () => 'ready', () => {}, false, async ({ route, pathname, payload, fetchFromServer }) => {
    const attempt = { pathname, payload };
    attempts.push(attempt);
    const fault = intercept(attempt);
    if (fault === 'before') return route.abort('connectionreset');
    const response = await fetchFromServer();
    Object.assign(attempt, { status: response.status(), result: await response.json() });
    const outcome = fault ? await fault : null;
    if (outcome === 'after') return route.abort('connectionreset');
    return route.fulfill({ response });
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await openList(page);

  const idle = () => expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held.some(lock => lock.name === 'lerne-offline-sync'))).toBe(false);
  const sync = () => page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.sync({ pendingNativeOnly: true }));
  const inspect = id => page.evaluate(async id => {
    const { prepareLocalDb, CARD_EDIT_KEY, CARD_CREATE_KEY } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return {
      card: await db.cards.get(id),
      operation: await db.syncState.get(CARD_EDIT_KEY + id),
      creates: await db.syncState.where('key').startsWith(CARD_CREATE_KEY).toArray(),
      alias: (await db.syncState.get('aliases'))?.mappings.cards?.[id],
    };
  }, id);
  const stage = (item, prompt) => page.evaluate(async ({ item, prompt }) => {
    const { default: api } = await import('/src/services/api.js');
    item.content_v2.card.data.prompt = prompt;
    const payload = { content_v2: item.content_v2, revision: item.revision, request_id: crypto.randomUUID() };
    await api.patch('/cards/' + item.id, payload, { offlineCardEdit: true });
    return payload;
  }, { item, prompt });
  const remote = (id, prompt) => page.evaluate(async ({ id, prompt }) => {
    const { networkApi } = await import('/src/services/networkApi.js');
    const path = '/cards/' + id;
    const { data } = await networkApi.get(path);
    if (!prompt) return data;
    data.content_v2.card.data.prompt = prompt;
    return (await networkApi.patch(path, {
      content_v2: data.content_v2, revision: data.revision, request_id: crypto.randomUUID(),
    })).data;
  }, { id, prompt });
  const promptOf = item => item.content_v2.card.data.prompt;
  const writesFor = id => attempts.filter(a => a.pathname === '/api/cards/' + id);
  const holdEdit = () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    intercept = ({ pathname }) => pathname === editPath ? gate : undefined;
    return release;
  };

  await idle();
  const a = await stage(card, 'Draft A');
  const independent = await stage(second, 'Independent edit');
  intercept = ({ pathname }) => pathname === editPath ? 'before' : undefined;
  expect((await sync()).success).toBe(false);
  expect(writesFor(card.id)).toEqual([{ pathname: editPath, payload: a }]);
  expect((await remote(card.id)).revision).toBe(card.revision);
  expect((await inspect(card.id)).operation.payload).toEqual(a);
  expect((await inspect(second.id)).operation).toBeUndefined();
  expect((await remote(second.id)).content_v2).toEqual(independent.content_v2);

  await openList(page);
  const releaseFirst = holdEdit();
  const first = sync();
  try {
    await expect.poll(() => writesFor(card.id).at(-1).status).toBe(200);
    await page.locator('#card-item-' + card.id).getByRole('button', { name: 'Открыть локальную правку' }).click();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await page.locator('#card-editor-front').fill('Draft B');
    await page.locator('.btn-save-action').click();
    await expect(page.locator('#card-item-' + card.id)).toContainText('Draft B');
    expect((await inspect(card.id)).operation.payload).toEqual(a);
    expect((await inspect(card.id)).card.offline_edit.status).toBe('error');
    await page.screenshot({ path: testInfo.outputPath('later-draft-375.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    releaseFirst('after');
    expect((await first).success).toBe(false);
  }
  const committed = writesFor(card.id).at(-1).result;
  const interrupted = await inspect(card.id);
  expect(promptOf(interrupted.card)).toBe('Draft B');
  expect(promptOf(await remote(card.id))).toBe('Draft A');

  // Startup retries the 6B.2-shaped operation. A response from the previous
  // login must not acknowledge it even when the account and UUID match.
  const releaseOldSession = holdEdit();
  try {
    await page.reload();
    await expect.poll(() => writesFor(card.id).length).toBe(3);
    await expect.poll(() => writesFor(card.id).at(-1).result).toEqual(committed);
    expect(await inspect(card.id)).toEqual(interrupted);
    await page.evaluate(() => {
      const key = 'lerne_auth_v2_session';
      const session = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...session, client_session_id: crypto.randomUUID() }));
    });
  } finally {
    releaseOldSession();
  }
  await idle();
  expect(await inspect(card.id)).toEqual(interrupted);
  intercept = () => undefined;
  await page.evaluate(() => {
    window.deliveredEdits = [];
    window.addEventListener('lerne:card-edit-changed', ({ detail }) => window.deliveredEdits.push(detail));
  });
  const pull = page.waitForResponse(response => response.url().includes('/api/sync/v2/pull') && response.ok());
  expect((await sync()).success).toBe(true);
  expect((await (await pull).json()).cards.find(item => item.id === card.id)).toMatchObject({ revision: committed.revision });
  const promoted = await inspect(card.id);
  expect(promptOf(promoted.card)).toBe('Draft B');
  expect(promoted.card.offline_edit.status).toBe('pending');
  expect(promoted.operation.payload).toMatchObject({ revision: committed.revision, content_v2: promoted.card.content_v2 });
  expect(promoted.operation.payload.request_id).not.toBe(a.request_id);
  expect(writesFor(card.id).map(attempt => attempt.payload)).toEqual(Array(4).fill(a));
  expect(await page.evaluate(() => window.deliveredEdits)).toMatchObject([
    { deliveredRequestId: a.request_id, confirmed: false, card: { id: card.id } },
  ]);
  await openList(page);
  const releaseSecond = holdEdit();
  const deliveringSecond = sync();
  try {
    await expect.poll(() => writesFor(card.id).length).toBe(5);
    await page.locator('#card-item-' + card.id).getByRole('button', { name: 'Открыть локальную правку' }).click();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await page.locator('#card-editor-front').fill('Unsaved text while B is sending');
  } finally {
    releaseSecond();
    expect((await deliveringSecond).success).toBe(true);
  }
  await expect(page.locator('#card-editor-front')).toHaveValue('Unsaved text while B is sending');
  await page.locator('.view-editor .back-btn').press('Enter');
  expect(writesFor(card.id).at(-1).payload).toEqual(promoted.operation.payload);
  expect((await inspect(card.id)).operation).toBeUndefined();
  expect(promptOf(await remote(card.id))).toBe('Draft B');

  const confirmed = await inspect(card.id);
  const c = await stage(confirmed.card, 'Rejected Draft C');
  await stage(confirmed.card, 'Latest Draft D');
  const newerServer = await remote(card.id, 'Concurrent server edit');
  expect((await sync()).success).toBe(true);
  expect(writesFor(card.id).at(-1)).toMatchObject({ payload: c, status: 409 });
  const conflict = await inspect(card.id);
  expect(conflict.card.offline_edit).toMatchObject({ status: 'conflict', server: { revision: newerServer.revision } });
  expect(promptOf(conflict.card)).toBe('Latest Draft D');
  expect(conflict.operation.payload).toEqual(c);
  expect((await remote(card.id)).revision).toBe(newerServer.revision);

  // An online create in a cached deck is also persisted before its first
  // HTTP write. If the server ID was cached before the receipt arrived, the
  // stale create receipt must preserve the edit already attached to that ID.
  let releaseCreate;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const createPath = '/api/cards/save';
  intercept = ({ pathname }) => pathname === createPath ? createGate : undefined;
  const createViaApi = () => page.evaluate(async ({ deckId, content }) => {
    const { default: api } = await import('/src/services/api.js');
    return (await api.post('/cards/save', { deck_id: deckId, content_v2: content, request_id: crypto.randomUUID() })).data;
  }, { deckId: deck.id, content: card.content_v2 });
  const creating = createViaApi();
  let created, create, freshDraft;
  try {
    await expect.poll(() => attempts.find(a => a.pathname === createPath)?.status).toBe(200);
    created = attempts.find(a => a.pathname === createPath).result;
    [create] = (await inspect(created.id)).creates;
    expect(create.payload).toEqual(attempts.find(a => a.pathname === createPath).payload);
    expect(create.tempId).toBeLessThan(0);
    expect((await inspect(create.tempId)).card.offline_create_status).toBe('pending');
    await page.evaluate(async id => (await (await import('/src/services/api.js')).default.get('/cards/' + id)).data, created.id);
    freshDraft = await stage(created, 'Draft on discovered server ID');
  } finally {
    releaseCreate('after');
    await creating;
  }
  intercept = ({ pathname }) => pathname === '/api/cards/' + created.id ? 'before' : undefined;
  expect((await sync()).success).toBe(false);
  expect((await inspect(create.tempId)).alias).toBe(created.id);
  expect((await inspect(create.tempId)).card).toBeUndefined();
  expect((await inspect(created.id)).creates).toEqual([]);
  expect((await inspect(created.id)).operation.payload).toEqual(freshDraft);
  expect(promptOf((await inspect(created.id)).card)).toBe('Draft on discovered server ID');
  expect(attempts.filter(a => a.pathname === createPath).map(a => a.result)).toEqual([created, created]);
  intercept = () => undefined;
  expect((await sync()).success).toBe(true);
  expect((await remote(created.id)).content_v2).toEqual(freshDraft.content_v2);
  const online = await createViaApi();
  expect(online.id).toBeGreaterThan(created.id);
  expect(online.offline_create_status).toBeUndefined();
  expect((await inspect(online.id)).creates).toEqual([]);
});

test('isolates Standard queues across tabs and login sessions', async ({ page, context }) => {
  test.skip(!fixture?.isolation, 'Isolation fixture only');
  test.setTimeout(120000);
  const writes = [];
  let heldWrite;
  let heldPull;
  const hold = () => {
    const { promise, resolve } = Promise.withResolvers();
    return { promise, release: resolve };
  };
  await setupDevice(context, () => 'ready', () => {}, false, async ({ route, payload, fetchFromServer }) => {
    const response = await fetchFromServer();
    const attempt = { payload, status: response.status(), card: await response.json() };
    writes.push(attempt);
    const tab = route.request().frame().page();
    const gate = heldWrite;
    if (gate?.prompt === payload.content_v2.card.data.prompt) {
      gate.attempt = attempt;
      await gate.promise;
    }
    if (!tab.isClosed()) await route.fulfill({ response });
  }, async ({ route, fetchFromServer }) => {
    const response = await fetchFromServer();
    const gate = heldPull;
    if (gate) {
      gate.snapshot = await response.json();
      await gate.promise;
    }
    await route.fulfill({ response });
  });

  const peer = await context.newPage();
  await page.goto('/');
  await peer.goto('/');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await expect(peer.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await openList(page);
  await openList(peer);

  const sync = (tab, options = { pendingNativeOnly: true, skipPull: true }) => tab.evaluate(async options => {
    const { syncService } = await import('/src/services/syncService.js');
    return syncService.sync(options);
  }, options);
  const inspect = tab => tab.evaluate(async () => {
    const { prepareLocalDb, CARD_CREATE_KEY } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return db.transaction('r', db.cards, db.syncState, async () => ({
      name: db.name, cards: await db.cards.toArray(),
      queue: await db.syncState.where('key').startsWith(CARD_CREATE_KEY).toArray(),
      aliases: (await db.syncState.get('aliases'))?.mappings.cards || {},
      lastSync: await db.syncState.get('lastSync'),
    }));
  });
  const enterDraft = async (tab, title, offline) => {
    await tab.evaluate(async offline => {
      if (offline) Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useUiStore.setState({ editorSourceView: 'cards', view: 'creator' });
    }, offline);
    await tab.locator('#card-editor-front').fill(title, { timeout: 7000 });
    await tab.locator('#card-editor-back').fill(answer);
    await tab.locator('.btn-save-action').click();
  };
  const createOffline = async (tab, title) => {
    await enterDraft(tab, title, true);
    await expect(tab.getByText(title, { exact: true })).toBeVisible();
    const operation = (await inspect(tab)).queue.find(row => row.payload.content_v2.card.data.prompt === title);
    expect(operation.tempId).toBeLessThan(0);
    await tab.evaluate(() => { delete navigator.onLine; });
    return operation;
  };
  const login = session => peer.evaluate(async session => {
    const { useAuthStore } = await import('/src/store/useAuthStore.js');
    const auth = useAuthStore.getState();
    auth.logout();
    await auth.finishLogin(session);
  }, session);
  const writesFor = operation => writes.filter(write => write.payload.request_id === operation.payload.request_id);

  const shared = await createOffline(page, 'Shared queue draft');
  await openList(peer);
  await expect(peer.locator('#card-item-' + shared.tempId)).toContainText('Shared queue draft');

  for (const tab of [page, peer]) {
    await tab.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
  }
  const refused = await Promise.all([sync(page), sync(peer)]);
  expect(refused.every(result => !result.success && /недоступна/.test(result.reason))).toBe(true);
  expect(writes).toEqual([]);
  expect((await inspect(peer)).queue).toEqual([shared]);
  for (const tab of [page, peer]) await tab.evaluate(() => { delete navigator.locks; });

  const staleDeck = hold();
  await peer.route(url => url.pathname === '/api/decks/' + deck.id + '/cards', async route => {
    const { pathname, search } = new URL(route.request().url());
    const response = await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
    staleDeck.cards = await response.json();
    await staleDeck.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  const lateList = peer.evaluate(async deckId => {
    const { default: api } = await import('/src/services/api.js');
    return (await api.get('/decks/' + deckId + '/cards')).data;
  }, deck.id);
  await expect.poll(() => staleDeck.cards).toEqual([]);

  heldWrite = { ...hold(), prompt: 'Shared queue draft' };
  const first = sync(page);
  try {
    await expect.poll(() => heldWrite.attempt?.status).toBe(200);
    expect(await sync(peer)).toEqual({ success: false, reason: 'Already syncing' });
    expect(writesFor(shared)).toHaveLength(1);
    expect((await inspect(peer)).queue).toEqual([shared]);
  } finally {
    heldWrite.release();
    try { expect((await first).success).toBe(true); }
    finally { staleDeck.release(); }
  }
  const sharedId = writesFor(shared)[0].card.id;
  expect((await lateList).map(card => card.id)).toEqual([sharedId]);
  await expect(peer.locator('#card-item-' + sharedId)).toContainText('Shared queue draft');
  await expect(peer.locator('#card-item-' + shared.tempId)).toHaveCount(0);
  expect((await inspect(peer)).aliases[shared.tempId]).toBe(sharedId);

  // The earlier pull must not overwrite a newer server revision another tab
  // has already read into the shared database.
  heldPull = hold();
  const stalePull = sync(page, { pullOnly: true });
  try {
    await expect.poll(() => heldPull.snapshot?.cards.find(card => card.id === sharedId)?.revision)
      .toBe(writesFor(shared)[0].card.revision);
    const fresh = await peer.evaluate(async id => {
      const { default: api, networkApi } = await import('/src/services/api.js');
      const path = '/cards/' + id;
      const { data } = await networkApi.get(path);
      data.content_v2.card.data.answer = 'New answer on the server';
      await networkApi.patch(path, { content_v2: data.content_v2, revision: data.revision,
        request_id: crypto.randomUUID() });
      return (await api.get(path)).data;
    }, sharedId);
    expect(fresh.content_v2.card.data.answer).toBe('New answer on the server');
  } finally {
    heldPull.release();
    expect((await stalePull).success).toBe(true);
  }
  heldPull = null;
  expect((await inspect(peer)).cards.find(card => card.id === sharedId).content_v2.card.data.answer)
    .toBe('New answer on the server');

  // The legacy Collaborative endpoint directs native changes to V2 pull.
  const legacy = peer.waitForResponse(response => response.url().includes('/api/sync/collab-pull'));
  const native = peer.waitForResponse(response => response.url().includes('/api/sync/v2/pull'));
  await peer.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect((await legacy).status()).toBe(409);
  expect((await native).status()).toBe(200);
  await expect.poll(() => peer.evaluate(async () => (await navigator.locks.query()).held.length)).toBe(0);

  const closing = await createOffline(page, 'Closed tab draft');
  const beforePull = await inspect(peer);
  expect((await sync(peer, { pullOnly: true })).success).toBe(true);
  expect((await inspect(peer)).queue).toEqual([closing]);
  expect((await inspect(peer)).cards.find(card => card.id === closing.tempId))
    .toEqual(beforePull.cards.find(card => card.id === closing.tempId));
  heldWrite = { ...hold(), prompt: 'Closed tab draft' };
  const abandoned = sync(page).catch(error => error.message);
  try {
    await expect.poll(() => heldWrite.attempt?.status).toBe(200);
    await page.close();
    await abandoned;
  } finally {
    heldWrite.release();
  }
  heldWrite = null;
  expect((await inspect(peer)).queue).toEqual([closing]);
  await expect.poll(() => peer.evaluate(async () => (await navigator.locks.query()).held.length)).toBe(0);
  expect((await sync(peer)).success).toBe(true);
  expect(writesFor(closing)).toHaveLength(2);
  expect(writesFor(closing)[0]).toEqual(writesFor(closing)[1]);

  heldWrite = { ...hold(), prompt: 'Private A pending draft' };
  let switching, secondAccount;
  try {
    await enterDraft(peer, 'Private A pending draft', false);
    await expect.poll(() => heldWrite.attempt?.status).toBe(200);
    [switching] = (await inspect(peer)).queue;
    expect(switching.payload).toEqual(heldWrite.attempt.payload);
    await login(fixture.second_session);
    await openList(peer, fixture.private_deck);
    expect(await inspect(peer)).toMatchObject({ name: beforePull.name.replace(/_1$/, '_2'), queue: [], cards: [] });
    await expect(peer.getByText('Private A pending draft', { exact: true })).toHaveCount(0);
    secondAccount = await createOffline(peer, 'Private B draft');
    expect((await inspect(peer)).queue).toEqual([secondAccount]);
    expect(writesFor(secondAccount)).toEqual([]);
  } finally {
    heldWrite.release();
  }
  heldWrite = null;
  await expect.poll(() => peer.evaluate(async () => (await navigator.locks.query()).held.length)).toBe(0);
  expect((await inspect(peer)).aliases).toEqual({});
  expect((await sync(peer, { pullOnly: true })).success).toBe(true);
  expect((await inspect(peer)).cards.some(card => card.deck_id === deck.id)).toBe(false);
  expect((await inspect(peer)).queue).toEqual([secondAccount]);
  expect((await sync(peer)).success).toBe(true);
  expect(writesFor(secondAccount)).toHaveLength(1);

  await login(fixture.initial_session);
  await openList(peer);
  const recovered = await inspect(peer);
  expect(recovered.name).toBe(beforePull.name);
  expect(recovered.queue).toEqual([switching]);
  await expect(peer.locator('#card-item-' + switching.tempId)).toContainText('Private A pending draft');
  await expect(peer.getByText('Private B draft', { exact: true })).toHaveCount(0);

  heldPull = hold();
  const latePull = sync(peer, { pullOnly: true });
  try {
    await expect.poll(() => heldPull.snapshot?.status).toBe('success');
    await login(fixture.new_session);
  } finally {
    heldPull.release();
    expect((await latePull).success).toBe(false);
  }
  heldPull = null;
  expect((await inspect(peer)).lastSync).toEqual(recovered.lastSync);
  expect((await inspect(peer)).queue).toEqual([switching]);
  expect((await sync(peer)).success).toBe(true);
  expect(writesFor(switching)).toHaveLength(2);
  expect(writesFor(switching)[0]).toEqual(writesFor(switching)[1]);
  expect((await inspect(peer)).queue).toEqual([]);
});

test('completes V2 list operations with search parity and durable atomic delivery', async ({ browser }, testInfo) => {
  test.skip(!fixture?.list, 'V2 list fixture only');
  test.setTimeout(180000);
  const { source, foreign, cards, foreign_id: foreignId } = fixture.list;
  let phase = 'ready', device, page;
  const attempts = [];
  const inspect = tab => tab.evaluate(async () => {
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    return { cards: await db.cards.orderBy('id').toArray(), progress: await db.progress.toArray(),
      operations: await db.syncState.where('key').startsWith('card-lifecycle-v2:').toArray() };
  });
  const sync = (tab, options = { pendingNativeOnly: true, skipPull: true }) => tab.evaluate(async options => {
    const { syncService } = await import('/src/services/syncService.js');
    for (let i = 0; i < 30; i++) {
      const result = await syncService.sync(options);
      if (result.reason !== 'Already syncing') return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Sync lock remained held');
  }, options);
  const setPhase = async value => {
    phase = value;
    await page.evaluate(offline => Object.defineProperty(navigator, 'onLine', {
      configurable: true, value: !offline,
    }), value === 'offline');
  };
  const launch = async () => {
    device = await browser.browserType().launchPersistentContext(testInfo.outputPath('list-device'), {
      viewport: { width: 375, height: 844 }, serviceWorkers: 'block',
    });
    device.setDefaultTimeout(10000);
    await setupDevice(device, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
    page = device.pages()[0];
    await page.goto('http://127.0.0.1:5199/');
    await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
  };
  const closeDevice = async () => {
    await device.unrouteAll({ behavior: 'wait' });
    await device.close();
  };
  const row = (tab, id) => tab.locator('#card-item-' + id);
  const reorder = (ids, tab = page) => tab.evaluate(async ({ ids, deck }) => {
    await (await import('/src/store/useDeckStore.js')).useDeckStore.getState().reorderCards(ids, deck);
  }, { ids, deck: source.id });
  const remove = async selected => {
    await openList(page, source);
    await page.getByTitle('Выбрать несколько карточек', { exact: true }).click();
    for (const card of selected) await row(page, card.id).locator('.card-item-text').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByTitle('Удалить выбранные карточки', { exact: true }).click();
    await expect.poll(async () => (await inspect(page)).cards.filter(card => selected.some(item => item.id === card.id))
      .every(card => card.is_deleted)).toBe(true);
  };
  const read = (tab, path) => tab.evaluate(async path => (await (await import('/src/services/api.js')).default.get(path)).data, path);
  const peerDevice = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await setupDevice(peerDevice, () => 'ready', () => {});
    const peer = await peerDevice.newPage();
    await peer.goto('http://127.0.0.1:5199/');
    await expect(peer.getByText(source.name, { exact: true }).first()).toBeVisible();
    await launch();
    expect((await sync(page, { pullOnly: true })).success).toBe(true);
    const initial = await inspect(page);

    const queries = ['', 'osterreich', 'LOSUNGSNACHWEIS', 'Beispielnachweis', 'erklarungsnachweis', 'Fachgebiet', 'unsichtbar'];
    const searchPath = (q, language = 'de') => '/cards/search?' + new URLSearchParams({ q, target_language: language });
    const online = [];
    for (const q of queries) online.push(await read(page, searchPath(q)));
    expect(online.map(result => result.cards.length)).toEqual([0, 4, 1, 1, 1, 1, 0]);
    const duplicates = await read(page, '/cards/duplicates');
    expect(duplicates.map(card => card.id)).toEqual([cards[0].id, cards[1].id, foreignId]);
    const openDuplicates = async () => {
      await page.evaluate(async () => {
        await (await import('/src/store/useDeckStore.js')).useDeckStore.getState().fetchDuplicates();
        (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('duplicates');
      });
      await expect(page.locator('.duplicate-group')).toHaveCount(1);
      await expect(page.locator('.group-header')).toContainText('Österreichischer Suchtext');
      await expect(page.locator('.duplicate-group')).toContainText('Antwort 0');
    };
    await openDuplicates();
    await setPhase('offline');
    for (const [index, q] of queries.entries()) {
      const local = await read(page, searchPath(q));
      expect(local.decks.map(deck => deck.id)).toEqual(online[index].decks.map(deck => deck.id));
      expect(local.cards.map(({ id, content_v2, card_number, total_cards, flag }) => ({ id, content_v2, card_number, total_cards, flag })))
        .toEqual(online[index].cards.map(({ id, content_v2, card_number, total_cards, flag }) => ({ id, content_v2, card_number, total_cards, flag })));
    }
    expect((await read(page, searchPath('osterreich', 'fr'))).cards.map(card => card.id)).toEqual([foreignId]);
    expect((await read(page, '/cards/duplicates')).map(card => card.id)).toEqual(duplicates.map(card => card.id));
    await openDuplicates();
    await page.screenshot({ path: testInfo.outputPath('list-duplicates-offline-375.png') });
    expect((await read(page, searchPath('osterreich') + '&folder_id=2147483647')).cards).toEqual([]);

    await setPhase('ready');
    await openList(page, source);
    const handle = row(page, cards[0].id).getByTitle('Зажмите и потяните для перетаскивания карточки');
    await handle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await inspect(page)).cards.find(card => card.id === cards[0].id)?.position).toBe(cards[1].position);
    await expect.poll(async () => (await inspect(page)).operations.length).toBe(0);
    await remove(cards.slice(6, 8));
    await expect.poll(async () => (await inspect(page)).operations.length).toBe(0);

    await setPhase('offline');
    await openList(page, source);
    const beforeFailure = await inspect(page);
    await page.evaluate(async () => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const add = db.syncState.add;
      db.syncState.add = () => { db.syncState.add = add; throw new Error('Synthetic list outbox failure'); };
    });
    const order = cards.slice(3, 6).reverse().map(card => card.id);
    await reorder(order);
    expect(await inspect(page)).toEqual(beforeFailure);
    await reorder(order);
    const queuedOrder = (await inspect(page)).operations[0];
    expect(queuedOrder.payload.card_ids).toEqual(order);
    await closeDevice();
    await launch();
    expect((await inspect(page)).operations).toEqual([queuedOrder]);
    const beforeAck = await inspect(page);
    await page.evaluate(async id => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const put = db.cards.put.bind(db.cards);
      db.cards.put = card => {
        if (card.id === id) { db.cards.put = put; throw new Error('Synthetic list acknowledgement failure'); }
        return put(card);
      };
    }, order[1]);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    expect(await inspect(page)).toEqual(beforeAck);
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    expect((await inspect(page)).operations).toEqual([queuedOrder]);
    await closeDevice();
    phase = 'offline';
    await launch();
    await setPhase('ready');
    expect((await sync(page)).success).toBe(true);
    const orderAttempts = attempts.filter(item => item.payload.request_id === queuedOrder.payload.request_id);
    expect(orderAttempts).toHaveLength(3);
    expect(orderAttempts[1]).toEqual(orderAttempts[0]);
    expect(orderAttempts[2]).toEqual(orderAttempts[0]);

    await setPhase('offline');
    await remove(cards.slice(0, 2));
    const queuedDelete = (await inspect(page)).operations[0];
    expect((await read(page, '/cards/duplicates'))).toEqual([]);
    await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('trash'));
    await page.getByRole('button', { name: /^Карточки/ }).click();
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('.trash-card').getByRole('status').first()).toHaveText('Ожидает синхронизации');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('list-delete-pending-1280.png') });
    await closeDevice();
    await launch();
    expect((await inspect(page)).operations).toEqual([queuedDelete]);
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(true);
    const deleteAttempts = attempts.filter(item => item.payload.request_id === queuedDelete.payload.request_id);
    expect(deleteAttempts).toHaveLength(2);
    expect(deleteAttempts[1]).toEqual(deleteAttempts[0]);

    expect((await sync(peer, { pullOnly: true })).success).toBe(true);
    const remote = (await inspect(peer)).cards.filter(card => card.deck_id === source.id && !card.is_deleted)
      .sort((a, b) => a.position - b.position).map(card => card.id);
    expect(remote).toEqual([cards[2].id, cards[5].id, cards[4].id, cards[3].id]);
    const peerEdit = async id => {
      const current = await read(peer, '/cards/' + id);
      expect((await peerDevice.request.patch(fixture.origin + '/api/cards/' + id, {
        headers: { authorization: 'Bearer ' + fixture.access_token },
        data: { request_id: crypto.randomUUID(), revision: current.revision, content_v2: current.content_v2 },
      })).ok()).toBe(true);
    };
    await setPhase('offline');
    await openList(page, source);
    await reorder([cards[4].id, cards[5].id]);
    await remove(cards.slice(2, 4));
    await peerEdit(cards[5].id);
    await peerEdit(cards[3].id);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    const rejected = await inspect(page);
    expect(rejected.operations).toHaveLength(2);
    expect(rejected.operations.every(operation => operation.rejected)).toBe(true);
    expect(rejected.cards.filter(card => card.offline_list_error === 409)).toHaveLength(4);
    const sent = attempts.length;
    await closeDevice();
    phase = 'offline';
    await launch();
    expect((await inspect(page)).operations).toEqual(rejected.operations);
    await setPhase('ready');
    expect((await sync(page, { pullOnly: true })).success).toBe(true);
    const final = await inspect(page);
    expect(final.operations).toEqual(rejected.operations);
    for (const card of rejected.cards.filter(card => card.offline_lifecycle)) {
      expect(final.cards.find(item => item.id === card.id)).toEqual(card);
    }
    expect(final.progress).toEqual(initial.progress);
    expect(attempts).toHaveLength(sent);
    await openList(page, source);
    await page.setViewportSize({ width: 375, height: 844 });
    const conflict = row(page, cards[4].id).getByRole('status');
    await conflict.scrollIntoViewIfNeeded();
    await expect(conflict).toHaveText('Конфликт версий');
    await page.screenshot({ path: testInfo.outputPath('list-order-conflict-375.png') });
    expect((await read(page, '/cards/search?' + new URLSearchParams({ q: 'osterreich', target_language: 'fr' }))).cards
      .every(card => card.deck_id === foreign.id)).toBe(true);
  } finally {
    if (device) await closeDevice();
    await peerDevice.unrouteAll({ behavior: 'wait' });
    await peerDevice.close();
  }
});

test('batch copies and moves V2 atomically across restarts and a second device', async ({ browser }, testInfo) => {
  test.skip(!fixture?.batch, 'Batch transfer fixture only');
  test.setTimeout(180000);
  const { source, target, denied, cards } = fixture.move;
  const attempts = [];
  let phase = 'ready', device, page;
  const inspect = tab => tab.evaluate(async () => {
    const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    return { cards: await db.cards.orderBy('id').toArray(),
      operations: await db.syncState.where('key').startsWith('card-move-v2:').toArray(),
      aliases: (await db.syncState.get('aliases'))?.mappings?.cards || {},
      progress: await db.progress.toArray() };
  });
  const sync = (tab, options = { pendingNativeOnly: true, skipPull: true }) => tab.evaluate(async options => {
    const { syncService } = await import('/src/services/syncService.js');
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await syncService.sync(options);
      if (result.reason !== 'Already syncing') return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Sync lock remained held');
  }, options);
  const setPhase = async value => {
    phase = value;
    await page.evaluate(offline => Object.defineProperty(navigator, 'onLine', {
      configurable: true, value: !offline,
    }), value === 'offline');
  };
  const launch = async () => {
    device = await browser.browserType().launchPersistentContext(testInfo.outputPath('batch-device'), {
      viewport: { width: 375, height: 844 }, serviceWorkers: 'block',
    });
    await setupDevice(device, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
    page = device.pages()[0];
    await page.goto('http://127.0.0.1:5199/');
    await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
  };
  const transfer = async (selected, copy, to = target) => {
    await openList(page, source);
    await page.getByTitle('Выбрать несколько карточек', { exact: true }).click();
    // Select in reverse order: CardList must send displayed card order.
    for (const card of [...selected].reverse()) {
      const row = page.locator('#card-item-' + card.id);
      await row.locator('.card-item-text').click();
      await expect(row).toHaveClass(/is-selected/);
    }
    await page.getByTitle(copy ? 'Копировать выбранные карточки' : 'Переместить выбранные карточки', { exact: true }).click();
    const modal = page.locator('.settings-modal').filter({ hasText: copy ? 'Копировать карточки' : 'Переместить карточки' });
    await modal.getByRole('button', { name: new RegExp(to.name) }).click();
    await modal.getByRole('button', { name: 'Копии', exact: true }).click();
    await modal.getByRole('button', { name: new RegExp(copy ? '^Копировать' : '^Переместить') }).click();
    await expect(modal).toHaveCount(0);
  };
  const peerDevice = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await setupDevice(peerDevice, () => 'ready', () => {});
    const peer = await peerDevice.newPage();
    await peer.goto('http://127.0.0.1:5199/');
    await expect(peer.getByText(source.name, { exact: true }).first()).toBeVisible();
    await launch();
    expect((await sync(page, { pullOnly: true })).success).toBe(true);
    await openList(page, source);
    const initial = await inspect(page);

    await transfer(cards.slice(0, 2), true);
    expect((await inspect(page)).operations).toEqual([]);
    const onlineCopies = attempts.at(-1).receipt.copies.map(item => item.card);
    expect(onlineCopies.map(card => card.content_v2)).toEqual(cards.slice(0, 2).map(card => card.content_v2));
    expect(onlineCopies.every(card => !cards.some(source => source.id === card.id))).toBe(true);
    await transfer(cards.slice(0, 2), false);
    expect((await inspect(page)).operations).toEqual([]);

    await setPhase('offline');
    const beforeFailure = await inspect(page);
    // Legacy callers without revisions must never enqueue native cards as V1 dirty rows.
    expect(await page.evaluate(async ({ ids, target }) => {
      const { offlineApi } = await import('/src/services/offlineApi.js');
      try {
        await offlineApi.handle('post', '/cards/batch-copy', {
          request_id: crypto.randomUUID(), card_ids: ids, target_deck_id: target, on_duplicate: 'keep',
        });
      } catch (error) { return error.code; }
      return 'unexpected-success';
    }, { ids: cards.slice(2, 4).map(card => card.id), target: target.id })).toBe('OFFLINE_UNSUPPORTED');
    expect((await inspect(page)).cards).toEqual(beforeFailure.cards);
    await page.evaluate(async () => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const add = db.syncState.add;
      db.syncState.add = () => { db.syncState.add = add; throw new Error('Synthetic batch outbox failure'); };
    });
    await openList(page, source);
    await page.getByTitle('Выбрать несколько карточек', { exact: true }).click();
    for (const card of cards.slice(2, 4)) await page.locator('#card-item-' + card.id).locator('.card-item-text').click();
    await page.getByTitle('Копировать выбранные карточки', { exact: true }).click();
    const failedModal = page.locator('.settings-modal').filter({ hasText: 'Копировать карточки' });
    await failedModal.getByRole('button', { name: new RegExp(target.name) }).click();
    await failedModal.getByRole('button', { name: 'Копии', exact: true }).click();
    await failedModal.getByRole('button', { name: /^Копировать/ }).click();
    await expect(page.getByText(/Synthetic batch outbox failure/)).toBeVisible();
    expect((await inspect(page)).cards.map(({ offline_read_started_at, ...card }) => card)).toEqual(
      beforeFailure.cards.map(({ offline_read_started_at, ...card }) => card));
    expect((await inspect(page)).operations).toEqual([]);
    // Retry the still-open dialog after transaction rollback.
    await failedModal.getByRole('button', { name: /^Копировать/ }).click();
    await expect(failedModal).toHaveCount(0);
    const queuedCopy = (await inspect(page)).operations[0];
    expect(queuedCopy.payload.card_ids).toEqual(cards.slice(2, 4).map(card => card.id));
    const copyState = await inspect(page);
    const copies = queuedCopy.localIds.map(id => copyState.cards.find(card => card.id === id));
    expect(copies.map(card => card.content_v2)).toEqual(cards.slice(2, 4).map(card => card.content_v2));
    expect(copies.every(card => card.id < 0 && !card.flag && !card.repetitions && !card.queue)).toBe(true);
    expect((await inspect(page)).progress.filter(p => queuedCopy.localIds.includes(p.card_id))).toEqual([]);
    await openList(page, target);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('#card-item-' + copies[0].id).getByRole('status').filter({ hasText: 'Копирование' }))
        .toHaveText('Копирование ожидает синхронизации');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('batch-copy-pending-1280.png') });
    await device.close();
    await launch();
    expect((await inspect(page)).operations).toEqual([queuedCopy]);
    // Fail after the first copied card was acknowledged inside the transaction.
    await page.evaluate(async id => {
      const db = await (await import('/src/services/localDb.js')).prepareLocalDb();
      const remove = db.cards.delete.bind(db.cards);
      db.cards.delete = value => {
        if (value === id) { db.cards.delete = remove; throw new Error('Synthetic batch acknowledgement failure'); }
        return remove(value);
      };
    }, queuedCopy.localIds[1]);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    const failedAck = await inspect(page);
    expect(failedAck.operations).toEqual([queuedCopy]);
    for (const card of copies) expect(failedAck.cards.find(item => item.id === card.id)).toEqual(card);
    for (const id of queuedCopy.localIds) expect(failedAck.aliases[id]).toBeUndefined();
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    expect((await inspect(page)).operations).toEqual([queuedCopy]);
    expect(attempts.at(-1).status).toBe(200);
    await device.close();
    phase = 'offline';
    await launch();
    expect((await inspect(page)).operations).toEqual([queuedCopy]);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(true);
    expect((await inspect(page)).operations).toEqual([]);
    const copyAttempts = attempts.filter(item => item.payload.request_id === queuedCopy.payload.request_id);
    expect(copyAttempts).toHaveLength(3);
    expect(copyAttempts[1]).toEqual(copyAttempts[0]);
    expect(copyAttempts[2]).toEqual(copyAttempts[0]);
    const offlineCopies = copyAttempts[0].receipt.copies.map(item => item.card);
    for (const [index, id] of queuedCopy.localIds.entries()) {
      expect((await inspect(page)).aliases[id]).toBe(offlineCopies[index].id);
    }

    await setPhase('offline');
    await transfer(cards.slice(2, 4), false);
    const queuedMove = (await inspect(page)).operations[0];
    const progressBefore = (await inspect(page)).progress;
    await device.close();
    await launch();
    expect((await inspect(page)).operations).toEqual([queuedMove]);
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    expect((await inspect(page)).operations).toEqual([queuedMove]);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(true);
    const moveAttempts = attempts.filter(item => item.payload.request_id === queuedMove.payload.request_id);
    expect(moveAttempts).toHaveLength(2);
    expect(moveAttempts[1]).toEqual(moveAttempts[0]);
    expect((await inspect(page)).progress).toEqual(progressBefore);

    expect((await sync(peer, { pullOnly: true })).success).toBe(true);
    const expected = [...onlineCopies, ...cards.slice(0, 2), ...offlineCopies, ...cards.slice(2, 4)];
    const peerCards = (await inspect(peer)).cards.filter(card => card.deck_id === target.id).sort((a, b) => a.position - b.position);
    expect(peerCards.map(({ id, content_v2 }) => ({ id, content_v2 }))).toEqual(
      expected.map(({ id, content_v2 }) => ({ id, content_v2 })));
    await openList(peer, target);
    for (const card of expected) await expect(peer.locator('#card-item-' + card.id)).toBeVisible();

    // A stale member rejects the whole copy and move; local snapshots and requests survive pull/restart.
    await setPhase('offline');
    await transfer(cards.slice(4, 6), true);
    await transfer(cards.slice(4, 6), false);
    const stale = cards[5];
    const edit = await peerDevice.request.patch(fixture.origin + '/api/cards/' + stale.id, {
      headers: { authorization: 'Bearer ' + fixture.access_token },
      data: { request_id: crypto.randomUUID(), revision: stale.revision, content_v2: stale.content_v2 },
    });
    expect(edit.ok()).toBe(true);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    expect((await inspect(page)).operations).toHaveLength(2);
    expect((await inspect(page)).operations.every(op => op.rejected)).toBe(true);
    expect((await inspect(page)).cards.filter(card => card.offline_move).every(card => card.offline_move.httpStatus === 409)).toBe(true);

    await setPhase('offline');
    await transfer(cards.slice(6, 8), true, denied);
    await transfer(cards.slice(6, 8), false, denied);
    const revoke = await peerDevice.request.put(fixture.origin + '/api/collaborative/deck/' + denied.id + '/role', {
      headers: { authorization: 'Bearer ' + fixture.owner_token }, data: { user_id_to_update: 1, role: 'viewer' },
    });
    expect(revoke.ok()).toBe(true);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    const rejected = await inspect(page);
    expect(rejected.operations).toHaveLength(4);
    expect(rejected.operations.every(op => op.rejected)).toBe(true);
    expect(rejected.cards.filter(card => card.offline_move?.httpStatus === 403)).toHaveLength(4);
    const deliveries = attempts.length;
    await device.close();
    phase = 'offline';
    await launch();
    expect((await inspect(page)).operations).toEqual(rejected.operations);
    await setPhase('ready');
    expect((await sync(page, { pullOnly: true })).success).toBe(true);
    expect((await inspect(page)).operations).toEqual(rejected.operations);
    for (const card of rejected.cards.filter(card => card.offline_move)) {
      expect((await inspect(page)).cards.find(item => item.id === card.id)).toEqual(card);
    }
    expect(attempts).toHaveLength(deliveries);
    expect((await inspect(page)).progress.filter(p => cards.slice(0, 4).some(card => card.id === p.card_id)))
      .toEqual(initial.progress.filter(p => cards.slice(0, 4).some(card => card.id === p.card_id)));
    await openList(page, target);
    await page.setViewportSize({ width: 375, height: 844 });
    const errorStatus = page.getByText('Копирование не завершено. Карточки сохранены на устройстве.').first();
    await errorStatus.scrollIntoViewIfNeeded();
    await expect(errorStatus).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('batch-rejected-375.png') });
  } finally {
    await device?.close();
    await peerDevice.close();
  }
});

test('moves V2 cards across decks with durable placement, replay and rejection', async ({ page, context, browser }, testInfo) => {
  test.skip(!fixture?.move, 'Move fixture only');
  test.setTimeout(90000);
  const { source, target, denied, cards: [online, offline, refused, stale] } = fixture.move;
  let phase = 'ready';
  const attempts = [];
  await setupDevice(context, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
  const inspect = id => page.evaluate(async id => {
    const { prepareLocalDb, CARD_MOVE_KEY } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return { card: await db.cards.get(id), operation: await db.syncState.get(CARD_MOVE_KEY + id) };
  }, id);
  const sync = (device, options = { pendingNativeOnly: true, skipPull: true }) => device.evaluate(async options =>
    (await import('/src/services/syncService.js')).syncService.sync(options), options);
  const row = (device, card) => device.locator('#card-item-' + card.id);
  const move = async (card, to) => {
    await row(page, card).getByRole('button', { name: 'Действия с карточкой' }).click();
    const dialog = page.getByRole('dialog', { name: 'Управление карточкой' });
    await dialog.getByRole('button', { name: 'Перенести в другую колоду' }).click();
    await dialog.getByRole('button', { name: new RegExp(to.name) }).click();
  };
  const setOffline = async offline => {
    phase = offline ? 'offline' : 'ready';
    await context.setOffline(offline);
    await page.evaluate(offline => {
      if (offline) {
        sessionStorage.setItem('offline-fixture', 'true');
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      } else {
        sessionStorage.removeItem('offline-fixture');
        delete navigator.onLine;
      }
    }, offline);
  };

  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/');
  await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
  await openList(page, source);
  await move(online, target);
  await expect(page.getByText('Карточка перемещена', { exact: true })).toBeVisible();
  await expect(row(page, online)).toHaveCount(0);
  const placed = await inspect(online.id);
  expect(placed.operation).toBeUndefined();
  expect(placed.card).toMatchObject({ id: online.id, deck_id: target.id, content_v2: online.content_v2 });
  expect(placed.card.revision).not.toBe(online.revision);

  const original = await inspect(offline.id);
  await setOffline(true);
  await page.evaluate(async () => {
    const { getLocalDb } = await import('/src/services/localDb.js');
    const db = getLocalDb();
    const add = db.syncState.add;
    db.syncState.add = () => {
      db.syncState.add = add;
      throw new Error('Synthetic move outbox failure');
    };
  });
  await move(offline, target);
  await expect(page.getByText(/Synthetic move outbox failure/)).toBeVisible();
  expect(await inspect(offline.id)).toEqual({ ...original,
    card: { ...original.card, offline_read_started_at: expect.any(Number) } });
  await move(offline, target);
  await expect(row(page, offline)).toHaveCount(0);
  const queued = await inspect(offline.id);
  expect(queued.card).toMatchObject({ id: offline.id, deck_id: target.id, content_v2: offline.content_v2 });
  expect(queued.operation.payload).toEqual({
    request_id: expect.any(String), card_ids: [offline.id], revisions: { [offline.id]: offline.revision },
    target_deck_id: target.id, on_duplicate: 'keep',
  });
  expect(attempts).toHaveLength(1);

  // Restart with a reachable app shell and disconnected API.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(target.name, { exact: true }).first()).toBeVisible();
  await openList(page, target);
  await expect(row(page, offline).getByRole('status')).toHaveText('Перенос ожидает синхронизации');
  expect(await inspect(offline.id)).toEqual(queued);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(row(page, offline).getByRole('status')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('pending-move-1280.png') });

  await setOffline(false);
  await openList(page, source);
  await expect(row(page, offline)).toHaveCount(0);
  await openList(page, target);
  await expect(row(page, offline).getByRole('status')).toBeVisible();
  phase = 'lose-response';
  expect((await sync(page)).success).toBe(false);
  expect(await inspect(offline.id)).toEqual(queued);
  expect(attempts.at(-1).status).toBe(200);

  phase = 'ready';
  await page.reload();
  await expect.poll(async () => (await inspect(offline.id)).operation).toBeUndefined();
  const confirmed = await inspect(offline.id);
  expect(confirmed.card).toMatchObject({ id: offline.id, deck_id: target.id, content_v2: offline.content_v2 });
  const deliveries = attempts.filter(attempt => attempt.payload.card_ids.includes(offline.id));
  expect(deliveries).toHaveLength(2);
  expect(deliveries[1]).toEqual(deliveries[0]);
  expect(confirmed.card.revision).toBe(deliveries[0].receipt.placements[0].revision);

  const other = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await setupDevice(other, () => 'ready', () => {});
    const peer = await other.newPage();
    await peer.goto('http://127.0.0.1:5199/');
    await expect(peer.getByText(target.name, { exact: true }).first()).toBeVisible();
    expect((await sync(peer, { pullOnly: true })).success).toBe(true);
    await openList(peer, source);
    await expect(row(peer, online)).toHaveCount(0);
    await expect(row(peer, offline)).toHaveCount(0);
    await openList(peer, target);
    await expect(row(peer, online)).toBeVisible();
    await expect(row(peer, offline)).toBeVisible();
    const listing = await peer.evaluate(async id => {
      const { default: api } = await import('/src/services/api.js');
      return (await api.get('/decks/' + id + '/cards')).data;
    }, target.id);
    expect(listing.map(({ id, content_v2 }) => ({ id, content_v2 }))).toEqual(
      [online, offline].map(({ id, content_v2 }) => ({ id, content_v2 })));

    await openList(page, source);
    await setOffline(true);
    await move(refused, denied);
    await expect(row(page, refused)).toHaveCount(0);
    const revoked = await other.request.put(fixture.origin + '/api/collaborative/deck/' + denied.id + '/role', {
      headers: { authorization: 'Bearer ' + fixture.owner_token },
      data: { user_id_to_update: 1, role: 'viewer' },
    });
    expect(revoked.ok()).toBe(true);
    await setOffline(false);
    expect((await sync(page)).success).toBe(false);
    await expect.poll(async () => (await inspect(refused.id)).card.offline_move?.httpStatus).toBe(403);
    expect(attempts.at(-1).status).toBe(403);
    const refusedLocal = await inspect(refused.id);
    expect(refusedLocal.operation.rejected).toBe(true);
    expect(refusedLocal.card).toMatchObject({ deck_id: denied.id, content_v2: refused.content_v2 });
    await openList(page, denied);
    await expect(row(page, refused).getByRole('status')).toHaveText('Сервер отклонил перенос. Перенос сохранён на устройстве.');
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('rejected-move-375.png') });

    await openList(page, source);
    await setOffline(true);
    await move(stale, target);
    await expect(row(page, stale)).toHaveCount(0);
    await peer.evaluate(async card => {
      const { networkApi } = await import('/src/services/api.js');
      await networkApi.patch('/cards/' + card.id, {
        request_id: crypto.randomUUID(), revision: card.revision, content_v2: card.content_v2,
      });
    }, stale);
    await setOffline(false);
    expect((await sync(page)).success).toBe(false);
    const staleLocal = await inspect(stale.id);
    expect(staleLocal.operation.rejected).toBe(true);
    expect(staleLocal.card).toMatchObject({ deck_id: target.id, content_v2: stale.content_v2, offline_move: { httpStatus: 409 } });
    const attemptCount = attempts.length;
    await page.reload();
    await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
    expect((await sync(page, { pullOnly: true })).success).toBe(true);
    await openList(page, target);
    await expect(row(page, stale).getByRole('status')).toHaveText('Конфликт версий. Перенос сохранён на устройстве.');
    expect(await inspect(stale.id)).toEqual(staleLocal);
    expect(await inspect(refused.id)).toEqual(refusedLocal);
    expect(attempts).toHaveLength(attemptCount);
  } finally {
    await other.close();
  }
});

test('deletes and restores V2 through Chromium restarts without losing local edits', async ({ browser }, testInfo) => {
  test.skip(!fixture?.lifecycle, 'Card lifecycle fixture only');
  test.setTimeout(150000);
  const [card, conflict] = fixture.lifecycle;
  const promptOf = value => value.content_v2.card.data.prompt;
  const attempts = [];
  let phase = 'ready';
  let device, page;
  const peerDevice = await browser.newContext({ serviceWorkers: 'block' });
  const peer = await peerDevice.newPage();
  const origin = 'http://127.0.0.1:5199/';
  const row = (tab, id) => tab.locator('#card-item-' + id);
  const trashItem = (tab, value) => tab.locator('.trash-card').filter({ hasText: promptOf(value) });
  const openTrash = async tab => {
    await tab.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('trash'));
    await tab.getByRole('button', { name: /^Карточки/ }).click();
  };
  const inspect = (tab, id) => tab.evaluate(async id => {
    const { prepareLocalDb, CARD_LIFECYCLE_KEY, CARD_EDIT_KEY } = await import('/src/services/localDb.js');
    const db = await prepareLocalDb();
    return db.transaction('r', db.cards, db.syncState, async () => ({
      card: await db.cards.get(id), lifecycle: await db.syncState.get(CARD_LIFECYCLE_KEY + id),
      edit: await db.syncState.get(CARD_EDIT_KEY + id),
    }));
  }, id);
  const setPhase = async value => {
    phase = value;
    await page.evaluate(offline => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: !offline });
    }, value === 'offline');
  };
  const sync = (tab, options = { pendingNativeOnly: true, skipPull: true }) => tab.evaluate(async options => {
    const { syncService } = await import('/src/services/syncService.js');
    let result;
    for (let attempt = 0; attempt < 20; attempt++) {
      result = await syncService.sync(options);
      if (result.reason !== 'Already syncing') return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return result;
  }, options);
  const open = async tab => {
    await tab.goto(origin);
    await expect(tab.getByText(deck.name, { exact: true }).first()).toBeVisible();
    await openList(tab);
  };
  const launch = async () => {
    device = await browser.browserType().launchPersistentContext(testInfo.outputPath('lifecycle-device'), {
      viewport: { width: 375, height: 844 }, serviceWorkers: 'block',
    });
    await setupDevice(device, () => phase, (payload, status, receipt) => attempts.push({ payload, status, receipt }));
    page = device.pages()[0];
    await open(page);
  };
  const remove = async (tab, id) => {
    await row(tab, id).getByRole('button', { name: 'Действия с карточкой' }).click();
    await tab.getByRole('dialog', { name: 'Управление карточкой' })
      .getByRole('button', { name: /Удалить карточку/ }).click();
  };
  const peerRequest = (path, options = {}, token = fixture.access_token) => peerDevice.request.fetch(
    fixture.origin + '/api/' + path, { ...options, headers: { authorization: 'Bearer ' + token } });

  try {
    await setupDevice(peerDevice, () => 'ready', () => {});
    await launch();
    await open(peer);
    await setPhase('offline');
    await remove(page, card.id);
    await expect(row(page, card.id)).toHaveCount(0);
    await openTrash(page);
    await expect(trashItem(page, card).getByRole('status')).toHaveText('Ожидает синхронизации');
    await expect(trashItem(page, card).getByRole('button', { name: 'Восстановить' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Очистить корзину' })).toBeDisabled();
    const deletion = await inspect(page, card.id);
    expect(deletion.card).toMatchObject({ is_deleted: true, content_v2: card.content_v2 });
    expect(deletion.lifecycle.payload.revisions).toEqual({ [card.id]: card.revision });
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(trashItem(page, card)).toBeVisible();
      await expect.poll(() => page.locator('#app-container').evaluate(app => app.scrollWidth <= app.clientWidth))
        .toBe(true);
      const button = await trashItem(page, card).getByRole('button', { name: 'Восстановить' }).boundingBox();
      expect(button.x + button.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath('pending-delete-1280.png') });
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('pending-delete-375.png') });

    await setPhase('ready');
    await openList(page);
    await expect(row(page, card.id)).toHaveCount(0); // An online list still contains the server's active row.
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    expect(await inspect(page, card.id)).toEqual(deletion);
    expect(attempts.at(-1)).toMatchObject({ status: 200, receipt: { card: { is_deleted: true } } });
    const tombstone = attempts.at(-1).receipt.card;
    expect((await sync(peer, { pullOnly: true })).success).toBe(true);
    expect((await inspect(peer, card.id)).card).toMatchObject({ is_deleted: true, revision: tombstone.revision });
    await openTrash(peer);
    await expect(trashItem(peer, card).getByRole('button', { name: 'Восстановить' })).toBeEnabled();

    const restorePath = `trash/card/${card.id}/restore`;
    expect((await peerRequest(restorePath, { method: 'POST' })).status()).toBe(422);
    const staleRestore = { method: 'POST', data: { request_id: crypto.randomUUID(), revision: card.revision } };
    const rejected = await peerRequest(restorePath, staleRestore);
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).detail.card.revision).toBe(tombstone.revision);
    expect((await peerRequest(restorePath, { method: 'POST', data: {
      request_id: crypto.randomUUID(), revision: tombstone.revision,
    } }, fixture.editor_token)).status()).toBe(404);

    await device.close();
    phase = 'offline';
    await launch();
    expect(await inspect(page, card.id)).toEqual(deletion);
    await setPhase('ready');
    expect((await sync(page)).success).toBe(true);
    expect(attempts[1]).toEqual(attempts[0]);
    await openTrash(page);
    await setPhase('offline');
    await trashItem(page, card).getByRole('button', { name: 'Восстановить' }).click();
    await expect(trashItem(page, card)).toHaveCount(0);
    const restoration = await inspect(page, card.id);
    expect(restoration.lifecycle.payload.revision).toBe(tombstone.revision);
    await openList(page);
    await expect(row(page, card.id).getByRole('status')).toHaveText('Ожидает синхронизации');
    await setPhase('lose-response');
    expect((await sync(page)).success).toBe(false);
    expect(await inspect(page, card.id)).toEqual(restoration);
    expect(attempts.at(-1)).toMatchObject({ status: 200, receipt: { card: { is_deleted: false } } });
    await device.close();
    phase = 'ready';
    await launch();
    await expect.poll(async () => (await inspect(page, card.id)).lifecycle).toBeUndefined();
    expect(attempts[3]).toEqual(attempts[2]);
    expect((await sync(peer, { pullOnly: true })).success).toBe(true);
    expect((await inspect(peer, card.id)).card.is_deleted).toBe(false);
    await openList(peer);
    await expect(row(peer, card.id)).toBeVisible();
    expect((await inspect(peer, card.id)).card).toMatchObject({
      revision: attempts[2].receipt.card.revision, content_v2: card.content_v2 });

    await setPhase('offline');
    await remove(page, conflict.id);
    await expect(row(page, conflict.id)).toHaveCount(0);
    const peerEdit = structuredClone(conflict.content_v2);
    peerEdit.card.data.prompt = 'Server version before deletion';
    const updated = await peerRequest(`cards/${conflict.id}`, { method: 'PATCH',
      data: { content_v2: peerEdit, revision: conflict.revision, request_id: crypto.randomUUID() } });
    expect(updated.ok()).toBe(true);
    const current = await updated.json();
    await setPhase('ready');
    expect((await sync(page)).success).toBe(false);
    await openList(page);
    await expect(row(page, conflict.id)).toContainText(peerEdit.card.data.prompt);
    expect(await inspect(page, conflict.id)).toMatchObject({
      card: { content_v2: peerEdit, revision: current.revision }, lifecycle: undefined,
    });

    await setPhase('offline');
    const localDraft = structuredClone(peerEdit);
    localDraft.card.data.prompt = 'Local draft survives deletion on the second device';
    const editPayload = { content_v2: localDraft, revision: current.revision, request_id: crypto.randomUUID() };
    await page.evaluate(async ({ id, editPayload }) => {
      const { default: api } = await import('/src/services/api.js');
      await api.patch('/cards/' + id, editPayload, { offlineCardEdit: true });
    }, { id: conflict.id, editPayload });
    await openList(page);
    await remove(page, conflict.id);
    await expect(page.getByText('Сначала синхронизируйте правку карточки.', { exact: true })).toBeVisible();
    expect((await inspect(page, conflict.id)).edit.payload).toEqual(editPayload);
    await openList(peer);
    await remove(peer, conflict.id);
    await expect(row(peer, conflict.id)).toHaveCount(0);

    await setPhase('ready');
    await sync(page);
    await openTrash(page);
    const draftTrash = trashItem(page, current);
    await expect(draftTrash.getByText('Локальный черновик сохранён.')).toBeVisible();
    const draft = await inspect(page, conflict.id);
    expect(draft.card).toMatchObject({ content_v2: localDraft, is_deleted: true, offline_edit: {
      status: 'conflict', server: { content_v2: peerEdit, is_deleted: true },
    } });
    expect(draft.edit.payload).toEqual(editPayload);
    // A rejection persisted before this release can lack the tombstone. An
    // active-card GET returns 404, so the same sync cycle must continue to pull.
    await page.evaluate(async id => {
      const { prepareLocalDb } = await import('/src/services/localDb.js');
      const db = await prepareLocalDb();
      await db.cards.update(id, { is_deleted: false, 'offline_edit.server': undefined });
    }, conflict.id);
    expect((await sync(page, {})).success).toBe(true);
    expect((await inspect(page, conflict.id)).card).toMatchObject({ is_deleted: true, content_v2: localDraft,
      offline_edit: { server: { is_deleted: true } } });
    await draftTrash.getByRole('button', { name: 'Восстановить' }).click();
    await expect(draftTrash).toHaveCount(0);
    await expect.poll(async () => (await inspect(page, conflict.id)).lifecycle).toBeUndefined();
    const recovered = await inspect(page, conflict.id);
    expect(recovered.card).toMatchObject({ content_v2: localDraft, is_deleted: false, offline_edit: {
      status: 'conflict', server: { content_v2: peerEdit, is_deleted: false },
    } });
    expect(recovered.edit.payload).toEqual(editPayload);
    await openList(page);
    await row(page, conflict.id).getByRole('button', { name: 'Открыть локальную правку' }).click();
    await page.getByRole('button', { name: 'Сохранить мою версию' }).click();
    await expect.poll(async () => (await inspect(page, conflict.id)).edit).toBeUndefined();
    expect((await (await peerRequest(`cards/${conflict.id}`)).json()).content_v2).toEqual(localDraft);
  } finally {
    await device?.close();
    await peerDevice.close();
  }
});
