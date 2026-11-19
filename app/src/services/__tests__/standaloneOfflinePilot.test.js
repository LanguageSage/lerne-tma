import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const memStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: key => (memStorage.has(key) ? memStorage.get(key) : null),
    setItem: (key, val) => memStorage.set(key, String(val)),
    removeItem: key => memStorage.delete(key),
    clear: () => memStorage.clear(),
  };
}
if (!globalThis.window) {
  globalThis.window = { location: { search: '', hostname: 'localhost', port: '' }, Capacitor: null };
}

const { IS_STANDALONE, STANDALONE_USER_ID } = await import('../../utils/standaloneMode.js');
const {
  buildStandalonePack,
  getStandalonePack,
  SUPPORTED_OFFLINE_CARD_TYPES,
} = await import('../../pilot/standalonePack.js');
const { ensureStandaloneSeed, validateStandalonePack, STANDALONE_SEED_MANIFEST_KEY } = await import('../../pilot/standaloneSeed.js');
const {
  PROGRESS_BACKUP_FORMAT,
  PROGRESS_BACKUP_SCHEMA_VERSION,
  LAST_BACKUP_META_KEY,
  exportProgressBackup,
  recordBackupExportMeta,
  inspectProgressBackup,
  applyProgressBackup,
} = await import('../../pilot/progressBackup.js');
const { calculateCardReview } = await import('../../utils/srsEngine.js');

function createTestDexie(name) {
  const db = new Dexie(name);
  db.version(1).stores({
    decks: 'id, user_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  });
  db.version(2).stores({
    folders: 'id, user_id, name, is_deleted, is_dirty',
    decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
  });
  db.version(3).stores({
    syncState: 'key',
    media: 'url',
  });
  db.version(4).stores({
    knowledge_items: 'id, language, category',
    card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
    knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
    user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id',
  });
  db.version(5).stores({ card_notes: 'id, card_id, is_dirty' });
  return db;
}

let dbCounter = 0;

describe('Standalone Offline Pilot — Pack, Seed & Progress Backup', () => {
  let db;

  beforeEach(async () => {
    memStorage.clear();
    dbCounter += 1;
    db = createTestDexie(`StandaloneTestDB_${dbCounter}`);
    await db.open();
  });

  test('default web build flag IS_STANDALONE is false', () => {
    assert.equal(IS_STANDALONE, false);
  });

  test('bundled Native JSON V2 pack has 3 valid decks, 30 cards, and covers all 7 offline card types', () => {
    const pack = getStandalonePack();
    validateStandalonePack(pack);

    assert.equal(pack.decks.length, 3);
    assert.equal(pack.cards.length, 30);

    const seenTypes = new Set(pack.cards.map(c => c.card.type));
    for (const type of SUPPORTED_OFFLINE_CARD_TYPES) {
      assert.equal(seenTypes.has(type), true, `Missing card type: ${type}`);
    }
    assert.equal(seenTypes.has('free_text'), false);
    assert.equal(seenTypes.has('editable_text'), false);
  });

  test('seed is strictly idempotent and writes complete cache markers', async () => {
    const pack = getStandalonePack();
    const first = await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(first.seeded, true);
    assert.equal(first.insertedDecks, 3);
    assert.equal(first.insertedCards, 30);

    const second = await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(second.seeded, false);
    assert.equal(second.skipped, true);

    assert.equal(await db.decks.count(), 3);
    assert.equal(await db.cards.count(), 30);
    for (const deck of pack.decks) {
      const marker = await db.syncState.get(`deck-cards:${deck.id}`);
      assert.equal(marker?.complete, true);
    }
    const manifest = await db.syncState.get(STANDALONE_SEED_MANIFEST_KEY);
    assert.equal(manifest.card_set_fingerprint, pack.cardSetFingerprint);
  });

  test('simulated APK pack upgrade preserves 100% of existing SRS progress and deck preferences', async () => {
    const v1Pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack: v1Pack });

    await db.decks.update(v1Pack.decks[0].id, { is_learning: true });
    const reviewedCard = v1Pack.cards[0];
    const srsProgress = calculateCardReview({
      card_id: reviewedCard.id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 3, false, 'scheduled', new Date('2026-11-19T12:00:00.000Z'));
    await db.progress.put(srsProgress);

    const v2Specs = v1Pack.decks.map((d, idx) => {
      const doc = structuredClone(d.document);
      if (idx === 0) {
        doc.cards[0].explanation = 'Updated explanation in v2 APK';
        doc.cards.push({
          id: 'a2-13-new',
          type: 'standard',
          level: 'A2',
          data: { prompt: 'die Vereinbarung', answer: 'договорённость' },
        });
      }
      return {
        id: d.id,
        slug: d.slug,
        targetLanguage: d.targetLanguage,
        color: d.color,
        position: d.position,
        cardIdBase: d.id === 9101 ? 910100 : d.id === 9102 ? 910200 : 910300,
        document: doc,
      };
    });
    const v2Pack = buildStandalonePack({ packVersion: 2, deckSpecs: v2Specs });

    const upgrade = await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack: v2Pack });
    assert.equal(upgrade.seeded, true);
    assert.equal(upgrade.upgraded, true);
    assert.equal(upgrade.insertedCards, 1);
    assert.equal(await db.cards.count(), 31);

    const upgradedDeck = await db.decks.get(v1Pack.decks[0].id);
    assert.equal(upgradedDeck.is_learning, true);

    const updatedCard = await db.cards.get(reviewedCard.id);
    assert.equal(updatedCard.content_v2.card.explanation, 'Updated explanation in v2 APK');

    const preservedProgress = await db.progress.get([reviewedCard.id, STANDALONE_USER_ID]);
    assert.deepEqual(preservedProgress, srsProgress);
  });

  test('backup export/inspect/restore verifies integrity, rejects bad formats, warns on overwrite, and restores cleanly on wipe', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });

    await db.decks.update(pack.decks[1].id, { is_learning: true });
    const baseTime = new Date('2026-11-19T14:00:00.000Z').getTime();
    const expectedRows = [];
    for (let i = 0; i < 22; i += 1) {
      const card = pack.cards[i];
      const grade = i % 4;
      const review = calculateCardReview({
        card_id: card.id,
        user_id: STANDALONE_USER_ID,
        queue: 'new',
        step_index: 0,
        interval: 0,
        ease_factor: 2.5,
        repetitions: 0,
        lapses: 0,
        flag: i % 3,
        want_to_learn: i % 2 === 0,
      }, grade, false, 'scheduled', new Date(baseTime + i * 60000));
      expectedRows.push(review);
      await db.progress.put(review);
    }

    const deferredExport = await exportProgressBackup({
      db,
      userId: STANDALONE_USER_ID,
      pack,
      now: new Date('2026-11-19T14:55:00.000Z'),
      recordMeta: false,
    });
    assert.equal(await db.syncState.get(LAST_BACKUP_META_KEY), undefined);
    await recordBackupExportMeta({
      db,
      exportedAt: deferredExport.backup.exported_at,
      summary: deferredExport.summary,
    });
    const recordedMeta = await db.syncState.get(LAST_BACKUP_META_KEY);
    assert.equal(recordedMeta?.exported_at, '2026-11-19T14:55:00.000Z');

    const exported = await exportProgressBackup({
      db,
      userId: STANDALONE_USER_ID,
      pack,
      now: new Date('2026-11-19T15:00:00.000Z'),
    });
    assert.equal(exported.backup.format, PROGRESS_BACKUP_FORMAT);
    assert.equal(exported.backup.schema_version, PROGRESS_BACKUP_SCHEMA_VERSION);
    assert.equal(exported.summary.total_records, 22);
    assert.equal(exported.summary.reviewed_records, 22);

    // 1. Tamper detection
    const tampered = structuredClone(exported.backup);
    tampered.records[0].interval = 999;
    const tamperedCheck = await inspectProgressBackup(JSON.stringify(tampered), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(tamperedCheck.ok, false);
    assert.equal(tamperedCheck.code, 'INTEGRITY_MISMATCH');

    // 2. Wrong format detection (deck JSON & lerne-materials archive)
    const deckJsonCheck = await inspectProgressBackup(JSON.stringify(pack.decks[0].document), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(deckJsonCheck.ok, false);
    assert.equal(deckJsonCheck.code, 'WRONG_ARCHIVE_FORMAT');

    const materialsCheck = await inspectProgressBackup(JSON.stringify({ format: 'lerne-materials', archive_version: 3 }), {
      db,
      userId: STANDALONE_USER_ID,
      pack,
    });
    assert.equal(materialsCheck.ok, false);
    assert.equal(materialsCheck.code, 'WRONG_ARCHIVE_FORMAT');

    // 3. Invalid JSON
    const badJson = await inspectProgressBackup('{not-json', { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(badJson.ok, false);
    assert.equal(badJson.code, 'INVALID_JSON');

    // 4. Overwrite warning on non-empty DB
    const overwriteCheck = await inspectProgressBackup(exported.json, { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(overwriteCheck.ok, true);
    assert.equal(overwriteCheck.preview.willOverwriteLocalProgress, true);
    assert.equal(overwriteCheck.preview.currentProgressCount, 22);

    // 5. Clean install simulation -> wipe & re-seed -> inspect -> restore -> exact verification
    db.close();
    await Dexie.delete(db.name);
    const freshDb = createTestDexie(`StandaloneCleanInstall_${dbCounter}`);
    await freshDb.open();
    await ensureStandaloneSeed({ db: freshDb, userId: STANDALONE_USER_ID, pack });
    assert.equal(await freshDb.progress.count(), 0);

    const cleanInspect = await inspectProgressBackup(exported.json, { db: freshDb, userId: STANDALONE_USER_ID, pack });
    assert.equal(cleanInspect.ok, true);
    assert.equal(cleanInspect.preview.willOverwriteLocalProgress, false);
    assert.equal(cleanInspect.preview.backupReviewedCount, 22);

    const applied = await applyProgressBackup(cleanInspect.backup, { db: freshDb, userId: STANDALONE_USER_ID, pack });
    assert.equal(applied.restoredRecords, 22);

    const restoredRows = (await freshDb.progress.where('user_id').equals(STANDALONE_USER_ID).toArray())
      .sort((a, b) => a.card_id - b.card_id);
    assert.equal(restoredRows.length, 22);
    expectedRows.sort((a, b) => a.card_id - b.card_id);
    for (let i = 0; i < 22; i += 1) {
      assert.equal(restoredRows[i].card_id, expectedRows[i].card_id);
      assert.equal(restoredRows[i].queue, expectedRows[i].queue);
      assert.equal(restoredRows[i].interval, expectedRows[i].interval);
      assert.equal(restoredRows[i].ease_factor, expectedRows[i].ease_factor);
      assert.equal(restoredRows[i].repetitions, expectedRows[i].repetitions);
      assert.equal(restoredRows[i].lapses, expectedRows[i].lapses);
      assert.equal(restoredRows[i].next_review, expectedRows[i].next_review);
      assert.equal(restoredRows[i].last_reviewed, expectedRows[i].last_reviewed);
      assert.equal(restoredRows[i].flag, expectedRows[i].flag);
      assert.equal(restoredRows[i].want_to_learn, expectedRows[i].want_to_learn);
    }

    const restoredDeck = await freshDb.decks.get(pack.decks[1].id);
    assert.equal(restoredDeck.is_learning, true);
    freshDb.close();
  });
});
