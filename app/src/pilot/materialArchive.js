import { prepareLocalDb } from '../services/localDb.js';
import { getUserId } from '../utils/auth.js';
import { studySideText } from '../utils/structuredStudyCard.js';
import { validateNativeV2Content } from '../utils/nativeV2Contract.js';
import { assertArchiveSafeMetadata } from './materialMetadataPolicy.js';
import { getStandaloneProfileName, STANDALONE_USER_ID } from '../utils/standaloneMode.js';
import {
  buildOriginKey,
  getMaterialExportSource,
  ID_COUNTERS_KEY,
  IMPORTED_ID_START,
  MATERIAL_EXPORT_SOURCE_KEY,
} from './materialArchiveIdentity.js';
import { canonicalJson } from './progressBackup.js';
import { sha256BytesHex, sha256Hex } from './sha256.js';
import { OFFLINE_MEDIA_KEY_PREFIX, parseOfflineMediaRef } from './offlineMediaResolver.js';

export { ID_COUNTERS_KEY, IMPORTED_ID_START };

export const MATERIAL_ARCHIVE_FORMAT = 'lerne-materials';
export const MATERIAL_ARCHIVE_EXPORT_VERSION = 4;
export const SUPPORTED_ARCHIVE_VERSIONS = new Set([2, 3, 4]);
export const ARCHIVE_LIMITS = { folder: 10000, deck: 20000, card: 100000 };
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_ASSETS = 10000;
export const IMPORT_REGISTRY_KEY = 'standalone_import_registry';

const ARCHIVE_TOKEN_RE = /archive:\/\/[a-f0-9]{64}/g;
const ARCHIVE_TOKEN_FULL_RE = /^archive:\/\/[a-f0-9]{64}$/;
const SOURCE_IDENTITY_RE = /^(?:LOCAL|Supabase):[a-f0-9]{64}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ASSET_PATH_RE = /^media\/([a-f0-9]{64})\.[a-z0-9]{2,4}$/;
const CHAR_FIELD_MAX = 255;
const TEXT_FIELD_MAX = 2_000_000;
export const FOLDER_FIELDS = ['name', 'color', 'target_language', 'position', 'is_deleted', 'parent_id'];
export const DECK_V3_FIELDS = ['name', 'level', 'topic', 'target_language', 'position', 'is_deleted', 'folder_id', 'metadata'];
export const DECK_V4_FIELDS = [...DECK_V3_FIELDS, 'scope', 'category_id', 'is_default'];
export const CARD_FIELDS = [
  'content_v2', 'image_path', 'audio_path', 'audio_back_path',
  'video_front_path', 'video_back_path', 'difficulty', 'source',
  'position', 'is_deleted', 'deck_id',
];
export const CARD_ATTACHMENTS = {
  image_path: 'image',
  audio_path: 'audio',
  audio_back_path: 'audio',
  video_front_path: 'video',
  video_back_path: 'video',
};
export const ROLE_TO_FOLDER = {
  image: 'images',
  audio: 'audio',
  video: 'videos',
  background: 'backgrounds',
};
const INLINE_URI_RE = /(?:https?:\/\/[^\s"'<>()[\]{}]+|\/api\/media\/(?:images|audio|videos|backgrounds|tma-audio)\/[^\s"'<>()[\]{}]+)/g;

function failArchive(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isInt32(value) {
  return Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31;
}

function setEquals(actualKeys, expectedKeys) {
  if (actualKeys.length !== expectedKeys.length) return false;
  const expected = new Set(expectedKeys);
  return actualKeys.every(key => expected.has(key));
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected binary buffer');
}

/**
 * Strict RFC 8259 JSON parser rejecting duplicate keys in any object.
 */
export function parseJsonStrictNoDuplicates(text) {
  if (typeof text !== 'string') {
    failArchive('Манифест архива должен быть строкой JSON.');
  }
  const clean = text.replace(/^\uFEFF/, '');
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let pos = 0;

  const skipWhitespace = () => {
    while (pos < clean.length) {
      const code = clean.charCodeAt(pos);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        pos += 1;
      } else {
        break;
      }
    }
  };

  const parseString = () => {
    const start = pos;
    pos += 1; // opening quote
    let hasEscape = false;
    while (pos < clean.length) {
      const ch = clean.charCodeAt(pos);
      if (ch === 0x22) { // '"'
        const rawSlice = clean.slice(start, pos + 1);
        pos += 1;
        if (!hasEscape) return rawSlice.slice(1, -1);
        try {
          return JSON.parse(rawSlice);
        } catch {
          failArchive('Некорректная escape-последовательность JSON в манифесте.');
        }
      }
      if (ch === 0x5c) { // '\'
        hasEscape = true;
        if (pos + 1 >= clean.length) {
          failArchive('Незакрытая строка JSON в манифесте.');
        }
        if (clean[pos + 1] === 'u') {
          if (pos + 5 >= clean.length) {
            failArchive('Некорректная escape-последовательность \\u в манифесте.');
          }
          pos += 6;
        } else {
          pos += 2;
        }
        continue;
      }
      if (ch < 0x20) {
        failArchive('Некорректный управляющий символ в JSON.');
      }
      pos += 1;
    }
    failArchive('Незакрытая строка JSON в манифесте.');
  };

  const parseValue = (depth = 0) => {
    if (depth > 256) {
      failArchive('Слишком глубокая вложенность JSON в манифесте.');
    }
    skipWhitespace();
    if (pos >= clean.length) {
      failArchive('Неожиданный конец JSON в манифесте.');
    }
    const ch = clean[pos];
    if (ch === '{') {
      pos += 1;
      skipWhitespace();
      const obj = {};
      if (clean[pos] === '}') {
        pos += 1;
        return obj;
      }
      while (true) {
        skipWhitespace();
        if (clean[pos] !== '"') {
          failArchive('Ожидался строковый ключ объекта JSON.');
        }
        const key = parseString();
        if (Object.hasOwn(obj, key)) {
          failArchive(`Повторный ключ JSON: ${key}`);
        }
        skipWhitespace();
        if (clean[pos] !== ':') {
          failArchive('Ожидалось двоеточие в объекте JSON.');
        }
        pos += 1;
        const value = parseValue(depth + 1);
        if (key === '__proto__') {
          Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
        } else {
          obj[key] = value;
        }
        skipWhitespace();
        if (clean[pos] === '}') {
          pos += 1;
          return obj;
        }
        if (clean[pos] !== ',') {
          failArchive('Ожидалась запятая или закрывающая скобка в объекте JSON.');
        }
        pos += 1;
      }
    }
    if (ch === '[') {
      pos += 1;
      skipWhitespace();
      const arr = [];
      if (clean[pos] === ']') {
        pos += 1;
        return arr;
      }
      while (true) {
        arr.push(parseValue(depth + 1));
        skipWhitespace();
        if (clean[pos] === ']') {
          pos += 1;
          return arr;
        }
        if (clean[pos] !== ',') {
          failArchive('Ожидалась запятая или закрывающая скобка в массиве JSON.');
        }
        pos += 1;
      }
    }
    if (ch === '"') {
      return parseString();
    }
    if (ch === 't' && clean.startsWith('true', pos)) {
      pos += 4;
      return true;
    }
    if (ch === 'f' && clean.startsWith('false', pos)) {
      pos += 5;
      return false;
    }
    if (ch === 'n' && clean.startsWith('null', pos)) {
      pos += 4;
      return null;
    }
    numberPattern.lastIndex = pos;
    const numMatch = numberPattern.exec(clean);
    if (numMatch) {
      pos += numMatch[0].length;
      const parsed = Number(numMatch[0]);
      if (!Number.isFinite(parsed)) {
        failArchive('Число JSON выходит за допустимые пределы.');
      }
      return parsed;
    }
    failArchive('Некорректный синтаксис JSON в манифесте.');
  };

  const result = parseValue(0);
  skipWhitespace();
  if (pos !== clean.length) {
    failArchive('Лишние данные после JSON в манифесте.');
  }
  return result;
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function inspectImageSignature(bytes) {
  // PNG
  if (
    bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    const width = readUint32BE(bytes, 16);
    const height = readUint32BE(bytes, 20);
    if (!width || !height || width * height > 25_000_000) {
      failArchive('Слишком большое или повреждённое PNG-изображение.');
    }
    return { ext: '.png', mime: 'image/png' };
  }

  // JPEG
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLen = readUint16BE(bytes, offset + 2);
      if (segmentLen < 2 || offset + 2 + segmentLen > bytes.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (segmentLen >= 7) {
          const height = readUint16BE(bytes, offset + 5);
          const width = readUint16BE(bytes, offset + 7);
          if (!width || !height || width * height > 25_000_000) {
            failArchive('Слишком большое или повреждённое JPEG-изображение.');
          }
        }
        break;
      }
      offset += 2 + segmentLen;
    }
    return { ext: '.jpg', mime: 'image/jpeg' };
  }

  // GIF87a / GIF89a
  if (
    bytes.length >= 14
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    const width = readUint16LE(bytes, 6);
    const height = readUint16LE(bytes, 8);
    if (!width || !height || width * height > 25_000_000) {
      failArchive('Слишком большое или повреждённое GIF-изображение.');
    }
    return { ext: '.gif', mime: 'image/gif' };
  }

  // WEBP (RIFF....WEBP)
  if (
    bytes.length >= 20
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    let width = 1;
    let height = 1;
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20 && bytes.length >= 30) {
      width = readUint16LE(bytes, 26) & 0x3fff;
      height = readUint16LE(bytes, 28) & 0x3fff;
    } else if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4c && bytes.length >= 25) {
      const bits = readUint32LE(bytes, 21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58 && bytes.length >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    }
    if (!width || !height || width * height > 25_000_000) {
      failArchive('Слишком большое или повреждённое WebP-изображение.');
    }
    return { ext: '.webp', mime: 'image/webp' };
  }

  failArchive('Повреждённое или неподдерживаемое изображение.');
}

function hasMp3Header(bytes) {
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes[6] & 0x80 || bytes[7] & 0x80 || bytes[8] & 0x80 || bytes[9] & 0x80) {
      return false;
    }
    offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  const end = Math.min(bytes.length, offset + 4096);
  for (let i = offset; i < end - 3; i += 1) {
    if (
      bytes[i] === 0xff
      && (bytes[i + 1] & 0xe0) === 0xe0
      && (bytes[i + 1] & 0x18) !== 0x08
      && (bytes[i + 1] & 0x06) !== 0
      && (bytes[i + 2] >> 4) !== 0
      && (bytes[i + 2] >> 4) !== 15
      && (bytes[i + 2] & 0x0c) !== 0x0c
    ) {
      return true;
    }
  }
  return false;
}

function hasValidWavHeader(bytes) {
  if (
    bytes.length < 44
    || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46
    || bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) {
    return false;
  }
  let pos = 12;
  let hasFmt = false;
  let hasData = false;
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const chunkSize = readUint32LE(bytes, pos + 4);
    const bodyStart = pos + 8;
    const bodyEnd = bodyStart + chunkSize;
    if (id === 'fmt ' && chunkSize >= 16 && bodyEnd <= bytes.length) {
      hasFmt = true;
    } else if (id === 'data') {
      if (chunkSize === 0 || bodyEnd > bytes.length) return false;
      hasData = true;
    }
    pos = bodyEnd + (chunkSize % 2);
  }
  return hasFmt && hasData;
}

function inspectAudioSignature(bytes) {
  if (bytes.length < 128) {
    failArchive('Повреждённый или слишком короткий аудиофайл.');
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  ) {
    if (!hasValidWavHeader(bytes)) {
      failArchive('Пустая или обрезанная WAV-запись.');
    }
    return { ext: '.wav', mime: 'audio/wav' };
  }
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { ext: '.ogg', mime: 'audio/ogg' };
  }
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    return { ext: '.flac', mime: 'audio/flac' };
  }
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { ext: '.m4a', mime: 'audio/mp4' };
  }
  if (hasMp3Header(bytes)) {
    return { ext: '.mp3', mime: 'audio/mpeg' };
  }
  failArchive('Неподдерживаемый аудиофайл.');
}

function inspectVideoSignature(bytes) {
  if (bytes.length >= 32 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { ext: '.mp4', mime: 'video/mp4' };
  }
  if (bytes.length >= 32 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { ext: '.webm', mime: 'video/webm' };
  }
  failArchive('Неподдерживаемое видео: ожидается MP4 или WebM.');
}

/**
 * Validate media bytes by signature without lossy conversion, matching Admin material_archive.asset().
 */
export function inspectMediaBytes(rawBytes, folder) {
  const bytes = toUint8Array(rawBytes);
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
    failArchive('Пустое медиа или размер больше 20 МБ.');
  }

  let info;
  if (folder === 'images' || folder === 'backgrounds') {
    info = inspectImageSignature(bytes);
  } else if (folder === 'audio') {
    info = inspectAudioSignature(bytes);
  } else if (folder === 'videos') {
    info = inspectVideoSignature(bytes);
  } else {
    failArchive('Неизвестная категория медиа.');
  }

  const sha256 = sha256BytesHex(bytes);
  return {
    sha256,
    folder,
    filename: `archive_${sha256}${info.ext}`,
    mime: info.mime,
    size: bytes.length,
    path: `media/${sha256}${info.ext}`,
  };
}

export function iterNativeMediaFields(envelope) {
  const results = [];
  const card = envelope?.card;
  if (!isPlainObject(card)) return results;

  if (card.image) {
    results.push({ owner: card, key: 'image', role: 'image' });
  }
  if (Array.isArray(card.layout)) {
    for (const item of card.layout) {
      if (isPlainObject(item) && item.type === 'image') {
        results.push({ owner: item, key: 'path', role: 'image' });
      }
    }
  }
  const resources = card.metadata?.resources;
  if (Array.isArray(resources)) {
    for (const item of resources) {
      if (isPlainObject(item) && ['image', 'audio', 'video', 'background'].includes(item.type)) {
        for (const key of ['url', 'path']) {
          if (item[key]) {
            results.push({ owner: item, key, role: item.type });
          }
        }
      }
    }
  }
  return results;
}

export function iterTextLocations(value, out = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (typeof value[i] === 'string') {
        out.push({ owner: value, key: i });
      } else if (value[i] && typeof value[i] === 'object') {
        iterTextLocations(value[i], out);
      }
    }
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'string') {
        out.push({ owner: value, key });
      } else if (value[key] && typeof value[key] === 'object') {
        iterTextLocations(value[key], out);
      }
    }
  }
  return out;
}

export function checkMaterialMetadata(rawValue) {
  let parsed;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    try {
      parsed = trimmed ? parseJsonStrictNoDuplicates(trimmed) : {};
    } catch {
      failArchive('Повреждены метаданные материала. Исправьте их до экспорта или импорта.');
    }
  } else if (rawValue == null) {
    parsed = {};
  } else {
    parsed = rawValue;
  }

  if (!isPlainObject(parsed)) {
    failArchive('Метаданные материала должны быть объектом JSON.');
  }

  assertArchiveSafeMetadata(parsed);

  return canonicalJson(parsed);
}

function archiveMediaEntry(token, assets) {
  return assets.get(token.slice('archive://'.length));
}

function restoreInlineMedia(text, assets) {
  return text.replace(ARCHIVE_TOKEN_RE, token => {
    const entry = archiveMediaEntry(token, assets);
    return entry ? `/api/media/${entry.folder}/${entry.filename}` : token;
  });
}

function restoreCardMedia(envelope, assets) {
  const canonical = structuredClone(envelope);
  for (const { owner, key, role } of iterNativeMediaFields(canonical)) {
    const { folder, filename } = archiveMediaEntry(owner[key], assets);
    owner[key] = role === 'image' ? `${folder}/${filename}` : `/api/media/${folder}/${filename}`;
  }
  for (const { owner, key } of iterTextLocations(canonical)) {
    owner[key] = restoreInlineMedia(owner[key], assets);
  }
  return canonical;
}

export function orderFoldersTopologically(rows) {
  const children = new Map();
  for (const row of rows) {
    const parent = row.values.parent_id;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  const ordered = [];
  let ready = children.get(null) || [];
  while (ready.length > 0) {
    ready.sort((a, b) => (a.values.position || 0) - (b.values.position || 0) || a.id - b.id);
    const next = [];
    for (const row of ready) {
      ordered.push(row);
      for (const child of children.get(row.id) || []) next.push(child);
    }
    ready = next;
  }
  if (ordered.length !== rows.length) failArchive('Цикл или отсутствующий родитель папки.');
  return ordered;
}

export function validateMaterialArchiveDocument(rawDocument) {
  if (!isPlainObject(rawDocument) || !setEquals(Object.keys(rawDocument), ['format', 'version', 'source', 'source_users', 'content', 'assets'])) {
    failArchive('Неизвестная структура архива.');
  }
  const document = structuredClone(rawDocument);
  const originalVersion = document.version;
  if (document.format !== MATERIAL_ARCHIVE_FORMAT || !Number.isInteger(originalVersion) || !SUPPORTED_ARCHIVE_VERSIONS.has(originalVersion)) {
    failArchive('Неподдерживаемая версия архива.');
  }
  if (typeof document.source !== 'string' || !SOURCE_IDENTITY_RE.test(document.source)) {
    failArchive('Некорректный источник архива.');
  }

  const { content, assets, source_users: sourceUsers } = document;
  if (!Array.isArray(sourceUsers) || sourceUsers.length > 10000) {
    failArchive('Некорректный список исходных пользователей.');
  }
  for (const user of sourceUsers) {
    if (
      !isPlainObject(user)
      || !setEquals(Object.keys(user), ['id', 'name', 'username'])
      || !isPositiveInt(user.id)
      || [user.name, user.username].some(val => val !== null && (typeof val !== 'string' || val.length > 512))
    ) {
      failArchive('Некорректный исходный пользователь.');
    }
  }

  if (!isPlainObject(content) || !setEquals(Object.keys(content), ['folder', 'deck', 'card']) || !Array.isArray(assets) || assets.length > MAX_ASSETS) {
    failArchive('Некорректное содержимое архива.');
  }

  const byId = { folder: new Map(), deck: new Map(), card: new Map() };
  const deckMetadataById = new Map();
  const expectedDeckFields = DECK_V4_FIELDS;
  const charFieldLimits = {
    folder: new Set(['name', 'color', 'target_language', 'access_scope']),
    deck: new Set(['name', 'level', 'topic', 'target_language', 'scope']),
    card: new Set(['source']),
  };

  for (const kind of ['folder', 'deck', 'card']) {
    const rows = content[kind];
    if (!Array.isArray(rows) || rows.length > ARCHIVE_LIMITS[kind]) {
      failArchive('Превышен лимит материалов в архиве.');
    }
    for (const row of rows) {
      if (!isPlainObject(row) || !setEquals(Object.keys(row), ['id', 'values', 'author']) || !isPositiveInt(row.id)) {
        failArchive('Некорректный ID материала.');
      }
      if (row.author !== null && !isPositiveInt(row.author)) {
        failArchive('Некорректный исходный владелец или автор.');
      }
      if (byId[kind].has(row.id)) {
        failArchive('Повторный ID материала в архиве.');
      }
      if (!isPlainObject(row.values)) {
        failArchive('Некорректные поля материала в архиве.');
      }
      const values = row.values;

      if (kind === 'deck' && originalVersion < 4) {
        values.scope = values.scope ?? 'personal';
        values.category_id = values.category_id ?? null;
        values.is_default = values.is_default ?? false;
      }

      const isLibraryDeck = kind === 'deck' && values.scope === 'library';
      if (kind !== 'card' && row.author === null && !isLibraryDeck) {
        failArchive('У папки или колоды отсутствует владелец.');
      }
      if (kind === 'deck') {
        if (!['personal', 'library'].includes(values.scope)) {
          failArchive('Неизвестная область колоды.');
        }
        if (isLibraryDeck && (row.author !== null || values.folder_id !== null)) {
          failArchive('Библиотечная колода не должна иметь личного владельца или папку.');
        }
        if (!isLibraryDeck && (values.category_id !== null || Boolean(values.is_default))) {
          failArchive('Некорректные библиотечные поля личной колоды.');
        }
      }

      if (kind === 'card' && values.content_v2) {
        for (const legacyField of ['front_text', 'back_text', 'context', 'topics', 'tags', 'metadata', 'card_type']) {
          if (Object.hasOwn(values, legacyField) && values[legacyField] === null) {
            delete values[legacyField];
          }
        }
      }

      const expectedFields = kind === 'folder' ? FOLDER_FIELDS : kind === 'deck' ? expectedDeckFields : CARD_FIELDS;
      if (!setEquals(Object.keys(values), expectedFields)) {
        failArchive('Неизвестные поля материала: пользовательское состояние не допускается.');
      }

      const parentKey = kind === 'folder' ? 'parent_id' : kind === 'deck' ? 'folder_id' : 'deck_id';
      for (const [field, value] of Object.entries(values)) {
        if (field === 'content_v2') continue;
        if (field === 'is_default') {
          if (typeof value !== 'boolean') failArchive('Некорректный флаг библиотечной колоды.');
        } else if (field === 'category_id') {
          if (value !== null && !isPositiveInt(value)) failArchive('Некорректная категория библиотеки.');
        } else if (field === 'is_deleted') {
          if (value !== false) failArchive('Архив не должен содержать удалённые материалы.');
        } else if (field === parentKey) {
          if (value !== null && !isPositiveInt(value)) failArchive('Некорректный родитель материала.');
        } else if (field === 'position') {
          if (!isInt32(value)) failArchive('Некорректная позиция материала.');
        } else if (field === 'difficulty') {
          if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
            failArchive('Некорректная сложность карточки.');
          }
        } else if (value !== null && typeof value !== 'string') {
          failArchive(`Некорректный тип текстового поля ${field}.`);
        }

        if (typeof value === 'string') {
          const maxLen = charFieldLimits[kind].has(field) ? CHAR_FIELD_MAX : TEXT_FIELD_MAX;
          if (value.length > maxLen) {
            failArchive(`Поле материала ${field} превышает допустимую длину.`);
          }
        }
      }

      if (kind !== 'card' && !values.name) {
        failArchive('Материал без названия.');
      }
      if (kind === 'card' && !values.content_v2) {
        failArchive('Карточка без Native V2 содержимого.');
      }
      if (values.metadata != null) {
        const metaObj = JSON.parse(checkMaterialMetadata(values.metadata));
        for (const res of Array.isArray(metaObj.resources) ? metaObj.resources : []) {
          if (!isPlainObject(res)) failArchive('Некорректный ресурс в метаданных.');
        }
        deckMetadataById.set(row.id, metaObj);
      }
      byId[kind].set(row.id, row);
    }
  }

  for (const kind of ['folder', 'deck', 'card']) {
    const parentKind = kind === 'card' ? 'deck' : 'folder';
    const parentKey = kind === 'folder' ? 'parent_id' : kind === 'deck' ? 'folder_id' : 'deck_id';
    for (const row of content[kind]) {
      const parentId = row.values[parentKey];
      if ((kind === 'card' && parentId === null) || (parentId !== null && !byId[parentKind].has(parentId))) {
        failArchive('Отсутствующий родитель материала.');
      }
    }
  }
  orderFoldersTopologically(content.folder);

  const expectedAuthorIds = [...new Set(
    ['folder', 'deck', 'card'].flatMap(kind => content[kind].map(r => r.author).filter(a => a !== null))
  )].sort((a, b) => a - b);
  const actualAuthorIds = sourceUsers.map(u => u.id);
  if (
    expectedAuthorIds.length !== actualAuthorIds.length
    || expectedAuthorIds.some((id, idx) => id !== actualAuthorIds[idx])
  ) {
    failArchive('Список исходных пользователей не совпадает с материалами.');
  }

  const assetBySha = new Map();
  for (const entry of assets) {
    if (
      !isPlainObject(entry)
      || !setEquals(Object.keys(entry), ['sha256', 'folder', 'filename', 'mime', 'size', 'path'])
    ) {
      failArchive('Некорректный манифест медиа.');
    }
    const key = entry.sha256;
    if (typeof key !== 'string' || !SHA256_RE.test(key) || assetBySha.has(key)) {
      failArchive('Некорректная или повторная контрольная сумма медиа.');
    }
    if (!Number.isInteger(entry.size) || entry.size <= 0 || entry.size > MAX_ASSET_BYTES) {
      failArchive('Некорректный размер медиа.');
    }
    if (typeof entry.path !== 'string' || !ASSET_PATH_RE.test(entry.path) || !entry.path.startsWith(`media/${key}.`)) {
      failArchive('Небезопасный путь медиа.');
    }
    assetBySha.set(key, entry);
  }

  const referencedShas = new Set();
  const verifyTypedMedia = (token, role) => {
    const sha = typeof token === 'string' && ARCHIVE_TOKEN_FULL_RE.test(token)
      ? token.slice('archive://'.length)
      : null;
    if (!sha || assetBySha.get(sha)?.folder !== ROLE_TO_FOLDER[role]) {
      failArchive('Медиа отсутствует в архиве или имеет другую категорию.');
    }
  };
  for (const kind of ['folder', 'deck', 'card']) {
    for (const row of content[kind]) {
      if (kind === 'deck') {
        const metadata = deckMetadataById.get(row.id);
        for (const resource of Array.isArray(metadata?.resources) ? metadata.resources : []) {
          if (!Object.hasOwn(ROLE_TO_FOLDER, resource.type)) continue;
          for (const key of ['url', 'path']) {
            if (resource[key]) verifyTypedMedia(resource[key], resource.type);
          }
        }
      }
      if (row.values.content_v2) {
        for (const ref of iterNativeMediaFields(row.values.content_v2)) {
          verifyTypedMedia(ref.owner[ref.key], ref.role);
        }
        const canonical = restoreCardMedia(row.values.content_v2, assetBySha);
        validateNativeV2Content(canonical, { writable: true });
        assertArchiveSafeMetadata(canonical.card.metadata);
        for (const [field, role] of Object.entries(CARD_ATTACHMENTS)) {
          if (row.values[field]) verifyTypedMedia(row.values[field], role);
        }
      }
      for (const loc of iterTextLocations(row.values)) {
        const value = loc.owner[loc.key];
        const tokens = value.match(ARCHIVE_TOKEN_RE) || [];
        for (const token of tokens) {
          referencedShas.add(token.slice('archive://'.length));
        }
        const stripped = value.replace(ARCHIVE_TOKEN_RE, '');
        if (stripped.includes('archive://')) {
          failArchive('Некорректная ссылка на вложение.');
        }
        if (value.includes('/api/media/') || value.includes('/storage/v1/object/public/')) {
          failArchive('Архив содержит невложенные медиа.');
        }
      }
    }
  }

  if (referencedShas.size !== assetBySha.size || [...referencedShas].some(sha => !assetBySha.has(sha))) {
    failArchive('Отсутствуют связанные медиа или есть лишние вложения.');
  }

  const languages = [...new Set(
    [...content.folder, ...content.deck]
      .map(row => row.values.target_language)
      .filter(lang => typeof lang === 'string' && lang.trim().length > 0)
  )];

  return {
    document,
    originalVersion,
    summary: {
      counts: {
        folder: content.folder.length,
        deck: content.deck.length,
        card: content.card.length,
      },
      source: document.source,
      mediaCount: assets.length,
      mediaBytes: assets.reduce((sum, item) => sum + item.size, 0),
      languages,
    },
  };
}

/**
 * Validate an archive + verify every ZIP entry against manifest, and preview import impact against Dexie.
 */
export async function inspectMaterialArchiveForImport({
  manifestJson,
  manifestSha256,
  verifiedZipEntries,
  inspectEntry = value => value,
  fileName = '',
  db = null,
  userId = null,
} = {}) {
  if (typeof manifestJson !== 'string' || !manifestJson.trim()) {
    failArchive('В архиве отсутствует файл manifest.json.');
  }
  const actualManifestSha = sha256Hex(manifestJson);
  if (typeof manifestSha256 !== 'string' || actualManifestSha !== manifestSha256.trim()) {
    failArchive('Контрольная сумма манифеста не совпадает.');
  }

  const rawDocument = parseJsonStrictNoDuplicates(manifestJson);
  const { document, originalVersion, summary } = validateMaterialArchiveDocument(rawDocument);

  const expectedZipNames = new Set(['manifest.json', 'manifest.sha256', ...document.assets.map(a => a.path)]);
  if (!(verifiedZipEntries instanceof Map) || verifiedZipEntries.size !== expectedZipNames.size) {
    failArchive('Состав ZIP не совпадает с манифестом.');
  }
  for (const name of expectedZipNames) {
    if (!verifiedZipEntries.has(name)) {
      failArchive('Состав ZIP не совпадает с манифестом.');
    }
  }

  for (const assetEntry of document.assets) {
    const inspected = inspectEntry(verifiedZipEntries.get(assetEntry.path), assetEntry);
    if (!inspected) {
      failArchive(`Медиа повреждено или отсутствует в архиве: ${assetEntry.filename}`);
    }
    const matchesWeb = inspected.folder === assetEntry.folder
      && inspected.filename === assetEntry.filename;
    const expectedKind = (assetEntry.folder === 'images' || assetEntry.folder === 'backgrounds')
      ? 'image'
      : assetEntry.folder === 'audio'
        ? 'audio'
        : 'video';
    const matchesNative = inspected.detectedKind === expectedKind
      && inspected.ext
      && `archive_${inspected.sha256}${inspected.ext}` === assetEntry.filename
      && `media/${inspected.sha256}${inspected.ext}` === assetEntry.path;
    if (
      (!matchesWeb && !matchesNative)
      || inspected.sha256 !== assetEntry.sha256
      || inspected.mime !== assetEntry.mime
      || inspected.size !== assetEntry.size
      || inspected.path !== assetEntry.path
    ) {
      failArchive(`Медиа повреждено или его контрольная сумма не совпадает: ${assetEntry.filename}`);
    }
  }

  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  const [existingFolders, existingDecks, existingCards, progressRows, exportSource, registryRecord] = await Promise.all([
    database.folders.toArray(),
    database.decks.toArray(),
    database.cards.toArray(),
    resolvedUserId != null ? database.progress.where('user_id').equals(resolvedUserId).toArray() : Promise.resolve([]),
    database.syncState.get(MATERIAL_EXPORT_SOURCE_KEY),
    database.syncState.get(IMPORT_REGISTRY_KEY),
  ]);

  const ownExport = exportSource?.source === document.source;
  const folderByOrigin = new Map();
  const deckByOrigin = new Map();
  const cardByOrigin = new Map();
  for (const f of existingFolders) {
    if (f.standalone_origin_key) folderByOrigin.set(f.standalone_origin_key, f);
    if (ownExport) folderByOrigin.set(buildOriginKey(document.source, 'folder', f.id), f);
  }
  for (const d of existingDecks) {
    const key = d.standalone_origin_key || d.standalone_deck_key;
    if (key) deckByOrigin.set(key, d);
    if (ownExport) deckByOrigin.set(buildOriginKey(document.source, 'deck', d.id), d);
  }
  for (const c of existingCards) {
    const key = c.standalone_origin_key || c.standalone_card_key;
    if (key) cardByOrigin.set(key, c);
    if (ownExport) cardByOrigin.set(buildOriginKey(document.source, 'card', c.id), c);
  }
  const progressByCardId = new Set(progressRows.map(p => p.card_id));

  let newFolders = 0;
  let updatedFolders = 0;
  for (const row of document.content.folder) {
    const originKey = buildOriginKey(document.source, 'folder', row.id);
    if (folderByOrigin.has(originKey)) updatedFolders += 1;
    else newFolders += 1;
  }

  let newDecks = 0;
  let updatedDecks = 0;
  for (const row of document.content.deck) {
    const originKey = buildOriginKey(document.source, 'deck', row.id);
    if (deckByOrigin.has(originKey)) updatedDecks += 1;
    else newDecks += 1;
  }

  let newCards = 0;
  let updatedCards = 0;
  let protectedCards = 0;
  let preservedProgressCount = 0;
  for (const row of document.content.card) {
    const originKey = buildOriginKey(document.source, 'card', row.id);
    const existing = cardByOrigin.get(originKey);
    const matchedId = existing?.id;
    if (matchedId) {
      if (existing?.standalone_local_edit) {
        protectedCards += 1;
      } else {
        updatedCards += 1;
      }
      if (progressByCardId.has(matchedId)) {
        preservedProgressCount += 1;
      }
    } else {
      newCards += 1;
    }
  }

  const isReimport = updatedFolders > 0 || updatedDecks > 0 || updatedCards > 0 || protectedCards > 0;
  const previousImport = (registryRecord?.imports || []).find(item => item.source === document.source);

  return {
    ok: true,
    fileName,
    document,
    originalVersion,
    preview: {
      fileName,
      source: document.source,
      archiveVersion: originalVersion,
      newFolders,
      updatedFolders,
      newDecks,
      updatedDecks,
      newCards,
      updatedCards,
      protectedCards,
      totalFolders: document.content.folder.length,
      totalDecks: document.content.deck.length,
      totalCards: document.content.card.length,
      mediaCount: summary.mediaCount,
      mediaBytes: summary.mediaBytes,
      languages: summary.languages,
      isReimport,
      previousImportAt: previousImport?.imported_at || null,
      preservedProgressCount,
      deckNames: document.content.deck.map(d => d.values.name).slice(0, 8),
      folderNames: document.content.folder.map(f => f.values.name).slice(0, 8),
    },
  };
}

/**
 * Commit validated archive media first, then atomically write folders/decks/cards into Dexie.
 * Never touches user SRS progress in db.progress.
 */
export async function applyMaterialArchiveImport({
  inspection,
  commitMedia,
  mediaInTransaction = false,
  db = null,
  userId = null,
  fileName = '',
} = {}) {
  if (!inspection?.document) {
    failArchive('Отсутствуют проверенные данные архива для импорта.');
  }
  const { document } = inspection;
  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  if (resolvedUserId == null) {
    failArchive('Отсутствует идентификатор локального профиля.');
  }
  if (document.assets.length > 0 && typeof commitMedia !== 'function') {
    failArchive('Не настроен обработчик сохранения медиафайлов.');
  }
  if (document.assets.length > 0 && !mediaInTransaction) await commitMedia(document.assets);

  const assetBySha = new Map(document.assets.map(entry => [entry.sha256, entry]));
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const tables = [database.folders, database.decks, database.cards, database.syncState];
  if (mediaInTransaction && document.assets.length > 0) tables.push(database.media);
  return database.transaction('rw', tables, async () => {
    const [existingFolders, existingDecks, existingCards, countersRecord, registryRecord, exportSource] = await Promise.all([
      database.folders.toArray(),
      database.decks.toArray(),
      database.cards.toArray(),
      database.syncState.get(ID_COUNTERS_KEY),
      database.syncState.get(IMPORT_REGISTRY_KEY),
      database.syncState.get(MATERIAL_EXPORT_SOURCE_KEY),
    ]);

    const origins = { ...(registryRecord?.origins || {}) };
    const sourceUsersBySource = { ...(registryRecord?.sourceUsersBySource || {}) };
    const imports = Array.isArray(registryRecord?.imports) ? [...registryRecord.imports] : [];

    const existingFoldersById = new Map(existingFolders.map(f => [f.id, f]));
    const existingDecksById = new Map(existingDecks.map(d => [d.id, d]));
    const existingCardsById = new Map(existingCards.map(c => [c.id, c]));

    const folderByOrigin = new Map();
    const deckByOrigin = new Map();
    const cardByOrigin = new Map();
    for (const f of existingFolders) {
      if (f.standalone_origin_key) folderByOrigin.set(f.standalone_origin_key, f);
    }
    for (const d of existingDecks) {
      const k = d.standalone_origin_key || d.standalone_deck_key;
      if (k) deckByOrigin.set(k, d);
    }
    for (const c of existingCards) {
      const k = c.standalone_origin_key || c.standalone_card_key;
      if (k) cardByOrigin.set(k, c);
    }

    const maxId = (rows, kind) => rows.reduce(
      (max, row) => Math.max(max, Number(row.id) || 0),
      Math.max(IMPORTED_ID_START, countersRecord?.[kind] || 0),
    );
    const counters = {
      folder: maxId(existingFolders, 'folder'),
      deck: maxId(existingDecks, 'deck'),
      card: maxId(existingCards, 'card'),
    };
    const ownExport = exportSource?.source === document.source;
    const matchExisting = (originKey, sourceId, byOrigin, byId) => {
      const existing = (ownExport ? byId.get(sourceId) : undefined) || byOrigin.get(originKey);
      if (existing?.is_dirty) failArchive('Импорт остановлен: в материалах есть несохранённые локальные изменения.');
      return existing;
    };
    const nextId = (kind) => {
      counters[kind] += 1;
      return counters[kind];
    };

    const idMap = { folder: new Map([[null, null]]), deck: new Map() };
    const foldersToPut = [];
    const decksToPut = [];
    const cardsToPut = [];
    const syncEntriesToPut = [];

    let importedFolders = 0;
    let updatedFolders = 0;
    const orderedFolders = orderFoldersTopologically(document.content.folder);
    for (const row of orderedFolders) {
      const originKey = buildOriginKey(document.source, 'folder', row.id);
      const existing = matchExisting(originKey, row.id, folderByOrigin, existingFoldersById);
      const localId = existing?.id || nextId('folder');
      idMap.folder.set(row.id, localId);
      origins[originKey] = localId;

      if (existing) updatedFolders += 1;
      else importedFolders += 1;

      const parentId = row.values.parent_id == null ? null : idMap.folder.get(row.values.parent_id);
      foldersToPut.push({
        ...(existing || {}),
        id: localId,
        user_id: resolvedUserId,
        parent_id: parentId ?? null,
        name: row.values.name,
        color: row.values.color || existing?.color || '#ffd043',
        target_language: row.values.target_language || existing?.target_language || 'de',
        position: row.values.position ?? 0,
        role: 'viewer',
        is_owner: false,
        is_global_readonly: true,
        is_shared: false,
        is_deleted: 0,
        is_dirty: 0,
        standalone_origin_key: existing?.standalone_origin_key || originKey,
        standalone_source: existing?.standalone_source || document.source,
        standalone_source_id: existing?.standalone_source_id ?? row.id,
        standalone_source_author: existing?.standalone_source_author ?? row.author ?? null,
        created_at: existing?.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const deckLanguages = new Map();
    let importedDecks = 0;
    let updatedDecks = 0;
    for (const row of document.content.deck) {
      const originKey = buildOriginKey(document.source, 'deck', row.id);
      const existing = matchExisting(originKey, row.id, deckByOrigin, existingDecksById);
      const localId = existing?.id || nextId('deck');
      idMap.deck.set(row.id, localId);
      origins[originKey] = localId;

      if (existing) updatedDecks += 1;
      else importedDecks += 1;

      const mappedFolderId = row.values.folder_id == null ? null : (idMap.folder.get(row.values.folder_id) ?? null);
      let parsedMetadata = {};
      if (row.values.metadata != null) {
        const replacedMeta = restoreInlineMedia(row.values.metadata, assetBySha);
        parsedMetadata = JSON.parse(replacedMeta);
      }
      if (!Array.isArray(parsedMetadata.resources)) {
        parsedMetadata.resources = [];
      }
      delete parsedMetadata.is_learning;

      const targetLang = row.values.target_language || 'de';
      deckLanguages.set(localId, targetLang);
      if (ownExport && existing?.standalone_slug) continue;

      decksToPut.push({
        ...(existing || {}),
        id: localId,
        user_id: resolvedUserId,
        folder_id: row.values.scope === 'library' ? null : mappedFolderId,
        name: row.values.name,
        level: row.values.level ?? null,
        topic: row.values.topic ?? null,
        target_language: targetLang,
        color: existing?.color || parsedMetadata?.color || '#6366f1',
        position: row.values.position ?? 0,
        role: 'viewer',
        is_owner: false,
        is_global_readonly: true,
        is_pinned: Boolean(existing?.is_pinned),
        is_learning: Boolean(existing?.is_learning),
        is_deleted: 0,
        is_dirty: 0,
        metadata: parsedMetadata,
        standalone_origin_key: existing?.standalone_origin_key || originKey,
        standalone_deck_key: existing?.standalone_deck_key || originKey,
        standalone_source: existing?.standalone_source || document.source,
        standalone_source_id: existing?.standalone_source_id ?? row.id,
        standalone_source_author: existing?.standalone_source_author ?? row.author ?? null,
        standalone_deck_scope: row.values.scope || 'personal',
        standalone_category_id: row.values.category_id ?? null,
        standalone_is_default: Boolean(row.values.is_default),
        created_at: existing?.created_at || nowIso,
        updated_at: nowIso,
      });

      syncEntriesToPut.push({
        key: `deck-cards:${localId}`,
        complete: true,
        fetched_at: nowMs,
      });
    }

    let importedCards = 0;
    let updatedCards = 0;
    let protectedCards = 0;
    for (const row of document.content.card) {
      const originKey = buildOriginKey(document.source, 'card', row.id);
      const existing = matchExisting(originKey, row.id, cardByOrigin, existingCardsById);
      const localId = existing?.id || nextId('card');
      origins[originKey] = localId;

      if (existing?.standalone_local_edit) {
        protectedCards += 1;
        continue;
      }
      if (existing) updatedCards += 1;
      else importedCards += 1;
      if (ownExport && existing?.standalone_card_key && !existing.standalone_source) continue;

      const localDeckId = idMap.deck.get(row.values.deck_id);
      const { content_v2: archivedContent, ...fields } = row.values;
      const valuesCopy = { ...fields };
      for (const { owner, key } of iterTextLocations(valuesCopy)) {
        owner[key] = restoreInlineMedia(owner[key], assetBySha);
      }
      const contentV2 = restoreCardMedia(archivedContent, assetBySha);
      const frontText = studySideText(contentV2.card, 'front');
      const cardLang = deckLanguages.get(localDeckId) || existing?.target_language || 'de';

      cardsToPut.push({
        ...(existing || {}),
        id: localId,
        deck_id: localDeckId,
        position: valuesCopy.position ?? 0,
        target_language: cardLang,
        content_v2: contentV2,
        front_text: frontText,
        image_path: valuesCopy.image_path || null,
        audio_path: valuesCopy.audio_path || null,
        audio_back_path: valuesCopy.audio_back_path || null,
        video_front_path: valuesCopy.video_front_path || null,
        video_back_path: valuesCopy.video_back_path || null,
        difficulty: valuesCopy.difficulty ?? null,
        source: valuesCopy.source ?? 'user',
        revision: (Number(existing?.revision) || 0) + 1,
        standalone_origin_key: existing?.standalone_origin_key || originKey,
        standalone_card_key: existing?.standalone_card_key || originKey,
        standalone_source: existing?.standalone_source || document.source,
        standalone_source_id: existing?.standalone_source_id ?? row.id,
        standalone_source_author: existing?.standalone_source_author ?? row.author ?? null,
        is_deleted: 0,
        is_dirty: 0,
        created_at: existing?.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    for (const entry of document.assets) {
      syncEntriesToPut.push({
        key: `${OFFLINE_MEDIA_KEY_PREFIX}${entry.folder}/${entry.filename}`,
        sha256: entry.sha256,
        folder: entry.folder,
        filename: entry.filename,
        mime: entry.mime,
        size: entry.size,
        path: entry.path,
        updated_at: nowIso,
      });
    }

    if (mediaInTransaction && document.assets.length > 0) await commitMedia(document.assets);
    if (foldersToPut.length > 0) await database.folders.bulkPut(foldersToPut);
    if (decksToPut.length > 0) await database.decks.bulkPut(decksToPut);
    if (cardsToPut.length > 0) await database.cards.bulkPut(cardsToPut);

    const sourceUserMap = { ...(sourceUsersBySource[document.source] || {}) };
    for (const user of document.source_users) {
      sourceUserMap[String(user.id)] = user;
    }
    sourceUsersBySource[document.source] = sourceUserMap;

    const updatedImports = [
      {
        source: document.source,
        file_name: fileName || '',
        imported_at: nowIso,
        counts: {
          folder: document.content.folder.length,
          deck: document.content.deck.length,
          card: document.content.card.length,
        },
        media_count: document.assets.length,
      },
      ...imports.filter(item => item.source !== document.source),
    ].slice(0, 50);

    await database.syncState.bulkPut([
      ...syncEntriesToPut,
      { key: ID_COUNTERS_KEY, ...counters },
      {
        key: IMPORT_REGISTRY_KEY,
        origins,
        sourceUsersBySource,
        imports: updatedImports,
      },
    ]);

    return {
      importedFolders,
      updatedFolders,
      importedDecks,
      updatedDecks,
      importedCards,
      updatedCards,
      protectedCards,
      mediaCount: document.assets.length,
      languages: inspection.preview.languages,
      preservedProgressCount: inspection.preview.preservedProgressCount,
    };
  });
}

function collectMediaRefsForDeckAndCards(deck, cards) {
  const refs = new Map();
  const recordRef = (rawPath, role) => {
    const parsed = parseOfflineMediaRef(rawPath, role || 'images');
    if (parsed) {
      refs.set(rawPath, { ...parsed, role: role || parsed.folder });
    }
  };

  if (deck.metadata && typeof deck.metadata === 'object') {
    for (const res of Array.isArray(deck.metadata.resources) ? deck.metadata.resources : []) {
      if (isPlainObject(res) && ['audio', 'image', 'video', 'background'].includes(res.type)) {
        if (res.url) recordRef(res.url, res.type);
        if (res.path) recordRef(res.path, res.type);
      }
    }
    for (const loc of iterTextLocations(deck.metadata)) {
      const matches = loc.owner[loc.key].match(INLINE_URI_RE) || [];
      for (const uri of matches) recordRef(uri, null);
    }
  }

  for (const card of cards) {
    if (card.content_v2) {
      for (const fieldRef of iterNativeMediaFields(card.content_v2)) {
        recordRef(fieldRef.owner[fieldRef.key], fieldRef.role);
      }
    }
    for (const [field, role] of Object.entries(CARD_ATTACHMENTS)) {
      if (card[field]) {
        recordRef(card[field], role);
      }
    }
    for (const loc of iterTextLocations({ content_v2: card.content_v2 })) {
      const matches = loc.owner[loc.key].match(INLINE_URI_RE) || [];
      for (const uri of matches) recordRef(uri, null);
    }
  }

  return refs;
}

/**
 * Return folder/unfiled-deck tree with card and media counts for selective export UI.
 */
export async function getExportableMaterialsTree({ db = null } = {}) {
  const database = db || await prepareLocalDb();
  const [allFolders, allDecks, allCards] = await Promise.all([
    database.folders.filter(f => !f.is_deleted).toArray(),
    database.decks.filter(d => !d.is_deleted).toArray(),
    database.cards.filter(c => !c.is_deleted && Boolean(c.content_v2)).toArray(),
  ]);

  const cardsByDeck = new Map();
  for (const card of allCards) {
    if (!cardsByDeck.has(card.deck_id)) cardsByDeck.set(card.deck_id, []);
    cardsByDeck.get(card.deck_id).push(card);
  }

  const childrenByFolder = new Map();
  for (const folder of allFolders) {
    const pid = folder.parent_id ?? null;
    if (!childrenByFolder.has(pid)) childrenByFolder.set(pid, []);
    childrenByFolder.get(pid).push(folder);
  }

  const decksByFolder = new Map();
  for (const deck of allDecks) {
    const fid = deck.folder_id ?? null;
    if (!decksByFolder.has(fid)) decksByFolder.set(fid, []);
    decksByFolder.get(fid).push(deck);
  }

  const sortByPos = (a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id;

  const buildDeckInfo = (deck) => {
    const cards = (cardsByDeck.get(deck.id) || []).sort(sortByPos);
    const refs = collectMediaRefsForDeckAndCards(deck, cards);
    const uniqueFiles = new Set([...refs.values()].map(r => r.relativePath));
    return {
      id: deck.id,
      name: deck.name,
      folderId: deck.folder_id ?? null,
      targetLanguage: deck.target_language || 'de',
      level: deck.level || null,
      cardCount: cards.length,
      mediaCount: uniqueFiles.size,
      isImported: Boolean(deck.standalone_source),
    };
  };

  const buildFolderStats = folderId => {
    const folderIds = new Set([folderId]);
    let deckCount = 0;
    let cardCount = 0;
    const mediaFiles = new Set();
    for (const id of folderIds) {
      for (const child of childrenByFolder.get(id) || []) folderIds.add(child.id);
      for (const deck of decksByFolder.get(id) || []) {
        deckCount += 1;
        const cards = cardsByDeck.get(deck.id) || [];
        cardCount += cards.length;
        for (const ref of collectMediaRefsForDeckAndCards(deck, cards).values()) {
          mediaFiles.add(ref.relativePath);
        }
      }
    }
    return { subfolderCount: folderIds.size - 1, deckCount, cardCount, mediaFiles };
  };

  const rootFolders = (childrenByFolder.get(null) || []).sort(sortByPos).map(folder => {
    const stats = buildFolderStats(folder.id);
    return {
      id: folder.id,
      name: folder.name,
      color: folder.color || '#ffd043',
      targetLanguage: folder.target_language || 'de',
      subfolderCount: stats.subfolderCount,
      deckCount: stats.deckCount,
      cardCount: stats.cardCount,
      mediaCount: stats.mediaFiles.size,
    };
  });

  const unfiledDecks = (decksByFolder.get(null) || []).sort(sortByPos).map(buildDeckInfo);
  const allActiveDecks = [...allDecks].sort(sortByPos).map(buildDeckInfo);

  return {
    rootFolders,
    unfiledDecks,
    allFolders: [...allFolders].sort(sortByPos).map(f => ({
      id: f.id,
      parentId: f.parent_id ?? null,
      name: f.name,
      targetLanguage: f.target_language || 'de',
    })),
    allDecks: allActiveDecks,
    totals: {
      folders: allFolders.length,
      decks: allDecks.length,
      cards: allCards.length,
    },
  };
}

function formatArchiveFileName(date) {
  const pad = n => String(n).padStart(2, '0');
  return `lerne-materials-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}.zip`;
}

/**
 * Build a validated lerne-materials v4 archive from selected folders and/or decks in Dexie.
 * Verifies every referenced media asset before emitting the archive.
 */
export async function buildMaterialArchiveExport({
  db = null,
  folderIds = [],
  deckIds = [],
  selectAll = false,
  readAssetBytes = null,
  inspectNativeAssets = null,
  now = new Date(),
} = {}) {
  const database = db || await prepareLocalDb();
  const [allFolders, allDecks, allCards, registryRecord, offlineMediaRecords] = await database.transaction(
    'r',
    database.folders,
    database.decks,
    database.cards,
    database.syncState,
    async () => Promise.all([
      database.folders.filter(f => !f.is_deleted).toArray(),
      database.decks.filter(d => !d.is_deleted).toArray(),
      database.cards.filter(c => !c.is_deleted && Boolean(c.content_v2)).toArray(),
      database.syncState.get(IMPORT_REGISTRY_KEY),
      database.syncState.where('key').startsWith(OFFLINE_MEDIA_KEY_PREFIX).toArray(),
    ])
  );

  const folderMap = new Map(allFolders.map(f => [f.id, f]));
  const deckMap = new Map(allDecks.map(d => [d.id, d]));

  const requestedFolders = Array.isArray(folderIds) ? folderIds.map(Number) : [];
  const requestedDecks = Array.isArray(deckIds) ? deckIds.map(Number) : [];

  if (!selectAll && requestedFolders.length === 0 && requestedDecks.length === 0) {
    failArchive('Выберите хотя бы одну папку или колоду для экспорта.');
  }

  const selectedFolderIds = new Set();
  if (selectAll) {
    for (const folder of allFolders) selectedFolderIds.add(folder.id);
  } else {
    for (const id of requestedFolders) {
      if (folderMap.has(id)) selectedFolderIds.add(id);
    }
    const children = new Map();
    for (const folder of allFolders) {
      if (!children.has(folder.parent_id)) children.set(folder.parent_id, []);
      children.get(folder.parent_id).push(folder.id);
    }
    for (const parentId of selectedFolderIds) {
      for (const childId of children.get(parentId) || []) selectedFolderIds.add(childId);
    }
  }

  const selectedDeckIds = new Set();
  if (selectAll) {
    for (const deck of allDecks) selectedDeckIds.add(deck.id);
  } else {
    for (const deck of allDecks) {
      if (deck.folder_id != null && selectedFolderIds.has(deck.folder_id)) {
        selectedDeckIds.add(deck.id);
      }
    }
    for (const id of requestedDecks) {
      if (deckMap.has(id)) selectedDeckIds.add(id);
    }
  }

  if (selectedFolderIds.size === 0 && selectedDeckIds.size === 0) {
    failArchive('Выбранные материалы не найдены.');
  }
  if (selectedFolderIds.size > ARCHIVE_LIMITS.folder || selectedDeckIds.size > ARCHIVE_LIMITS.deck) {
    failArchive('Выбор превышает лимит архива.');
  }

  const selectedFolders = allFolders
    .filter(f => selectedFolderIds.has(f.id))
    .sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
  const selectedDecks = allDecks
    .filter(d => selectedDeckIds.has(d.id))
    .sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
  const selectedCards = allCards
    .filter(c => selectedDeckIds.has(c.deck_id))
    .sort((a, b) => a.deck_id - b.deck_id || (a.position || 0) - (b.position || 0) || a.id - b.id);

  if (selectedCards.length > ARCHIVE_LIMITS.card) {
    failArchive('Выбор карточек превышает лимит архива.');
  }

  const selectedRows = [...selectedFolders, ...selectedDecks, ...selectedCards];
  const hasLocalAuthoring = selectedRows.some(row => row.standalone_local_edit || row.standalone_local_created);
  const sourceCandidates = new Set(selectedRows.map(row => row.standalone_source));
  const [singleSource] = sourceCandidates;
  const preserveSource = !hasLocalAuthoring && sourceCandidates.size === 1 && SOURCE_IDENTITY_RE.test(singleSource || '');
  const source = preserveSource ? singleSource : await getMaterialExportSource(database);
  const exportId = row => preserveSource ? row.standalone_source_id : row.id;
  const exportedFolderId = id => folderMap.has(id) && selectedFolderIds.has(id) ? exportId(folderMap.get(id)) : null;
  const rawRefs = new Map();
  const addRef = (rawPath, role) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      failArchive('Некорректная ссылка на медиа.');
    }
    const parsed = parseOfflineMediaRef(rawPath, role || 'images');
    if (!parsed || (role && parsed.folder !== ROLE_TO_FOLDER[role])) {
      failArchive(`В материалах обнаружена неподдерживаемая или внешняя ссылка медиа: ${rawPath}`);
    }
    rawRefs.set(rawPath, parsed);
  };
  const addInlineRefs = (value) => {
    for (const loc of iterTextLocations(value)) {
      const matches = loc.owner[loc.key].match(INLINE_URI_RE) || [];
      for (const uri of matches) addRef(uri, null);
    }
  };

  const exportedFolders = selectedFolders.map(folder => ({
    id: exportId(folder),
    author: isPositiveInt(folder.standalone_source_author) ? folder.standalone_source_author : STANDALONE_USER_ID,
    values: {
      name: folder.name,
      color: typeof folder.color === 'string' && folder.color ? folder.color : null,
      target_language: folder.target_language || 'de',
      position: isInt32(folder.position) ? folder.position : 0,
      is_deleted: false,
      parent_id: exportedFolderId(folder.parent_id),
    },
    _source: folder.standalone_source_author ? folder.standalone_source : null,
  }));

  const exportedDecks = selectedDecks.map(deck => {
    const scope = deck.standalone_deck_scope === 'library' ? 'library' : 'personal';
    const isLibrary = scope === 'library';
    const metaCopy = isPlainObject(deck.metadata) ? structuredClone(deck.metadata) : {};
    delete metaCopy.is_learning;
    delete metaCopy.learning_dirty;

    for (const res of Array.isArray(metaCopy.resources) ? metaCopy.resources : []) {
      if (!isPlainObject(res)) failArchive('Некорректный ресурс в метаданных колоды.');
      if (['audio', 'image', 'video', 'background'].includes(res.type)) {
        if (res.url) addRef(res.url, res.type);
        if (res.path) addRef(res.path, res.type);
      }
    }
    addInlineRefs(metaCopy);

    const author = isLibrary
      ? null
      : (isPositiveInt(deck.standalone_source_author) ? deck.standalone_source_author : STANDALONE_USER_ID);

    return {
        id: exportId(deck),
      author,
      values: {
        name: deck.name,
        level: typeof deck.level === 'string' && deck.level ? deck.level : null,
        topic: typeof deck.topic === 'string' && deck.topic ? deck.topic : null,
        target_language: deck.target_language || 'de',
        position: isInt32(deck.position) ? deck.position : 0,
        is_deleted: false,
        folder_id: isLibrary ? null : exportedFolderId(deck.folder_id),
        metadata: metaCopy,
        scope,
        category_id: isLibrary ? (isPositiveInt(deck.standalone_category_id) ? deck.standalone_category_id : null) : null,
        is_default: isLibrary ? Boolean(deck.standalone_is_default) : false,
      },
      _source: deck.standalone_source_author ? deck.standalone_source : null,
    };
  });

  const deckAuthorById = new Map(exportedDecks.map(d => [d.id, d.author]));
  const exportedCards = selectedCards.map(card => {
    const contentV2 = structuredClone(card.content_v2);
    for (const fieldRef of iterNativeMediaFields(contentV2)) {
      addRef(fieldRef.owner[fieldRef.key], fieldRef.role);
    }
    for (const [field, role] of Object.entries(CARD_ATTACHMENTS)) {
      if (card[field]) {
        addRef(card[field], role);
      }
    }
    addInlineRefs({ content_v2: contentV2 });

    const exportedDeckId = exportId(deckMap.get(card.deck_id));
    const deckAuthor = deckAuthorById.get(exportedDeckId);
    const author = isPositiveInt(card.standalone_source_author)
      ? card.standalone_source_author
      : (deckAuthor === null ? null : STANDALONE_USER_ID);

    return {
      id: exportId(card),
      author,
      values: {
        content_v2: contentV2,
        image_path: card.image_path || null,
        audio_path: card.audio_path || null,
        audio_back_path: card.audio_back_path || null,
        video_front_path: card.video_front_path || null,
        video_back_path: card.video_back_path || null,
        difficulty: typeof card.difficulty === 'number' && Number.isFinite(card.difficulty) ? card.difficulty : null,
        source: typeof card.source === 'string' && card.source ? card.source.slice(0, CHAR_FIELD_MAX) : 'user',
        position: isInt32(card.position) ? card.position : 0,
        is_deleted: false,
        deck_id: exportedDeckId,
      },
      _source: card.standalone_source_author ? card.standalone_source : null,
    };
  });

  if (rawRefs.size > MAX_ASSETS) {
    failArchive('Больше 10000 медиафайлов в архиве.');
  }

  const offlineMetaByRelPath = new Map(
    offlineMediaRecords
      .filter(r => r?.folder && r?.filename)
      .map(r => [`${r.folder}/${r.filename}`, r])
  );

  const assetsBySha = new Map();
  const blobsBySha = new Map();
  const replacements = new Map();
  let totalAssetBytes = 0;

  if (rawRefs.size > 0) {
    if (typeof readAssetBytes === 'function') {
      for (const [rawUri, parsed] of rawRefs.entries()) {
        const bytes = await readAssetBytes(parsed.folder, parsed.filename);
        const entry = inspectMediaBytes(bytes, parsed.folder);
        if (!assetsBySha.has(entry.sha256)) {
          totalAssetBytes += entry.size;
          if (totalAssetBytes > MAX_ARCHIVE_BYTES - MAX_MANIFEST_BYTES) {
            failArchive('Медиа архива превышают 448 МБ. Выберите меньше папок.');
          }
          assetsBySha.set(entry.sha256, entry);
          blobsBySha.set(entry.sha256, toUint8Array(bytes));
        }
        replacements.set(rawUri, `archive://${entry.sha256}`);
      }
    } else if (typeof inspectNativeAssets === 'function') {
      for (const [rawUri, parsed] of rawRefs.entries()) {
        const meta = offlineMetaByRelPath.get(parsed.relativePath);
        if (!meta) {
          failArchive(`Отсутствуют метаданные локального медиафайла: ${parsed.relativePath}`);
        }
        if (!assetsBySha.has(meta.sha256)) {
          totalAssetBytes += meta.size;
          if (totalAssetBytes > MAX_ARCHIVE_BYTES - MAX_MANIFEST_BYTES) {
            failArchive('Медиа архива превышают 448 МБ. Выберите меньше папок.');
          }
          assetsBySha.set(meta.sha256, {
            sha256: meta.sha256,
            folder: meta.folder,
            filename: meta.filename,
            mime: meta.mime,
            size: meta.size,
            path: meta.path,
          });
        }
        replacements.set(rawUri, `archive://${meta.sha256}`);
      }
      const verification = await inspectNativeAssets(
        [...assetsBySha.values()].map(a => ({
          folder: a.folder,
          filename: a.filename,
          sha256: a.sha256,
          size: a.size,
        }))
      );
      if (verification?.missing?.length > 0 || verification?.corrupted?.length > 0) {
        const problem = verification.missing?.[0] || verification.corrupted?.[0] || 'media';
        failArchive(`Невозможно экспортировать архив: отсутствует или повреждён файл ${problem}.`);
      }
    } else {
      failArchive('Недоступно чтение локальных медиафайлов для экспорта.');
    }
  }

  const rewriteRow = (row) => {
    if (row.values.content_v2) {
      for (const fieldRef of iterNativeMediaFields(row.values.content_v2)) {
        const token = replacements.get(fieldRef.owner[fieldRef.key]);
        if (!token) failArchive(`Отсутствует медиа вложения: ${fieldRef.owner[fieldRef.key]}`);
        fieldRef.owner[fieldRef.key] = token;
      }
    }
    for (const loc of iterTextLocations(row.values)) {
      const val = loc.owner[loc.key];
      loc.owner[loc.key] = replacements.get(val) || val.replace(INLINE_URI_RE, uri => replacements.get(uri) || uri);
    }
  };

  const authoredRows = [...exportedFolders, ...exportedDecks, ...exportedCards].filter(row => row.author !== null);
  const reservedAuthorIds = new Set(authoredRows.map(row => row.author));
  const storedUsersBySource = registryRecord?.sourceUsersBySource || {};
  const authorsByKey = new Map();
  const usedAuthorIds = new Set();
  let nextAuthorId = 1;
  for (const row of authoredRows) {
    const authorKey = `${row._source || ''}:${row.author}`;
    if (!authorsByKey.has(authorKey)) {
      let id = row.author;
      if (usedAuthorIds.has(id)) {
        while (reservedAuthorIds.has(nextAuthorId) || usedAuthorIds.has(nextAuthorId)) nextAuthorId += 1;
        id = nextAuthorId;
      }
      const user = row._source
        ? storedUsersBySource[row._source]?.[String(row.author)]
        : { name: getStandaloneProfileName(), username: 'offline_pilot' };
      authorsByKey.set(authorKey, { id, name: user?.name ?? null, username: user?.username ?? null });
      usedAuthorIds.add(id);
    }
    row.author = authorsByKey.get(authorKey).id;
  }

  const cleanRow = ({ id, author, values }) => ({ id, author, values });
  const content = {
    folder: exportedFolders.map(row => { rewriteRow(row); return cleanRow(row); }),
    deck: exportedDecks.map(row => {
      rewriteRow(row);
      row.values.metadata = checkMaterialMetadata(row.values.metadata);
      return cleanRow(row);
    }),
    card: exportedCards.map(row => { rewriteRow(row); return cleanRow(row); }),
  };

  const sourceUsers = [...authorsByKey.values()].sort((a, b) => a.id - b.id);

  const document = {
    format: MATERIAL_ARCHIVE_FORMAT,
    version: MATERIAL_ARCHIVE_EXPORT_VERSION,
    source,
    source_users: sourceUsers,
    content,
    assets: [...assetsBySha.values()],
  };

  const manifestJson = canonicalJson(document);
  if (new TextEncoder().encode(manifestJson).length > MAX_MANIFEST_BYTES) {
    failArchive('Описание материалов больше 64 МБ.');
  }

  const validated = validateMaterialArchiveDocument(document);
  const manifestSha256 = sha256Hex(manifestJson);

  return {
    document: validated.document,
    manifestJson,
    manifestSha256,
    assets: validated.document.assets,
    blobsBySha,
    fileName: formatArchiveFileName(now),
    summary: validated.summary,
  };
}
