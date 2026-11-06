const { test, expect } = require('./isolated-fixture.cjs');

const fixture = JSON.parse(process.env.LERNE_OFFLINE_CREATE_FIXTURE || 'null');
test.skip(!fixture, 'Run structured_cards_postgres.py with an offline browser scenario');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Expected a loopback HTTP fixture');

const prompt = 'Österreichische Grüße [[literal]]';
const answer = 'Синтетический ответ';
const deck = fixture && { id: fixture.deck_id, name: 'Offline Standard fixture',
  user_id: fixture.card ? 2 : 1, target_language: 'de', role: fixture.card ? 'editor' : 'owner', stats: { total: 0 } };
const profile = { user_id: 1, first_name: 'Test learner', is_guest: false };

async function setupDevice(context, getPhase, observeSave, owner = false) {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ token, profile, manualSync }) => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify(profile));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: profile.user_id, access_token: token }));
    if (sessionStorage.getItem('offline-fixture')) {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    }
    if (manualSync) {
      // Keep network transitions deterministic. Startup sync still runs on reload.
      window.addEventListener('online', event => event.stopImmediatePropagation(), true);
    }
  }, { token: owner ? fixture.owner_token : fixture.access_token, profile: { ...profile, user_id: owner ? 2 : 1 },
    manualSync: Boolean(fixture.card) && !owner });
  await context.route('**/api/**', async route => {
    const { pathname, search } = new URL(route.request().url());
    const phase = getPhase();
    if (phase === 'offline') return route.abort('internetdisconnected');
    const cardPath = '/api/cards/' + fixture.card?.id;
    const updating = pathname === cardPath && route.request().method() === 'PATCH';
    const fetchFromServer = () => route.fetch({
      url: fixture.origin + pathname + search, maxRetries: 0,
      ...(updating && phase === 'unauthorized' ? { headers: { ...route.request().headers(), authorization: 'Bearer invalid' } } : {}),
    });
    if (pathname === '/api/cards/save' || updating) {
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
    if (pathname === cardPath && phase === 'conflict-read-down') return route.abort('connectionreset');
    if (/^\/api\/(sync\/v2\/|cards\/\d+|decks\/\d+\/cards|collaborative\/deck\/\d+\/role)/.test(pathname)) {
      return route.fulfill({ response: await fetchFromServer() });
    }
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [],
      settings: {}, prompts: {}, user_settings: {}, user_info: profile } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { ...profile, user_id: owner ? 2 : 1 } });
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
  test.skip(Boolean(fixture?.card), 'Creation fixture only');
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

test('resolves Standard revisions across two devices and preserves the draft on auth errors', async ({ page, context, browser }, testInfo) => {
  test.skip(!fixture?.card, 'Editing fixture only');
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
    await expect(page.getByText('Карточка сохранена на устройстве', { exact: true })).toHaveCount(0);
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
