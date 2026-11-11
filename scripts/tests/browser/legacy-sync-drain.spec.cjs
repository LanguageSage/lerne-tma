const { test: base, expect } = require('./isolated-fixture.cjs');
const { chromium } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const test = base.extend({
  durableDevice: async ({}, use, testInfo) => {
    let context;
    const restart = async () => {
      if (context) { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
      context = await chromium.launchPersistentContext(testInfo.outputPath('v1-device-profile'), {
        headless: true, serviceWorkers: 'block', baseURL: 'http://127.0.0.1:5199',
      });
      return context;
    };
    await restart();
    try { await use({ get context() { return context; }, restart }); }
    finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  },
});
const fixture = JSON.parse(process.env.LERNE_LEGACY_DRAIN_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --legacy-drain-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Expected disposable loopback HTTP');

async function device(page, context, control) {
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ token }) => {
    if (!localStorage.getItem('lerne_auth_v2_session')) {
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Synthetic learner', is_guest: false }));
    }
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('offline_mode', 'true');
  }, { token: fixture.tokens['1'] });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5199') return route.abort('blockedbyclient');
    if (url.pathname === '/legacy-harness') return route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (process.env.LERNE_DRAIN_BASELINE_REF && url.pathname === '/src/services/syncService.js') {
      return route.fulfill({ contentType: 'text/javascript', body: execFileSync('git', ['show', process.env.LERNE_DRAIN_BASELINE_REF + ':app/src/services/syncService.js']) });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const fetchServer = () => route.fetch({ url: fixture.origin + url.pathname + url.search, maxRetries: 0 });
    if (control && await control({ route, url, fetchServer })) return;
    if (/^\/api\/(sync\/v2\/|cards\/|study\/|card-notes\/|knowledge\/|decks\/\d+\/toggle-learning)/.test(url.pathname)) {
      return route.fulfill({ response: await fetchServer() });
    }
    return route.fulfill({ json: {} });
  });
  await open(page);
}

async function open(page) {
  await page.goto('/legacy-harness');
  await page.evaluate(async deck => {
    window.sync = (await import('/src/services/syncService.js')).syncService;
    window.offline = (await import('/src/services/offlineApi.js')).offlineApi;
    window.network = (await import('/src/services/networkApi.js')).networkApi;
    window.preflight = await import('/src/services/cardCutoverPreflight.js');
    window.local = await import('/src/services/localDb.js');
    window.db = await window.local.prepareLocalDb();
    await window.db.decks.put({ ...deck, is_dirty: 0 });
  }, fixture.deck);
}

test('V2 confirmation is separate from old queues; immutable replay survives offline, lost response and restart', async ({ browser, durableDevice }) => {
  test.setTimeout(90000);
  let context = durableDevice.context;
  let page = context.pages()[0] || await context.newPage();
  let lose = false;
  const attempts = [];
  const control = async ({ route, url, fetchServer }) => {
    if (url.pathname !== '/api/sync/v2/push-legacy') return false;
    attempts.push(route.request().postDataJSON());
    const response = await fetchServer();
    if (lose) await route.abort('connectionreset'); else await route.fulfill({ response });
    return true;
  };
  await device(page, context, control);
  const original = await page.evaluate(async ({ deck, sample }) => {
    const card = { id: -40, deck_id: -30, front_text: 'legacy immutable creation', back_text: 'Original', card_type: 'standard', is_dirty: 1, local_revision: 'old-create' };
    const progress = { card_id: -40, user_id: 1, queue: 'review', interval: 12, ease_factor: 2.5,
      repetitions: 4, lapses: 0, is_dirty: 1, local_revision: 'old-progress' };
    const review = { key: 'review:old-without-action', card_id: -40, rating: 3, review_time: '2026-01-01T01:00:00Z', scheduled_interval: 12 };
    const batch = { key: 'pending', userId: '1', request_id: sample.batch_id,
      folders: [{ id: -20, user_id: 1, name: 'Legacy nested folder', is_dirty: 1 }],
      decks: [{ id: -30, user_id: 1, name: 'Legacy nested deck', folder_id: -20, role: 'owner', is_dirty: 1 }],
      cards: [card], progress: [progress], reviews: [review] };
    await db.folders.bulkPut(batch.folders);
    await db.decks.bulkPut(batch.decks);
    await db.cards.put(card); await db.progress.put(progress);
    await db.syncState.bulkPut([batch, review]);
    await db.card_notes.put({ id: sample.note_id, user_id: 1, card_id: -40, text: 'Original pending note', is_deleted: false, is_dirty: 1, local_revision: 'note-rev' });
    // A failed adjacent outbox must never be mistaken for a completed sync.
    await db.knowledge_attempt_outbox.put({ client_event_id: 'retained-failed-attempt', user_id: 1, card_id: -40, sync_status: 'failed' });
    // A child created after the immutable packet must also have its deck remapped.
    await db.cards.put({ id: -41, deck_id: -30, front_text: 'Later unsent creation', back_text: 'Later', is_dirty: 1 });
    await offline.handle('post', '/cards/save', { request_id: sample.action_id, deck_id: deck.id,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Native confirmation', answer: 'V2' } } } });
    const result = await sync.sync({ pendingNativeOnly: true, skipPull: true });
    return { batch, result };
  }, { deck: fixture.deck, sample: fixture.cases.replay });
  expect(original.result.success, JSON.stringify(original.result)).toBe(false);
  expect(original.result.native_success, JSON.stringify(original.result)).toBe(true);
  expect(original.result.pending.blockers['syncState:pending_batch']).toBe(1);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  expect((await page.evaluate(() => sync.sync())).success).toBe(false);
  expect(attempts).toHaveLength(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }));
  lose = true;
  expect((await page.evaluate(() => sync.sync())).success).toBe(false);
  expect(await page.evaluate(() => db.syncState.get('pending'))).toEqual(original.batch);
  context = await durableDevice.restart(); // Actual Chromium process restart, same on-disk IndexedDB.
  page = context.pages()[0] || await context.newPage();
  await device(page, context, control);
  expect(await page.evaluate(() => db.syncState.get('pending'))).toEqual(original.batch);
  lose = false;
  const delivered = await page.evaluate(() => sync.sync());
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1].reviews[0]).not.toHaveProperty('action_id');
  expect(delivered.success).toBe(false);
  expect(delivered.native_success).toBe(true);
  const retained = await page.evaluate(async sample => ({
    pending: await db.syncState.get('pending'), aliases: (await db.syncState.get('aliases')).mappings,
    note: await db.card_notes.get(sample.note_id), attempt: await db.knowledge_attempt_outbox.get('retained-failed-attempt'),
    child: await db.cards.get(-41), check: await preflight.inspectCutoverDatabase(db),
  }), fixture.cases.replay);
  expect(retained.pending).toBeUndefined();
  expect(retained.note.card_id).toBe(retained.aliases.cards['-40']);
  expect(retained.note.is_dirty).toBe(0);
  expect(retained.attempt.card_id).toBe(retained.aliases.cards['-40']);
  expect(retained.attempt.sync_status).toBe('failed');
  expect(retained.child.deck_id).toBe(retained.aliases.decks['-30']);
  expect(retained.child.is_dirty).toBe(1);
  expect(retained.check.pending_free).toBe(false);
  // A second device receives both native and legacy scopes without mixing them.
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await device(peer, peerContext);
  await peer.evaluate(async () => {
    const response = await network.get('/sync/v2/pull', { params: { card_schema: 1 } });
    await db.cards.bulkPut(response.data.cards.map(card => ({ ...card, is_dirty: 0 })));
  });
  expect(await peer.evaluate(() => db.cards.filter(card => card.front_text === 'legacy immutable creation').count())).toBe(1);
  const drained = await peer.evaluate(() => sync.sync());
  expect(drained.success).toBe(true);
  expect((await peer.evaluate(() => preflight.inspectCutoverDatabase(db))).pending_free).toBe(true);
  const rejected = await page.evaluate(async () => {
    const native = await db.cards.filter(card => !!card.content_v2).first();
    const current = (await network.get('/cards/' + native.id)).data;
    current.content_v2.card.data.prompt = 'Concurrent native revision';
    await network.patch('/cards/' + native.id, { request_id: crypto.randomUUID(), revision: current.revision, content_v2: current.content_v2 });
    const payload = { request_id: crypto.randomUUID(), card_ids: [native.id], revisions: { [native.id]: native.revision } };
    await offline.handle('post', '/cards/batch-delete', payload);
    const result = await sync.sync({ pendingNativeOnly: true, skipPull: true });
    return { result, id: native.id, payload, operation: await db.syncState.get('card-lifecycle-v2:' + native.id) };
  });
  expect(rejected.result.native_success).toBe(false);
  expect(rejected.operation.rejected).toBe(true);
  expect(rejected.operation.payload).toEqual(rejected.payload);
  await open(page);
  expect(await page.evaluate(id => db.cards.get(id).then(card => card.offline_lifecycle), rejected.id)).toBe('delete');
  expect((await page.evaluate(() => preflight.inspectCardCutover())).pending_free).toBe(false);
  await peerContext.close();
});

test('V1 edit and UUID grade use a saved base; concurrent peer edit blocks without losing the draft and UI reports partial status', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(90000);
  await device(page, context);
  await page.evaluate(async sample => {
    const response = await network.get('/sync/v2/pull', { params: { card_schema: 1 } });
    await db.cards.bulkPut(response.data.cards.map(card => ({ ...card, is_dirty: 0 })));
    await db.progress.bulkPut(response.data.progress.map(item => ({ ...item, user_id: 1, is_dirty: 0 })));
    await offline.handle('post', '/cards/save', { card_id: sample.id, deck_id: (await db.cards.get(sample.id)).deck_id, front: 'Safe first V1 edit' });
    await offline.handle('post', '/study/grade', { card_id: sample.id, grade: 3, action_id: sample.action_id, return_next: false });
  }, fixture.cases.conflict);
  const safe = await page.evaluate(() => sync.sync());
  expect(safe.success, JSON.stringify(safe)).toBe(true);
  expect(await page.evaluate(id => db.cards.get(id).then(card => card.front_text), fixture.cases.conflict.id)).toBe('Safe first V1 edit');
  await page.evaluate(async id => {
    await offline.handle('post', '/cards/save', { card_id: id, deck_id: (await db.cards.get(id)).deck_id, front: 'Offline draft must survive' });
  }, fixture.cases.conflict.id);
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  await device(peer, peerContext);
  await peer.evaluate(async id => {
    const response = await network.get('/sync/v2/pull', { params: { card_schema: 1 } });
    await db.cards.bulkPut(response.data.cards.map(card => ({ ...card, is_dirty: 0 })));
    await offline.handle('post', '/cards/save', { card_id: id, deck_id: (await db.cards.get(id)).deck_id, front: 'Peer edit survives' });
  }, fixture.cases.conflict.id);
  expect((await peer.evaluate(() => sync.sync())).success).toBe(true);
  const newerSrs = await peer.evaluate(async id => {
    await offline.handle('post', `/cards/${id}/flag`, { flag: 3 });
    // A newer remote grade must survive delivery of the explicit V1 label.
    await network.post('/study/grade', { card_id: id, deck_id: (await db.cards.get(id)).deck_id,
      grade: 0, action_id: crypto.randomUUID(), return_next: false });
    return (await network.get('/sync/v2/pull', { params: { card_schema: 1 } })).data.progress.find(item => item.card_id === id);
  }, fixture.cases.conflict.id);
  expect(newerSrs.lapses).toBeGreaterThan(0);
  expect((await peer.evaluate(() => sync.sync())).success).toBe(true);
  const labeled = await peer.evaluate(async id => (await network.get('/sync/v2/pull', { params: { card_schema: 1 } })).data.progress.find(item => item.card_id === id), fixture.cases.conflict.id);
  expect(labeled.flag).toBe(3);
  const srs = row => Object.fromEntries(['queue', 'interval', 'ease_factor', 'repetitions', 'lapses', 'step_index', 'next_review', 'last_reviewed'].map(key => [key, row[key]]));
  expect(srs(labeled)).toEqual(srs(newerSrs));
  const conflict = await page.evaluate(() => sync.sync());
  expect(conflict.success).toBe(false);
  expect(conflict.native_success).toBe(true);
  expect(conflict.error_code).toBe('legacy_revision_conflict');
  const queued = await page.evaluate(() => db.syncState.get('pending'));
  await open(page);
  expect(await page.evaluate(() => db.syncState.get('pending'))).toEqual(queued);
  expect(await page.evaluate(id => db.cards.get(id).then(card => card.front_text), fixture.cases.conflict.id)).toBe('Offline draft must survive');
  expect((await page.evaluate(() => preflight.inspectCardCutover())).pending_free).toBe(false);
  // Mount the real existing ProfileTab; no app startup or background sync.
  await page.evaluate(async () => {
    localStorage.removeItem('offline_mode'); // Profile sync must also be reachable in online web mode.
    await import('/src/index.css'); await import('/src/App.css');
    const reactModule = await import('/node_modules/.vite/deps/react.js');
    const React = reactModule.default || reactModule;
    const domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = domModule.default || domModule;
    const { ProfileTab } = await import('/src/components/settings/ProfileTab.jsx');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useUiStore.setState({ userProfile: { user_id: 1, first_name: 'Synthetic learner', is_guest: false } });
    createRoot(document.getElementById('root')).render(React.createElement(ProfileTab, { userId: 1 }));
  });
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Синхронизировать сейчас' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Общая синхронизация не завершена' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Старая правка конфликтует' })).toBeVisible();
    const section = page.locator('.link-telegram-section').filter({ has: page.getByRole('button', { name: 'Синхронизировать сейчас' }) });
    await section.screenshot({ path: testInfo.outputPath(`partial-sync-${width}.png`) });
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole('button', { name: 'Synchronize now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Overall synchronization is incomplete' })).toBeVisible();
  await page.locator('.link-telegram-section').filter({ has: page.getByRole('button', { name: 'Synchronize now' }) })
    .screenshot({ path: testInfo.outputPath('partial-sync-en-375.png') });
  await peerContext.close();
});

test('later local edits and grades survive an in-flight ACK and rebase only across their own commit', async ({ page, context }) => {
  test.setTimeout(90000);
  let release, entered;
  let first = true;
  const committed = new Promise(resolve => { entered = resolve; });
  await device(page, context, async ({ route, url, fetchServer }) => {
    if (url.pathname !== '/api/sync/v2/push-legacy' || !first) return false;
    first = false;
    const response = await fetchServer(); entered();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response }); return true;
  });
  await page.evaluate(async sample => {
    const response = await network.get('/sync/v2/pull', { params: { card_schema: 1 } });
    await db.cards.bulkPut(response.data.cards.map(card => ({ ...card, is_dirty: 0 })));
    await db.progress.bulkPut(response.data.progress.map(item => ({ ...item, user_id: 1, is_dirty: 0 })));
    await offline.handle('post', '/cards/save', { card_id: sample.id, deck_id: (await db.cards.get(sample.id)).deck_id, front: 'First local edit' });
    await offline.handle('post', '/study/grade', { card_id: sample.id, grade: 3, action_id: sample.action_id, return_next: false });
  }, fixture.cases.followup);
  const syncing = page.evaluate(() => sync.sync());
  await committed;
  const successor = await page.evaluate(async id => {
    const action = crypto.randomUUID();
    await offline.handle('post', '/cards/save', { card_id: id, deck_id: (await db.cards.get(id)).deck_id, front: 'Later edit retained' });
    await offline.handle('post', '/study/grade', { card_id: id, grade: 3, action_id: action, return_next: false });
    return action;
  }, fixture.cases.followup.id);
  release();
  expect((await syncing).success).toBe(false);
  expect(await page.evaluate(id => db.cards.get(id).then(card => card.front_text), fixture.cases.followup.id)).toBe('Later edit retained');
  expect(await page.evaluate(action => db.syncState.get('review:' + action), successor)).toBeTruthy();
  expect((await page.evaluate(() => sync.sync())).success).toBe(true);
  expect((await page.evaluate(() => preflight.inspectCardCutover())).pending_free).toBe(true);
  const reviews = await page.evaluate(async id => {
    const response = await network.get('/sync/v2/pull', { params: { card_schema: 1 } });
    return response.data.progress.find(item => item.card_id === id).repetitions;
  }, fixture.cases.followup.id);
  expect(reviews).toBe(4);
});

test('missing bases, unsupported servers and account changes retain immutable batches for retry', async ({ page, context }) => {
  test.setTimeout(90000);
  let phase = 'normal';
  let release;
  let entered;
  const committed = new Promise(resolve => { entered = resolve; });
  await device(page, context, async ({ route, url, fetchServer }) => {
    if (url.pathname !== '/api/sync/v2/push-legacy') return false;
    if (phase === 'old-server') { await route.fulfill({ status: 404, json: { detail: 'Not found' } }); return true; }
    if (phase === 'hold') {
      const response = await fetchServer(); entered();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ response }); return true;
    }
    return false;
  });
  await page.evaluate(async ({ sample, deck }) => {
    const card = { id: sample.id, deck_id: deck.id, front_text: 'Unknown old base', back_text: 'Original', is_dirty: 1 };
    await db.cards.put(card);
    await db.syncState.put({ key: 'pending', userId: 1, request_id: sample.batch_id,
      folders: [], decks: [], cards: [card], progress: [], reviews: [] });
  }, { sample: fixture.cases.isolation, deck: fixture.deck });
  const original = await page.evaluate(() => db.syncState.get('pending'));
  expect((await page.evaluate(() => sync.sync())).error_code).toBe('legacy_base_unknown');
  expect(await page.evaluate(() => db.syncState.get('pending'))).toEqual(original);
  phase = 'old-server';
  const unavailable = await page.evaluate(() => sync.sync());
  expect(unavailable.success).toBe(false);
  expect(unavailable.reason).toContain('Сервер ещё не обновлён');
  expect(await page.evaluate(() => db.syncState.get('pending'))).toEqual(original);
  // Use a separate new operation for account-switch testing. The rejected old
  // operation remains in its original account DB on a separate device/profile.
  const secondContext = await context.browser().newContext();
  const second = await secondContext.newPage();
  await device(second, secondContext, async ({ route, url, fetchServer }) => {
    if (url.pathname !== '/api/sync/v2/push-legacy') return false;
    const response = await fetchServer(); entered();
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ response }); return true;
  });
  await second.evaluate(async deck => {
    await db.cards.put({ id: -71, deck_id: deck.id, front_text: 'Switch account create', back_text: 'Original', is_dirty: 1 });
  }, fixture.deck);
  const syncing = second.evaluate(() => sync.sync());
  await committed;
  const packet = await second.evaluate(() => db.syncState.get('pending'));
  await second.evaluate(token => {
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 2, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 2, access_token: token }));
  }, fixture.tokens['2']);
  release();
  expect((await syncing).success).toBe(false);
  expect(await second.evaluate(() => db.syncState.get('pending'))).toEqual(packet);
  expect(await second.evaluate(async () => (await local.prepareLocalDb()).cards.count())).toBe(0);
  await secondContext.unroute('**/*');
  // Reinstall the normal isolated routing, then login to the original account.
  await second.evaluate(token => {
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
  }, fixture.tokens['1']);
  await device(second, secondContext);
  expect((await second.evaluate(() => sync.sync())).success).toBe(true);
  expect(await second.evaluate(() => db.syncState.get('pending'))).toBeUndefined();
  await secondContext.close();
});

test('an unresolved unscoped source cannot be re-imported and duplicated under a new UUID', async ({ page, context }) => {
  let posts = 0;
  await device(page, context, async ({ url }) => {
    if (url.pathname === '/api/sync/v2/push-legacy') posts++;
    return false;
  });
  const before = await page.evaluate(async ({ sample, deck }) => {
    const original = new db.constructor('LerneLocalDB');
    original.version(3).stores({ cards: 'id', syncState: 'key' });
    const card = { id: -92, deck_id: deck.id, front_text: 'Unscoped committed create', back_text: 'Original', is_dirty: 1 };
    const packet = { key: 'pending', userId: 1, request_id: sample.batch_id,
      cards: [card], folders: [], decks: [], progress: [], reviews: [] };
    await original.cards.put(card); await original.syncState.put(packet);
    // The old client committed, then lost its ACK before the current app ran.
    await network.post('/sync/v2/push-legacy', { request_id: packet.request_id, cards: packet.cards });
    const snapshot = { cards: await original.table('cards').toArray(), state: await original.table('syncState').toArray(), version: original.verno };
    original.close();
    return snapshot;
  }, { sample: fixture.cases.unscoped, deck: fixture.deck });
  const nativeOnly = await page.evaluate(() => sync.sync({ pendingNativeOnly: true, skipPull: true }));
  expect(nativeOnly.native_success).toBe(true);
  expect(nativeOnly.success).toBe(false); // An empty current DB cannot hide the old source.
  expect(nativeOnly.device_pending).toBe(true);
  // Emulate the historical importer: entities copied, original UUID omitted.
  await page.evaluate(card => db.cards.put(card), before.cards[0]);
  const result = await page.evaluate(() => sync.sync());
  expect(result.success).toBe(false);
  expect(result.device_pending).toBe(true);
  expect(result.reason).toContain('исходной очереди');
  expect(posts).toBe(1);
  expect(await page.evaluate(() => db.syncState.get('pending'))).toBeUndefined();
  await open(page);
  const after = await page.evaluate(async () => {
    const original = new db.constructor('LerneLocalDB'); await original.open();
    const snapshot = { cards: await original.table('cards').toArray(), state: await original.table('syncState').toArray(), version: original.verno };
    original.close(); return snapshot;
  });
  expect(after).toEqual(before);
  expect((await page.evaluate(() => preflight.inspectCardCutover())).pending_free).toBe(false);
  expect(await page.evaluate(async () => (await network.get('/sync/v2/pull', { params: { card_schema: 1 } })).data.cards
    .filter(card => card.front_text === 'Unscoped committed create').length)).toBe(1);
});
