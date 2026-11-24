import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        return next(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

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

mock.module('../apiConfig.js', { namedExports: { API_BASE_URL: '/api', mediaURL: value => value } });

const { IS_STANDALONE, STANDALONE_USER_ID } = await import('../../utils/standaloneMode.js');
const {
  buildStandalonePack,
  getStandalonePack,
} = await import('../../pilot/standalonePack.js');
const { ensureStandaloneSeed, validateStandalonePack, STANDALONE_SEED_MANIFEST_KEY } = await import('../../pilot/standaloneSeed.js');
const {
  PROGRESS_BACKUP_FORMAT,
  PROGRESS_BACKUP_SCHEMA_VERSION,
  PROGRESS_BACKUP_INTEGRITY_SCOPE,
  LAST_BACKUP_META_KEY,
  computeLegacyCoreBackupHash,
  computeBackupHash,
  exportProgressBackup,
  recordBackupExportMeta,
  inspectProgressBackup,
  applyProgressBackup,
} = await import('../../pilot/progressBackup.js');
const { offlineApi, STANDALONE_MAX_GRADE_RECEIPTS } = await import('../offlineApi.js');
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
    db = createTestDexie(`LerneStandaloneDB_Test_${dbCounter}`);
    await db.open();
  });

  test('default web build flag IS_STANDALONE is false', () => {
    assert.equal(IS_STANDALONE, false);
  });

  test('bundled Native JSON V2 pack has 3 valid decks, 30 cards, and covers 7 sample card types', () => {
    const pack = getStandalonePack();
    validateStandalonePack(pack);

    assert.equal(pack.decks.length, 3);
    assert.equal(pack.cards.length, 30);

    const seenTypes = new Set(pack.cards.map(c => c.card.type));
    for (const type of ['theory', 'standard', 'trainer', 'quiz', 'match', 'puzzle', 'word_bank']) {
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

  test('seed sets read-only deck permissions and migrates legacy owner decks while preserving is_learning', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });

    const deckId = pack.decks[0].id;
    const seededDeck = await db.decks.get(deckId);
    assert.equal(seededDeck.role, 'viewer');
    assert.equal(seededDeck.is_owner, false);
    assert.equal(seededDeck.is_global_readonly, true);

    await db.decks.update(deckId, {
      role: 'owner',
      is_owner: true,
      is_global_readonly: false,
      is_learning: true,
    });

    const migrated = await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(migrated.seeded, true);

    const updatedDeck = await db.decks.get(deckId);
    assert.equal(updatedDeck.role, 'viewer');
    assert.equal(updatedDeck.is_owner, false);
    assert.equal(updatedDeck.is_global_readonly, true);
    assert.equal(updatedDeck.is_learning, true);
  });

  test('standalone DB rejects content writes while allowing SRS grades, flags, learning toggle, and progress reset', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));

    const deckId = pack.decks[0].id;
    const cardId = pack.cards[0].id;
    const cfg = { _testDb: db };
    const READ_ONLY_ERR = /только для чтения|лише для перегляду|read-?only/i;

    await assert.rejects(
      offlineApi.handle('post', '/decks', { name: 'Blocked Deck' }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', '/folders', { name: 'Blocked Folder' }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', `/decks/${deckId}/rename`, { name: 'Renamed' }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('delete', `/decks/${deckId}`, null, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', `/decks/${deckId}/move`, { folder_id: null }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', `/decks/${deckId}/pin`, {}, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', '/decks/reorder', { deck_ids: [9102, 9101, 9103] }, cfg),
      READ_ONLY_ERR
    );

    const created = await offlineApi.handle('post', '/cards/save', {
      deck_id: deckId,
      request_id: 'req-create-standalone-allowed',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'x', answer: 'y' } } },
    }, cfg);
    assert.ok(created.data.id > 1000000);
    assert.equal(created.data.deck_id, deckId);
    assert.equal(created.data.standalone_local_created, true);

    const edited = await offlineApi.handle('patch', `/cards/${cardId}`, {
      request_id: 'req-edit-standalone-allowed',
      revision: 1,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'updated', answer: 'обновлено' } } },
    }, { _testDb: db, offlineCardEdit: true });
    assert.equal(edited.data.id, cardId);
    assert.equal(edited.data.standalone_local_edit, true);
    assert.equal(edited.data.content_v2.card.data.prompt, 'updated');

    const singleDeleted = await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [created.data.id],
      request_id: 'req-del-single-standalone',
    }, cfg);
    assert.equal(singleDeleted.data.is_deleted, 1);

    await assert.rejects(
      offlineApi.handle('post', '/cards/batch-move', {
        card_ids: [cardId],
        target_deck_id: 9102,
        revisions: { [cardId]: 1 },
        request_id: 'req-move-blocked',
      }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', '/cards/batch-copy', {
        card_ids: [cardId],
        target_deck_id: 9102,
        revisions: { [cardId]: 1 },
        request_id: 'req-copy-blocked',
      }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', '/cards/batch-delete', {
        card_ids: [cardId, pack.cards[1].id],
        revisions: { [cardId]: 1, [pack.cards[1].id]: 1 },
        request_id: 'req-del-multi-blocked',
      }, cfg),
      READ_ONLY_ERR
    );
    await assert.rejects(
      offlineApi.handle('post', '/cards/reorder', {
        card_ids: [cardId, pack.cards[1].id],
        revisions: { [cardId]: 1, [pack.cards[1].id]: 1 },
        request_id: 'req-reorder-blocked',
      }, cfg),
      READ_ONLY_ERR
    );

    const graded = await offlineApi.handle('post', '/study/grade', {
      card_id: cardId,
      grade: 2,
      action_id: 'personal-grade-1',
      include_progress: true,
      return_next: false,
    }, cfg);
    assert.equal(graded.data.graded_progress.repetitions, 1);

    const flagged = await offlineApi.handle('post', `/cards/${cardId}/flag`, { flag: 3 }, cfg);
    assert.equal(flagged.data.flag, 3);

    const toggled = await offlineApi.handle('post', `/decks/${deckId}/toggle-learning`, { is_learning: true }, cfg);
    assert.equal(toggled.data.is_learning, true);

    await offlineApi.handle('post', `/decks/${deckId}/reset`, {}, cfg);
    const resetProgress = await db.progress.get([cardId, STANDALONE_USER_ID]);
    assert.equal(resetProgress.repetitions, 0);
    assert.equal(resetProgress.queue, 'new');
  });

  test('standalone study grades keep bounded grade: receipts, zero review: keys, and idempotent duplicate protection', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));

    const totalGrades = 80;
    for (let i = 1; i <= totalGrades; i += 1) {
      const card = pack.cards[(i - 1) % pack.cards.length];
      await offlineApi.handle('post', '/study/grade', {
        card_id: card.id,
        grade: 2,
        action_id: `act-${i}`,
        return_next: false,
      }, { _testDb: db });
    }

    assert.equal(await db.syncState.where('key').startsWith('review:').count(), 0);
    assert.equal(await db.syncState.where('key').startsWith('grade:').count(), STANDALONE_MAX_GRADE_RECEIPTS);
    assert.equal(await db.syncState.get('grade:act-1'), undefined);
    assert.ok(await db.syncState.get('grade:act-80'));

    const lastCard = pack.cards[(totalGrades - 1) % pack.cards.length];
    const beforeReplay = await db.progress.get([lastCard.id, STANDALONE_USER_ID]);

    const replaySame = await offlineApi.handle('post', '/study/grade', {
      card_id: lastCard.id,
      grade: 2,
      action_id: 'act-80',
      include_progress: true,
      return_next: false,
    }, { _testDb: db });
    assert.equal(replaySame.data.graded_progress.repetitions, beforeReplay.repetitions);

    const afterReplay = await db.progress.get([lastCard.id, STANDALONE_USER_ID]);
    assert.equal(afterReplay.repetitions, beforeReplay.repetitions);

    await assert.rejects(
      offlineApi.handle('post', '/study/grade', {
        card_id: lastCard.id,
        grade: 0,
        action_id: 'act-80',
        return_next: false,
      }, { _testDb: db }),
      /Grade action already used with different data/
    );
  });

  test('backup integrity covers metadata and maintains compatibility with legacy core-v1 backups and pack upgrades', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });

    const review = calculateCardReview({
      card_id: pack.cards[0].id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 2, false, 'scheduled', new Date('2026-11-20T06:00:00.000Z'));
    await db.progress.put(review);

    const exported = await exportProgressBackup({
      db,
      userId: STANDALONE_USER_ID,
      pack,
      now: new Date('2026-11-20T06:30:00.000Z'),
    });
    assert.equal(exported.backup.integrity.scope, PROGRESS_BACKUP_INTEGRITY_SCOPE);

    const tamperedExportedAt = structuredClone(exported.backup);
    tamperedExportedAt.exported_at = '2026-11-21T00:00:00.000Z';
    const exportedAtRes = await inspectProgressBackup(JSON.stringify(tamperedExportedAt), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(exportedAtRes.ok, false);
    assert.equal(exportedAtRes.code, 'INTEGRITY_MISMATCH');

    const tamperedSummary = structuredClone(exported.backup);
    tamperedSummary.summary.total_records = 99;
    const summaryTamperRes = await inspectProgressBackup(JSON.stringify(tamperedSummary), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(summaryTamperRes.ok, false);
    assert.equal(summaryTamperRes.code, 'INTEGRITY_MISMATCH');

    const badSummaryWithRehash = structuredClone(exported.backup);
    badSummaryWithRehash.summary.total_records = 99;
    badSummaryWithRehash.integrity.payload_hash = computeBackupHash(badSummaryWithRehash);
    const badSummaryRes = await inspectProgressBackup(JSON.stringify(badSummaryWithRehash), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(badSummaryRes.ok, false);
    assert.equal(badSummaryRes.code, 'INVALID_METADATA');

    const badFingerprintWithRehash = structuredClone(exported.backup);
    badFingerprintWithRehash.app.card_set_fingerprint = '0'.repeat(64);
    badFingerprintWithRehash.integrity.payload_hash = computeBackupHash(badFingerprintWithRehash);
    const badFpRes = await inspectProgressBackup(JSON.stringify(badFingerprintWithRehash), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(badFpRes.ok, false);
    assert.equal(badFpRes.code, 'PACK_MISMATCH');

    const futureVersionWithRehash = structuredClone(exported.backup);
    futureVersionWithRehash.app.pack_version = 99;
    futureVersionWithRehash.integrity.payload_hash = computeBackupHash(futureVersionWithRehash);
    const futureRes = await inspectProgressBackup(JSON.stringify(futureVersionWithRehash), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(futureRes.ok, false);
    assert.equal(futureRes.code, 'PACK_MISMATCH');

    const legacyV1Backup = structuredClone(exported.backup);
    legacyV1Backup.integrity = {
      algorithm: 'sha256',
      payload_hash: computeLegacyCoreBackupHash(legacyV1Backup),
    };
    const legacyRes = await inspectProgressBackup(JSON.stringify(legacyV1Backup), { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(legacyRes.ok, true);
    assert.equal(legacyRes.preview.backupReviewedCount, 1);

    const v2Specs = pack.decks.map((d, idx) => {
      const doc = structuredClone(d.document);
      if (idx === 0) {
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
    const upgradeDb = createTestDexie(`LerneStandaloneDB_Upgrade_${dbCounter}`);
    await upgradeDb.open();
    await ensureStandaloneSeed({ db: upgradeDb, userId: STANDALONE_USER_ID, pack: v2Pack });
    const upgradeInspect = await inspectProgressBackup(exported.json, { db: upgradeDb, userId: STANDALONE_USER_ID, pack: v2Pack });
    assert.equal(upgradeInspect.ok, true);
    const upgradeApplied = await applyProgressBackup(upgradeInspect.backup, { db: upgradeDb, userId: STANDALONE_USER_ID, pack: v2Pack });
    assert.equal(upgradeApplied.restoredRecords, 1);
    upgradeDb.close();
  });

  test('Android build configuration locks Offline Pilot as the sole APK target without Standard mode', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

    const capConfig = JSON.parse(read('capacitor.config.json'));
    assert.equal(capConfig.appId, 'com.lerne.offlinepilot');
    assert.equal(capConfig.appName, 'Lerne Offline Pilot');
    assert.equal(capConfig.webDir, 'app/dist');
    assert.equal(capConfig.server?.androidScheme, 'https');

    const buildGradle = read('android/app/build.gradle');
    assert.match(buildGradle, /applicationId\s+"com\.lerne\.offlinepilot"/);
    assert.match(buildGradle, /namespace\s*=\s*"com\.lerne\.app"/);
    assert.match(buildGradle, /lernePilotVersionCode/);
    assert.match(buildGradle, /lernePilotVersionName/);
    assert.match(buildGradle, /verifyStandaloneAndroidWebBundle/);
    assert.equal(buildGradle.includes('lerneOfflinePilot'), false);
    assert.equal(buildGradle.includes('isOfflinePilot'), false);
    assert.equal(/applicationId\s+[^\n]*com\.lerne\.app/.test(buildGradle), false);

    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /android\.permission\.INTERNET"\s+tools:node="remove"/);
    assert.match(manifest, /android:name="\.MainActivity"/);
    assert.match(manifest, /\$\{applicationId\}\.fileprovider/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'android/app/src/offline/AndroidManifest.xml')), false);

    const stringsXml = read('android/app/src/main/res/values/strings.xml');
    assert.match(stringsXml, /<string name="app_name">Lerne Offline Pilot<\/string>/);
    assert.match(stringsXml, /<string name="package_name">com\.lerne\.offlinepilot<\/string>/);
    assert.match(stringsXml, /<string name="custom_url_scheme">com\.lerne\.offlinepilot<\/string>/);

    const mainActivity = read('android/app/src/main/java/com/lerne/app/MainActivity.java');
    assert.match(mainActivity, /registerPlugin\(OfflineBackupFilePlugin\.class\)/);
    assert.match(mainActivity, /registerPlugin\(OfflineMaterialArchivePlugin\.class\)/);

    assert.equal(fs.existsSync(path.join(repoRoot, '.github/workflows/android.yml')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, '.github/workflows/checks.yml')), true);

    const rootPkg = JSON.parse(read('package.json'));
    assert.match(rootPkg.scripts['build:android'], /VITE_LERNE_STANDALONE/);
    assert.match(rootPkg.scripts['build:android'], /cap sync android/);

    const versionProps = read('android/version.properties');
    assert.match(versionProps, /^VERSION_CODE=\d+/m);
    assert.match(versionProps, /^VERSION_NAME=1\.0\.0-offline-pilot/m);

    assert.match(buildGradle, /\.\.\/version\.properties/);
    assert.match(buildGradle, /signingConfigs\s*\{/);
    assert.match(buildGradle, /LERNE_KEYSTORE_PATH/);
    assert.match(buildGradle, /LERNE_KEYSTORE_STORE_PASS/);
    assert.match(buildGradle, /LERNE_KEYSTORE_ALIAS/);
    assert.match(buildGradle, /LERNE_KEYSTORE_KEY_PASS/);
    assert.match(buildGradle, /signingConfig\s+signingConfigs\.release/);
    assert.match(buildGradle, /verifyReleaseSigningConfig/);
    assert.match(buildGradle, /packageRelease.*assembleRelease.*bundleRelease/);

    assert.match(manifest, /android:allowBackup="false"/);
    assert.equal(manifest.includes('android:allowBackup="true"'), false);
    assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
    assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);

    const dataExtractionRules = read('android/app/src/main/res/xml/data_extraction_rules.xml');
    assert.match(dataExtractionRules, /<cloud-backup>/);
    assert.match(dataExtractionRules, /<device-transfer>/);
    assert.match(dataExtractionRules, /app_webview/);
    assert.match(dataExtractionRules, /lerne-offline-media/);

    const backupRules = read('android/app/src/main/res/xml/backup_rules.xml');
    assert.match(backupRules, /<full-backup-content>/);
    assert.match(backupRules, /app_webview/);
    assert.match(backupRules, /lerne-offline-media/);

    const rootGitignoreLines = new Set(read('.gitignore').split(/\r?\n/).map(line => line.trim()));
    for (const pattern of ['*.keystore', '*.jks', '*.p12', 'keystore.properties']) {
      assert.equal(rootGitignoreLines.has(pattern), true, `Missing ${pattern} in root .gitignore`);
    }

    const androidGitignoreLines = new Set(read('android/.gitignore').split(/\r?\n/).map(line => line.trim()));
    assert.equal(androidGitignoreLines.has('*.jks'), true);
    assert.equal(androidGitignoreLines.has('*.keystore'), true);
  });
});
