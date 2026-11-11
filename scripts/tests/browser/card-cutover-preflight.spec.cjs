const { test, expect } = require('@playwright/test');

async function harness(page, context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5199' || url.pathname.startsWith('/api')) return route.abort();
    if (url.pathname === '/cutover-harness') return route.fulfill({ contentType: 'text/html', body: '<html>Preflight</html>' });
    return route.continue();
  });
  await page.goto('/cutover-harness');
  await page.evaluate(async () => {
    window.cutover = await import('/src/services/cardCutoverPreflight.js');
    window.Dexie = (await import('/node_modules/.vite/deps/dexie.js')).default;
  });
}

test('old account databases retain every pending operation across read-only scans and reload', async ({ page, context }) => {
  await harness(page, context);
  await page.evaluate(async () => {
    const legacy = new window.Dexie('LerneLocalDB');
    legacy.version(1).stores({ cards: 'id', progress: '[card_id+user_id]' });
    await legacy.cards.put({ id: -9, front_text: 'Unsaved creation', is_dirty: 1 });
    await legacy.progress.put({ card_id: 44, user_id: 1, is_dirty: 1, flag: 3 });
    legacy.close();
    const db = new window.Dexie('LerneLocalDB_2');
    db.version(5).stores({ cards: 'id', decks: 'id', folders: 'id', progress: '[card_id+user_id]',
      syncState: 'key', card_notes: 'id', knowledge_attempt_outbox: 'client_event_id' });
    await db.cards.bulkPut([
      { id: 44, front_text: 'Edited V1', is_dirty: 1, is_deleted: true },
      { id: 45, content_v2: {}, offline_edit: { status: 'conflict', next: { text: 'Later draft' } } },
      { id: 46, offline_create_status: 'error' },
      { id: 47, offline_move: { status: 'rejected' } },
      { id: 48, offline_lifecycle: 'reorder' },
    ]);
    await db.decks.put({ id: 2, learning_dirty: 1 });
    await db.folders.put({ id: 3, is_dirty: 1, is_deleted: true });
    await db.progress.put({ card_id: 44, user_id: 2, is_dirty: 1, want_to_learn: true });
    await db.syncState.bulkPut([
      { key: 'pending', request_id: 'immutable-request', cards: [{ id: -9 }], reviews: [{ card_id: 44 }] },
      { key: 'review:old-event', card_id: 44, rating: 3 },
      { key: 'grade:receipt', fingerprint: 'retained-receipt' },
      ...['create', 'edit', 'move', 'lifecycle'].map(kind => ({ key: `card-${kind}-v2:uuid`, rejected: true, payload: { literal: 'Original' } })),
      { key: 'unknown-future-outbox', payload: 'Do not ignore' },
    ]);
    await db.card_notes.put({ id: 'note', is_dirty: 1, is_deleted: true });
    await db.knowledge_attempt_outbox.bulkPut(['pending', 'syncing', 'failed', 'unknown'].map(sync_status => ({ client_event_id: sync_status, sync_status })));
    db.close();
    localStorage.setItem('lerne_bulk_import_2_3', '[{"import_id":"keep-uuid"}]');
    localStorage.setItem('lerne:personal-design:v2:2', '{"version":1,"pending":true}');
    localStorage.setItem('lerne_bulk_import_1_8', 'invalid original');
  });
  const snapshot = () => page.evaluate(async () => {
    const result = {};
    for (const name of ['LerneLocalDB', 'LerneLocalDB_2']) {
      const db = new window.Dexie(name);
      await db.open();
      result[name] = { version: db.verno, rows: {} };
      for (const table of db.tables) result[name].rows[table.name] = await table.toArray();
      db.close();
    }
    result.storage = { ...localStorage };
    return result;
  });
  const before = await snapshot();
  const report = await page.evaluate(() => window.cutover.inspectCardCutover());
  expect(report.pending_free).toBe(false);
  expect(report.safe_to_stop_v1_writes).toBe(false);
  expect(report.databases.map(db => db.name)).toEqual(['LerneLocalDB', 'LerneLocalDB_2']);
  const blockers = report.databases[1].blockers;
  for (const reason of ['cards:dirty', 'cards:unacknowledged_native_state', 'decks:learning_dirty', 'folders:dirty',
    'progress:dirty', 'syncState:pending_batch', 'syncState:review', 'syncState:unknown_or_active', 'card_notes:dirty']) {
    expect(blockers[reason], reason).toBeGreaterThan(0);
  }
  expect(blockers['syncState:native_operation']).toBe(4);
  expect(blockers['knowledge_attempt_outbox:retained']).toBe(4);
  expect(Object.keys(report.storage_blockers)).toHaveLength(3);
  expect(await snapshot()).toEqual(before);
  await harness(page, context);
  const repeated = await page.evaluate(() => window.cutover.inspectCardCutover());
  expect(repeated.databases).toEqual(report.databases);
  expect(await snapshot()).toEqual(before);
});

test('empty queues never authorize global cutover; unknown schema and unavailable storage fail closed', async ({ page, context }) => {
  await harness(page, context);
  const clean = await page.evaluate(async () => {
    const db = new window.Dexie('LerneTestDB_3');
    db.version(1).stores({ cards: 'id', syncState: 'key' });
    await db.cards.put({ id: 1, front_text: 'Cached V1', is_dirty: 0 });
    await db.syncState.bulkPut([{ key: 'lastSync', time: 'today' }, { key: 'grade:ok', fingerprint: '{}' }]);
    db.close();
    return window.cutover.inspectCardCutover();
  });
  expect(clean.pending_free).toBe(true);
  expect(clean.safe_to_stop_v1_writes).toBe(false);
  const unknown = await page.evaluate(async () => {
    const db = new window.Dexie('LerneLocalDB_99');
    db.version(9).stores({ cards: 'id', future_outbox: 'id' });
    await db.open();
    db.close();
    return window.cutover.inspectCardCutover();
  });
  expect(unknown.pending_free).toBe(false);
  expect(unknown.databases[0].blockers['unknown_table:future_outbox']).toBe(1);
  const denied = await page.evaluate(async () => {
    indexedDB.databases = async () => { throw new Error('denied'); };
    return window.cutover.inspectCardCutover({ storage: { get length() { throw new Error('denied'); } } });
  });
  expect(denied.pending_free).toBe(false);
  expect(denied.errors).toEqual(['database_enumeration_failed', 'local_storage_unreadable']);
});
