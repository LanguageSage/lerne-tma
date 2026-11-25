import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';
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
  globalThis.window = {
    location: { search: '', hostname: 'localhost', port: '', origin: 'https://localhost' },
    Capacitor: null,
  };
}

mock.module('../../utils/standaloneMode.js', {
  namedExports: {
    IS_STANDALONE: true,
    STANDALONE_APPLICATION_ID: 'com.lerne.offlinepilot',
    STANDALONE_USER_ID: 900001,
    STANDALONE_SESSION_IDENTITY: 'standalone-offline-pilot',
    STANDALONE_DB_PREFIX: 'LerneStandaloneDB',
    STANDALONE_SEED_DECK_IDS: new Set([9101, 9102, 9103]),
    STANDALONE_PROFILE_NAME_KEY: 'lerne_standalone_profile_name',
    getStandaloneProfileName: () => memStorage.get('lerne_standalone_profile_name') || 'Offline Pilot',
    saveStandaloneProfileName: (name) => {
      const normalized = typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : 'Offline Pilot';
      memStorage.set('lerne_standalone_profile_name', normalized);
      return normalized;
    },
    getStandaloneProfile: () => ({
      user_id: 900001,
      first_name: memStorage.get('lerne_standalone_profile_name') || 'Offline Pilot',
      username: 'offline_pilot',
      is_guest: false,
      active_language: 'de',
      has_selected_language: true,
      is_standalone: true,
    }),
  },
});

const { isOfflineMediaUrl, resolveOfflineMediaUrlSync, clearOfflineMediaCache } = await import('../../pilot/offlineMediaResolver.js');
mock.module('../apiConfig.js', {
  namedExports: {
    API_BASE_URL: '/api',
    mediaURL: (path, kind = 'images') => {
      if (!path) return null;
      if (isOfflineMediaUrl(path)) return path;
      return resolveOfflineMediaUrlSync(path, kind);
    },
  },
});

const { sha256Hex, sha256BytesHex } = await import('../../pilot/sha256.js');
const { buildZipArchive, computeCrc32 } = await import('../../pilot/zipCodec.js');
const { validateNativeV2Content } = await import('../../utils/nativeV2Contract.js');
const {
  STANDALONE_MAX_CARD_OP_RECEIPTS,
} = await import('../cardOfflineQueue.js');
const { ID_COUNTERS_KEY, IMPORTED_ID_START } = await import('../../pilot/materialArchiveIdentity.js');
const { storeLocalMediaFile } = await import('../../pilot/localMediaWriter.js');
const {
  MATERIAL_ARCHIVE_FORMAT,
} = await import('../../pilot/materialArchive.js');
const {
  inspectArchiveWebBytes,
  confirmArchiveImport,
  buildWebArchiveZipBytes,
} = await import('../../pilot/materialArchiveTransport.js');
const {
  clearOfflineMediaCache: clearStoreCache,
  readWebMediaAssetBytes,
} = await import('../../pilot/offlineMediaStore.js');
const { buildStandalonePack, getStandalonePack } = await import('../../pilot/standalonePack.js');
const { ensureStandaloneSeed } = await import('../../pilot/standaloneSeed.js');
const {
  exportProgressBackup,
  inspectProgressBackup,
  applyProgressBackup,
} = await import('../../pilot/progressBackup.js');
const { offlineApi } = await import('../offlineApi.js');
const { calculateCardReview } = await import('../../utils/srsEngine.js');

const STANDALONE_USER_ID = 900001;

function createStandaloneTestDb(name) {
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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(computeCrc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function makePngBytes(width = 2, height = 2, r = 100, g = 50, b = 210) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const base = y * rowSize;
    raw[base] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }
  return new Uint8Array(Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeWavBytes(sampleCount = 400) {
  const dataSize = sampleCount * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return new Uint8Array(buf);
}

function assetRecord(bytes, folder, ext, mime) {
  const sha = sha256BytesHex(bytes);
  return {
    sha256: sha,
    folder,
    filename: `archive_${sha}${ext}`,
    mime,
    size: bytes.length,
    path: `media/${sha}${ext}`,
    bytes,
  };
}

function buildArchiveZipFromDoc(document, mediaAssets = []) {
  const manifestJson = JSON.stringify(document);
  const manifestSha = sha256Hex(manifestJson);
  const encoder = new TextEncoder();
  return buildZipArchive([
    { name: 'manifest.json', data: encoder.encode(manifestJson) },
    { name: 'manifest.sha256', data: encoder.encode(manifestSha) },
    ...mediaAssets.map(asset => ({ name: asset.path, data: asset.bytes })),
  ]);
}

const sampleCardsAll9 = () => [
  { type: 'standard', data: { prompt: 'der Tisch', answer: 'стол' }, level: 'A1', explanation: 'мужской род', topics: ['Möbel'] },
  { type: 'theory', data: { text: '**Artikeln** im Nominativ', summary: 'Кратко: der / die / das' }, level: 'A1' },
  {
    type: 'trainer',
    data: {
      back_note: 'Глагол haben',
      parts: [
        { type: 'text', text: 'Ich ' },
        { type: 'input', answers: ['habe', 'hätte'] },
        { type: 'text', text: ' ein ' },
        { type: 'choice', options: [{ text: 'Buch', correct: true }, { text: 'Bücher', correct: false }] },
      ],
    },
  },
  {
    type: 'quiz',
    data: {
      prompt: 'Wie geht es dir?',
      back_note: 'Повседневная фраза',
      options: [
        { text: 'Danke, gut!', correct: true },
        { text: 'Auf Wiedersehen', correct: false },
      ],
    },
  },
  {
    type: 'match',
    data: {
      back_note: 'Переведите пары',
      pairs: [
        { left: 'groß', right: 'большой' },
        { left: 'klein', right: 'маленький' },
      ],
    },
  },
  { type: 'puzzle', data: { tokens: ['Wir', 'lernen', 'Deutsch'], translation: 'Мы учим немецкий' } },
  {
    type: 'word_bank',
    data: {
      options: ['heute', 'morgen'],
      parts: [
        { type: 'text', text: 'Ich komme ' },
        { type: 'gap', option: 0 },
        { type: 'text', text: '.' },
      ],
    },
  },
  {
    type: 'free_text',
    data: {
      prompt: 'Schreiben Sie einen Satz über das Wetter.',
      sample_answer: 'Heute scheint die Sonne.',
      accepted_answers: ['Es ist sonnig heute.'],
      grading_policy: { mode: 'open_text', max_retries: 2, typo_tolerance: true },
    },
  },
  {
    type: 'editable_text',
    data: {
      source_text: 'Er gehen zur Arbeit.',
      correct_text: 'Er geht zur Arbeit.',
      accepted_answers: ['Er geht heute zur Arbeit.'],
      grading_policy: { mode: 'controlled_text', max_retries: 3, grammar_requires_retry: true },
    },
  },
];

async function assertZeroCloudQueue(db) {
  const syncKeys = (await db.syncState.toArray()).map(row => row.key);
  for (const prefix of ['card-create-v2:', 'card-edit-v2:', 'card-lifecycle-v2:', 'review:']) {
    assert.equal(syncKeys.some(k => k.startsWith(prefix)), false, `Forbidden cloud queue key prefix: ${prefix}`);
  }
  const dirtyCards = await db.cards.filter(c => Number(c.is_dirty || 0) !== 0).count();
  const dirtyDecks = await db.decks.filter(d => Number(d.is_dirty || 0) !== 0).count();
  assert.equal(dirtyCards, 0);
  assert.equal(dirtyDecks, 0);
}

describe('standalone card authoring, media, re-import protection, and ZIP export', () => {
  let dbCounter = 0;
  let db;

  beforeEach(async () => {
    dbCounter += 1;
    memStorage.clear();
    clearOfflineMediaCache();
    clearStoreCache();
    db = createStandaloneTestDb(`LerneStandaloneDB_Editor_${dbCounter}`);
    await db.open();
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));
    memStorage.set('native_language', 'ru');
  });

  test('validateNativeV2Content accepts all 9 types and enforces canonical Native V2 constraints', () => {
    for (const card of sampleCardsAll9()) {
      validateNativeV2Content({ schema_version: 2, card });
    }

    assert.throws(() => validateNativeV2Content(null), /Expected object/);
    assert.throws(() => validateNativeV2Content({ schema_version: 2, card: { type: 'unknown', data: {} } }), /card.type/);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: { type: 'standard', data: { prompt: 'A\0B', answer: 'C' } },
    }, { writable: true }), /Unicode/i);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: { type: 'standard', data: { prompt: 'x', extra: 'y' } },
    }), /card.data.extra/i);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: { type: 'standard', data: { prompt: 'x'.repeat(260 * 1024), answer: 'y' } },
    }), /UTF-8 JSON/i);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: {
        type: 'editable_text',
        data: { source_text: 'gleich', correct_text: 'gleich' },
      },
    }), /source and correction must differ/i);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: {
        type: 'editable_text',
        data: { source_text: 'alt', correct_text: 'neu', grading_policy: { mode: 'open_text' } },
      },
    }), /controlled_text|exact/i);
    assert.throws(() => validateNativeV2Content({
      schema_version: 2,
      card: {
        type: 'standard',
        data: { prompt: 'x', answer: 'y' },
        info: [{ type: 'task', text: 'do' }],
        layout: [{ id: 'ex', type: 'exercise' }],
      },
    }), /layout/i);
  });

  test('creates and edits all 9 Native V2 types on readonly decks, preserves origin, placement and idempotency', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    const deckId = pack.decks[0].id;
    const cfg = { _testDb: db };

    const deckBefore = await db.decks.get(deckId);
    const createdIds = [];
    for (const [idx, card] of sampleCardsAll9().entries()) {
      const res = await offlineApi.handle('post', '/cards/save', {
        deck_id: deckId,
        request_id: `req-all9-${idx}`,
        content_v2: { schema_version: 2, card },
      }, cfg);
      assert.ok(res.data.id > IMPORTED_ID_START);
      assert.equal(res.data.content_v2.card.type, card.type);
      assert.equal(res.data.standalone_local_created, true);
      createdIds.push(res.data.id);
    }

    assert.equal(new Set(createdIds).size, 9);
    for (let i = 1; i < createdIds.length; i += 1) {
      assert.ok(createdIds[i] > createdIds[i - 1], 'IDs must strictly increase');
    }
    const counterState = await db.syncState.get(ID_COUNTERS_KEY);
    assert.ok(counterState.card >= createdIds[createdIds.length - 1]);

    const deckAfter = await db.decks.get(deckId);
    assert.equal(deckAfter.role, deckBefore.role);
    assert.equal(deckAfter.is_global_readonly, deckBefore.is_global_readonly);
    assert.equal(deckAfter.standalone_source, deckBefore.standalone_source);

    const replaySame = await offlineApi.handle('post', '/cards/save', {
      deck_id: deckId,
      request_id: 'req-all9-0',
      content_v2: { schema_version: 2, card: sampleCardsAll9()[0] },
    }, cfg);
    assert.equal(replaySame.data.id, createdIds[0]);

    await assert.rejects(
      offlineApi.handle('post', '/cards/save', {
        deck_id: deckId,
        request_id: 'req-all9-0',
        content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'mutated', answer: 'нет' } } },
      }, cfg),
      /request changed/
    );

    for (const [index, card] of sampleCardsAll9().entries()) {
      const cardId = createdIds[index];
      const content_v2 = { schema_version: 2, card: { ...card, explanation: `Edited ${card.type}` } };
      const updated = await offlineApi.handle('patch', `/cards/${cardId}`, {
        request_id: `edit-all9-${index}`, revision: 1, content_v2,
      }, cfg);
      assert.equal(updated.data.revision, 2);
      assert.deepEqual((await db.cards.get(cardId)).content_v2, content_v2);
    }

    const anchorCardId = createdIds[0];
    const insertedRes = await offlineApi.handle('post', '/cards/save', {
      deck_id: deckId,
      after_card_id: anchorCardId,
      request_id: 'req-after-anchor',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'inserted', answer: 'вставлено' } } },
    }, cfg);

    const listed = (await offlineApi.handle('get', `/decks/${deckId}/cards`, null, cfg)).data;
    const anchorPosIdx = listed.findIndex(c => c.id === anchorCardId);
    assert.equal(listed[anchorPosIdx + 1].id, insertedRes.data.id);
    assert.ok(listed.every(c => Number.isInteger(c.position)), 'All card positions must remain integers');

    await assertZeroCloudQueue(db);
  });

  test('allocates unique IDs above imported and deleted rows and the persistent counter', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    const deckId = pack.decks[0].id;
    const highestImportedId = IMPORTED_ID_START + 50;
    await db.cards.add({ id: highestImportedId, deck_id: deckId, is_deleted: 1 });
    await db.syncState.put({ key: ID_COUNTERS_KEY, card: highestImportedId - 1 });

    const create = request_id => offlineApi.handle('post', '/cards/save', {
      deck_id: deckId, request_id, content_v2: { schema_version: 2, card: sampleCardsAll9()[0] },
    }, { _testDb: db });
    const concurrent = await Promise.all([create('allocate-a'), create('allocate-b')]);
    assert.deepEqual(concurrent.map(result => result.data.id).sort((a, b) => a - b),
      [highestImportedId + 1, highestImportedId + 2]);
    await db.syncState.put({ key: ID_COUNTERS_KEY, card: highestImportedId + 10 });
    assert.equal((await create('allocate-c')).data.id, highestImportedId + 11);
  });

  test('concurrent edits only commit one revision and the winning request can replay', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    const original = await db.cards.get(pack.cards[0].id);
    const bodies = ['first edit', 'second edit'].map((explanation, index) => ({
      request_id: `concurrent-edit-${index}`,
      revision: original.revision,
      content_v2: { ...original.content_v2, card: { ...original.content_v2.card, explanation } },
    }));
    const edit = body => offlineApi.handle('patch', `/cards/${original.id}`, body, { _testDb: db });
    const results = await Promise.allSettled(bodies.map(edit));
    const winner = results.findIndex(result => result.status === 'fulfilled');
    assert.notEqual(winner, -1);
    const loser = 1 - winner;
    assert.equal(results[loser].status, 'rejected');
    assert.equal(results[loser].reason.response?.status, 409);
    assert.equal(results[loser].reason.response.data.detail.code, 'card_revision_conflict');
    const saved = await db.cards.get(original.id);
    assert.equal(saved.revision, original.revision + 1);
    assert.deepEqual(saved.content_v2, bodies[winner].content_v2);
    assert.equal(await db.syncState.get(`standalone-card-op:${bodies[loser].request_id}`), undefined);

    const replay = await edit(bodies[winner]);
    assert.equal(replay.data.revision, saved.revision);
    assert.deepEqual(await db.cards.get(original.id), saved);
    await assert.rejects(edit({ ...bodies[loser], revision: undefined }), error => error.response?.status === 409);
    await assertZeroCloudQueue(db);
  });

  test('edits preserve SRS & unchanged layout, reject layout mutations, prune receipts, and delete cleanly', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    const deckId = pack.decks[0].id;
    const cfg = { _testDb: db, offlineCardEdit: true };

    const seedCard = await db.cards.get(pack.cards[0].id);
    const srsProgress = {
      ...calculateCardReview({
        card_id: seedCard.id,
        user_id: STANDALONE_USER_ID,
        queue: 'review',
        step_index: 0,
        interval: 6,
        ease_factor: 2.6,
        repetitions: 3,
        lapses: 1,
      }, 2, false, 'scheduled', new Date('2026-11-20T08:00:00.000Z')),
      flag: 2,
    };
    await db.progress.put(srsProgress);

    const cardWithLayoutId = IMPORTED_ID_START + 50;
    const originalLayout = [
      { id: 'info_0', type: 'info', index: 0, visibility: 'before_answer' },
      { id: 'ex_0', type: 'exercise' },
    ];
    await db.cards.put({
      id: cardWithLayoutId,
      deck_id: deckId,
      position: 500,
      target_language: 'de',
      revision: 1,
      is_deleted: 0,
      is_dirty: 0,
      content_v2: {
        schema_version: 2,
        card: {
          type: 'standard',
          data: { prompt: 'Alt', answer: 'старый' },
          info: [{ type: 'task', text: 'Читайте' }],
          layout: originalLayout,
        },
      },
    });

    await assert.rejects(
      offlineApi.handle('post', '/cards/save', {
        deck_id: deckId,
        request_id: 'req-create-with-layout',
        content_v2: {
          schema_version: 2,
          card: {
            type: 'standard',
            data: { prompt: 'New', answer: 'Ans' },
            layout: [{ id: 'ex', type: 'exercise' }],
          },
        },
      }, cfg),
      /layout|макета/i
    );

    const editBeforeCount = await db.cards.count();
    const editSeedRes = await offlineApi.handle('patch', `/cards/${seedCard.id}`, {
      request_id: 'req-edit-seed-1',
      revision: seedCard.revision,
      content_v2: {
        schema_version: 2,
        card: { type: 'standard', data: { prompt: 'Geändert', answer: 'изменено' } },
      },
    }, { _testDb: db, offlineCardEdit: true, standaloneFlag: 4 });
    assert.equal(await db.cards.count(), editBeforeCount);
    assert.equal(editSeedRes.data.content_v2.card.data.prompt, 'Geändert');

    const progressAfter = await db.progress.get([seedCard.id, STANDALONE_USER_ID]);
    assert.equal(progressAfter.interval, srsProgress.interval);
    assert.equal(progressAfter.repetitions, srsProgress.repetitions);
    assert.equal(progressAfter.ease_factor, srsProgress.ease_factor);
    assert.equal(progressAfter.next_review, srsProgress.next_review);
    assert.equal(progressAfter.flag, 4);

    const editLayoutValid = await offlineApi.handle('patch', `/cards/${cardWithLayoutId}`, {
      request_id: 'req-edit-layout-keep',
      revision: 1,
      content_v2: {
        schema_version: 2,
        card: {
          type: 'standard',
          data: { prompt: 'Neu', answer: 'новый' },
          info: [{ type: 'task', text: 'Новый текст блока' }],
          layout: structuredClone(originalLayout),
        },
      },
    }, cfg);
    assert.deepEqual(editLayoutValid.data.content_v2.card.layout, originalLayout);

    await assert.rejects(
      offlineApi.handle('patch', `/cards/${cardWithLayoutId}`, {
        request_id: 'req-edit-layout-reordered',
        revision: 2,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'standard',
            data: { prompt: 'Neu', answer: 'новый' },
            info: [{ type: 'task', text: 'Новый текст блока' }],
            layout: [
              { id: 'ex_0', type: 'exercise' },
              { id: 'info_0', type: 'info', index: 0, visibility: 'before_answer' },
            ],
          },
        },
      }, cfg),
      /layout|макета/i
    );

    await assert.rejects(
      offlineApi.handle('patch', `/cards/${cardWithLayoutId}`, {
        request_id: 'req-edit-layout-removed',
        revision: 2,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'standard',
            data: { prompt: 'Neu', answer: 'новый' },
            info: [{ type: 'task', text: 'Новый текст блока' }],
          },
        },
      }, cfg),
      /layout|макета/i
    );

    const createdList = [];
    for (let i = 0; i < 70; i += 1) {
      const c = await offlineApi.handle('post', '/cards/save', {
        deck_id: deckId,
        request_id: `prune-op-${i}`,
        content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: `P${i}`, answer: `A${i}` } } },
      }, cfg);
      createdList.push(c.data.id);
    }
    const opCount = await db.syncState.where('key').startsWith('standalone-card-op:').count();
    assert.equal(opCount, STANDALONE_MAX_CARD_OP_RECEIPTS);

    const delRes = await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [createdList[0]],
      request_id: 'del-single-1',
    }, cfg);
    assert.equal(delRes.data.is_deleted, 1);
    const delReplay = await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [createdList[0]],
      request_id: 'del-single-1',
    }, cfg);
    assert.equal(delReplay.data.is_deleted, 1);

    const visibleAfterDelete = (await offlineApi.handle('get', `/decks/${deckId}/cards`, null, cfg)).data;
    assert.equal(visibleAfterDelete.some(c => c.id === createdList[0]), false);

    await assertZeroCloudQueue(db);
  });

  test('local media attachment, ZIP re-import protection, bundled seed protection, full round-trip export, and full-v2 backup', async () => {
    const pngBytes = makePngBytes(4, 4, 20, 120, 200);
    const wavBytes = makeWavBytes(300);
    const importedAsset = assetRecord(pngBytes, 'images', '.png', 'image/png');
    const sourceIdentity = `Supabase:${'b'.repeat(64)}`;
    const sourceDoc = {
      format: MATERIAL_ARCHIVE_FORMAT,
      version: 4,
      source: sourceIdentity,
      source_users: [{ id: 7, name: 'Teacher', username: 'teacher' }],
      content: {
        folder: [{ id: 1, author: 7, values: { name: 'A1 Folder', color: '#4f46e5', target_language: 'de', position: 0, is_deleted: false, parent_id: null } }],
        deck: [{ id: 10, author: 7, values: { name: 'Imported Deck', level: 'A1', topic: null, target_language: 'de', position: 0, is_deleted: false, folder_id: 1, metadata: null, scope: 'personal', category_id: null, is_default: false } }],
        card: [
          {
            id: 101,
            author: 7,
            values: {
              content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Orig 1', answer: 'Ориг 1' }, image: `archive://${importedAsset.sha256}` } },
              image_path: `archive://${importedAsset.sha256}`,
              audio_path: null,
              audio_back_path: null,
              video_front_path: null,
              video_back_path: null,
              difficulty: null,
              source: 'user',
              position: 0,
              is_deleted: false,
              deck_id: 10,
            },
          },
          {
            id: 102,
            author: 7,
            values: {
              content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Orig 2', answer: 'Ориг 2' } } },
              image_path: null,
              audio_path: null,
              audio_back_path: null,
              video_front_path: null,
              video_back_path: null,
              difficulty: null,
              source: 'user',
              position: 1,
              is_deleted: false,
              deck_id: 10,
            },
          },
          {
            id: 103,
            author: 7,
            values: {
              content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Orig 3', answer: 'Ориг 3' } } },
              image_path: null,
              audio_path: null,
              audio_back_path: null,
              video_front_path: null,
              video_back_path: null,
              difficulty: null,
              source: 'user',
              position: 2,
              is_deleted: false,
              deck_id: 10,
            },
          },
        ],
      },
      assets: [{
        sha256: importedAsset.sha256,
        folder: importedAsset.folder,
        filename: importedAsset.filename,
        mime: importedAsset.mime,
        size: importedAsset.size,
        path: importedAsset.path,
      }],
    };

    const zipV1 = await buildArchiveZipFromDoc(sourceDoc, [importedAsset]);
    const pendingV1 = await inspectArchiveWebBytes(zipV1, 'v1.zip', { db });
    assert.equal(pendingV1.ok, true, pendingV1.error);
    await confirmArchiveImport(pendingV1, { db });

    const importedDeck = (await db.decks.filter(d => d.name === 'Imported Deck').toArray())[0];
    const importedCards = (await db.cards.where('deck_id').equals(importedDeck.id).sortBy('position'));
    assert.equal(importedCards.length, 3);
    const [card1, card2, card3] = importedCards;

    await offlineApi.handle('patch', `/cards/${card1.id}`, {
      request_id: 'edit-imp-1',
      revision: card1.revision,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Local Edit 1', answer: 'Локальная правка' } } },
      image_path: null,
    }, { _testDb: db, offlineCardEdit: true });

    await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [card2.id],
      request_id: 'del-imp-2',
    }, { _testDb: db });

    const updatedDoc = structuredClone(sourceDoc);
    updatedDoc.content.card[0].values.content_v2.card.data.prompt = 'Server V2 Should Not Overwrite 1';
    updatedDoc.content.card[1].values.content_v2.card.data.prompt = 'Server V2 Should Not Resurrect 2';
    updatedDoc.content.card[2].values.content_v2.card.data.prompt = 'Server V2 Updated 3';
    const zipV2 = await buildArchiveZipFromDoc(updatedDoc, [importedAsset]);

    const pendingV2 = await inspectArchiveWebBytes(zipV2, 'v2.zip', { db });
    assert.equal(pendingV2.ok, true, pendingV2.error);
    assert.equal(pendingV2.inspection.preview.protectedCards, 2);
    assert.equal(pendingV2.inspection.preview.updatedCards, 1);

    const appliedV2 = await confirmArchiveImport(pendingV2, { db });
    assert.equal(appliedV2.protectedCards, 2);
    assert.equal(appliedV2.updatedCards, 1);

    assert.equal((await db.cards.get(card1.id)).content_v2.card.data.prompt, 'Local Edit 1');
    assert.equal((await db.cards.get(card2.id)).is_deleted, 1);
    assert.equal((await db.cards.get(card3.id)).content_v2.card.data.prompt, 'Server V2 Updated 3');

    const imgFile = new Blob([makePngBytes(6, 6, 250, 10, 40)], { type: 'image/png' });
    const wavFile = new Blob([wavBytes], { type: 'audio/wav' });
    const storedImg = await storeLocalMediaFile(imgFile, 'images', { db });
    const storedAudio = await storeLocalMediaFile(wavFile, 'audio', { db });
    assert.match(storedImg.path, /^\/api\/media\/images\/archive_[a-f0-9]{64}\.png$/);
    assert.match(storedAudio.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);

    await assert.rejects(
      storeLocalMediaFile(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'images', { db }),
      /.+/
    );

    const authoredRes = await offlineApi.handle('post', '/cards/save', {
      deck_id: importedDeck.id,
      request_id: 'req-authored-with-media',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Authored Media', answer: 'С медиа' } } },
      image_path: storedImg.path,
      audio_path: storedAudio.path,
    }, { _testDb: db });

    const exportedArchive = await buildWebArchiveZipBytes({
      db,
      deckIds: [importedDeck.id],
    });
    assert.notEqual(exportedArchive.document.source, sourceIdentity);
    assert.equal(exportedArchive.document.content.card.length, 3);

    const freshDb = createStandaloneTestDb(`LerneStandaloneDB_Editor_Fresh_${dbCounter}`);
    await freshDb.open();
    const freshPending = await inspectArchiveWebBytes(exportedArchive.zipBytes, 'exported.zip', { db: freshDb });
    assert.equal(freshPending.ok, true, freshPending.error);
    await confirmArchiveImport(freshPending, { db: freshDb });

    const importedCardsFresh = await freshDb.cards.filter(c => !c.is_deleted).toArray();
    const prompts = new Set(importedCardsFresh.map(c => c.content_v2.card.data.prompt));
    assert.equal(prompts.has('Local Edit 1'), true);
    assert.equal(prompts.has('Server V2 Updated 3'), true);
    assert.equal(prompts.has('Authored Media'), true);

    const mediaCard = importedCardsFresh.find(c => c.content_v2.card.data.prompt === 'Authored Media');
    assert.ok(mediaCard.image_path);
    assert.ok(mediaCard.audio_path);
    const resolvedBlobBytes = await readWebMediaAssetBytes(
      freshDb,
      'audio',
      mediaCard.audio_path.split('/').pop(),
    );
    assert.equal(resolvedBlobBytes.byteLength, wavBytes.byteLength);

    const gradedAuthored = await offlineApi.handle('post', '/study/grade', {
      card_id: authoredRes.data.id,
      grade: 2,
      action_id: 'grade-authored-1',
      include_progress: true,
      return_next: false,
    }, { _testDb: db });
    assert.equal(gradedAuthored.data.graded_progress.repetitions, 1);

    const basePack = getStandalonePack();
    const backupDb = createStandaloneTestDb(`LerneStandaloneDB_Editor_BackupSrc_${dbCounter}`);
    await backupDb.open();
    await ensureStandaloneSeed({ db: backupDb, userId: STANDALONE_USER_ID, pack: basePack });
    const seedDeckId = basePack.decks[0].id;
    const editedSeedCard = await backupDb.cards.get(basePack.cards[0].id);
    await offlineApi.handle('patch', `/cards/${editedSeedCard.id}`, {
      request_id: 'edit-seed-before-upgrade',
      revision: editedSeedCard.revision,
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Keep Me Across Seed Upgrade', answer: 'Не затирать' } } },
    }, { _testDb: backupDb });

    const upgradedSpecs = basePack.decks.map(d => ({
      id: d.id,
      slug: d.slug,
      targetLanguage: d.targetLanguage,
      color: d.color,
      position: d.position,
      cardIdBase: d.id === 9101 ? 910100 : d.id === 9102 ? 910200 : 910300,
      document: structuredClone(d.document),
    }));
    upgradedSpecs[0].document.cards[0].data.text = 'Seed V2 Text Should Be Skipped';
    const upgradedPack = buildStandalonePack({ packVersion: 2, deckSpecs: upgradedSpecs });
    await ensureStandaloneSeed({ db: backupDb, userId: STANDALONE_USER_ID, pack: upgradedPack });
    const seedCardAfterUpgrade = await backupDb.cards.get(editedSeedCard.id);
    assert.equal(seedCardAfterUpgrade.content_v2.card.data.prompt, 'Keep Me Across Seed Upgrade');

    const localSeedAuthored = await offlineApi.handle('post', '/cards/save', {
      deck_id: seedDeckId,
      request_id: 'authored-in-seed-deck',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Custom Backup Card', answer: 'Ответ' } } },
    }, { _testDb: backupDb });
    await offlineApi.handle('post', '/study/grade', {
      card_id: localSeedAuthored.data.id,
      grade: 2,
      action_id: 'grade-custom-backup-card',
      return_next: false,
    }, { _testDb: backupDb });

    const fullBackup = await exportProgressBackup({ db: backupDb, userId: STANDALONE_USER_ID, pack: upgradedPack });
    assert.equal(fullBackup.backup.imported_records.length, 1);
    assert.equal(fullBackup.backup.imported_records[0].card_key, localSeedAuthored.data.standalone_card_key);

    await backupDb.progress.clear();
    const inspectBk = await inspectProgressBackup(fullBackup.json, { db: backupDb, userId: STANDALONE_USER_ID, pack: upgradedPack });
    assert.equal(inspectBk.ok, true);
    const applyBk = await applyProgressBackup(inspectBk.backup, { db: backupDb, userId: STANDALONE_USER_ID, pack: upgradedPack });
    assert.equal(applyBk.restoredRecords, 1);
    const restoredProgress = await backupDb.progress.get([localSeedAuthored.data.id, STANDALONE_USER_ID]);
    assert.equal(restoredProgress.repetitions, 1);

    await assertZeroCloudQueue(db);
    await assertZeroCloudQueue(backupDb);
    freshDb.close();
    backupDb.close();
  });

  test('supports batch-move, batch-copy with on_duplicate modes, multi-delete, card restore, and reorder in standalone', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    const cfg = { _testDb: db };

    const deckA = (await offlineApi.handle('post', '/decks', { name: 'Deck A', target_language: 'de' }, cfg)).data;
    const deckB = (await offlineApi.handle('post', '/decks', { name: 'Deck B', target_language: 'de' }, cfg)).data;
    assert.ok(deckA.id > IMPORTED_ID_START);
    assert.ok(deckB.id > IMPORTED_ID_START);

    const c1 = (await offlineApi.handle('post', '/cards/save', {
      deck_id: deckA.id,
      request_id: 'batch-c1',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Wort 1', answer: 'Слово 1' } } },
    }, cfg)).data;
    const c2 = (await offlineApi.handle('post', '/cards/save', {
      deck_id: deckA.id,
      request_id: 'batch-c2',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Wort 2', answer: 'Слово 2' } } },
    }, cfg)).data;
    const c3 = (await offlineApi.handle('post', '/cards/save', {
      deck_id: deckA.id,
      request_id: 'batch-c3',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Wort 3', answer: 'Слово 3' } } },
    }, cfg)).data;

    // Duplicate of c1 in deckB with different field order to test canonical duplicate detection
    const dupTarget = (await offlineApi.handle('post', '/cards/save', {
      deck_id: deckB.id,
      request_id: 'batch-dup-target',
      content_v2: { schema_version: 2, card: { data: { answer: 'Слово 1', prompt: 'Wort 1' }, type: 'standard' } },
    }, cfg)).data;

    // Grade c1 & c2 to verify SRS preservation on move vs non-transfer on copy
    await offlineApi.handle('post', '/study/grade', {
      card_id: c1.id, grade: 2, action_id: 'grade-batch-c1', return_next: false,
    }, cfg);
    await offlineApi.handle('post', '/study/grade', {
      card_id: c2.id, grade: 3, action_id: 'grade-batch-c2', return_next: false,
    }, cfg);

    // 1. batch-copy with on_duplicate: 'skip' -> skips c1 duplicate, copies c2 with new ID > 1_000_000
    const copySkip = (await offlineApi.handle('post', '/cards/batch-copy', {
      card_ids: [c1.id, c2.id],
      target_deck_id: deckB.id,
      revisions: { [c1.id]: c1.revision, [c2.id]: c2.revision },
      on_duplicate: 'skip',
      request_id: 'req-copy-skip',
    }, cfg)).data;
    assert.equal(copySkip.count, 1);
    assert.equal(copySkip.skipped, 1);
    assert.equal(copySkip.cards.length, 1);
    const copiedC2 = copySkip.cards[0];
    assert.ok(copiedC2.id > IMPORTED_ID_START);
    assert.notEqual(copiedC2.id, c2.id);
    assert.equal(copiedC2.deck_id, deckB.id);
    assert.equal(copiedC2.is_dirty, 0);
    // Source c2 retains its SRS progress; copied card starts fresh
    assert.equal((await db.progress.get([c2.id, STANDALONE_USER_ID])).repetitions, 1);
    assert.equal(await db.progress.get([copiedC2.id, STANDALONE_USER_ID]), undefined);

    // Idempotent replay of batch-copy
    const copySkipReplay = (await offlineApi.handle('post', '/cards/batch-copy', {
      card_ids: [c1.id, c2.id],
      target_deck_id: deckB.id,
      revisions: { [c1.id]: c1.revision, [c2.id]: c2.revision },
      on_duplicate: 'skip',
      request_id: 'req-copy-skip',
    }, cfg)).data;
    assert.equal(copySkipReplay.cards[0].id, copiedC2.id);

    // 2. batch-copy with on_duplicate: 'keep' -> creates another copy even though duplicate exists
    const copyKeep = (await offlineApi.handle('post', '/cards/batch-copy', {
      card_ids: [c1.id],
      target_deck_id: deckB.id,
      revisions: { [c1.id]: c1.revision },
      on_duplicate: 'keep',
      request_id: 'req-copy-keep',
    }, cfg)).data;
    assert.equal(copyKeep.count, 1);
    assert.equal(copyKeep.skipped, 0);
    assert.notEqual(copyKeep.cards[0].id, dupTarget.id);

    // 3. Single batch-move with on_duplicate: 'skip' -> leaves card in deckA
    const moveSingleSkip = (await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [c1.id],
      target_deck_id: deckB.id,
      revisions: { [c1.id]: c1.revision },
      on_duplicate: 'skip',
      request_id: 'req-move-single-skip',
    }, cfg)).data;
    assert.equal(moveSingleSkip.deck_id, deckA.id);

    // 4. Single batch-move with on_duplicate: 'overwrite' -> updates dupTarget and soft-deletes c1
    const moveOverwrite = (await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [c1.id],
      target_deck_id: deckB.id,
      revisions: { [c1.id]: c1.revision },
      on_duplicate: 'overwrite',
      request_id: 'req-move-overwrite',
    }, cfg)).data;
    assert.equal(moveOverwrite.id, dupTarget.id);
    assert.equal(moveOverwrite.deck_id, deckB.id);
    assert.equal(moveOverwrite.revision, dupTarget.revision + 1);
    assert.equal((await db.cards.get(c1.id)).is_deleted, 1);

    // 5. Move c2 & c3 to deckB with on_duplicate: 'keep' -> preserves c2 ID and SRS progress
    const multiMove = (await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [c2.id, c3.id],
      target_deck_id: deckB.id,
      revisions: { [c2.id]: c2.revision, [c3.id]: c3.revision },
      on_duplicate: 'keep',
      request_id: 'req-move-multi',
    }, cfg)).data;
    assert.equal(multiMove.count, 2);
    assert.equal((await db.cards.get(c2.id)).deck_id, deckB.id);
    assert.equal((await db.progress.get([c2.id, STANDALONE_USER_ID])).repetitions, 1);

    // 6. Reorder cards in deckB
    const deckBCardsBefore = (await offlineApi.handle('get', `/decks/${deckB.id}/cards`, null, cfg)).data;
    const reversedIds = [...deckBCardsBefore].reverse().map(c => c.id);
    const reordered = (await offlineApi.handle('post', '/cards/reorder', {
      card_ids: reversedIds,
      revisions: Object.fromEntries(deckBCardsBefore.map(c => [c.id, c.revision])),
      request_id: 'req-reorder-deckB',
    }, cfg)).data;
    assert.equal(reordered.cards.length, reversedIds.length);
    const deckBCardsAfter = (await offlineApi.handle('get', `/decks/${deckB.id}/cards`, null, cfg)).data;
    assert.deepEqual(deckBCardsAfter.map(c => c.id), reversedIds);

    // 7. Multi-delete + single restore via /trash/card/:id/restore
    const multiDeleted = (await offlineApi.handle('post', '/cards/batch-delete', {
      card_ids: [c2.id, c3.id],
      revisions: { [c2.id]: (await db.cards.get(c2.id)).revision, [c3.id]: (await db.cards.get(c3.id)).revision },
      request_id: 'req-multi-delete-1',
    }, cfg)).data;
    assert.equal(multiDeleted.cards.length, 2);
    assert.ok(multiDeleted.cards.every(c => c.is_deleted === 1 && c.is_dirty === 0));

    const trashBeforeRestore = (await offlineApi.handle('get', '/trash', null, cfg)).data;
    assert.ok(trashBeforeRestore.cards.some(c => c.id === c2.id));
    assert.ok(trashBeforeRestore.cards.some(c => c.id === c3.id));

    const restoredC2 = (await offlineApi.handle('post', `/trash/card/${c2.id}/restore`, {
      revision: (await db.cards.get(c2.id)).revision,
      request_id: 'req-restore-c2',
    }, cfg)).data;
    assert.equal(restoredC2.is_deleted, 0);
    assert.equal(restoredC2.is_dirty, 0);

    await assertZeroCloudQueue(db);
  });
});
