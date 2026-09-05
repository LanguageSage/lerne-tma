const { test, expect } = require('@playwright/test');

async function harness(page, context) {
  const assets = new Map();
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (new URL(url).pathname === '/offline-harness') {
      return route.fulfill({ contentType: 'text/html', body: '<html><body>Offline test</body></html>' });
    }
    if (new URL(url).pathname.startsWith('/api')) return route.abort();
    if (assets.has(url)) return route.fulfill(assets.get(url));
    const response = await route.fetch();
    const saved = { status: response.status(), headers: response.headers(), body: await response.body() };
    assets.set(url, saved);
    return route.fulfill(saved);
  });
  await context.addInitScript(() => {
    localStorage.setItem('offline_mode', 'true');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
  });
  await page.goto('/offline-harness');
  await loadModules(page);
}

async function loadModules(page) {
  await page.evaluate(async () => {
    window.api = (await import('/src/services/api.js')).default;
    window.network = (await import('/src/services/api.js')).networkApi;
    window.sync = (await import('/src/services/syncService.js')).syncService;
    window.getDb = (await import('/src/services/localDb.js')).getLocalDb;
    window.snapshot = { status: 'success', folders: [], decks: [], cards: [], progress: [], server_time: new Date().toISOString() };
  });
}

test('offline CRUD, due scheduling, restart and persistent progress', async ({ page, context }) => {
  await harness(page, context);
  await context.setOffline(true);
  const ids = await page.evaluate(async () => {
    const folder = (await api.post('/folders', { name: 'Parent', target_language: 'de' })).data;
    const child = (await api.post('/folders', { name: 'Child', parent_id: folder.id })).data;
    const deck = (await api.post('/decks', { name: 'Offline', folder_id: child.id, target_language: 'de' })).data;
    const first = (await api.post('/cards/save', { deck_id: deck.id, front: 'Hallo', back: 'Hello', card_type: 'quiz', audio_back_path: 'back.mp3', flag: 3 })).data;
    const second = (await api.post('/cards/save', { deck_id: deck.id, front: 'Danke', back: 'Thanks' })).data;
    const next = (await api.get(`/decks/${deck.id}/next`)).data;
    if (next.id !== first.id) throw new Error('Unexpected initial card');
    const grade = (await api.post('/study/grade', { card_id: first.id, deck_id: deck.id, grade: 2 })).data;
    if (grade.id !== second.id) throw new Error('Reviewed card returned before due');
    const done = (await api.post('/study/grade', { card_id: second.id, deck_id: deck.id, grade: 2 })).data;
    if (!done.finished) throw new Error('Study never finishes');
    await api.post('/cards/save', { card_id: first.id, deck_id: deck.id, front: 'Edited' });
    return { folder: folder.id, child: child.id, deck: deck.id, first: first.id, second: second.id };
  });
  await page.reload();
  await loadModules(page);
  const saved = await page.evaluate(async ids => ({
    cards: (await api.get(`/decks/${ids.deck}/cards`)).data,
    progress: await getDb().progress.get([ids.first, 1]),
    next: (await api.get(`/decks/${ids.deck}/next`)).data,
  }), ids);
  expect(saved.cards[0]).toMatchObject({ front: 'Edited', back: 'Hello', card_type: 'quiz', audio_back_path: 'back.mp3', flag: 3 });
  expect(saved.progress).toMatchObject({ queue: 'review', repetitions: 1, is_dirty: 1 });
  expect(saved.next.finished).toBe(true);
  await page.evaluate(async ids => {
    await api.delete(`/folders/${ids.child}`);
    const deck = await getDb().decks.get(ids.deck);
    if (deck.folder_id !== ids.folder) throw new Error('Folder deletion lost deck hierarchy');
    await api.delete(`/cards/${ids.first}`);
    await api.post(`/trash/card/${ids.first}/restore`);
    await api.post(`/decks/${ids.deck}/reset`);
  }, ids);
  expect(await page.evaluate(async ids => (await api.get(`/decks/${ids.deck}/next`)).data.finished, ids)).not.toBe(true);
});

test('lost response retries identical durable batch after restart', async ({ page, context }) => {
  await harness(page, context);
  const pending = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Retry' })).data;
    await api.post('/cards/save', { deck_id: deck.id, front: 'x', back: 'y' });
    network.defaults.adapter = async () => { throw new Error('Connection lost after server commit'); };
    const result = await sync.sync();
    return { result, batch: await getDb().syncState.get('pending') };
  });
  expect(pending.result.success).toBe(false);
  await page.reload();
  await loadModules(page);
  const retried = await page.evaluate(async () => {
    let sent;
    network.defaults.adapter = async config => {
      if (config.method === 'post') {
        sent = JSON.parse(config.data);
        return { data: { status: 'error' }, status: 200, headers: {}, config };
      }
      throw new Error('Must not pull after failed push');
    };
    const result = await sync.sync();
    return { result, sent, dirty: await getDb().cards.where('is_dirty').equals(1).count() };
  });
  expect(retried.result.success).toBe(false);
  expect(retried.sent.request_id).toBe(pending.batch.request_id);
  expect(retried.dirty).toBe(1);
});

test('edits during push survive acknowledgement and stale pull', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    await getDb().decks.put({ id: 10, name: 'Deck', user_id: 1 });
    await getDb().cards.put({ id: 20, deck_id: 10, front_text: 'Original', back_text: 'Back' });
    await api.post('/cards/save', { card_id: 20, deck_id: 10, front: 'Sent' });
    let release;
    let started;
    const arrived = new Promise(resolve => { started = resolve; });
    network.defaults.adapter = async config => {
      if (config.method === 'post') {
        started();
        await new Promise(resolve => { release = resolve; });
        return { data: { status: 'success', mappings: { folders: {}, decks: {}, cards: {} } }, config };
      }
      return { data: { ...snapshot, decks: [{ id: 10, name: 'Deck', user_id: 1 }], cards: [{ id: 20, deck_id: 10, front_text: 'Sent', back_text: 'Back' }] }, config };
    };
    const syncing = sync.sync();
    await arrived;
    await api.post('/cards/save', { card_id: 20, deck_id: 10, front: 'Edited during request' });
    release();
    const result = await syncing;
    return { result, card: await getDb().cards.get(20) };
  });
  expect(state.result.success).toBe(true);
  expect(state.card).toMatchObject({ front_text: 'Edited during request', is_dirty: 1 });
});

test('ID remapping preserves nested references and progress', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    const parent = (await api.post('/folders', { name: 'Parent' })).data;
    const child = (await api.post('/folders', { name: 'Child', parent_id: parent.id })).data;
    const deck = (await api.post('/decks', { name: 'Deck', folder_id: child.id })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'x', back: 'y' })).data;
    await api.post('/study/grade', { card_id: card.id, deck_id: deck.id, grade: 0 });
    network.defaults.adapter = async config => {
      if (config.method === 'post') {
        return { config, data: { status: 'success', mappings: {
          folders: { [parent.id]: 10, [child.id]: 11 }, decks: { [deck.id]: 12 }, cards: { [card.id]: 13 },
        } } };
      }
      // Stop before pull, to inspect the acknowledged local transaction.
      throw new Error('Pull unavailable');
    };
    await sync.sync();
    return { folders: await getDb().folders.toArray(), decks: await getDb().decks.toArray(),
      cards: await getDb().cards.toArray(), progress: await getDb().progress.toArray(), pending: await getDb().syncState.get('pending') };
  });
  expect(state.folders.find(f => f.id === 11).parent_id).toBe(10);
  expect(state.decks[0]).toMatchObject({ id: 12, folder_id: 11 });
  expect(state.cards[0]).toMatchObject({ id: 13, deck_id: 12 });
  expect(state.progress[0]).toMatchObject({ card_id: 13, user_id: 1 });
  expect(state.pending).toBeUndefined();
});

test('accounts remain isolated and retain unsent data', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    await api.post('/decks', { name: 'Account one' });
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 2 }));
    const before = (await api.get('/decks')).data;
    await api.post('/decks', { name: 'Account two' });
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1 }));
    return { before, after: (await api.get('/decks')).data };
  });
  expect(state.before).toEqual([]);
  expect(state.after.map(d => d.name)).toEqual(['Account one']);
});

test('cached audio survives a new page without network', async ({ page, context }) => {
  await harness(page, context);
  await page.evaluate(async () => {
    await getDb().decks.put({ id: 1, name: 'Audio' });
    await getDb().cards.put({ id: 2, deck_id: 1, front_text: 'Audio', back_text: 'Back', audio_path: 'saved.wav' });
    const { mediaURL } = await import('/src/services/apiConfig.js');
    await getDb().media.put({ url: mediaURL('saved.wav', 'audio'), blob: new Blob(['RIFF'], { type: 'audio/wav' }) });
  });
  await context.setOffline(true);
  await page.reload();
  await loadModules(page);
  const audio = await page.evaluate(async () => {
    const card = (await api.get('/study/card/2')).data;
    return { url: card.audio_url, size: (await (await fetch(card.audio_url)).blob()).size };
  });
  expect(audio.url).toMatch(/^blob:/);
  expect(audio.size).toBe(4);
});

test('native platform enables local-first without a stored setting', async ({ page, context }) => {
  await harness(page, context);
  const local = await page.evaluate(async () => {
    localStorage.removeItem('offline_mode');
    const { Capacitor } = await import('/node_modules/.vite/deps/@capacitor_core.js');
    Capacitor.isNativePlatform = () => true;
    const { isOfflineMode } = await import('/src/services/localDb.js');
    return isOfflineMode();
  });
  expect(local).toBe(true);
});

test('two separate devices exchange real HTTP batches and progress', async ({ page, context, browser, request }) => {
  const health = await request.get('http://127.0.0.1:8199/api/health').catch(() => null);
  test.skip(!health?.ok(), 'Start offline_sandbox.py for HTTP integration');
  await harness(page, context);
  const connect = async target => target.route('**/api/sync/v2/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:8199${url.pathname}${url.search}` });
    return route.fulfill({ response });
  });
  await connect(page);
  const first = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: `HTTP test ${crypto.randomUUID()}`, target_language: 'de' })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'Device one', back: 'Back' })).data;
    await api.post('/study/grade', { card_id: card.id, deck_id: deck.id, grade: 2 });
    const result = await sync.sync();
    const saved = (await getDb().cards.toArray()).find(c => c.front_text === 'Device one');
    return { result, saved };
  });
  expect(first.result.success).toBe(true);
  expect(first.saved.id).toBeGreaterThan(0);
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5199' });
  try {
    const second = await secondContext.newPage();
    await harness(second, secondContext);
    await connect(second);
    const received = await second.evaluate(async id => {
      const result = await sync.sync();
      const card = await getDb().cards.get(id);
      const progress = await getDb().progress.get([id, 1]);
      await api.post('/cards/save', { card_id: id, deck_id: card.deck_id, front: 'Device two edit' });
      const pushed = await sync.sync();
      return { result, progress, pushed };
    }, first.saved.id);
    expect(received.result.success).toBe(true);
    expect(received.pushed.success).toBe(true);
    expect(received.progress).toMatchObject({ queue: 'review', repetitions: 1 });
    const returned = await page.evaluate(async id => {
      await sync.sync();
      const card = await getDb().cards.get(id);
      await api.delete(`/decks/${card.deck_id}`);
      await sync.sync();
      return card;
    }, first.saved.id);
    expect(returned.front_text).toBe('Device two edit');
  } finally {
    await secondContext.close();
  }
});
