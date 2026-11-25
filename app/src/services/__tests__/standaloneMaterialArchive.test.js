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
      cancelImport: (...args) => nativeArchive.cancelImport(...args),
    } : capacitor.registerPlugin(name),
  },
});
const { isOfflineMediaUrl, resolveOfflineMediaUrlSync, clearOfflineMediaCache: clearResolverCache } = await import('../../pilot/offlineMediaResolver.js');

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
const { ensureStandaloneSeed, validateStandalonePack } = await import('../../pilot/standaloneSeed.js');
const { getStandalonePack } = await import('../../pilot/standalonePack.js');
const {
  PROGRESS_BACKUP_INTEGRITY_SCOPE,
  PROGRESS_BACKUP_INTEGRITY_SCOPE_V2,
  exportProgressBackup,
  inspectProgressBackup,
  applyProgressBackup,
} = await import('../../pilot/progressBackup.js');
const { offlineApi } = await import('../offlineApi.js');
const { cardMediaView } = await import('../mediaCache.js');
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
});
