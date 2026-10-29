const { test, expect } = require('./isolated-fixture.cjs');

async function harness(page, context) {
  const assets = new Map();
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (new URL(url).origin !== 'http://127.0.0.1:5199') return route.abort('blockedbyclient');
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
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test_access_token', refresh_token: 'test_refresh_token' }));
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

test('offline viewer learning stays personal and never writes deck metadata', async ({ page, context }) => {
  await harness(page, context);
  const result = await page.evaluate(async () => {
    await getDb().decks.put({ id: 77, name: 'Published', role: 'viewer', is_global_readonly: true,
      target_language: 'de', metadata: { intro: 'Preserved' }, is_dirty: 0 });
    await api.post('/decks/77/toggle-learning', { is_learning: true });
    return getDb().decks.get(77);
  });
  expect(result).toMatchObject({ is_learning: true, learning_dirty: 1, is_dirty: 0, metadata: { intro: 'Preserved' } });
  await page.reload();
  await loadModules(page);
  expect(await page.evaluate(async () => (await api.get('/decks')).data[0].is_learning)).toBe(true);
  const other = await page.evaluate(async () => {
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 2, is_guest: false }));
    await getDb().decks.put({ id: 77, name: 'Published', role: 'viewer', metadata: { is_learning: true } });
    return (await api.get('/decks')).data[0];
  });
  expect(other.is_learning).toBe(false);
  expect(other.metadata).not.toHaveProperty('is_learning');
  expect(await page.evaluate(async () => {
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    return (await api.get('/decks')).data[0].is_learning;
  })).toBe(true);
});

test('offline save-only grade keeps its atomic progress and durable review event', async ({ page, context }) => {
  await harness(page, context);
  await context.setOffline(true);
  const saved = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Save only', target_language: 'de' })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'Hallo', back: 'Hello' })).data;
    const response = (await api.post('/study/grade', { card_id: card.id, deck_id: deck.id, grade: 2, return_next: false })).data;
    return { response, progress: await getDb().progress.get([card.id, 1]),
      reviews: (await getDb().syncState.toArray()).filter(item => item.key.startsWith('review:')) };
  });
  expect(saved.response).toEqual({ status: 'success' });
  expect(saved.progress.last_reviewed).toBeTruthy();
  expect(saved.reviews).toHaveLength(1);
  expect(saved.reviews[0].rating).toBe(2);
});

test('offline deck card reload remains account-isolated and usable for scheduled study', async ({ page, context }) => {
  await harness(page, context);
  await context.setOffline(true);
  const result = await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const deck = (await api.post('/decks', { name: 'Synthetic offline deck', target_language: 'de' })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'Synthetic front', back: 'Synthetic back' })).data;
    useDeckStore.getState().setCurrentDeck(deck);
    const first = await useDeckStore.getState().fetchDeckCards(deck.id);
    const next = (await api.get(`/decks/${deck.id}/next`)).data;
    await api.post('/cards/save', { ...card, front: 'Updated synthetic front' });
    const reload = await useDeckStore.getState().fetchDeckCards(deck.id);
    const selected = useDeckStore.getState().deckCards;
    const cached = useDeckStore.getState().cardsByDeck[deck.id];
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 2, is_guest: false }));
    useDeckStore.getState().resetDeckStore();
    await getDb().decks.put({ id: deck.id, name: 'Other synthetic deck', target_language: 'de' });
    await useDeckStore.getState().fetchDeckCards(deck.id);
    const other = useDeckStore.getState().cardsByDeck[deck.id];
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    useDeckStore.getState().resetDeckStore();
    useDeckStore.getState().setCurrentDeck(deck);
    await useDeckStore.getState().fetchDeckCards(deck.id);
    return { cardId: card.id, first, next, reload, selected, cached, other,
      restored: useDeckStore.getState().deckCards, loading: useDeckStore.getState().cardsLoading };
  });
  expect(result.first).toHaveLength(1);
  expect(result.first[0].id).toBe(result.cardId);
  expect(result.next.id).toBe(result.cardId);
  expect(result.reload[0].front).toBe('Updated synthetic front');
  expect(result.selected).toEqual(result.reload);
  expect(result.cached).toEqual(result.reload);
  expect(result.other).toEqual([]);
  expect(result.restored).toEqual(result.reload);
  expect(result.loading).toBe(false);
});

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
  expect(saved.progress.flag).toBe(3);
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

test('flags remain per-user progress through save, grade, clear, retry and pull', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Flags' })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'Flag', back: 'Back', flag: 3 })).data;
    if (card.flag !== 3) throw new Error('Save response lost flag');
    await api.post('/study/grade', { card_id: card.id, grade: 2, return_next: false });
    const reviewed = await getDb().progress.get([card.id, 1]);
    await api.post('/cards/save', { card_id: card.id, front: 'Edited' });
    const edited = await getDb().progress.get([card.id, 1]);
    await api.post('/cards/save', { card_id: card.id, flag: 0 });
    const cleared = await getDb().progress.get([card.id, 1]);
    return { deck: deck.id, card: card.id, reviewed, edited, cleared, canonical: await getDb().cards.get(card.id) };
  });
  expect(state.reviewed.flag).toBe(3);
  expect(state.edited).toEqual(state.reviewed);
  expect(state.cleared).toMatchObject({ flag: 0, repetitions: 1, queue: 'review', is_dirty: 1 });
  expect(state.cleared.local_revision).not.toBe(state.edited.local_revision);
  expect(state.canonical.flag).toBeUndefined();
  await page.reload();
  await loadModules(page);
  expect(await page.evaluate(async id => (await api.get(`/study/card/${id}`)).data.flag, state.card)).toBe(0);

  let payload;
  await page.route('**/api/sync/v2/push', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { status: 'success', review_count: payload.reviews.length,
      mappings: { folders: {}, decks: { [state.deck]: 10 }, cards: { [state.card]: 20 } } } });
  });
  await page.route('**/api/sync/v2/pull*', route => route.fulfill({ json: {
    status: 'success', server_time: new Date().toISOString(), folders: [],
    decks: [{ id: 10, name: 'Flags', user_id: 1 }],
    cards: [{ id: 20, deck_id: 10, front_text: 'Edited', back_text: 'Back' }],
    progress: [{ ...state.cleared, card_id: 20, user_id: 1 }],
  } }));
  expect((await page.evaluate(() => sync.sync())).success).toBe(true);
  expect(payload.progress[0]).toMatchObject({ card_id: state.card, flag: 0, repetitions: 1 });
  expect(payload.cards[0].flag).toBeUndefined();
  expect(await page.evaluate(async () => (await api.get('/study/card/20')).data.flag)).toBe(0);
});

test('grading legacy cached flags preserves them while explicit zero takes precedence', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    await getDb().decks.put({ id: 10, name: 'Legacy', user_id: 1, role: 'owner' });
    await getDb().cards.put({ id: 20, deck_id: 10, front_text: 'Old cache', flag: 3 });
    await api.post('/study/grade', { card_id: 20, grade: 2, return_next: false });
    const graded = (await api.get('/study/card/20')).data;
    await api.post('/cards/20/flag', { flag: 0 });
    await api.post('/cards/save', { card_id: 20, front: 'Edited cache' });
    const cleared = (await api.get('/study/card/20')).data;
    return { graded, cleared, progress: await getDb().progress.get([20, 1]) };
  });
  expect(state.graded.flag).toBe(3);
  expect(state.cleared.flag).toBe(0);
  expect(state.progress).toMatchObject({ flag: 0, repetitions: 1 });
});

test('card and flag changes roll back together when progress cannot be saved', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Atomic flag' })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'Original', flag: 3 })).data;
    const table = getDb().progress;
    const put = table.put;
    let failed = false;
    table.put = () => { throw new Error('Fixture storage failure'); };
    try { await api.post('/cards/save', { card_id: card.id, front: 'Should roll back', flag: 0 }); }
    catch (error) { failed = error.message === 'Fixture storage failure'; }
    finally { table.put = put; }
    return { failed, card: await getDb().cards.get(card.id), progress: await table.get([card.id, 1]) };
  });
  expect(state.failed).toBe(true);
  expect(state.card.front_text).toBe('Original');
  expect(state.progress.flag).toBe(3);
});

test('lost response retries identical durable batch after restart', async ({ page, context }) => {
  await harness(page, context);
  await page.route('**/api/sync/v2/push', async route => {
    await route.abort('failed');
  });
  const pending = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Retry' })).data;
    await api.post('/cards/save', { deck_id: deck.id, front: 'x', back: 'y', flag: 3 });
    const result = await sync.sync();
    return { result, batch: await getDb().syncState.get('pending') };
  });
  expect(pending.result.success).toBe(false);
  expect(pending.batch?.request_id).toBeTruthy();

  await page.reload();
  await loadModules(page);

  let sent;
  await page.route('**/api/sync/v2/push', async route => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error' }) });
  });

  const retried = await page.evaluate(async () => {
    const result = await sync.sync();
    return { result, dirty: await getDb().cards.where('is_dirty').equals(1).count() };
  });

  expect(retried.result.success).toBe(false);
  expect(sent?.request_id).toBe(pending.batch.request_id);
  expect(sent.progress).toEqual(pending.batch.progress);
  expect(sent.progress[0].flag).toBe(3);
  expect(retried.dirty).toBe(1);
});

test('edits during push survive acknowledgement and stale pull', async ({ page, context }) => {
  await harness(page, context);
  let releasePush;
  const pushStarted = new Promise(resolve => {
    page.route('**/api/sync/v2/push', async route => {
      resolve();
      await new Promise(r => { releasePush = r; });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', mappings: { folders: {}, decks: {}, cards: {} } }),
      });
    });
  });

  await page.route('**/api/sync/v2/pull*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        server_time: new Date().toISOString(),
        folders: [],
        decks: [{ id: 10, name: 'Deck', user_id: 1 }],
        cards: [{ id: 20, deck_id: 10, front_text: 'Sent', back_text: 'Back' }],
        progress: [{ card_id: 20, user_id: 1, flag: 3 }],
      }),
    });
  });

  await page.evaluate(async () => {
    await getDb().decks.put({ id: 10, name: 'Deck', user_id: 1 });
    await getDb().cards.put({ id: 20, deck_id: 10, front_text: 'Original', back_text: 'Back' });
    await api.post('/cards/save', { card_id: 20, deck_id: 10, front: 'Sent', flag: 3 });
  });

  const syncPromise = page.evaluate(async () => sync.sync());
  await pushStarted;
  await page.evaluate(async () => {
    await api.post('/cards/save', { card_id: 20, deck_id: 10, front: 'Edited during request', flag: 0 });
  });
  releasePush();
  const syncResult = await syncPromise;
  expect(syncResult.success).toBe(true);

  const card = await page.evaluate(async () => getDb().cards.get(20));
  expect(card).toMatchObject({ front_text: 'Edited during request', is_dirty: 1 });
  expect(await page.evaluate(async () => getDb().progress.get([20, 1]))).toMatchObject({ flag: 0, is_dirty: 1 });
});

test('ID remapping preserves nested references and progress', async ({ page, context }) => {
  await harness(page, context);
  const ids = await page.evaluate(async () => {
    const parent = (await api.post('/folders', { name: 'Parent' })).data;
    const child = (await api.post('/folders', { name: 'Child', parent_id: parent.id })).data;
    const deck = (await api.post('/decks', { name: 'Deck', folder_id: child.id })).data;
    const card = (await api.post('/cards/save', { deck_id: deck.id, front: 'x', back: 'y' })).data;
    await api.post('/study/grade', { card_id: card.id, deck_id: deck.id, grade: 0 });
    return { parent: parent.id, child: child.id, deck: deck.id, card: card.id };
  });

  await page.route('**/api/sync/v2/push', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
          status: 'success',
          review_count: route.request().postDataJSON().reviews?.length || 0,
          mappings: {
          folders: { [ids.parent]: 10, [ids.child]: 11 },
          decks: { [ids.deck]: 12 },
          cards: { [ids.card]: 13 },
        },
      }),
    });
  });

  await page.route('**/api/sync/v2/pull*', async route => {
    await route.abort('failed');
  });

  await page.evaluate(async () => sync.sync());

  const state = await page.evaluate(async () => ({
    folders: await getDb().folders.toArray(),
    decks: await getDb().decks.toArray(),
    cards: await getDb().cards.toArray(),
    progress: await getDb().progress.toArray(),
    pending: await getDb().syncState.get('pending'),
  }));

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

test('forced offline traversal persists every grade and synchronizes history with progress', async ({ page, context }) => {
  await harness(page, context);
  const state = await page.evaluate(async () => {
    const deck = (await api.post('/decks', { name: 'Forced' })).data;
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const card = (await api.post('/cards/save', { deck_id: deck.id, front: `Word ${i}`, back: 'Back' })).data;
      ids.push(card.id);
      await getDb().progress.put({ card_id: card.id, user_id: 1, queue: 'review', interval: 10,
        ease_factor: 2.5, lapses: 0, repetitions: 1,
        last_reviewed: new Date(Date.now() - 2 * 86400000).toISOString(),
        next_review: new Date(Date.now() + 8 * 86400000).toISOString() });
    }
    if (!(await api.get(`/decks/${deck.id}/next`)).data.finished) throw new Error('Expected scheduled completion');
    let card = (await api.get(`/decks/${deck.id}/next?review_context=forced`)).data;
    const seen = [];
    while (!card.finished) {
      if (seen.includes(card.id)) throw new Error('Forced pass loop');
      seen.push(card.id);
      card = (await api.post('/study/grade', { card_id: card.id, deck_id: deck.id,
        grade: seen.length === 1 ? 0 : 2, review_context: 'forced', exclude_ids: seen })).data;
    }
    return { ids, seen, deckId: deck.id };
  });
  expect(new Set(state.seen)).toEqual(new Set(state.ids));
  await page.reload();
  await loadModules(page);
  const persisted = await page.evaluate(async () => ({
    events: await getDb().syncState.filter(item => item.key.startsWith('review:')).toArray(),
    progress: await getDb().progress.toArray(),
  }));
  expect(persisted.events).toHaveLength(3);
  expect(persisted.events.every(e => e.review_context === 'forced')).toBe(true);
  expect(persisted.progress.find(p => p.card_id === state.seen[0])).toMatchObject({ queue: 'relearning', lapses: 1 });
  expect(persisted.progress.filter(p => p.queue === 'review').every(p => p.interval >= 13 && p.interval <= 14)).toBe(true);
  let payload;
  await page.route('**/api/sync/v2/push', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { status: 'success', review_count: payload.reviews.length,
      mappings: { folders: {}, decks: { [state.deckId]: 50 }, cards: Object.fromEntries(state.ids.map((id, i) => [id, 60 + i])) } } });
  });
  await page.route('**/api/sync/v2/pull*', route => route.abort());
  await page.evaluate(async () => sync.sync());
  expect(payload.reviews).toHaveLength(3);
  const after = await page.evaluate(async () => ({
    events: await getDb().syncState.filter(item => item.key.startsWith('review:')).toArray(),
    progress: await getDb().progress.toArray(), pending: await getDb().syncState.get('pending'),
  }));
  expect(after.events).toEqual([]);
  expect(after.pending).toBeUndefined();
  expect(after.progress.every(p => p.card_id > 0 && p.is_dirty === 0)).toBe(true);
});

test('forced backend and offline order match position with exclusions, independent of SRS', async ({ page, context }) => {
  const fixture = {
    cards: [
      { id: 101, deck_id: 1, position: 30, queue: 'new' },
      { id: 102, deck_id: 1, position: 10, queue: 'review', next_review: '2099-01-01T00:00:00Z' },
      { id: 103, deck_id: 1, position: 20, queue: 'learning', next_review: '2000-01-01T00:00:00Z' },
      { id: 104, deck_id: 1, position: 10, queue: 'relearning', next_review: '2099-02-01T00:00:00Z' },
      { id: 105, deck_id: 1, position: 0, is_deleted: true },
      { id: 106, deck_id: 2, position: 0 },
      { id: 107, deck_id: 1, position: 15 },
    ],
    exclude: [104],
  };
  // Execute the real selector against SQLite using the very same browser fixture.
  const backend = JSON.parse(require('child_process').execFileSync('python', ['-c', `
import sys, json, datetime
sys.path.insert(0, 'scripts/tests')
from test_forced_study import database, models, TABLES, cards
fixture = json.load(sys.stdin)
database.create_tables(TABLES)
models.TMAUser.create(user_id=1)
for deck_id in [1, 2]:
    models.TMA_Deck.create(id=deck_id, user_id=1, name='Order')
for row in fixture['cards']:
    models.TMA_Card.create(id=row['id'], deck=row['deck_id'], position=row['position'],
        front_text=str(row['id']), back_text='x', is_deleted=row.get('is_deleted', False))
    if 'queue' in row:
        due = datetime.datetime.fromisoformat(row['next_review'].replace('Z', '')) if row.get('next_review') else None
        models.TMAProgress.create(card_id=row['id'], user_id=1, queue=row['queue'], next_review=due)
seen = list(fixture['exclude'])
order = []
for _ in range(len(fixture['cards']) + 1):
    card, _ = cards.get_next_card(1, 1, exclude_ids=seen, review_context='forced')
    if not card:
        break
    order.append(card.id)
    seen.append(card.id)
print(json.dumps(order))
database.drop_tables(TABLES)
`], { cwd: require('path').resolve(__dirname, '../../..'), input: JSON.stringify(fixture), encoding: 'utf8' }));
  await harness(page, context);
  const offline = await page.evaluate(async fixture => {
    for (const id of [1, 2]) await getDb().decks.put({ id, name: 'Order', user_id: 1 });
    for (const row of fixture.cards) {
      await getDb().cards.put({ ...row, front_text: String(row.id), back_text: 'x' });
      if (row.queue) await getDb().progress.put({ card_id: row.id, user_id: 1, queue: row.queue, next_review: row.next_review });
    }
    const seen = [...fixture.exclude];
    const order = [];
    for (let i = 0; i <= fixture.cards.length; i++) {
      const card = (await api.get(`/decks/1/next?review_context=forced&exclude_ids=${seen.join(',')}`)).data;
      if (card.finished) break;
      order.push(card.id);
      seen.push(card.id);
    }
    return order;
  }, fixture);
  expect(backend).toEqual([102, 107, 103, 101]);
  expect(offline).toEqual(backend);
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
