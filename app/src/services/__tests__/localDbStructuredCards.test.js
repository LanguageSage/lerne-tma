import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { configureDatabase, STRUCTURED_CARDS_V2_NATIVE_WRITES_ENABLED } from '../localDb.js';

let serial = 0;
const schemas = {
  1: {
    decks: 'id, user_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  },
  2: {
    folders: 'id, user_id, name, is_deleted, is_dirty',
    decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  },
  3: { syncState: 'key', media: 'url' },
  4: {
    knowledge_items: 'id, language, category',
    card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
    knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
    user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id',
  },
};
const defaults = { content_version: 1, content_v2: null, card_revision: 1 };

async function fixture(version = 4) {
  const name = `structured-card-upgrade-${++serial}`;
  const legacy = new Dexie(name);
  for (let index = 1; index <= version; index++) legacy.version(index).stores(schemas[index]);
  await legacy.open();
  await legacy.decks.put({ id: -1, user_id: 7, name: 'Pending deck', is_dirty: 1 });
  await legacy.cards.bulkPut([
    { id: -2, deck_id: -1, front_text: '@quiz\n[[literal]]', back_text: 'A', is_dirty: 1,
      local_revision: 'draft-uuid', updated_at: '2026-10-01T00:00:00Z', metadata: { tags: ['a', 'a'] } },
    { id: 125, deck_id: -1, front_text: 'clean', back_text: 'B', is_dirty: 0 },
  ]);
  await legacy.progress.put({ card_id: -2, user_id: 7, interval: 17, repetitions: 3,
    is_dirty: 1, next_review: '2026-10-10', local_revision: 'review-draft' });
  if (version >= 3) {
    const cards = await legacy.cards.toArray();
    await legacy.syncState.bulkPut([
      { key: 'pending', request_id: 'immutable-uuid', userId: 7, cards,
        reviews: [{ key: 'review:uuid', card_id: -2, rating: 'good' }] },
      { key: 'aliases', mappings: { cards: { '-9': 125 }, decks: { '-8': 20 } } },
      { key: 'review:uuid', card_id: -2, rating: 'good', review_time: '2026-10-01' },
    ]);
    await legacy.media.put({ url: '/api/media/audio/a.mp3', blob: new Blob(['audio']) });
  }
  if (version >= 4) {
    await legacy.knowledge_attempt_outbox.put({ client_event_id: 'attempt-uuid', user_id: 7,
      knowledge_item_id: 3, sync_status: 'pending', payload: { card_id: -2, score: 1 } });
    await legacy.card_knowledge_items.put({ card_id: -2, knowledge_item_id: 3, role: 'primary' });
  }
  const before = Object.fromEntries(await Promise.all(legacy.tables.map(async table =>
    [table.name, await table.toArray()])));
  legacy.close();
  const database = new Dexie(name);
  configureDatabase(database);
  return { database, before, name };
}

test('v4 upgrade preserves dirty drafts, pending bytes, aliases, reviews and Knowledge outbox', async () => {
  const { database, before, name } = await fixture();
  try {
    await database.open();
    assert.equal(database.verno, 5);
    for (const [table, rows] of Object.entries(before)) {
      const expected = table === 'cards' ? rows.map(card => ({ ...defaults, ...card })) : rows;
      assert.deepEqual(await database.table(table).toArray(), expected, table);
    }
    assert.equal(await (await database.media.get('/api/media/audio/a.mp3')).blob.text(), 'audio');
    database.close();
    await database.open();
    assert.deepEqual(await database.syncState.toArray(), before.syncState);
    assert.deepEqual(await database.cards.toArray(), before.cards.map(card => ({ ...defaults, ...card })));
  } finally {
    database.close();
    await Dexie.delete(name);
  }
});

test('failed upgrade rolls back cards and pending, then a retry recovers', async () => {
  const { database, before, name } = await fixture();
  const fail = () => { throw new Error('injected upgrade failure'); };
  const previous = new Dexie(name);
  database.cards.hook('updating', fail);
  try {
    await assert.rejects(database.open(), /injected upgrade failure/);
    await previous.open();
    assert.equal(previous.verno, 4);
    for (const [table, rows] of Object.entries(before)) {
      assert.deepEqual(await previous.table(table).toArray(), rows, table);
    }
    previous.close();
    database.cards.hook('updating').unsubscribe(fail);
    await database.open();
    assert.equal(database.verno, 5);
    assert.deepEqual(await database.syncState.toArray(), before.syncState);
  } finally {
    previous.close();
    database.close();
    await Dexie.delete(name);
  }
});

test('upgrades from v1-v3 retain every existing store and row', async () => {
  for (const version of [1, 2, 3]) {
    const { database, before, name } = await fixture(version);
    try {
      await database.open();
      for (const [table, rows] of Object.entries(before)) {
        assert.deepEqual(await database.table(table).toArray(),
          table === 'cards' ? rows.map(card => ({ ...defaults, ...card })) : rows, `v${version}/${table}`);
      }
    } finally {
      database.close();
      await Dexie.delete(name);
    }
  }
});

test('upgrade preserves pre-existing V2/unknown envelopes without enabling their writes', async () => {
  const { database, name } = await fixture();
  const legacy = new Dexie(name);
  try {
    await legacy.open();
    const rows = [2, 99].map(version => ({ id: 200 + version, deck_id: -1, front_text: 'cache',
      content_version: version, content_v2: { id: 'author', type: 'puzzle', data: { tokens: ['a', 'a'] } },
      card_revision: 7, base_revision: 6, local_revision: 'keep', is_dirty: 1 }));
    await legacy.table('cards').bulkPut(rows);
    legacy.close();
    await database.open();
    for (const row of rows) {
      assert.deepEqual(await database.cards.get(row.id), row);
      for (const operation of [
        () => database.cards.update(row.id, { front_text: 'changed' }),
        () => database.cards.update(row.id, { content_version: 1, content_v2: null }),
        () => database.cards.put({ id: row.id, deck_id: -1, front_text: 'legacy replacement' }),
      ]) {
        await assert.rejects(operation(), /structured_cards_v2_creation_disabled/);
        assert.deepEqual(await database.cards.get(row.id), row);
      }
    }
  } finally {
    legacy.close();
    database.close();
    await Dexie.delete(name);
  }
});

test('fresh database keeps the creation flag off and legacy CRUD works', async () => {
  const name = `structured-card-new-${++serial}`;
  const database = new Dexie(name);
  configureDatabase(database);
  try {
    await database.open();
    assert.equal(STRUCTURED_CARDS_V2_NATIVE_WRITES_ENABLED, false);
    await database.cards.add({ id: -1, deck_id: -2, front_text: 'Q', back_text: 'A', is_dirty: 1 });
    assert.deepEqual(await database.cards.get(-1), {
      id: -1, deck_id: -2, front_text: 'Q', back_text: 'A', is_dirty: 1, ...defaults,
    });
    await database.cards.update(-1, { front_text: 'edited' });
    await database.cards.put({ id: -1, deck_id: -2, front_text: 'replaced', back_text: 'B' });
    const saved = await database.cards.get(-1);
    assert.equal(saved.front_text, 'replaced');
    assert.equal(saved.card_revision, 1);
    assert.equal(saved.content_version, 1);
    assert.equal(saved.content_v2, null);
  } finally {
    database.close();
    await Dexie.delete(name);
  }
});

test('add, put, update, dotted update and mixed bulk fail atomically for V2', async () => {
  const { database, name } = await fixture();
  try {
    await database.open();
    const original = await database.cards.get(125);
    const native = { id: 500, deck_id: -1, content_version: 2,
      content_v2: { type: 'standard', data: { prompt: 'Q', answer: 'A' } } };
    for (const operation of [
      () => database.cards.add(native), () => database.cards.put(native),
      () => database.cards.update(125, { content_version: 2, content_v2: native.content_v2 }),
      () => database.cards.update(125, { 'content_v2.data.prompt': 'new' }),
      () => database.cards.update(125, { content_version: 99 }),
      () => database.cards.update(125, { content_version: null }),
      () => database.cards.put({ ...original, content_v2: native.content_v2 }),
    ]) {
      await assert.rejects(operation(), /structured_cards_v2_creation_disabled/);
      assert.deepEqual(await database.cards.get(125), original);
      assert.equal(await database.cards.get(500), undefined);
    }
    await assert.rejects(database.transaction('rw', database.cards, async () => {
      await database.cards.bulkPut([{ id: 499, front_text: 'allowed' }, native]);
    }), /structured_cards_v2_creation_disabled/);
    assert.equal(await database.cards.get(499), undefined);
  } finally {
    database.close();
    await Dexie.delete(name);
  }
});
