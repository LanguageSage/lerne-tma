import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { observeServerGeneration } from '../serverGeneration.js';
import { inspectCutoverDatabase } from '../cardCutoverPreflight.js';

const original = 'a'.repeat(64), restored = 'b'.repeat(64);
const fixture = () => {
  const db = new Dexie(`synthetic-generation-${crypto.randomUUID()}`);
  db.version(1).stores({ syncState: 'key', cards: 'id', progress: 'id', decks: 'id', folders: 'id',
    card_notes: 'id', knowledge_attempt_outbox: 'id' });
  return db;
};

test('generation mismatch quarantines cache and pending operations across reopen', async () => {
  const db = fixture();
  try {
    await observeServerGeneration(db, { server_generation: original, restored: false }, () => true);
    assert.equal((await inspectCutoverDatabase(db)).pending_free, true);
    const card = { id: 7, content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Keep', answer: 'local' } } } };
    await db.cards.put(card);
    await db.syncState.put({ key: 'card-create-v2:-1', payload: { request_id: 'keep-identity' } });
    const before = await db.cards.toArray();
    await assert.rejects(observeServerGeneration(db, { server_generation: restored, restored: true }, () => true),
      error => error.response.data.detail.code === 'database_generation_conflict');
    db.close(); await db.open();
    assert.deepEqual(await db.cards.toArray(), before);
    assert.equal((await db.syncState.get('card-create-v2:-1')).payload.request_id, 'keep-identity');
    assert.equal((await db.syncState.get('serverGeneration')).generation, original);
    assert.equal((await inspectCutoverDatabase(db)).blockers['syncState:server_generation_conflict'], 1);
    await assert.rejects(observeServerGeneration(db, { server_generation: original }, () => true));
  } finally { await db.delete(); }
});

test('new account may bind a restored server; unversioned retained edits require reconciliation', async () => {
  for (const hasDraft of [false, true]) {
    const db = fixture();
    try {
      if (hasDraft) await db.knowledge_attempt_outbox.put({ id: 1, answer: 'retain' });
      const observe = observeServerGeneration(db, { server_generation: restored, restored: true }, () => true);
      if (hasDraft) await assert.rejects(observe);
      else assert.equal(await observe, restored);
    } finally { await db.delete(); }
  }
});

test('a changed session cannot bind or overwrite recovery state', async () => {
  const db = fixture();
  try {
    await assert.rejects(observeServerGeneration(db, { server_generation: original }, () => false), /Session changed/);
    assert.equal(await db.syncState.count(), 0);
  } finally { await db.delete(); }
});
