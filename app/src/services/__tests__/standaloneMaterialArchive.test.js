import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
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

const { sha256Hex, sha256BytesHex } = await import('../../pilot/sha256.js');
let nativeArchive;
const capacitor = await import('@capacitor/core');
mock.module('@capacitor/core', {
  namedExports: {
    ...Object.fromEntries(Object.entries(capacitor).filter(([name]) => name !== '__esModule')),
    Capacitor: {
      ...capacitor.Capacitor,
      isNativePlatform: () => Boolean(nativeArchive),
      isPluginAvailable: () => Boolean(nativeArchive),
    },
    registerPlugin: name => name === 'OfflineMaterialArchive' ? {
      pickArchiveForImport: (...args) => nativeArchive.pickArchiveForImport(...args),
      commitImportMedia: (...args) => nativeArchive.commitImportMedia(...args),
      rollbackImportMedia: (...args) => nativeArchive.rollbackImportMedia(...args),
      cancelImport: (...args) => nativeArchive.cancelImport(...args),
      listMediaAssets: (...args) => nativeArchive?.listMediaAssets?.(...args),
      getMediaRoot: (...args) => nativeArchive?.getMediaRoot?.(...args),
      statMediaAsset: (...args) => nativeArchive?.statMediaAsset?.(...args),
      inspectExistingMedia: (...args) => nativeArchive?.inspectExistingMedia?.(...args),
      storeMediaAsset: (...args) => nativeArchive?.storeMediaAsset?.(...args),
    } : capacitor.registerPlugin(name),
  },
});
const {
  isOfflineMediaUrl,
  resolveOfflineMediaUrlSync,
  setWebBlobUrl,
  getWebBlobUrl,
  getNativeMediaRoot,
  clearOfflineMediaCache: clearResolverCache,
} = await import('../../pilot/offlineMediaResolver.js');

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

const { buildZipArchive, readZipArchive, computeCrc32 } = await import('../../pilot/zipCodec.js');
const {
  MATERIAL_ARCHIVE_FORMAT,
  validateMaterialArchiveDocument,
  applyMaterialArchiveImport,
  getExportableMaterialsTree,
  buildMaterialArchiveExport,
  MAX_ARCHIVE_BYTES,
  IMPORTED_ID_START,
  parseJsonStrictNoDuplicates,
} = await import('../../pilot/materialArchive.js');
const {
  inspectArchiveWebBytes,
  confirmArchiveImport,
  buildWebArchiveZipBytes,
  pickArchiveForImportNative,
} = await import('../../pilot/materialArchiveTransport.js');
const {
  clearOfflineMediaCache,
  initOfflineMediaStore,
  resolveOfflineMediaUrlAsync,
  readWebMediaAssetBytes,
} = await import('../../pilot/offlineMediaStore.js');
const { storeLocalMediaFile } = await import('../../pilot/localMediaWriter.js');
const { ensureStandaloneSeed, validateStandalonePack } = await import('../../pilot/standaloneSeed.js');
const { getStandalonePack } = await import('../../pilot/standalonePack.js');
const {
  PROGRESS_BACKUP_INTEGRITY_SCOPE,
  PROGRESS_BACKUP_INTEGRITY_SCOPE_V2,
  computeBackupHash,
  exportProgressBackup,
  inspectProgressBackup,
  applyProgressBackup,
} = await import('../../pilot/progressBackup.js');
const { offlineApi } = await import('../offlineApi.js');
const { cardMediaView, clearMediaCache } = await import('../mediaCache.js');
const { prepareLocalDb, closeLocalDb, resetAllDatabases } = await import('../localDb.js');
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
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(computeCrc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function makePngBytes(width = 2, height = 2, r = 128, g = 40, b = 220) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
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
  const idat = zlib.deflateSync(raw);
  return new Uint8Array(Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function makeWebpBytes(width = 8, height = 8) {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(24, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  buf[24] = wMinus1 & 0xff;
  buf[25] = (wMinus1 >> 8) & 0xff;
  buf[26] = (wMinus1 >> 16) & 0xff;
  buf[27] = hMinus1 & 0xff;
  buf[28] = (hMinus1 >> 8) & 0xff;
  buf[29] = (hMinus1 >> 16) & 0xff;
  return new Uint8Array(buf);
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

function makeMp3Bytes() {
  const buf = new Uint8Array(256);
  // Valid MPEG-1 Layer III frame header bytes repeated
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 0xff;
    buf[i + 1] = 0xfb;
    buf[i + 2] = 0x90;
    buf[i + 3] = 0x00;
  }
  return buf;
}

function makeMp4Bytes(size = 64) {
  const buf = new Uint8Array(size);
  buf[3] = 0x20;
  buf[4] = 0x66; // f
  buf[5] = 0x74; // t
  buf[6] = 0x79; // y
  buf[7] = 0x70; // p
  buf[8] = 0x69; // i
  buf[9] = 0x73; // s
  buf[10] = 0x6f; // o
  buf[11] = 0x6d; // m
  return buf;
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

function buildArchiveZipFromDoc(document, mediaAssets) {
  const manifestJson = JSON.stringify(document);
  const manifestSha = sha256Hex(manifestJson);
  const encoder = new TextEncoder();
  return buildZipArchive([
    { name: 'manifest.json', data: encoder.encode(manifestJson) },
    { name: 'manifest.sha256', data: encoder.encode(manifestSha) },
    ...mediaAssets.map(a => ({ name: a.path, data: a.bytes })),
  ]);
}

function buildRichCourseFixture({
  source = `Supabase:${'a'.repeat(64)}`,
  version = 4,
  updatedExplanation = 'Initial explanation',
  includeExtraCard = false,
  targetLanguage = 'fr',
} = {}) {
  const pngAsset = assetRecord(makePngBytes(4, 4, 90, 60, 210), 'images', '.png', 'image/png');
  const webpAsset = assetRecord(makeWebpBytes(8, 8), 'images', '.webp', 'image/webp');
  const wavAsset = assetRecord(makeWavBytes(400), 'audio', '.wav', 'audio/wav');
  const mp3Asset = assetRecord(makeMp3Bytes(), 'audio', '.mp3', 'audio/mpeg');
  const mediaAssets = [pngAsset, webpAsset, wavAsset, mp3Asset];

  const tok = a => `archive://${a.sha256}`;

  const cards = [
    {
      id: 201,
      author: 42,
      values: {
        deck_id: 101,
        position: 0,
        is_deleted: false,
        difficulty: null,
        source: 'admin',
        image_path: tok(pngAsset),
        audio_path: tok(wavAsset),
        audio_back_path: tok(mp3Asset),
        video_front_path: null,
        video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'standard',
            level: 'A1',
            image: tok(pngAsset),
            info: [{ type: 'text', text: `Inline markdown ![Pic](${tok(pngAsset)})` }],
            layout: [
              { id: 'img_1', type: 'image', path: tok(webpAsset) },
              { id: 'info_0', type: 'info', index: 0 },
              { id: 'ex_1', type: 'exercise' },
            ],
            data: { prompt: 'Bonjour', answer: 'Привет' },
            explanation: updatedExplanation,
            metadata: {
              resources: [{ type: 'audio', url: tok(wavAsset), label: 'Card sound' }],
            },
          },
        },
      },
    },
    {
      id: 202,
      author: 42,
      values: {
        deck_id: 101, position: 1, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: { schema_version: 2, card: { type: 'theory', data: { text: '# Theorie' } } },
      },
    },
    {
      id: 203,
      author: 42,
      values: {
        deck_id: 101, position: 2, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: { type: 'trainer', data: { parts: [{ type: 'text', text: 'Je ' }, { type: 'input', answers: ['suis'] }] } },
        },
      },
    },
    {
      id: 204,
      author: 42,
      values: {
        deck_id: 101, position: 3, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'quiz',
            data: {
              prompt: 'Choisissez',
              options: [{ text: 'Oui', correct: true }, { text: 'Non', correct: false }],
            },
          },
        },
      },
    },
    {
      id: 205,
      author: 42,
      values: {
        deck_id: 101, position: 4, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: { type: 'match', data: { pairs: [{ left: 'Un', right: '1' }, { left: 'Deux', right: '2' }] } },
        },
      },
    },
    {
      id: 206,
      author: 42,
      values: {
        deck_id: 101, position: 5, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: { type: 'puzzle', data: { tokens: ['Je', 'parle', 'français'] } },
        },
      },
    },
    {
      id: 207,
      author: 42,
      values: {
        deck_id: 101, position: 6, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'word_bank',
            data: {
              options: ['suis', 'es'],
              parts: [{ type: 'text', text: 'Je ' }, { type: 'gap', option: 0 }],
            },
          },
        },
      },
    },
    {
      id: 208,
      author: 42,
      values: {
        deck_id: 101, position: 7, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'free_text',
            data: { prompt: 'Переведите: Спасибо', sample_answer: 'Merci' },
          },
        },
      },
    },
    {
      id: 209,
      author: null,
      values: {
        deck_id: 102, position: 0, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: {
            type: 'editable_text',
            data: { source_text: 'Il a aller', correct_text: 'Il est allé' },
          },
        },
      },
    },
  ];

  if (includeExtraCard) {
    cards.push({
      id: 210,
      author: 42,
      values: {
        deck_id: 101, position: 8, is_deleted: false, difficulty: null, source: 'admin',
        image_path: null, audio_path: null, audio_back_path: null, video_front_path: null, video_back_path: null,
        content_v2: {
          schema_version: 2,
          card: { type: 'standard', data: { prompt: 'Au revoir', answer: 'До свидания' } },
        },
      },
    });
  }

  const personalDeckValues = {
    name: 'Cours Complet',
    level: 'A1',
    topic: 'Voyage',
    target_language: targetLanguage,
    position: 0,
    is_deleted: false,
    folder_id: 11,
    metadata: JSON.stringify({
      resources: [{ type: 'audio', label: 'Intro track', url: tok(wavAsset) }],
    }),
  };
  if (version >= 4) {
    personalDeckValues.scope = 'personal';
    personalDeckValues.category_id = null;
    personalDeckValues.is_default = false;
  }

  const decks = [{ id: 101, author: 42, values: personalDeckValues }];
  if (version >= 4) {
    decks.push({
      id: 102,
      author: null,
      values: {
        name: 'Library Grammaire',
        level: 'B1',
        topic: 'Syntaxe',
        target_language: targetLanguage,
        position: 1,
        is_deleted: false,
        folder_id: null,
        metadata: null,
        scope: 'library',
        category_id: 7,
        is_default: true,
      },
    });
  } else {
    // Version 3 has only personal decks (no library scope field)
    cards.splice(cards.findIndex(c => c.id === 209), 1);
  }

  const document = {
    format: MATERIAL_ARCHIVE_FORMAT,
    version,
    source,
    source_users: [{ id: 42, name: 'Admin Author', username: 'admin42' }],
    content: {
      folder: [
        {
          id: 10,
          author: 42,
          values: { name: 'Français Root', color: '#6366f1', target_language: targetLanguage, position: 0, is_deleted: false, parent_id: null },
        },
        {
          id: 11,
          author: 42,
          values: { name: 'Module 1', color: '#22c55e', target_language: targetLanguage, position: 0, is_deleted: false, parent_id: 10 },
        },
      ],
      deck: decks,
      card: cards,
    },
    assets: mediaAssets.map(a => ({
      sha256: a.sha256,
      folder: a.folder,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      path: a.path,
    })),
  };

  return { document, mediaAssets };
}

let dbCounter = 0;

describe('Android Offline Materials — Hashing, ZIP, Archive Engine, Media & Progress Backup v2', () => {
  let db;

  beforeEach(async () => {
    memStorage.clear();
    clearResolverCache();
    clearOfflineMediaCache();
    dbCounter += 1;
    db = createStandaloneTestDb(`LerneStandaloneDB_${900100 + dbCounter}`);
    await db.open();
    await initOfflineMediaStore(db);
  });

  test('1. sha256BytesHex matches Node crypto across boundary byte sizes', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 128, 4096]) {
      const buf = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) {
        buf[i] = (i * 131 + size) & 0xff;
      }
      const expected = crypto.createHash('sha256').update(buf).digest('hex');
      assert.equal(sha256BytesHex(buf), expected, `SHA-256 mismatch at ${size} bytes`);
    }
  });

  test('2. zipCodec supports stored & deflated entries and rejects corrupt or unsafe ZIPs', async () => {
    const encoder = new TextEncoder();
    const textData = encoder.encode('Bonjour '.repeat(100));
    const binData = makePngBytes(2, 2);

    const zipBytes = await buildZipArchive([
      { name: 'manifest.json', data: textData },
      { name: 'media/sample.png', data: binData },
    ]);
    const extracted = await readZipArchive(zipBytes);
    assert.deepEqual(extracted.get('manifest.json'), textData);
    assert.deepEqual(extracted.get('media/sample.png'), binData);

    // Non-ZIP bytes
    await assert.rejects(() => readZipArchive(new Uint8Array([1, 2, 3, 4])), /ZIP/);

    // CRC mismatch in ZIP (flip byte of Central Directory entry CRC32)
    const corruptCrc = new Uint8Array(zipBytes);
    const cdSigPos = Buffer.from(corruptCrc).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(cdSigPos >= 0);
    corruptCrc[cdSigPos + 16] ^= 0xff;
    await assert.rejects(() => readZipArchive(corruptCrc), /Несогласованный заголовок/i);
    corruptCrc[14] ^= 0xff;
    await assert.rejects(() => readZipArchive(corruptCrc), /Контрольная сумма CRC-32/i);

    const wrongLocalName = zipBytes.slice();
    wrongLocalName[30] ^= 1;
    await assert.rejects(() => readZipArchive(wrongLocalName), /Несогласованный заголовок/i);

    // Unsafe path traversal & backslash
    await assert.rejects(() => buildZipArchive([{ name: '../evil.txt', data: binData }]), /путь/i);
    await assert.rejects(() => buildZipArchive([{ name: 'a\\b.txt', data: binData }]), /путь/i);

    // Craft manual local header + central directory with forbidden flags (encrypted, traversal, dir, symlink, duplicate)
    const craftSingleEntryZip = (entryName, { gpFlag = 0, extAttr = 0, uncompSize = 3 } = {}) => {
      const nameBytes = Buffer.from(entryName, 'utf8');
      const payload = Buffer.from('abc');
      const crc = computeCrc32(payload);
      const lfh = Buffer.alloc(30 + nameBytes.length);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(gpFlag, 6);
      lfh.writeUInt16LE(0, 8);
      lfh.writeUInt32LE(crc, 14);
      lfh.writeUInt32LE(payload.length, 18);
      lfh.writeUInt32LE(uncompSize, 22);
      lfh.writeUInt16LE(nameBytes.length, 26);
      nameBytes.copy(lfh, 30);

      const cdfh = Buffer.alloc(46 + nameBytes.length);
      cdfh.writeUInt32LE(0x02014b50, 0);
      cdfh.writeUInt16LE(0x0314, 4);
      cdfh.writeUInt16LE(20, 6);
      cdfh.writeUInt16LE(gpFlag, 8);
      cdfh.writeUInt16LE(0, 10);
      cdfh.writeUInt32LE(crc, 16);
      cdfh.writeUInt32LE(payload.length, 20);
      cdfh.writeUInt32LE(uncompSize, 24);
      cdfh.writeUInt16LE(nameBytes.length, 28);
      cdfh.writeUInt32LE(extAttr, 38);
      cdfh.writeUInt32LE(0, 42);
      nameBytes.copy(cdfh, 46);

      const cdOffset = lfh.length + payload.length;
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(1, 8);
      eocd.writeUInt16LE(1, 10);
      eocd.writeUInt32LE(cdfh.length, 12);
      eocd.writeUInt32LE(cdOffset, 16);
      return new Uint8Array(Buffer.concat([lfh, payload, cdfh, eocd]));
    };

    await assert.rejects(() => readZipArchive(craftSingleEntryZip('../escape.json')), /путь/i);
    await assert.rejects(() => readZipArchive(craftSingleEntryZip('dir/')), /путь/i);
    await assert.rejects(() => readZipArchive(craftSingleEntryZip('sym', { extAttr: (0o120000 << 16) >>> 0 })), /Каталоги и ссылки/);
    await assert.rejects(() => readZipArchive(craftSingleEntryZip('enc', { gpFlag: 0x01 })), /Шифрование/);
    await assert.rejects(() => readZipArchive(craftSingleEntryZip('bomb', { uncompSize: MAX_ARCHIVE_BYTES + 10 })), /размер/i);

    // Duplicate entry name
    const single = Buffer.from(zipBytes);
    // Test duplicate check by crafting 2 CD headers cleanly
    const nameB = Buffer.from('dup.txt');
    const pay = Buffer.from('123');
    const crc32v = computeCrc32(pay);
    const lfh1 = Buffer.alloc(30 + nameB.length);
    lfh1.writeUInt32LE(0x04034b50, 0); lfh1.writeUInt16LE(20, 4); lfh1.writeUInt32LE(crc32v, 14);
    lfh1.writeUInt32LE(3, 18); lfh1.writeUInt32LE(3, 22); lfh1.writeUInt16LE(nameB.length, 26); nameB.copy(lfh1, 30);
    const cd1 = Buffer.alloc(46 + nameB.length);
    cd1.writeUInt32LE(0x02014b50, 0); cd1.writeUInt16LE(20, 4); cd1.writeUInt16LE(20, 6);
    cd1.writeUInt32LE(crc32v, 16); cd1.writeUInt32LE(3, 20); cd1.writeUInt32LE(3, 24); cd1.writeUInt16LE(nameB.length, 28);
    nameB.copy(cd1, 46);
    const cd2 = Buffer.from(cd1);
    const off2 = lfh1.length + pay.length;
    cd2.writeUInt32LE(off2, 42);
    const cdStart = off2 * 2;
    const eocd2 = Buffer.alloc(22);
    eocd2.writeUInt32LE(0x06054b50, 0); eocd2.writeUInt16LE(2, 8); eocd2.writeUInt16LE(2, 10);
    eocd2.writeUInt32LE(cd1.length * 2, 12); eocd2.writeUInt32LE(cdStart, 16);
    const dupZip = new Uint8Array(Buffer.concat([lfh1, pay, lfh1, pay, cd1, cd2, eocd2]));
    await assert.rejects(() => readZipArchive(dupZip), /Повторные/i);
    assert.ok(single.length > 0);
  });

  test('3. Imports v4 & v3 archives with all 9 V2 card types, nested folders, library/personal decks & offline media resolution', async () => {
    const v4 = buildRichCourseFixture({ version: 4 });
    const v4Zip = await buildArchiveZipFromDoc(v4.document, v4.mediaAssets);
    const inspected = await inspectArchiveWebBytes(v4Zip, 'course-v4.zip', { db, userId: STANDALONE_USER_ID });
    assert.equal(inspected.ok, true, inspected.error);
    assert.equal(inspected.inspection.originalVersion, 4);
    assert.equal(inspected.inspection.preview.totalFolders, 2);
    assert.equal(inspected.inspection.preview.totalDecks, 2);
    assert.equal(inspected.inspection.preview.totalCards, 9);

    const applied = await confirmArchiveImport(inspected, { db, userId: STANDALONE_USER_ID });
    assert.equal(applied.importedFolders, 2);
    assert.equal(applied.importedDecks, 2);
    assert.equal(applied.importedCards, 9);
    assert.equal(applied.mediaCount, 4);

    const folders = await db.folders.toArray();
    const decks = await db.decks.toArray();
    const cards = await db.cards.toArray();
    assert.equal(folders.length, 2);
    assert.equal(decks.length, 2);
    assert.equal(cards.length, 9);

    for (const f of folders) {
      assert.ok(f.id > 1000000);
      assert.equal(f.role, 'owner');
      assert.equal(f.is_owner, true);
      assert.equal(f.is_global_readonly, false);
      assert.equal(f.is_builtin, false);
      assert.match(f.standalone_origin_key, /^archive:Supabase:[a-f0-9]{64}:folder:\d+$/);
    }
    for (const d of decks) {
      assert.ok(d.id > 1000000);
      assert.equal(d.role, 'owner');
      assert.equal(d.is_owner, true);
      assert.equal(d.is_global_readonly, false);
      assert.equal(d.is_builtin, false);
      const complete = await db.syncState.get(`deck-cards:${d.id}`);
      assert.equal(complete?.complete, true);
    }

    const personalDeck = decks.find(d => d.name === 'Cours Complet');
    assert.equal(personalDeck.folder_id, folders.find(f => f.name === 'Module 1').id);
    assert.match(personalDeck.metadata.resources[0].url, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);

    const richCard = cards.find(c => c.content_v2.card.type === 'standard');
    assert.match(richCard.image_path, /^\/api\/media\/images\/archive_[a-f0-9]{64}\.png$/);
    assert.match(richCard.audio_path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);
    assert.match(richCard.audio_back_path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.mp3$/);
    assert.match(richCard.content_v2.card.image, /^images\/archive_[a-f0-9]{64}\.png$/);
    assert.match(richCard.content_v2.card.layout[0].path, /^images\/archive_[a-f0-9]{64}\.webp$/);
    assert.ok(richCard.content_v2.card.info[0].text.includes('/api/media/images/archive_'));

    // Card media resolution + offlineApi /init runtime resolution without mutating stored metadata
    const directResolved = await resolveOfflineMediaUrlAsync(db, richCard.image_path, 'images');
    assert.ok(directResolved?.startsWith('blob:'));
    const view = await cardMediaView(db, richCard, false);
    assert.ok(view.image_url?.startsWith('blob:'));
    assert.ok(view.audio_url?.startsWith('blob:'));
    assert.ok(view.audio_back_url?.startsWith('blob:'));
    assert.ok(view.layout_media_urls.img_1?.startsWith('blob:'));

    const initResp = await offlineApi.handle('get', '/init', {}, { _testDb: db });
    const apiPersonalDeck = initResp.data.decks.find(d => d.name === 'Cours Complet');
    assert.ok(apiPersonalDeck, 'Custom target_language imported deck must stay visible in /init');
    assert.ok(apiPersonalDeck.metadata.resources[0].url.startsWith('blob:'));
    const storedDeckAfterInit = await db.decks.get(personalDeck.id);
    assert.match(storedDeckAfterInit.metadata.resources[0].url, /^\/api\/media\/audio\/archive_/);

    // Import a v3 archive from a distinct source -> normalizes scope/category_id/is_default
    const v3 = buildRichCourseFixture({ source: `Supabase:${'b'.repeat(64)}`, version: 3 });
    const v3Zip = await buildArchiveZipFromDoc(v3.document, v3.mediaAssets);
    const v3Inspected = await inspectArchiveWebBytes(v3Zip, 'course-v3.zip', { db, userId: STANDALONE_USER_ID });
    assert.equal(v3Inspected.ok, true, v3Inspected.error);
    assert.equal(v3Inspected.inspection.originalVersion, 3);
    const v3Applied = await confirmArchiveImport(v3Inspected, { db, userId: STANDALONE_USER_ID });
    assert.equal(v3Applied.importedDecks, 1);
    const v3Deck = (await db.decks.toArray()).find(d => d.standalone_source === v3.document.source);
    assert.equal(v3Deck.standalone_deck_scope, 'personal');
    assert.equal(v3Deck.standalone_category_id, null);
    const v2 = buildRichCourseFixture({ source: `LOCAL:${'2'.repeat(64)}`, version: 2 });
    const v2Pending = await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v2.document, v2.mediaAssets), 'v2.zip', { db });
    assert.equal(v2Pending.ok, true, v2Pending.error);
    assert.equal(v2Pending.inspection.originalVersion, 2);
    await confirmArchiveImport(v2Pending, { db, userId: STANDALONE_USER_ID });
    assert.equal(await db.cards.filter(c => c.standalone_source === v2.document.source).count(), v2.document.content.card.length);
    assert.equal(v3Deck.standalone_is_default, false);
  });

  test('4. Re-importing exact & updated archives avoids duplicates and preserves 100% of SRS progress and is_learning', async () => {
    const v4a = buildRichCourseFixture({ updatedExplanation: 'V1 note', includeExtraCard: false });
    const first = await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4a.document, v4a.mediaAssets), 'a.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );
    assert.equal(first.importedCards, 9);

    const allDecks = await db.decks.toArray();
    const personalDeck = allDecks.find(d => d.name === 'Cours Complet');
    await db.decks.update(personalDeck.id, { is_learning: true });

    const allCards = await db.cards.toArray();
    const trackedCard = allCards.find(c => c.standalone_source_id === 201);
    const srsRow = calculateCardReview({
      card_id: trackedCard.id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 3, false, 'scheduled', new Date('2026-11-20T10:00:00.000Z'));
    await db.progress.put(srsRow);

    // Re-import exact same archive
    const reInspectSame = await inspectArchiveWebBytes(
      await buildArchiveZipFromDoc(v4a.document, v4a.mediaAssets),
      'a-again.zip',
      { db, userId: STANDALONE_USER_ID },
    );
    assert.equal(reInspectSame.inspection.preview.isReimport, true);
    assert.equal(reInspectSame.inspection.preview.preservedProgressCount, 1);
    const reApplySame = await confirmArchiveImport(reInspectSame, { db, userId: STANDALONE_USER_ID });
    assert.equal(reApplySame.importedCards, 0);
    assert.equal(reApplySame.updatedCards, 9);

    // Re-import updated archive (edited explanation + 1 new card)
    const v4b = buildRichCourseFixture({ updatedExplanation: 'V2 updated explanation', includeExtraCard: true });
    const reApplyUpdated = await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4b.document, v4b.mediaAssets), 'b.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );
    assert.equal(reApplyUpdated.importedCards, 1);
    assert.equal(reApplyUpdated.updatedCards, 9);
    assert.equal(await db.decks.count(), 2);
    assert.equal(await db.cards.count(), 10);

    const afterDeck = await db.decks.get(personalDeck.id);
    assert.equal(afterDeck.is_learning, true);
    const afterCard = await db.cards.get(trackedCard.id);
    assert.equal(afterCard.content_v2.card.explanation, 'V2 updated explanation');
    const afterProgress = await db.progress.get([trackedCard.id, STANDALONE_USER_ID]);
    assert.equal(afterProgress.interval, srsRow.interval);
    assert.equal(afterProgress.repetitions, srsRow.repetitions);
    assert.equal(afterProgress.next_review, srsRow.next_review);

    const localCard = { ...afterCard, is_dirty: 1, front_text: 'Local edit' };
    await db.cards.put(localCard);
    await assert.rejects(
      () => confirmArchiveImport(reInspectSame, { db, userId: STANDALONE_USER_ID }),
      /локальные изменения/i,
    );
    assert.deepEqual(await db.cards.get(trackedCard.id), localCard);
    assert.deepEqual(await db.progress.get([trackedCard.id, STANDALONE_USER_ID]), afterProgress);
  });

  test('Knowledge import shares skill keys across decks and preserves history through revisions and ZIP round trips', async () => {
    const { document, mediaAssets } = buildRichCourseFixture();
    const [first, second] = document.content.deck;
    const topic = { rule_code: 'fr.syntax', name: 'Syntaxe', kind: 'topic', language: 'fr', revision: 1 };
    const prerequisite = { ...topic, rule_code: 'fr.syntax.forms', name: 'Formes', kind: 'skill', parent_key: topic.rule_code };
    const skill = { ...prerequisite, rule_code: 'fr.syntax.order', name: 'Ordre', prerequisite_keys: [prerequisite.rule_code] };
    const primary = { rule_code: skill.rule_code, role: 'primary', complexity: 2, ability: 'recognition' };
    const setKnowledge = (deck, items, mappings) => {
      const metadata = JSON.parse(deck.values.metadata || '{}');
      deck.values.metadata = JSON.stringify({ ...metadata, knowledge: { version: 1, items, mappings } });
    };
    const primaryInFirst = { ...primary, card_id: 201 };
    const secondaryInFirst = { ...primaryInFirst, rule_code: prerequisite.rule_code, role: 'secondary' };
    const primaryInSecond = { ...primary, card_id: 209 };
    setKnowledge(first, [topic, prerequisite, skill], [primaryInFirst, secondaryInFirst]);
    setKnowledge(second, [topic, prerequisite, skill], [primaryInSecond]);
    const importArchive = async () => {
      const pending = await inspectArchiveWebBytes(await buildArchiveZipFromDoc(document, mediaAssets), 'knowledge.zip', { db, userId: STANDALONE_USER_ID });
      if (!pending.ok) throw new Error(pending.error);
      return confirmArchiveImport(pending, { db, userId: STANDALONE_USER_ID });
    };
    await importArchive();
    await importArchive();
    const [card] = await db.cards.filter(row => row.standalone_source_id === 201).toArray();
    assert.equal(await db.knowledge_items.count(), 3);
    assert.equal(await db.card_knowledge_items.where('knowledge_item_id').equals(skill.rule_code).count(), 2);
    assert.equal(await db.card_knowledge_items.where('card_id').equals(card.id).count(), 2);
    await db.knowledge_attempt_outbox.add({ client_event_id: 'prior', knowledge_item_id: skill.rule_code, card_id: card.id });

    const conflict = { ...skill, name: 'Contradiction' };
    setKnowledge(first, [topic, prerequisite, conflict], []);
    setKnowledge(second, [topic, prerequisite, conflict], []);
    await assert.rejects(() => importArchive(), /conflicting definition/);
    assert.equal(await db.card_knowledge_items.count(), 3);
    const renamed = { ...skill, name: 'Ordre des mots', revision: 2 };
    const cycle = { ...prerequisite, revision: 2, prerequisite_keys: [skill.rule_code] };
    setKnowledge(first, [topic, cycle, renamed], []);
    setKnowledge(second, [topic, cycle, renamed], []);
    await assert.rejects(() => importArchive(), /cycle in prerequisites/);
    setKnowledge(first, [topic, prerequisite, renamed], [primaryInFirst]);
    setKnowledge(second, [topic, prerequisite, renamed], []);
    first.values.name = 'Cours renommé';
    first.values.folder_id = 10;
    await importArchive();
    assert.equal((await db.knowledge_items.get(skill.rule_code)).name, renamed.name);
    assert.equal(await db.card_knowledge_items.count(), 1);
    assert.equal((await db.knowledge_attempt_outbox.get('prior')).knowledge_item_id, skill.rule_code);
    assert.ok(await db.card_knowledge_items.get([card.id, skill.rule_code]));
    const legacyMetadata = JSON.parse(first.values.metadata);
    delete legacyMetadata.knowledge;
    first.values.metadata = JSON.stringify(legacyMetadata);
    await importArchive();
    assert.ok(await db.card_knowledge_items.get([card.id, skill.rule_code]));

    const movedCard = await db.cards.get(card.id);
    const destination = await db.decks.filter(deck => deck.standalone_source_id === 102).first();
    await db.cards.update(card.id, { deck_id: destination.id, standalone_local_edit: true });
    assert.notEqual(movedCard.deck_id, destination.id);
    const archive = await buildMaterialArchiveExport({
      db, selectAll: true,
      readAssetBytes: (folder, filename) => mediaAssets.find(asset => asset.folder === folder && asset.filename === filename)?.bytes,
    });
    const restored = createStandaloneTestDb('LerneStandaloneDB_999811');
    try {
      const importedAssets = archive.document.assets.map(asset => ({ ...asset, bytes: archive.blobsBySha.get(asset.sha256) }));
      const bytes = await buildArchiveZipFromDoc(archive.document, importedAssets);
      const inspected = await inspectArchiveWebBytes(bytes, 'export.zip', { db: restored, userId: STANDALONE_USER_ID });
      await confirmArchiveImport(inspected, { db: restored, userId: STANDALONE_USER_ID });
      const [link] = await restored.card_knowledge_items.toArray();
      const restoredCard = await restored.cards.get(link.card_id);
      assert.equal(link.knowledge_item_id, skill.rule_code);
      assert.equal((await restored.decks.get(restoredCard.deck_id)).name, destination.name);
      assert.deepEqual((await restored.knowledge_items.get(skill.rule_code)).prerequisite_keys, [prerequisite.rule_code]);
      assert.equal(await restored.knowledge_attempt_outbox.count(), 0);
    } finally {
      await restored.delete();
    }
  });

  test('D02 cross-language move drops current bindings, preserves history and exports a valid ZIP', async () => {
    const { document, mediaAssets } = buildRichCourseFixture();
    const first = document.content.deck[0];
    const rule_code = 'fr.syntax.order';
    first.values.metadata = JSON.stringify({ ...JSON.parse(first.values.metadata), knowledge: {
      version: 1,
      items: [{ rule_code, name: 'Ordre', kind: 'skill', language: 'fr', revision: 1 }],
      mappings: [{ card_id: 201, rule_code, role: 'primary' }],
    } });
    await confirmArchiveImport(await inspectArchiveWebBytes(await buildArchiveZipFromDoc(document, mediaAssets),
      'knowledge.zip', { db, userId: STANDALONE_USER_ID }), { db, userId: STANDALONE_USER_ID });
    const card = await db.cards.filter(row => row.standalone_source_id === 201).first();
    const destination = await db.decks.filter(row => row.standalone_source_id === 102).first();
    await db.decks.update(destination.id, { target_language: 'en' });
    await db.knowledge_attempt_outbox.add({ client_event_id: 'before-move', card_id: card.id, knowledge_item_id: rule_code });
    await offlineApi.handle('post', '/cards/batch-move', {
      card_ids: [card.id], target_deck_id: destination.id, revisions: { [card.id]: card.revision }, request_id: 'cross-language',
    }, { _testDb: db });
    const archive = await buildMaterialArchiveExport({
      db, selectAll: true,
      readAssetBytes: (folder, filename) => mediaAssets.find(asset => asset.folder === folder && asset.filename === filename)?.bytes,
    });
    assert.ok(validateMaterialArchiveDocument(archive.document).document);
    assert.equal((await db.cards.get(card.id)).target_language, 'en');
    assert.equal(await db.card_knowledge_items.where('card_id').equals(card.id).count(), 0);
    assert.equal((await db.knowledge_attempt_outbox.get('before-move')).knowledge_item_id, rule_code);
  });

  test('D03 material import updates or removes mappings after audio edits without relabelling changed tasks', async () => {
    const { document, mediaAssets } = buildRichCourseFixture();
    const first = document.content.deck[0];
    const originalMetadata = JSON.parse(first.values.metadata);
    const oldSkill = { rule_code: 'fr.test.original', name: 'Original', kind: 'skill', language: 'fr', revision: 1 };
    const newSkill = { ...oldSkill, rule_code: 'fr.test.updated', name: 'Updated' };
    const metadata = (item, mappings) => {
      first.values.metadata = JSON.stringify({ ...originalMetadata,
        ...(mappings && { knowledge: { version: 1, items: [item], mappings } }) });
    };
    const apply = async () => confirmArchiveImport(await inspectArchiveWebBytes(await buildArchiveZipFromDoc(document, mediaAssets),
      'knowledge.zip', { db, userId: STANDALONE_USER_ID }), { db, userId: STANDALONE_USER_ID });
    const mapping = skill => [{ card_id: 201, rule_code: skill.rule_code, role: 'primary' }];
    metadata(oldSkill, mapping(oldSkill));
    await apply();
    const card = await db.cards.filter(row => row.standalone_source_id === 201).first();
    const audio = 'audio/archive_' + 'a'.repeat(64) + '.mp3';
    const edit = async (content, revision) => offlineApi.handle('patch', `/cards/${card.id}`, {
      revision, request_id: `edit-${revision}`, content_v2: content, audio_path: audio,
    }, { _testDb: db });
    await edit(card.content_v2, card.revision);
    metadata(newSkill, null);
    await apply();
    assert.ok(await db.card_knowledge_items.get([card.id, oldSkill.rule_code]));
    metadata(newSkill, mapping(newSkill));
    await apply();
    assert.ok(await db.card_knowledge_items.get([card.id, newSkill.rule_code]));
    assert.equal(await db.card_knowledge_items.get([card.id, oldSkill.rule_code]), undefined);
    assert.ok((await db.cards.get(card.id)).audio_path.endsWith(audio));

    metadata(newSkill, []);
    await apply();
    assert.equal(await db.card_knowledge_items.where('card_id').equals(card.id).count(), 0);
    metadata(newSkill, mapping(newSkill));
    await apply();
    const current = await db.cards.get(card.id);
    const changed = structuredClone(current.content_v2);
    changed.card.data.prompt = 'Un exercice différent';
    await edit(changed, current.revision);
    await apply();
    assert.equal((await db.cards.get(card.id)).content_v2.card.data.prompt, changed.card.data.prompt);
    assert.equal(await db.card_knowledge_items.where('card_id').equals(card.id).count(), 0);
  });

  test('D06 native import rejects catalog conflicts and failed Dexie writes before committing media', async () => {
    const fixture = buildRichCourseFixture();
    const deck = fixture.document.content.deck[0];
    const skill = { rule_code: 'fr.test.conflict', name: 'Original', kind: 'skill', language: 'fr', revision: 1 };
    await db.knowledge_items.put({ id: skill.rule_code, ...skill, parent_key: null, prerequisite_keys: [], cefr_level: null });
    deck.values.metadata = JSON.stringify({ ...JSON.parse(deck.values.metadata), knowledge: {
      version: 1, items: [{ ...skill, name: 'Conflict' }], mappings: [],
    } });
    const entries = fixture.mediaAssets.map(({ folder, filename, sha256, size, mime, path }) => ({
      sha256, size, mime, path, ext: filename.slice(filename.lastIndexOf('.')),
      detectedKind: folder === 'audio' ? 'audio' : 'image',
    }));
    let writes = 0;
    nativeArchive = {
      pickArchiveForImport: async () => {
        const manifestJson = JSON.stringify(fixture.document);
        return { stagingId: 'from-java', manifestJson, manifestSha256: sha256Hex(manifestJson), zipEntries: entries };
      },
      commitImportMedia: async () => { writes += 1; },
      cancelImport: async () => {},
    };
    try {
      const pending = await pickArchiveForImportNative({ db });
      assert.equal(pending.ok, true, pending.error);
      await assert.rejects(() => confirmArchiveImport(pending, { db, userId: STANDALONE_USER_ID }), /conflicting definition/);
      assert.equal(writes, 0);
      await db.knowledge_items.delete(skill.rule_code);
      const fail = () => { throw new Error('Injected card write failure'); };
      db.cards.hook('creating', fail);
      try {
        await assert.rejects(() => confirmArchiveImport(pending, { db, userId: STANDALONE_USER_ID }), /Injected card write failure/);
        assert.equal(writes, 0);
        assert.equal(await db.cards.count(), 0);
      } finally {
        db.cards.hook('creating').unsubscribe(fail);
      }

      const paths = fixture.mediaAssets.map(asset => `${asset.folder}/${asset.filename}`);
      const disk = new Set([paths[0]]);
      const created = new Set(paths.slice(1));
      await db.cards.add({ id: 99, deck_id: 100, image_path: `/api/media/${paths[1]}` });
      nativeArchive.commitImportMedia = async () => {
        for (const path of created) disk.add(path);
        Dexie.currentTransaction.abort();
      };
      nativeArchive.rollbackImportMedia = async ({ stagingId, protectedPaths }) => {
        assert.equal(stagingId, 'from-java');
        assert.deepEqual(protectedPaths, [paths[1]]);
        for (const path of created) if (!protectedPaths.includes(path)) disk.delete(path);
      };
      await assert.rejects(() => confirmArchiveImport(pending, { db, userId: STANDALONE_USER_ID }),
        { name: /^(AbortError|InvalidStateError)$/ });
      assert.deepEqual(disk, new Set(paths.slice(0, 2)));
      assert.deepEqual(await db.cards.toCollection().primaryKeys(), [99]);
      assert.equal(await db.knowledge_items.count(), 0);
    } finally {
      nativeArchive = null;
    }
  });

  test('5. Corrupt/tampered archives, validation violations & commit failures leave zero partial writes', async () => {
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack: getStandalonePack() });
    const beforeDeckCount = await db.decks.count();
    const beforeCardCount = await db.cards.count();
    const encoder = new TextEncoder();

    const base = buildRichCourseFixture();
    const baseManifest = JSON.stringify(base.document);
    const baseSha = sha256Hex(baseManifest);

    // 5a. Wrong manifest.sha256
    const badShaZip = await buildZipArchive([
      { name: 'manifest.json', data: encoder.encode(baseManifest) },
      { name: 'manifest.sha256', data: encoder.encode('0'.repeat(64)) },
      ...base.mediaAssets.map(a => ({ name: a.path, data: a.bytes })),
    ]);
    assert.equal((await inspectArchiveWebBytes(badShaZip, 'bad-sha.zip', { db })).ok, false);

    // 5b. Duplicate JSON key in manifest
    const dupManifest = '{"a":1,"a":2}';
    const dupZip = await buildZipArchive([
      { name: 'manifest.json', data: encoder.encode(dupManifest) },
      { name: 'manifest.sha256', data: encoder.encode(sha256Hex(dupManifest)) },
    ]);
    assert.equal((await inspectArchiveWebBytes(dupZip, 'dup-json.zip', { db })).ok, false);
    assert.throws(() => parseJsonStrictNoDuplicates('{"__proto__":{},"\\u005f_proto__":{}}'), /Повторный ключ/);
    const ownProto = parseJsonStrictNoDuplicates('{"__proto__":{"fake":true}}');
    assert.equal(ownProto.fake, undefined);
    assert.equal(Object.hasOwn(ownProto, '__proto__'), true);

    // 5c. Missing media file in ZIP
    const missingMediaZip = await buildZipArchive([
      { name: 'manifest.json', data: encoder.encode(baseManifest) },
      { name: 'manifest.sha256', data: encoder.encode(baseSha) },
      ...base.mediaAssets.slice(1).map(a => ({ name: a.path, data: a.bytes })),
    ]);
    assert.equal((await inspectArchiveWebBytes(missingMediaZip, 'missing-media.zip', { db })).ok, false);

    // 5d. Corrupted media bytes (wrong SHA/header)
    const fakeBytes = new Uint8Array(200);
    const badMediaZip = await buildZipArchive([
      { name: 'manifest.json', data: encoder.encode(baseManifest) },
      { name: 'manifest.sha256', data: encoder.encode(baseSha) },
      { name: base.mediaAssets[0].path, data: fakeBytes },
      ...base.mediaAssets.slice(1).map(a => ({ name: a.path, data: a.bytes })),
    ]);
    assert.equal((await inspectArchiveWebBytes(badMediaZip, 'bad-media.zip', { db })).ok, false);

    // 5e. Forbidden metadata key, folder cycle, missing parent
    const docSecretMeta = structuredClone(base.document);
    docSecretMeta.content.deck[0].values.metadata = JSON.stringify({ access_token: 'leak' });
    assert.throws(() => validateMaterialArchiveDocument(docSecretMeta), /секрет|состояние/i);

    const docCycle = structuredClone(base.document);
    docCycle.content.folder[0].values.parent_id = 11;
    assert.throws(() => validateMaterialArchiveDocument(docCycle), /Цикл/i);

    const docMissingParent = structuredClone(base.document);
    docMissingParent.content.folder[1].values.parent_id = 99999;
    assert.throws(() => validateMaterialArchiveDocument(docMissingParent), /родитель/i);

    // 5f. Commit media write failure aborts before Dexie writes anything
    const validZip = await buildArchiveZipFromDoc(base.document, base.mediaAssets);
    const validInspected = await inspectArchiveWebBytes(validZip, 'ok.zip', { db, userId: STANDALONE_USER_ID });
    assert.equal(validInspected.ok, true);
    await assert.rejects(() => applyMaterialArchiveImport({
      inspection: validInspected.inspection,
      db,
      userId: STANDALONE_USER_ID,
      commitMedia: async () => { throw new Error('Simulated disk full'); },
    }), /Simulated disk full/);

    assert.equal(await db.decks.count(), beforeDeckCount);
    assert.equal(await db.cards.count(), beforeCardCount);
    assert.equal(await db.folders.count(), 0);

    const failCardWrite = () => { throw new Error('Simulated IndexedDB failure'); };
    db.cards.hook('creating', failCardWrite);
    try {
      await assert.rejects(() => confirmArchiveImport(validInspected, { db, userId: STANDALONE_USER_ID }), /Simulated IndexedDB failure/);
      assert.equal(await db.media.count(), 0);
      assert.equal(await db.folders.count(), 0);
      assert.equal(await db.cards.count(), beforeCardCount);
    } finally {
      db.cards.hook('creating').unsubscribe(failCardWrite);
    }
  });

  test('Accepts the native bridge result, rejects missing or duplicate entries, and releases staging', async () => {
    const fixture = buildRichCourseFixture();
    const entries = fixture.mediaAssets.map(({ folder, filename, sha256, size, mime, path }) => ({
      sha256, size, mime, path,
      ext: filename.slice(filename.lastIndexOf('.')),
      detectedKind: folder === 'audio' ? 'audio' : 'image',
    }));
    const manifestJson = JSON.stringify(fixture.document);
    const cancelled = [];
    let stored = false;
    let zipEntries = entries;
    nativeArchive = {
      pickArchiveForImport: async () => ({
        stagingId: 'from-java',
        fileName: 'native.zip',
        manifestJson,
        manifestSha256: sha256Hex(manifestJson),
        zipEntries,
      }),
      cancelImport: async ({ stagingId }) => { cancelled.push(stagingId); },
      commitImportMedia: async ({ assets }) => { stored = assets.length === entries.length; },
    };
    try {
      for (const badEntries of [entries.slice(1), [...entries, entries[0]]]) {
        zipEntries = badEntries;
        assert.equal((await pickArchiveForImportNative({ db })).ok, false);
      }
      zipEntries = entries;
      const picked = await pickArchiveForImportNative({ db });
      assert.equal(picked.ok, true, picked.error);
      await confirmArchiveImport(picked, { db, userId: STANDALONE_USER_ID });
      assert.equal(stored, true);
      assert.equal(await db.cards.count(), fixture.document.content.card.length);
      assert.deepEqual(cancelled, ['from-java', 'from-java', 'from-java']);
    } finally {
      nativeArchive = null;
    }
  });

  test('6. Selective export tree + ZIP export + fail-closed on missing local media', async () => {
    const v4 = buildRichCourseFixture();
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4.document, v4.mediaAssets), 'v4.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );

    const tree = await getExportableMaterialsTree({ db });
    assert.equal(tree.rootFolders.length, 1);
    assert.equal(tree.rootFolders[0].name, 'Français Root');
    assert.equal(tree.rootFolders[0].subfolderCount, 1);
    assert.equal(tree.rootFolders[0].deckCount, 1);
    assert.equal(tree.rootFolders[0].cardCount, 8);
    assert.equal(tree.unfiledDecks.length, 1);
    assert.equal(tree.unfiledDecks[0].name, 'Library Grammaire');

    // Selective export of root folder only -> omits unfiled Library deck
    const folderExport = await buildWebArchiveZipBytes({
      db,
      folderIds: [tree.rootFolders[0].id],
      now: new Date('2026-11-21T12:00:00Z'),
    });
    assert.equal(folderExport.document.content.folder.length, 2);
    assert.equal(folderExport.document.content.deck.length, 1);
    assert.equal(folderExport.document.content.card.length, 8);
    assert.equal(folderExport.document.source, v4.document.source);
    assert.deepEqual(folderExport.document.content.deck.map(row => row.id), [101]);

    const roundtripInspect = await inspectArchiveWebBytes(folderExport.zipBytes, folderExport.fileName, { db, userId: STANDALONE_USER_ID });
    assert.equal(roundtripInspect.ok, true, roundtripInspect.error);
    assert.equal(roundtripInspect.inspection.preview.newCards, 0);

    // Verify stored web media bytes are exact
    const asset0 = v4.mediaAssets[0];
    const readBack = await readWebMediaAssetBytes(db, asset0.folder, asset0.filename);
    assert.deepEqual(readBack, asset0.bytes);

    // Delete 1 required media blob from IndexedDB -> export must fail closed
    await db.media.delete(`/api/media/${asset0.folder}/${asset0.filename}`);
    await assert.rejects(() => buildMaterialArchiveExport({
      db,
      folderIds: [tree.rootFolders[0].id],
      readAssetBytes: (folder, filename) => readWebMediaAssetBytes(db, folder, filename),
    }), /Отсутствует/i);
  });

  test('D04 Knowledge and SRS share material aliases and refuse ambiguous restore matches', async () => {
    const { document, mediaAssets } = buildRichCourseFixture();
    const userId = STANDALONE_USER_ID;
    const pack = getStandalonePack();
    const rule_code = 'fr.test.restore';
    const first = document.content.deck[0];
    first.values.metadata = JSON.stringify({ ...JSON.parse(first.values.metadata), knowledge: {
      version: 1, items: [{ rule_code, name: 'Restore', kind: 'skill', language: 'fr', revision: 1 }],
      mappings: [{ card_id: 201, rule_code, role: 'primary' }],
    } });
    await confirmArchiveImport(await inspectArchiveWebBytes(await buildArchiveZipFromDoc(document, mediaAssets),
      'source.zip', { db, userId }), { db, userId });
    const card = await db.cards.filter(row => row.standalone_source_id === 201).first();
    await offlineApi.handle('post', '/study/grade', { card_id: card.id, action_id: 'restorable', grade: 2, return_next: false }, { _testDb: db });
    await db.decks.update(card.deck_id, { standalone_local_edit: true });
    const archive = await buildMaterialArchiveExport({ db, deckIds: [card.deck_id],
      readAssetBytes: (folder, filename) => mediaAssets.find(asset => asset.folder === folder && asset.filename === filename)?.bytes,
    });
    assert.notEqual(archive.document.source, document.source);
    const { backup } = await exportProgressBackup({ db, userId, pack });
    assert.equal(backup.integrity.scope, 'full-v3');
    const legacy = structuredClone(backup);
    delete legacy.knowledge_attempts[0].material_key;
    legacy.integrity.payload_hash = computeBackupHash(legacy);
    const fresh = createStandaloneTestDb('LerneStandaloneDB_KnowledgeAliases');
    try {
      await applyProgressBackup(backup, { db: fresh, userId, pack });
      assert.equal((await fresh.knowledge_attempt_outbox.get('restorable')).card_id, null);
      const assets = archive.assets.map(asset => ({ ...asset, bytes: archive.blobsBySha.get(asset.sha256) }));
      const inspected = await inspectArchiveWebBytes(await buildArchiveZipFromDoc(archive.document, assets),
        'new-source.zip', { db: fresh, userId });
      await confirmArchiveImport(inspected, { db: fresh, userId });
      const target = await fresh.cards.filter(row => row.standalone_source_id === card.id).first();
      assert.notEqual(target.standalone_card_key, card.standalone_card_key);
      await fresh.cards.add({ ...target, id: target.id + 100, standalone_card_key: card.standalone_card_key });
      assert.equal((await applyProgressBackup(backup, { db: fresh, userId, pack })).unmatchedImportedRecords, 1);
      assert.equal((await fresh.knowledge_attempt_outbox.get('restorable')).card_id, null);
      assert.equal(await fresh.progress.count(), 0);
      await fresh.cards.delete(target.id + 100);
      await applyProgressBackup(legacy, { db: fresh, userId, pack });
      assert.equal((await fresh.knowledge_attempt_outbox.get('restorable')).card_id, target.id);
      assert.ok(await fresh.progress.get([target.id, userId]));
    } finally {
      await fresh.delete();
    }
  });

  test('7. Progress backup emits full-v1 without imported progress and full-v2 across different local IDs', async () => {
    const pack = getStandalonePack();
    validateStandalonePack(pack);
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });

    // Record SRS on built-in card 1
    const builtinProg = calculateCardReview({
      card_id: pack.cards[0].id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 3, false, 'scheduled', new Date('2026-11-20T08:00:00.000Z'));
    await db.progress.put(builtinProg);

    // Without imported decks/progress -> remains full-v1
    const v1Backup = await exportProgressBackup({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(v1Backup.backup.integrity.scope, PROGRESS_BACKUP_INTEGRITY_SCOPE);
    assert.equal(v1Backup.backup.imported_records, undefined);

    // Import target course + another unimported course B
    const mainCourse = buildRichCourseFixture({ source: `Supabase:${'c'.repeat(64)}` });
    const otherCourse = buildRichCourseFixture({ source: `Supabase:${'d'.repeat(64)}`, version: 3, targetLanguage: 'es' });
    otherCourse.document.source_users[0].name = 'Another author';
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(mainCourse.document, mainCourse.mediaAssets), 'main.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(otherCourse.document, otherCourse.mediaAssets), 'other.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );

    const allCardsBefore = await db.cards.toArray();
    const mainCard = allCardsBefore.find(c => c.standalone_source === mainCourse.document.source && c.standalone_source_id === 201);
    const otherCard = allCardsBefore.find(c => c.standalone_source === otherCourse.document.source && c.standalone_source_id === 201);
    const mainDeck = (await db.decks.toArray()).find(d => d.standalone_source === mainCourse.document.source && d.name === 'Cours Complet');
    await db.decks.update(mainDeck.id, { is_learning: true });

    const importedProg1 = calculateCardReview({
      card_id: mainCard.id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 2, false, 'scheduled', new Date('2026-11-20T09:00:00.000Z'));
    const importedProg2 = calculateCardReview({
      card_id: otherCard.id,
      user_id: STANDALONE_USER_ID,
      queue: 'new',
      step_index: 0,
      interval: 0,
      ease_factor: 2.5,
      repetitions: 0,
      lapses: 0,
    }, 1, false, 'scheduled', new Date('2026-11-20T09:05:00.000Z'));
    await db.progress.bulkPut([importedProg1, importedProg2]);

    const v2Backup = await exportProgressBackup({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(v2Backup.backup.integrity.scope, PROGRESS_BACKUP_INTEGRITY_SCOPE_V2);
    assert.equal(v2Backup.backup.imported_records.length, 2);

    // Wipe DB -> import DIFFERENT filler course first so mainCourse receives shifted local IDs!
    const db2 = createStandaloneTestDb(`LerneStandaloneDB_${900200 + dbCounter}`);
    await db2.open();
    await initOfflineMediaStore(db2);
    await ensureStandaloneSeed({ db: db2, userId: STANDALONE_USER_ID, pack });

    const filler = buildRichCourseFixture({ source: `Supabase:${'e'.repeat(64)}`, version: 3, targetLanguage: 'it' });
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(filler.document, filler.mediaAssets), 'filler.zip', { db: db2, userId: STANDALONE_USER_ID }),
      { db: db2, userId: STANDALONE_USER_ID },
    );
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(mainCourse.document, mainCourse.mediaAssets), 'main.zip', { db: db2, userId: STANDALONE_USER_ID }),
      { db: db2, userId: STANDALONE_USER_ID },
    );

    const relocatedCard = (await db2.cards.toArray()).find(
      c => c.standalone_source === mainCourse.document.source && c.standalone_source_id === 201
    );
    assert.notEqual(relocatedCard.id, mainCard.id, 'Imported card should receive a different local ID after shifted import order');

    const inspectedBackup = await inspectProgressBackup(v2Backup.json, { db: db2, pack });
    assert.equal(inspectedBackup.ok, true, inspectedBackup.error);
    assert.equal(inspectedBackup.preview.matchedImportedRecords, 1);
    assert.equal(inspectedBackup.preview.unmatchedImportedRecords, 1);

    const restored = await applyProgressBackup(v2Backup.json, { db: db2, userId: STANDALONE_USER_ID, pack });
    assert.equal(restored.restoredBuiltInRecords, 1);
    assert.equal(restored.restoredImportedRecords, 1);
    assert.equal(restored.unmatchedImportedRecords, 1);

    const restoredMainProg = await db2.progress.get([relocatedCard.id, STANDALONE_USER_ID]);
    assert.equal(restoredMainProg.interval, importedProg1.interval);
    assert.equal(restoredMainProg.next_review, importedProg1.next_review);
    const relocatedDeck = (await db2.decks.toArray()).find(
      d => d.standalone_source === mainCourse.document.source && d.name === 'Cours Complet'
    );
    assert.equal(relocatedDeck.is_learning, true);

    // Restoring the older backup must leave reviews that were not in that backup intact.
    const anotherCard = (await db2.cards.where('deck_id').equals(relocatedDeck.id).toArray())
      .find(card => card.id !== relocatedCard.id);
    const newerReview = { ...importedProg2, card_id: anotherCard.id };
    await db2.progress.put(newerReview);
    await applyProgressBackup(v2Backup.json, { db: db2, userId: STANDALONE_USER_ID, pack });
    assert.deepEqual(await db2.progress.get([anotherCard.id, STANDALONE_USER_ID]), newerReview);

    // A selection spanning two sources uses the exporting database's own identity.
    const mixed = await buildWebArchiveZipBytes({ db, deckIds: [mainCard.deck_id, otherCard.deck_id] });
    assert.match(mixed.document.source, /^LOCAL:[a-f0-9]{64}$/);
    assert.deepEqual(new Set(mixed.document.source_users.map(user => user.name)), new Set(['Admin Author', 'Another author']));
    const selfImport = await inspectArchiveWebBytes(mixed.zipBytes, mixed.fileName, { db });
    assert.equal(selfImport.ok, true, selfImport.error);
    assert.equal(selfImport.inspection.preview.newCards, 0);
    await confirmArchiveImport(selfImport, { db, userId: STANDALONE_USER_ID });
    assert.equal(await db.cards.count(), allCardsBefore.length);

    const cleanDb = createStandaloneTestDb(`LerneStandaloneDB_clean_${dbCounter}`);
    await cleanDb.open();
    const mixedImport = await inspectArchiveWebBytes(mixed.zipBytes, mixed.fileName, { db: cleanDb });
    assert.equal(mixedImport.ok, true, mixedImport.error);
    await confirmArchiveImport(mixedImport, { db: cleanDb, userId: STANDALONE_USER_ID });
    const restoredMixed = await applyProgressBackup(v2Backup.json, { db: cleanDb, userId: STANDALONE_USER_ID, pack });
    assert.equal(restoredMixed.restoredImportedRecords, 2);
    assert.equal(restoredMixed.unmatchedImportedRecords, 0);
    await cleanDb.delete();
  });

  test('8. Option A2 ZIP re-import preserves local folder/deck edits & trash, and full-v2 restores user-created decks', async () => {
    const pack = getStandalonePack();
    await ensureStandaloneSeed({ db, userId: STANDALONE_USER_ID, pack });
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));
    const cfg = { _testDb: db };

    const v4a = buildRichCourseFixture({ source: `Supabase:${'f'.repeat(64)}`, updatedExplanation: 'V1 note' });
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4a.document, v4a.mediaAssets), 'a2-v1.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );

    const rootFolder = (await db.folders.toArray()).find(f => f.name === 'Français Root');
    const moduleFolder = (await db.folders.toArray()).find(f => f.name === 'Module 1');
    const coursDeck = (await db.decks.toArray()).find(d => d.name === 'Cours Complet');
    const libDeck = (await db.decks.toArray()).find(d => d.name === 'Library Grammaire');

    // User renames, recolors, moves, pins, and trashes imported containers via offlineApi
    await offlineApi.handle('post', `/folders/${rootFolder.id}/rename`, { name: 'My Custom Root' }, cfg);
    await offlineApi.handle('post', `/folders/${rootFolder.id}/color`, { color: '#ef4444' }, cfg);
    await offlineApi.handle('post', `/decks/${coursDeck.id}/rename`, { name: 'My Cours' }, cfg);
    await offlineApi.handle('post', `/decks/${coursDeck.id}/move`, { folder_id: rootFolder.id }, cfg);
    await offlineApi.handle('post', `/decks/${coursDeck.id}/pin`, {}, cfg);
    await offlineApi.handle('post', `/decks/${coursDeck.id}/toggle-learning`, { is_learning: true }, cfg);
    await offlineApi.handle('delete', `/decks/${libDeck.id}`, null, cfg);
    await offlineApi.handle('delete', `/folders/${moduleFolder.id}`, null, cfg);

    // Re-import updated ZIP from the same source -> must NOT revert local edits or resurrect trashed items
    const v4b = buildRichCourseFixture({
      source: `Supabase:${'f'.repeat(64)}`,
      updatedExplanation: 'V2 note from teacher',
      includeExtraCard: true,
    });
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4b.document, v4b.mediaAssets), 'a2-v2.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );

    const foldersAfter = await db.folders.toArray();
    const decksAfter = await db.decks.toArray();
    assert.equal(foldersAfter.length, 2, 'Origin key matching must prevent duplicate folders');
    assert.equal(decksAfter.filter(d => d.standalone_source === v4b.document.source).length, 2, 'Origin key matching must prevent duplicate decks');

    const rootAfter = await db.folders.get(rootFolder.id);
    assert.equal(rootAfter.name, 'My Custom Root');
    assert.equal(rootAfter.color, '#ef4444');
    assert.equal(rootAfter.standalone_local_edit, true);

    const moduleAfter = await db.folders.get(moduleFolder.id);
    assert.equal(moduleAfter.is_deleted, 1);

    const coursAfter = await db.decks.get(coursDeck.id);
    assert.equal(coursAfter.name, 'My Cours');
    assert.equal(coursAfter.folder_id, rootFolder.id);
    assert.equal(coursAfter.is_pinned, true);
    assert.equal(coursAfter.is_learning, true);
    assert.equal(coursAfter.role, 'owner');
    assert.equal(coursAfter.is_global_readonly, false);
    // Unedited card in coursDeck still receives updated explanation + new card added
    const coursCards = await db.cards.where('deck_id').equals(coursDeck.id).toArray();
    assert.equal(coursCards.length, 9);
    assert.equal(coursCards.find(c => c.standalone_source_id === 201).content_v2.card.explanation, 'V2 note from teacher');

    const libAfter = await db.decks.get(libDeck.id);
    assert.equal(libAfter.is_deleted, 1);

    // User-created local deck + card -> full-v2 progressBackup restores is_learning + SRS for both ZIP & user-created decks
    const userDeck = (await offlineApi.handle('post', '/decks', { name: 'User Deck', target_language: 'de' }, cfg)).data;
    assert.ok(userDeck.id > IMPORTED_ID_START);
    assert.ok(userDeck.standalone_deck_key);
    await offlineApi.handle('post', `/decks/${userDeck.id}/toggle-learning`, { is_learning: true }, cfg);
    const userCard = (await offlineApi.handle('post', '/cards/save', {
      deck_id: userDeck.id,
      request_id: 'user-card-backup-1',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Eigen', answer: 'Свой' } } },
    }, cfg)).data;
    await offlineApi.handle('post', '/study/grade', {
      card_id: userCard.id, grade: 2, action_id: 'grade-user-backup-1', return_next: false,
    }, cfg);

    const backup = await exportProgressBackup({ db, userId: STANDALONE_USER_ID, pack });
    assert.equal(backup.backup.integrity.scope, PROGRESS_BACKUP_INTEGRITY_SCOPE_V2);

    // Clear learning toggles & progress, then apply backup
    await offlineApi.handle('post', `/decks/${coursDeck.id}/toggle-learning`, { is_learning: false }, cfg);
    await offlineApi.handle('post', `/decks/${userDeck.id}/toggle-learning`, { is_learning: false }, cfg);
    await db.progress.clear();

    const inspectedBackup = await inspectProgressBackup(backup.json, { db, userId: STANDALONE_USER_ID, pack });
    assert.equal(inspectedBackup.ok, true);
    await applyProgressBackup(inspectedBackup.backup, { db, userId: STANDALONE_USER_ID, pack });

    assert.equal((await db.decks.get(coursDeck.id)).is_learning, true);
    assert.equal((await db.decks.get(userDeck.id)).is_learning, true);
    assert.equal((await db.progress.get([userCard.id, STANDALONE_USER_ID])).repetitions, 1);
  });

  test('9. Native listMediaAssets and Web media reconciliation restore missing syncState without deleting missing-file rows', async () => {
    const pngAsset = assetRecord(makePngBytes(3, 3), 'images', '.png', 'image/png');
    const mp4Asset = assetRecord(makeMp4Bytes(), 'videos', '.mp4', 'video/mp4');
    const missingKey = `offline-media:audio/archive_${'0'.repeat(64)}.wav`;
    await db.syncState.put({
      key: missingKey,
      folder: 'audio',
      filename: `archive_${'0'.repeat(64)}.wav`,
      sha256: '0'.repeat(64),
      size: 128,
      mime: 'audio/wav',
      path: `media/${'0'.repeat(64)}.wav`,
    });

    nativeArchive = {
      pickArchiveForImport: async () => ({ cancelled: true }),
      commitImportMedia: async () => ({ storedCount: 0, reusedCount: 0 }),
      cancelImport: async () => ({ cancelled: true }),
      listMediaAssets: async () => ({
        mediaRoot: '/data/user/0/com.lerne.offlinepilot/files/lerne-offline-media',
        assets: [
          {
            folder: pngAsset.folder,
            filename: pngAsset.filename,
            relativePath: `${pngAsset.folder}/${pngAsset.filename}`,
            sha256: pngAsset.sha256,
            size: pngAsset.size,
            mime: pngAsset.mime,
            path: pngAsset.path,
          },
          {
            folder: mp4Asset.folder,
            filename: mp4Asset.filename,
            relativePath: `${mp4Asset.folder}/${mp4Asset.filename}`,
            sha256: mp4Asset.sha256,
            size: mp4Asset.size,
            mime: mp4Asset.mime,
            path: mp4Asset.path,
          },
        ],
        invalid: [{ relativePath: 'images/corrupt.png', reason: 'SHA-256 mismatch' }],
      }),
    };

    try {
      const nativeRes = await initOfflineMediaStore(db);
      assert.equal(nativeRes.mode, 'native');
      assert.equal(nativeRes.reconciledCount, 2);
      assert.equal(nativeRes.invalidCount, 1);

      const restoredPng = await db.syncState.get(`offline-media:${pngAsset.folder}/${pngAsset.filename}`);
      const restoredMp4 = await db.syncState.get(`offline-media:${mp4Asset.folder}/${mp4Asset.filename}`);
      assert.equal(restoredPng?.sha256, pngAsset.sha256);
      assert.equal(restoredMp4?.mime, 'video/mp4');
      assert.ok(await db.syncState.get(missingKey), 'Missing-file syncState row must be preserved for fail-closed export');

      const resolvedVideo = resolveOfflineMediaUrlSync(`/api/media/videos/${mp4Asset.filename}`, 'videos');
      assert.ok(resolvedVideo?.includes(mp4Asset.filename));
    } finally {
      nativeArchive = null;
      clearResolverCache();
      clearOfflineMediaCache();
    }

    // Web Dexie reconciliation: restores valid media blob without syncState, ignores corrupt blob without deleting
    const webDb = createStandaloneTestDb(`LerneStandaloneDB_web_reconcile_${dbCounter}`);
    await webDb.open();
    try {
      const validUrl = `/api/media/${pngAsset.folder}/${pngAsset.filename}`;
      const corruptUrl = `/api/media/images/archive_${'f'.repeat(64)}.png`;
      await webDb.media.put({ url: validUrl, blob: new Blob([pngAsset.bytes], { type: 'image/png' }) });
      await webDb.media.put({ url: corruptUrl, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });

      const webRes = await initOfflineMediaStore(webDb);
      assert.equal(webRes.mode, 'web');
      assert.equal(webRes.reconciledCount, 1);

      const repairedRow = await webDb.syncState.get(`offline-media:${pngAsset.folder}/${pngAsset.filename}`);
      assert.equal(repairedRow?.sha256, pngAsset.sha256);
      assert.equal(await webDb.syncState.get(`offline-media:images/archive_${'f'.repeat(64)}.png`), undefined);
      assert.ok(await webDb.media.get(corruptUrl), 'Corrupt media row must not be auto-deleted');
      assert.ok(resolveOfflineMediaUrlSync(validUrl, 'images')?.startsWith('blob:'));

      // setWebBlobUrl revokes overwritten blob URLs
      const revoked = [];
      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = (u) => {
        revoked.push(u);
        return origRevoke.call(URL, u);
      };
      try {
        const firstBlob = URL.createObjectURL(new Blob(['one']));
        const secondBlob = URL.createObjectURL(new Blob(['two']));
        setWebBlobUrl('/api/media/images/overwrite.png', firstBlob);
        setWebBlobUrl('/api/media/images/overwrite.png', secondBlob);
        assert.deepEqual(revoked, [firstBlob]);
      } finally {
        URL.revokeObjectURL = origRevoke;
      }
    } finally {
      await webDb.delete();
    }
  });

  test('10. Export recovers missing offline-media metadata via recoverNativeAsset and fails closed if missing or corrupted', async () => {
    const v4 = buildRichCourseFixture();
    await confirmArchiveImport(
      await inspectArchiveWebBytes(await buildArchiveZipFromDoc(v4.document, v4.mediaAssets), 'recover.zip', { db, userId: STANDALONE_USER_ID }),
      { db, userId: STANDALONE_USER_ID },
    );

    const pngAsset = v4.mediaAssets[0];
    const missingMetaKey = `offline-media:${pngAsset.folder}/${pngAsset.filename}`;
    await db.syncState.delete(missingMetaKey);
    assert.equal(await db.syncState.get(missingMetaKey), undefined);

    const tree = await getExportableMaterialsTree({ db });
    const folderId = tree.rootFolders[0].id;

    // 10a. Corrupted file on disk -> fail closed and do NOT persist metadata
    await assert.rejects(() => buildMaterialArchiveExport({
      db,
      folderIds: [folderId],
      inspectNativeAssets: async () => ({ missing: [], corrupted: [], verifiedCount: 4 }),
      recoverNativeAsset: async (ref) => ref.filename === pngAsset.filename
        ? { exists: true, valid: false, reason: 'SHA-256 mismatch' }
        : { exists: false, valid: false },
    }), /Отсутствуют метаданные/);
    assert.equal(await db.syncState.get(missingMetaKey), undefined);

    // 10b. Missing file on disk -> fail closed
    await assert.rejects(() => buildMaterialArchiveExport({
      db,
      folderIds: [folderId],
      inspectNativeAssets: async () => ({ missing: [], corrupted: [], verifiedCount: 4 }),
      recoverNativeAsset: async () => ({ exists: false, valid: false }),
    }), /Отсутствуют метаданные/);

    // 10c. Valid file on disk -> self-heals syncState and succeeds
    const exported = await buildMaterialArchiveExport({
      db,
      folderIds: [folderId],
      inspectNativeAssets: async () => ({ missing: [], corrupted: [], verifiedCount: 4 }),
      recoverNativeAsset: async (ref) => {
        const asset = v4.mediaAssets.find(a => a.folder === ref.folder && a.filename === ref.filename);
        return asset
          ? {
            exists: true,
            valid: true,
            folder: asset.folder,
            filename: asset.filename,
            sha256: asset.sha256,
            size: asset.size,
            mime: asset.mime,
            path: asset.path,
          }
          : { exists: false, valid: false };
      },
    });
    assert.equal(exported.assets.length, 4);
    const healed = await db.syncState.get(missingMetaKey);
    assert.equal(healed?.sha256, pngAsset.sha256);
    assert.equal(healed?.size, pngAsset.size);
  });

  test('11. Deck metadata resources reject ephemeral URLs, normalize to canonical refs, support videos, and round-trip ZIP', async () => {
    memStorage.set('lerne_user_id', String(STANDALONE_USER_ID));
    const cfg = { _testDb: db };
    const deck = (await offlineApi.handle('post', '/decks', { name: 'Media Resources Deck', target_language: 'de' }, cfg)).data;

    const pngBytes = makePngBytes(4, 4);
    const wavBytes = makeWavBytes(400);
    const mp4Bytes = makeMp4Bytes();

    const makeFileObj = (bytes, name, type) => {
      const blob = new Blob([bytes], { type });
      blob.name = name;
      return blob;
    };

    const imgStored = await storeLocalMediaFile(makeFileObj(pngBytes, 'cover.png', 'image/png'), 'images', { db });
    const audStored = await storeLocalMediaFile(makeFileObj(wavBytes, 'track.wav', 'audio/wav'), 'audio', { db });
    const vidStored = await storeLocalMediaFile(makeFileObj(mp4Bytes, 'clip.mp4', 'video/mp4'), 'videos', { db });

    assert.match(imgStored.path, /^\/api\/media\/images\/archive_[a-f0-9]{64}\.png$/);
    assert.match(audStored.path, /^\/api\/media\/audio\/archive_[a-f0-9]{64}\.wav$/);
    assert.match(vidStored.path, /^\/api\/media\/videos\/archive_[a-f0-9]{64}\.mp4$/);
    assert.equal(vidStored.mime, 'video/mp4');

    // Ephemeral blob:/_capacitor_file_ URL without valid canonical path must fail closed
    await assert.rejects(() => offlineApi.handle('post', `/decks/${deck.id}/metadata`, {
      resources: [{ type: 'image', url: 'blob:https://localhost/ephemeral-only', title: 'Broken' }],
    }, cfg), /локальный медиафайл/i);

    await assert.rejects(() => offlineApi.handle('post', `/decks/${deck.id}/metadata`, {
      resources: [{ type: 'video', path: imgStored.path, url: imgStored.path, title: 'Wrong folder' }],
    }, cfg), /локальный медиафайл/i);

    // Saving metadata with resolved UI URLs alongside canonical paths must strip ephemeral URLs in Dexie
    await offlineApi.handle('post', `/decks/${deck.id}/metadata`, {
      imageHeight: 260,
      resources: [
        { type: 'image', path: imgStored.path, url: 'blob:https://localhost/ui-temp-img', title: 'Cover', show_in_cards: true },
        { type: 'audio', path: audStored.path, url: '/_capacitor_file_/data/user/0/app/files/audio.wav', title: 'Track' },
        { type: 'video', path: vidStored.path, url: vidStored.url, title: 'Clip' },
        { type: 'link', url: 'https://example.com/grammar', title: 'Notes' },
      ],
    }, cfg);

    const savedDeck = await db.decks.get(deck.id);
    assert.equal(savedDeck.metadata.resources.length, 4);
    assert.equal(savedDeck.metadata.resources[0].path, imgStored.path);
    assert.equal(savedDeck.metadata.resources[0].url, imgStored.path);
    assert.equal(savedDeck.metadata.resources[1].path, audStored.path);
    assert.equal(savedDeck.metadata.resources[1].url, audStored.path);
    assert.equal(savedDeck.metadata.resources[2].path, vidStored.path);
    assert.equal(savedDeck.metadata.resources[2].url, vidStored.path);
    assert.equal(savedDeck.metadata.resources[3].url, 'https://example.com/grammar');

    // GET /init returns resolved blob URLs for display while keeping durable canonical path
    const initRes = await offlineApi.handle('get', '/init', {}, cfg);
    const apiDeck = initRes.data.decks.find(d => d.id === deck.id);
    assert.ok(apiDeck.metadata.resources[0].url.startsWith('blob:'));
    assert.equal(apiDeck.metadata.resources[0].path, imgStored.path);
    assert.ok(apiDeck.metadata.resources[2].url.startsWith('blob:'));
    assert.equal(apiDeck.metadata.resources[2].path, vidStored.path);

    // Add a card so deck exports cleanly and verify full image/audio/video ZIP roundtrip
    await offlineApi.handle('post', '/cards/save', {
      deck_id: deck.id,
      request_id: 'media-deck-card-1',
      content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Video', answer: 'Видео' } } },
    }, cfg);

    const exported = await buildWebArchiveZipBytes({ db, deckIds: [deck.id] });
    assert.equal(exported.document.assets.length, 3);

    const cleanDb = createStandaloneTestDb(`LerneStandaloneDB_media_rt_${dbCounter}`);
    await cleanDb.open();
    try {
      await initOfflineMediaStore(cleanDb);
      const inspected = await inspectArchiveWebBytes(exported.zipBytes, exported.fileName, { db: cleanDb, userId: STANDALONE_USER_ID });
      assert.equal(inspected.ok, true, inspected.error);
      await confirmArchiveImport(inspected, { db: cleanDb, userId: STANDALONE_USER_ID });

      const importedDeck = (await cleanDb.decks.toArray()).find(d => d.name === 'Media Resources Deck');
      assert.equal(importedDeck.metadata.resources.length, 4);
      assert.equal(importedDeck.metadata.resources[2].path, vidStored.path);
      assert.deepEqual(await readWebMediaAssetBytes(cleanDb, 'videos', vidStored.relativePath.split('/')[1]), mp4Bytes);
    } finally {
      await cleanDb.delete();
    }
  });

  test('12. closeLocalDb / clearMediaCache(db.name) revokes blob URLs without wiping native media config and resolveOfflineMediaUrlAsync lazily re-inits if reset', async () => {
    const pngAsset = assetRecord(makePngBytes(3, 3), 'images', '.png', 'image/png');
    const canonicalImgUrl = `/api/media/${pngAsset.folder}/${pngAsset.filename}`;
    const mediaRoot = '/data/user/0/com.lerne.offlinepilot/files/lerne-offline-media';
    let listCalls = 0;

    nativeArchive = {
      pickArchiveForImport: async () => ({ cancelled: true }),
      commitImportMedia: async () => ({ storedCount: 0, reusedCount: 0 }),
      cancelImport: async () => ({ cancelled: true }),
      listMediaAssets: async () => {
        listCalls += 1;
        return {
          mediaRoot,
          assets: [{
            folder: pngAsset.folder,
            filename: pngAsset.filename,
            relativePath: `${pngAsset.folder}/${pngAsset.filename}`,
            sha256: pngAsset.sha256,
            size: pngAsset.size,
            mime: pngAsset.mime,
            path: pngAsset.path,
          }],
          invalid: [],
        };
      },
    };

    const revoked = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      return origRevoke.call(URL, url);
    };

    let localDb = null;
    let reopenedDb = null;
    try {
      localDb = await prepareLocalDb();
      await initOfflineMediaStore(localDb);
      assert.equal(listCalls, 1);
      assert.equal(getNativeMediaRoot(), mediaRoot);

      const staleBlobUrl = URL.createObjectURL(new Blob(['stale-web-blob']));
      setWebBlobUrl('/api/media/images/stale.png', staleBlobUrl);
      assert.equal(getWebBlobUrl('/api/media/images/stale.png'), staleBlobUrl);

      // Simulate closeLocalDb -> onLocalDbClose -> clearMediaCache(localDb.name)
      closeLocalDb(STANDALONE_USER_ID);
      assert.equal(revoked.includes(staleBlobUrl), true);
      assert.equal(getWebBlobUrl('/api/media/images/stale.png'), null);
      assert.equal(getNativeMediaRoot(), mediaRoot);

      reopenedDb = await prepareLocalDb();
      assert.notEqual(reopenedDb, localDb);
      assert.ok(resolveOfflineMediaUrlSync(canonicalImgUrl, 'images')?.includes(pngAsset.filename));
      const resolvedAfterClose = await resolveOfflineMediaUrlAsync(reopenedDb, canonicalImgUrl, 'images');
      assert.ok(resolvedAfterClose?.includes(pngAsset.filename));
      assert.equal(listCalls, 1, 'Native config preserved across single-DB close without extra IPC');

      // Direct clearMediaCache(db.name) also revokes webBlobUrls while keeping nativeMediaRoot
      const staleBlobUrl2 = URL.createObjectURL(new Blob(['stale-web-blob-2']));
      setWebBlobUrl('/api/media/images/stale2.png', staleBlobUrl2);
      clearMediaCache(reopenedDb.name);
      assert.equal(revoked.includes(staleBlobUrl2), true);
      assert.equal(getWebBlobUrl('/api/media/images/stale2.png'), null);
      assert.equal(getNativeMediaRoot(), mediaRoot);

      // Full reset clears nativeMediaRoot -> resolveOfflineMediaUrlAsync lazily re-initializes native store
      clearOfflineMediaCache();
      assert.equal(getNativeMediaRoot(), null);
      const lazyResolved = await resolveOfflineMediaUrlAsync(reopenedDb, canonicalImgUrl, 'images');
      assert.ok(lazyResolved?.includes(pngAsset.filename));
      assert.equal(getNativeMediaRoot(), mediaRoot);
      assert.equal(listCalls, 2);
    } finally {
      resetAllDatabases();
      nativeArchive = null;
      clearResolverCache();
      clearOfflineMediaCache();
      URL.revokeObjectURL = origRevoke;
      if (reopenedDb) await reopenedDb.delete().catch(() => {});
      if (localDb && localDb !== reopenedDb) await localDb.delete().catch(() => {});
    }
  });
});
