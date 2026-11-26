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
const { isStandaloneDb } = await import('../cardOfflineQueue.js');
const { ensureStandaloneA2Ownership, STANDALONE_A2_OWNERSHIP_MIGRATION_KEY } = await import('../../pilot/standaloneBootstrap.js');
const { calculateCardReview } = await import('../../utils/srsEngine.js');
const { recoverLocalKnowledgeAttempts, readLocalKnowledgeAttempts } = await import('../localKnowledgeService.js');

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

  test('standalone DB unlocks user folder/deck CRUD and card batch ops while keeping bundled seed decks readonly and zero cloud queues', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));

    const deckId = pack.decks[0].id;
    const cardId = pack.cards[0].id;
    const cfg = { _testDb: db };
    const READ_ONLY_ERR = /только для чтения|лише для перегляду|read-?only/i;

    // Bundled seed decks remain structurally readonly
    const seededDeck = await db.decks.get(deckId);
    assert.equal(seededDeck.is_builtin, true);
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

    // User folders & decks succeed with positive ID > 1_000_000, owner rights, and is_dirty: 0
    const createdFolder = (await offlineApi.handle('post', '/folders', { name: 'My Folder', target_language: 'de' }, cfg)).data;
    assert.ok(createdFolder.id > 1_000_000);
    assert.equal(createdFolder.is_dirty, 0);
    assert.equal(createdFolder.role, 'owner');
    assert.equal(createdFolder.is_owner, true);
    assert.equal(createdFolder.is_global_readonly, false);
    assert.equal(createdFolder.is_builtin, false);
    assert.ok(createdFolder.standalone_origin_key);

    const createdDeck = (await offlineApi.handle('post', '/decks', { name: 'My Deck', folder_id: createdFolder.id, target_language: 'de' }, cfg)).data;
    assert.ok(createdDeck.id > 1_000_000);
    assert.equal(createdDeck.folder_id, createdFolder.id);
    assert.equal(createdDeck.is_dirty, 0);
    assert.equal(createdDeck.role, 'owner');
    assert.equal(createdDeck.is_owner, true);
    assert.equal(createdDeck.is_global_readonly, false);
    assert.equal(createdDeck.is_builtin, false);
    assert.ok(createdDeck.standalone_origin_key);
    assert.ok(createdDeck.standalone_deck_key);

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

    // Card batch-move, batch-copy, multi batch-delete, and cards/reorder all succeed with is_dirty: 0
    const moved = (await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [cardId],
      target_deck_id: 9102,
      revisions: { [cardId]: 2 },
      request_id: 'req-move-allowed',
    }, cfg)).data;
    assert.equal(moved.deck_id, 9102);
    assert.equal(moved.is_dirty, 0);

    const copied = (await offlineApi.handle('post', '/cards/batch-copy', {
      card_ids: [cardId],
      target_deck_id: deckId,
      revisions: { [cardId]: moved.revision },
      request_id: 'req-copy-allowed',
    }, cfg)).data;
    assert.equal(copied.count, 1);
    assert.ok(copied.cards[0].id > 1_000_000);
    assert.equal(copied.cards[0].is_dirty, 0);

    const card2 = await db.cards.get(pack.cards[1].id);
    const card3 = await db.cards.get(pack.cards[2].id);
    const reordered = (await offlineApi.handle('post', '/cards/reorder', {
      card_ids: [card3.id, card2.id],
      revisions: { [card3.id]: card3.revision, [card2.id]: card2.revision },
      request_id: 'req-reorder-allowed',
    }, cfg)).data;
    assert.equal(reordered.cards.length, 2);
    assert.ok(reordered.cards.every(c => c.is_dirty === 0));

    const multiDeleted = (await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [card2.id, card3.id],
      revisions: { [card2.id]: (await db.cards.get(card2.id)).revision, [card3.id]: (await db.cards.get(card3.id)).revision },
      request_id: 'req-del-multi-allowed',
    }, cfg)).data;
    assert.equal(multiDeleted.cards.length, 2);
    assert.ok(multiDeleted.cards.every(c => c.is_deleted === 1 && c.is_dirty === 0));

    const graded = await offlineApi.handle('post', '/study/grade', {
      card_id: cardId,
      grade: 2,
      action_id: 'personal-grade-1',
      include_progress: true,
      return_next: false,
    }, cfg);
    assert.equal(graded.data.graded_progress.repetitions, 1);
    assert.equal((await db.progress.get([cardId, STANDALONE_USER_ID])).is_dirty, 0);

    const flagged = await offlineApi.handle('post', `/cards/${cardId}/flag`, { flag: 3 }, cfg);
    assert.equal(flagged.data.flag, 3);
    assert.equal((await db.progress.get([cardId, STANDALONE_USER_ID])).is_dirty, 0);

    const toggled = await offlineApi.handle('post', `/decks/${deckId}/toggle-learning`, { is_learning: true }, cfg);
    assert.equal(toggled.data.is_learning, true);
    assert.equal((await db.decks.get(deckId)).learning_dirty, 0);

    await offlineApi.handle('post', `/decks/${deckId}/reset`, {}, cfg);
    const resetProgress = await db.progress.get([copied.cards[0].id, STANDALONE_USER_ID]);
    assert.equal(resetProgress.repetitions, 0);
    assert.equal(resetProgress.queue, 'new');
    assert.equal(resetProgress.is_dirty, 0);

    for (const prefix of ['card-create-v2:', 'card-edit-v2:', 'card-move-v2:', 'card-lifecycle-v2:', 'review:']) {
      assert.equal(await db.syncState.where('key').startsWith(prefix).count(), 0, `Unexpected cloud outbox key ${prefix}`);
    }
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

  test('graded local evidence is atomic, recoverable after reopen, and survives a portable backup', async () => {
    const pack = getStandalonePack();
    const userId = STANDALONE_USER_ID;
    const skill = 'de.test.syntax';
    const quiz = pack.cards.find(entry => entry.card.type === 'quiz');
    const theory = pack.cards.find(entry => entry.card.type === 'theory');
    const unmarked = pack.cards.find(entry => entry.card.type === 'standard');
    memStorage.set('lerne_user_id', String(userId));
    await ensureStandaloneSeed({ db, userId, pack });
    await db.card_knowledge_items.bulkAdd([
      { card_id: quiz.id, role: 'primary', knowledge_item_id: skill, complexity: 2, ability: 'recognition' },
      { card_id: quiz.id, role: 'secondary', knowledge_item_id: 'de.test.vocabulary' },
      { card_id: theory.id, role: 'primary', knowledge_item_id: skill },
    ]);
    const exerciseEvidence = {
      isCorrect: true, completed: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0,
      supportEvidence: { hint_count: 0, other_help_count: null, translation_view_count: 1, tracking_complete: false },
      gradingSummary: { final_evaluator: 'rules', final_verdict: 'correct' },
    };
    const submit = (actionId, cardId = quiz.id, grade = 2) => offlineApi.handle('post', '/study/grade',
      { card_id: cardId, action_id: actionId, grade, return_next: false }, { _testDb: db, knowledgeStudy: { exerciseEvidence } });

    const failReceipt = (_key, receipt) => {
      if (receipt.key === 'grade:rollback') throw new Error('Injected grade rollback');
    };
    db.syncState.hook('creating', failReceipt);
    await assert.rejects(() => submit('rollback'), /Injected grade rollback/);
    db.syncState.hook('creating').unsubscribe(failReceipt);
    assert.equal(await db.progress.get([quiz.id, userId]), undefined);
    assert.equal((await readLocalKnowledgeAttempts(db, userId)).length, 0);

    await submit('theory', theory.id);
    await submit('unmarked', unmarked.id);
    await Promise.all([submit('graded'), submit('graded')]);
    assert.equal((await readLocalKnowledgeAttempts(db, userId)).length, 1);
    const first = await db.knowledge_attempt_outbox.get('graded');
    assert.equal(first.knowledge_item_id, skill);
    assert.equal(first.evaluation_data.support.hint_count, 0);
    assert.equal(first.evaluation_data.support.other_help_count, null);
    assert.equal(first.evaluation_data.support.translation_view_count, 1);
    assert.equal(Object.hasOwn(first.evaluation_data.support, 'answer_reveal_count'), false);
    assert.equal(Object.hasOwn(first.evaluation_data.exercise, 'duration_ms'), false);
    const progress = await db.progress.get([quiz.id, userId]);
    await db.syncState.delete('grade:graded');
    await submit('graded');
    assert.deepEqual(await db.progress.get([quiz.id, userId]), progress);
    await assert.rejects(() => submit('graded', quiz.id, 0), /different data/);

    const failEvent = (_key, attempt) => {
      if (attempt.client_event_id === 'recovery') throw new Error('Injected evidence write failure');
    };
    db.knowledge_attempt_outbox.hook('creating', failEvent);
    await submit('recovery');
    const saved = await db.progress.get([quiz.id, userId]);
    assert.ok((await db.syncState.get('grade:recovery')).knowledge_pending);
    assert.equal(await db.knowledge_attempt_outbox.get('recovery'), undefined);
    await assert.rejects(() => exportProgressBackup({ db, userId, pack }), /pending recovery/);
    await submit('recovery');
    assert.deepEqual(await db.progress.get([quiz.id, userId]), saved);
    const name = db.name;
    db.close();
    db = createTestDexie(name);
    await db.open();
    assert.equal(await recoverLocalKnowledgeAttempts(db, userId), 0);
    assert.equal(await recoverLocalKnowledgeAttempts(db, userId), 0);
    assert.equal((await readLocalKnowledgeAttempts(db, userId)).length, 2);
    assert.deepEqual(await db.progress.get([quiz.id, userId]), saved);

    const { backup, json } = await exportProgressBackup({ db, userId, pack });
    assert.equal(backup.integrity.scope, 'full-v3');
    assert.equal(backup.knowledge_attempts.length, 2);
    assert.equal(Object.hasOwn(backup.knowledge_attempts[0], 'card_id'), false);
    const cleaned = createTestDexie('LerneStandaloneDB_KnowledgeRestore');
    try {
      await ensureStandaloneSeed({ db: cleaned, userId, pack });
      const tampered = JSON.parse(json);
      tampered.knowledge_attempts[0].evaluation_data.rating = 0;
      assert.equal((await inspectProgressBackup(JSON.stringify(tampered), { db: cleaned, userId, pack })).code, 'INTEGRITY_MISMATCH');
      const inspection = await inspectProgressBackup(json, { db: cleaned, userId, pack });
      assert.equal(inspection.ok, true);
      assert.equal((await applyProgressBackup(inspection.backup, { db: cleaned, userId, pack })).restoredKnowledgeAttempts, 2);
      assert.equal((await applyProgressBackup(inspection.backup, { db: cleaned, userId, pack })).restoredKnowledgeAttempts, 0);
      const roundtrip = await exportProgressBackup({ db: cleaned, userId, pack });
      assert.deepEqual(roundtrip.backup.knowledge_attempts, backup.knowledge_attempts);
      assert.equal((await cleaned.progress.get([quiz.id, userId])).last_reviewed, saved.last_reviewed);
    } finally {
      await cleaned.delete();
    }
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
    assert.match(manifest, /<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>/);
    assert.equal(manifest.includes('tools:node="remove"'), false);
    assert.match(manifest, /android:usesCleartextTraffic="false"/);
    assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
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
    assert.match(mainActivity, /registerPlugin\(SecureNetworkVaultPlugin\.class\)/);
    assert.match(mainActivity, /registerPlugin\(AndroidSystemTtsPlugin\.class\)/);

    assert.equal(fs.existsSync(path.join(repoRoot, '.github/workflows/android.yml')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, '.github/workflows/checks.yml')), true);

    const rootPkg = JSON.parse(read('package.json'));
    assert.match(rootPkg.scripts['build:android'], /VITE_LERNE_STANDALONE/);
    assert.match(rootPkg.scripts['build:android'], /cap sync android/);

    const versionProps = read('android/version.properties');
    assert.match(versionProps, /^VERSION_CODE=\d+/m);
    assert.match(versionProps, /^VERSION_NAME=1\.\d+\.\d+-offline-pilot/m);

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

  test('standalone folder/deck/trash/clear lifecycle & seed card non-resurrection after trash clear', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));
    const cfg = { _testDb: db };

    // 1. Folder + subfolder + deck + card full lifecycle
    const rootFolder = (await offlineApi.handle('post', '/folders', { name: 'Root F', target_language: 'de' }, cfg)).data;
    const subFolder = (await offlineApi.handle('post', '/folders', { name: 'Sub F', parent_id: rootFolder.id, target_language: 'de' }, cfg)).data;
    const otherFolder = (await offlineApi.handle('post', '/folders', { name: 'Other F', target_language: 'de' }, cfg)).data;
    const userDeck = (await offlineApi.handle('post', '/decks', { name: 'Local Deck', folder_id: subFolder.id, target_language: 'de' }, cfg)).data;
    const otherDeck = (await offlineApi.handle('post', '/decks', { name: 'Other Deck', folder_id: null, target_language: 'de' }, cfg)).data;

    await offlineApi.handle('post', `/folders/${subFolder.id}/rename`, { name: 'Sub F Renamed' }, cfg);
    await offlineApi.handle('post', `/folders/${subFolder.id}/color`, { color: '#10b981' }, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/rename`, { name: 'Local Deck Renamed' }, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/color`, { color: '#ec4899' }, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/pin`, {}, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/move`, { folder_id: rootFolder.id }, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/move`, { folder_id: subFolder.id }, cfg);
    await offlineApi.handle('post', '/folders/reorder', { folder_ids: [otherFolder.id, rootFolder.id] }, cfg);
    await offlineApi.handle('post', '/decks/reorder', { deck_ids: [otherDeck.id, userDeck.id] }, cfg);

    assert.equal((await db.folders.get(subFolder.id)).name, 'Sub F Renamed');
    assert.equal((await db.folders.get(subFolder.id)).color, '#10b981');
    assert.equal((await db.decks.get(userDeck.id)).name, 'Local Deck Renamed');
    assert.equal((await db.decks.get(userDeck.id)).is_pinned, true);
    assert.equal((await db.decks.get(userDeck.id)).is_dirty, 0);

    const userCard = (await offlineApi.handle('post', '/cards/save', {
      deck_id: userDeck.id,
      request_id: 'lifecycle-card-1',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'LifecycleWort', answer: 'Слово' } } },
    }, cfg)).data;

    // Delete rootFolder -> hides entire subtree across all read endpoints
    await offlineApi.handle('delete', `/folders/${rootFolder.id}`, null, cfg);
    const initAfterDel = (await offlineApi.handle('get', '/init', null, cfg)).data;
    assert.equal(initAfterDel.folders.some(f => f.id === rootFolder.id || f.id === subFolder.id), false);
    assert.equal(initAfterDel.decks.some(d => d.id === userDeck.id), false);
    assert.equal((await offlineApi.handle('get', '/decks', null, cfg)).data.some(d => d.id === userDeck.id), false);
    assert.equal((await offlineApi.handle('get', '/folders', null, cfg)).data.some(f => f.id === rootFolder.id), false);
    assert.deepEqual((await offlineApi.handle('get', '/cards/search?q=LifecycleWort', null, cfg)).data.cards, []);
    const statsAfterDel = (await offlineApi.handle('get', '/study/stats', null, cfg)).data;
    assert.equal(statsAfterDel.total_cards, pack.cards.length);

    // Pre-delete userDeck while root is active? Restore rootFolder first, then delete userDeck, then delete rootFolder to test parent_deleted
    await offlineApi.handle('post', `/trash/folder/${rootFolder.id}/restore`, null, cfg);
    await offlineApi.handle('delete', `/decks/${userDeck.id}`, null, cfg);
    await offlineApi.handle('delete', `/folders/${rootFolder.id}`, null, cfg);
    const trashData = (await offlineApi.handle('get', '/trash', null, cfg)).data;
    assert.equal(trashData.folders.find(f => f.id === rootFolder.id).parent_deleted, false);
    assert.equal(trashData.decks.find(d => d.id === userDeck.id).parent_deleted, true);
    await assert.rejects(
      () => offlineApi.handle('post', `/trash/deck/${userDeck.id}/restore`, null, cfg),
      err => err?.response?.status === 409 && err?.response?.data?.detail?.code === 'parent_folder_deleted',
    );

    // Restore folder & deck -> visible again -> delete again -> DELETE /trash/clear -> hard-deleted
    await offlineApi.handle('post', `/trash/folder/${rootFolder.id}/restore`, null, cfg);
    await offlineApi.handle('post', `/trash/deck/${userDeck.id}/restore`, null, cfg);
    assert.equal((await offlineApi.handle('get', '/decks', null, cfg)).data.some(d => d.id === userDeck.id), true);

    await offlineApi.handle('delete', `/folders/${rootFolder.id}`, null, cfg);
    await offlineApi.handle('delete', '/trash/clear', null, cfg);
    assert.equal(await db.folders.get(rootFolder.id), undefined);
    assert.equal(await db.folders.get(subFolder.id), undefined);
    assert.equal(await db.decks.get(userDeck.id), undefined);
    assert.equal(await db.cards.get(userCard.id), undefined);
    assert.equal(await db.syncState.get(`deck-cards:${userDeck.id}`), undefined);

    // 2. Seed card trash clear -> hard_deleted_locally tombstone prevents ensureStandaloneSeed resurrection
    const seedCard = pack.cards[0];
    await offlineApi.handle('post', '/study/grade', {
      card_id: seedCard.id, grade: 2, action_id: 'grade-seed-before-clear', return_next: false,
    }, cfg);
    await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [seedCard.id],
      revisions: { [seedCard.id]: 1 },
      request_id: 'del-seed-card-for-clear',
    }, cfg);
    assert.equal((await offlineApi.handle('get', '/trash', null, cfg)).data.cards.some(c => c.id === seedCard.id), true);

    await offlineApi.handle('delete', '/trash/clear', null, cfg);
    const clearedSeedCard = await db.cards.get(seedCard.id);
    assert.equal(clearedSeedCard.is_deleted, 1);
    assert.equal(clearedSeedCard.hard_deleted_locally, true);
    assert.equal(clearedSeedCard.standalone_local_edit, true);
    assert.equal(clearedSeedCard.is_dirty, 0);
    assert.equal(await db.progress.get([seedCard.id, STANDALONE_USER_ID]), undefined);

    // Simulate APK seed upgrade -> seedCard stays deleted and is NOT resurrected
    const v2Specs = pack.decks.map(d => ({
      id: d.id,
      slug: d.slug,
      targetLanguage: d.targetLanguage,
      color: d.color,
      position: d.position,
      cardIdBase: d.id === 9101 ? 910100 : d.id === 9102 ? 910200 : 910300,
      document: structuredClone(d.document),
    }));
    v2Specs[0].document.cards[0].explanation = 'Should not resurrect';
    const v2Pack = buildStandalonePack({ packVersion: 2, deckSpecs: v2Specs });
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack: v2Pack });
    const afterSeedUpgrade = await db.cards.get(seedCard.id);
    assert.equal(afterSeedUpgrade.is_deleted, 1);
    assert.equal(afterSeedUpgrade.hard_deleted_locally, true);

    for (const prefix of ['card-create-v2:', 'card-edit-v2:', 'card-move-v2:', 'card-lifecycle-v2:', 'review:']) {
      assert.equal(await db.syncState.where('key').startsWith(prefix).count(), 0);
    }
  });

  test('Option A2 one-time ownership migration upgrades legacy imported folders/decks while preserving seed readonly', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });

    // Simulate legacy pre-A2 imported folder and deck stored as viewer / is_global_readonly
    await db.folders.put({
      id: 1000010,
      user_id: STANDALONE_USER_ID,
      parent_id: null,
      name: 'Legacy Imported Folder',
      role: 'viewer',
      is_owner: false,
      is_global_readonly: true,
      standalone_origin_key: 'archive:Supabase:' + 'a'.repeat(64) + ':folder:1',
    });
    await db.decks.put({
      id: 1000020,
      user_id: STANDALONE_USER_ID,
      folder_id: 1000010,
      name: 'Legacy Imported Deck',
      role: 'viewer',
      is_owner: false,
      is_global_readonly: true,
      standalone_origin_key: 'archive:Supabase:' + 'a'.repeat(64) + ':deck:1',
      standalone_deck_key: 'archive:Supabase:' + 'a'.repeat(64) + ':deck:1',
    });

    const first = await ensureStandaloneA2Ownership(db);
    assert.equal(first.migrated, true);
    assert.equal(first.migratedFolders, 1);
    assert.equal(first.migratedDecks, 1);
    assert.equal((await db.syncState.get(STANDALONE_A2_OWNERSHIP_MIGRATION_KEY))?.completed, true);

    const upgradedFolder = await db.folders.get(1000010);
    assert.equal(upgradedFolder.role, 'owner');
    assert.equal(upgradedFolder.is_owner, true);
    assert.equal(upgradedFolder.is_global_readonly, false);
    assert.equal(upgradedFolder.is_builtin, false);

    const upgradedDeck = await db.decks.get(1000020);
    assert.equal(upgradedDeck.role, 'owner');
    assert.equal(upgradedDeck.is_owner, true);
    assert.equal(upgradedDeck.is_global_readonly, false);
    assert.equal(upgradedDeck.is_builtin, false);

    // Seed decks remain structurally readonly
    const seedDeck = await db.decks.get(9101);
    assert.equal(seedDeck.role, 'viewer');
    assert.equal(seedDeck.is_global_readonly, true);
    assert.equal(seedDeck.is_builtin, true);

    // Idempotent on second run
    const second = await ensureStandaloneA2Ownership(db);
    assert.equal(second.migrated, false);
  });

  test('Web non-standalone DB preserves negative temp IDs, is_dirty: 1, and cloud outbox keys', async () => {
    const webUserId = 777;
    memStorage.set('lerne_user_id', String(webUserId));
    const webDb = createTestDexie(`LerneLocalDB_Regression_${dbCounter}`);
    await webDb.open();
    assert.equal(isStandaloneDb(webDb), false);

    const cfg = { _testDb: webDb };
    const createdFolder = (await offlineApi.handle('post', '/folders', { name: 'Web Folder', target_language: 'de' }, cfg)).data;
    const createdDeck = (await offlineApi.handle('post', '/decks', { name: 'Web Deck', folder_id: createdFolder.id, target_language: 'de' }, cfg)).data;
    assert.ok(createdFolder.id < 0);
    assert.equal(createdFolder.is_dirty, 1);
    assert.ok(createdDeck.id < 0);
    assert.equal(createdDeck.is_dirty, 1);

    // Seed a positive synced deck + card for Web offline card queue mutations
    await webDb.decks.put({ id: 50, user_id: webUserId, folder_id: null, name: 'Synced Deck', role: 'owner', is_deleted: 0, is_dirty: 0 });
    await webDb.decks.put({ id: 51, user_id: webUserId, folder_id: null, name: 'Target Deck', role: 'owner', is_deleted: 0, is_dirty: 0 });
    await webDb.cards.put({
      id: 500,
      deck_id: 50,
      position: 0,
      revision: 1,
      is_deleted: 0,
      is_dirty: 0,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'WebPrompt', answer: 'WebAns' } } },
    });
    await webDb.cards.put({
      id: 501,
      deck_id: 50,
      position: 1,
      revision: 1,
      is_deleted: 0,
      is_dirty: 0,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'WebPrompt2', answer: 'WebAns2' } } },
    });

    const createdCard = (await offlineApi.handle('post', '/cards/save', {
      deck_id: 50,
      request_id: 'web-create-1',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'NewWeb', answer: 'Ans' } } },
    }, cfg)).data;
    assert.ok(createdCard.id < 0);
    assert.equal(createdCard.offline_create_status, 'pending');
    assert.ok(await webDb.syncState.get('card-create-v2:web-create-1'));

    const editedCard = (await offlineApi.handle('patch', '/cards/500', {
      request_id: 'web-edit-1',
      revision: 1,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'EditedWeb', answer: 'Ans' } } },
    }, { _testDb: webDb, offlineCardEdit: true })).data;
    assert.equal(editedCard.offline_edit?.status, 'pending');
    assert.ok(await webDb.syncState.get('card-edit-v2:500'));

    await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [501],
      target_deck_id: 51,
      revisions: { 501: 1 },
      request_id: 'web-move-1',
    }, cfg);
    assert.ok(await webDb.syncState.get('card-move-v2:501'));

    await webDb.cards.put({
      id: 502,
      deck_id: 50,
      position: 2,
      revision: 1,
      is_deleted: 0,
      is_dirty: 0,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'WebDel', answer: 'Ans' } } },
    });
    await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [502],
      revisions: { 502: 1 },
      request_id: 'web-del-1',
    }, cfg);
    assert.ok(await webDb.syncState.get('card-lifecycle-v2:502'));

    await offlineApi.handle('post', '/study/grade', {
      card_id: 502,
      grade: 2,
      action_id: 'web-grade-1',
      return_next: false,
    }, { _testDb: webDb }).catch(() => {});
    // Grade on active card 500
    await offlineApi.handle('post', '/study/grade', {
      card_id: 500,
      grade: 2,
      action_id: 'web-grade-active',
      return_next: false,
    }, cfg);
    assert.ok(await webDb.syncState.get('grade:web-grade-active'));
    assert.ok(await webDb.syncState.get('review:web-grade-active'));
    assert.equal((await webDb.progress.get([500, webUserId])).is_dirty, 1);

    await assert.rejects(() => offlineApi.handle('delete', '/trash/clear', null, cfg), err => err?.code === 'OFFLINE_UNSUPPORTED');
    await webDb.delete();
  });
});
