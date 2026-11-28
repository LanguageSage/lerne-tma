import Dexie from 'dexie';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import {
  convertNativeFileSrc,
  getNativePlugin,
  isNativePlatform,
  isNativePluginAvailable,
} from './nativeBridge.js';
import { sha256BytesHex } from './sha256.js';
import { openNativeMediaDb, storeNativeMediaMetadata } from './nativeMediaDb.js';
import {
  CANONICAL_ASSET_NAME_RE,
  MEDIA_FOLDERS,
  OFFLINE_MEDIA_KEY_PREFIX,
  clearOfflineMediaCache,
  getNativeMediaRoot,
  getWebBlobUrl,
  isOfflineMediaUrl,
  parseOfflineMediaRef,
  resolveOfflineMediaUrlSync,
  setLocalMediaEnabled,
  setNativeMediaConfig,
  setWebBlobUrl,
} from './offlineMediaResolver.js';

export {
  CANONICAL_ASSET_NAME_RE,
  MEDIA_FOLDERS,
  OFFLINE_MEDIA_KEY_PREFIX,
  clearOfflineMediaCache,
  isOfflineMediaUrl,
  parseOfflineMediaRef,
  resolveOfflineMediaUrlSync,
};

const CANONICAL_WEB_MEDIA_URL_RE = /^\/api\/media\/(images|audio|videos|backgrounds)\/(archive_[a-f0-9]{64}\.[a-z0-9]{2,4})$/;
const MAX_LOCAL_MEDIA_BYTES = 20 * 1024 * 1024;

function detectLocalMediaExtAndMime(bytes, folder) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_LOCAL_MEDIA_BYTES) {
    return null;
  }
  if (folder === 'images' || folder === 'backgrounds') {
    if (
      bytes.length >= 24
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
      return { ext: '.png', mime: 'image/png' };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { ext: '.jpg', mime: 'image/jpeg' };
    }
    if (
      bytes.length >= 14
      && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
      && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
    ) {
      return { ext: '.gif', mime: 'image/gif' };
    }
    if (
      bytes.length >= 20
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return { ext: '.webp', mime: 'image/webp' };
    }
    return null;
  }
  if (folder === 'audio') {
    if (bytes.length < 128) return null;
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
    ) {
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
    if (
      (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    ) {
      return { ext: '.mp3', mime: 'audio/mpeg' };
    }
    return null;
  }
  if (folder === 'videos') {
    if (bytes.length < 32) return null;
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return { ext: '.mp4', mime: 'video/mp4' };
    }
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return { ext: '.webm', mime: 'video/webm' };
    }
    return null;
  }
  return null;
}

function verifyLocalMediaBlobBytes(bytes, folder, filename) {
  const info = detectLocalMediaExtAndMime(bytes, folder);
  if (!info || !filename.endsWith(info.ext)) return null;
  const sha256 = sha256BytesHex(bytes);
  if (filename !== `archive_${sha256}${info.ext}`) return null;
  return {
    sha256,
    folder,
    filename,
    mime: info.mime,
    size: bytes.length,
    path: `media/${sha256}${info.ext}`,
  };
}

function isLocalMediaRuntime(options = {}) {
  return Boolean(IS_STANDALONE || isNativePlatform() || options?.forceLocal);
}

export function isNativeOfflineMediaAvailable() {
  return isNativePluginAvailable('OfflineMaterialArchive');
}

export function getOfflineMaterialArchivePlugin() {
  return getNativePlugin('OfflineMaterialArchive');
}

export async function initOfflineMediaStore(database, options = {}) {
  if (!isLocalMediaRuntime(options)) return { mode: 'disabled' };
  setLocalMediaEnabled(true);

  if (isNativeOfflineMediaAvailable()) {
    const plugin = getOfflineMaterialArchivePlugin();
    const [scan] = await Promise.all([plugin.listMediaAssets(), openNativeMediaDb()]);
    const { mediaRoot, assets, invalid } = scan;
    await storeNativeMediaMetadata(assets);
    await database?.syncState.where('key').startsWith(OFFLINE_MEDIA_KEY_PREFIX).delete();
    setNativeMediaConfig(mediaRoot, convertNativeFileSrc);
    return {
      mode: 'native',
      nativeMediaRoot: getNativeMediaRoot(),
      reconciledCount: assets.length,
      invalidCount: invalid.length,
    };
  }

  let reconciledCount = 0;

  if (database?.syncState) {
    const records = await database.syncState.where('key').startsWith(OFFLINE_MEDIA_KEY_PREFIX).toArray();
    const existingByKey = new Map();
    for (const record of records) {
      if (record?.key) existingByKey.set(record.key, record);
    }

    const nowIso = new Date().toISOString();

    if (database.media) {
      const allMediaRows = await database.media.toArray();
      const mediaByUrl = new Map();
      const repaired = [];

      for (const row of allMediaRows) {
        if (!row?.url || !row?.blob) continue;
        mediaByUrl.set(row.url, row.blob);
        const match = row.url.match(CANONICAL_WEB_MEDIA_URL_RE);
        if (!match) continue;
        const folder = match[1];
        const filename = match[2];
        const relativePath = `${folder}/${filename}`;
        const key = `${OFFLINE_MEDIA_KEY_PREFIX}${relativePath}`;
        const existing = existingByKey.get(key);
        const needsRepair = (
          !existing
          || !existing.sha256
          || !existing.size
          || !existing.mime
          || !existing.path
          || existing.size !== row.blob.size
        );
        if (!needsRepair || typeof row.blob.arrayBuffer !== 'function') continue;

        try {
          const bytes = new Uint8Array(await row.blob.arrayBuffer());
          const entry = verifyLocalMediaBlobBytes(bytes, folder, filename);
          if (entry) {
            const metaRecord = {
              key,
              sha256: entry.sha256,
              folder: entry.folder,
              filename: entry.filename,
              mime: entry.mime,
              size: entry.size,
              path: entry.path,
              updated_at: nowIso,
            };
            repaired.push(metaRecord);
            existingByKey.set(key, metaRecord);
          }
        } catch {
          // Leave invalid rows untouched without deleting user data.
        }
      }

      if (repaired.length > 0) {
        await database.syncState.bulkPut(repaired);
        reconciledCount = repaired.length;
      }

      if (typeof URL?.createObjectURL === 'function') {
        for (const record of existingByKey.values()) {
          if (!record?.folder || !record?.filename) continue;
          const canonicalUrl = `/api/media/${record.folder}/${record.filename}`;
          const blob = mediaByUrl.get(canonicalUrl);
          if (blob && !getWebBlobUrl(canonicalUrl)) {
            try {
              setWebBlobUrl(canonicalUrl, URL.createObjectURL(blob));
            } catch {
              // Ignore object URL errors in non-DOM test runtimes.
            }
          }
        }
      }
    }
  }

  return {
    mode: 'web',
    nativeMediaRoot: null,
    reconciledCount,
    invalidCount: 0,
  };
}

export async function resolveOfflineMediaUrlAsync(database, rawPath, defaultKind = 'images', options = {}) {
  if (!isLocalMediaRuntime(options) || typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const syncResolved = resolveOfflineMediaUrlSync(rawPath, defaultKind, { forceLocal: true });
  if (syncResolved) return syncResolved;

  if (isNativeOfflineMediaAvailable() && !getNativeMediaRoot()) {
    const openDatabase = database && (!database.isOpen || database.isOpen()) ? database : null;
    await initOfflineMediaStore(openDatabase, options);
    const nativeResolved = resolveOfflineMediaUrlSync(rawPath, defaultKind, { forceLocal: true });
    if (nativeResolved) return nativeResolved;
  }

  const ref = parseOfflineMediaRef(rawPath, defaultKind);
  if (!ref || getNativeMediaRoot() || !database?.media) return null;

  const existingBlobUrl = getWebBlobUrl(ref.canonicalUrl);
  if (existingBlobUrl) {
    return existingBlobUrl;
  }

  const cached = await database.media.get(ref.canonicalUrl) || await database.media.get(rawPath.trim());
  if (cached?.blob && typeof URL?.createObjectURL === 'function') {
    try {
      const blobUrl = URL.createObjectURL(cached.blob);
      setWebBlobUrl(ref.canonicalUrl, blobUrl);
      return blobUrl;
    } catch {
      return null;
    }
  }
  return null;
}

export async function storeWebMediaAssets(database, assets, blobsBySha) {
  if (!Array.isArray(assets) || assets.length === 0) {
    return { storedCount: 0, reusedCount: 0 };
  }
  if (!database?.media) {
    throw new Error('Локальное хранилище медиа недоступно.');
  }

  const verifiedEntries = [];
  for (const entry of assets) {
    if (!MEDIA_FOLDERS.has(entry?.folder) || !CANONICAL_ASSET_NAME_RE.test(entry?.filename || '')) {
      throw new Error(`Недопустимое имя медиафайла: ${entry?.filename || ''}`);
    }
    const bytes = blobsBySha?.get(entry.sha256);
    if (!(bytes instanceof Uint8Array) || bytes.length !== entry.size || sha256BytesHex(bytes) !== entry.sha256) {
      throw new Error(`Контрольная сумма медиа не совпадает: ${entry.filename}`);
    }
    verifiedEntries.push({
      entry,
      bytes,
      canonicalUrl: `/api/media/${entry.folder}/${entry.filename}`,
    });
  }

  // Verify existing blobs outside/before writing so conflicts abort cleanly without overwriting.
  const existingRows = await database.media.bulkGet(verifiedEntries.map(item => item.canonicalUrl));
  const itemsToWrite = [];
  let reusedCount = 0;

  for (let i = 0; i < verifiedEntries.length; i += 1) {
    const { entry, bytes, canonicalUrl } = verifiedEntries[i];
    const existing = existingRows[i];
    if (existing?.blob) {
      if (existing.blob.size !== entry.size) {
        throw new Error(`Конфликт существующего медиа ${entry.filename}: файл не изменён.`);
      }
      const existingBytes = new Uint8Array(await Dexie.waitFor(() => existing.blob.arrayBuffer()));
      const existingSha = sha256BytesHex(existingBytes);
      if (existingSha !== entry.sha256 || existingBytes.length !== entry.size) {
        throw new Error(`Конфликт существующего медиа ${entry.filename}: файл не изменён.`);
      }
      reusedCount += 1;
    } else {
      itemsToWrite.push({
        url: canonicalUrl,
        blob: new Blob([bytes], { type: entry.mime || 'application/octet-stream' }),
      });
    }
  }

  if (itemsToWrite.length > 0) {
    await database.media.bulkAdd(itemsToWrite);
  }

  return {
    storedCount: itemsToWrite.length,
    reusedCount,
  };
}

export async function readWebMediaAssetBytes(database, folder, filename) {
  if (!database?.media) {
    throw new Error('Локальное хранилище медиа недоступно.');
  }
  const canonicalUrl = `/api/media/${folder}/${filename}`;
  const row = await database.media.get(canonicalUrl);
  if (!row?.blob) {
    throw new Error(`Файл ${folder}/${filename} отсутствует в локальном хранилище.`);
  }
  if (row.blob.size > 20 * 1024 * 1024) {
    throw new Error(`Файл ${folder}/${filename} превышает допустимый размер.`);
  }
  const buffer = await row.blob.arrayBuffer();
  return new Uint8Array(buffer);
}
