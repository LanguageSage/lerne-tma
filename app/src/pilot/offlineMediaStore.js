import { Capacitor, registerPlugin } from '@capacitor/core';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import { sha256BytesHex } from './sha256.js';
import {
  CANONICAL_ASSET_NAME_RE,
  MEDIA_FOLDERS,
  OFFLINE_MEDIA_KEY_PREFIX,
  addKnownOfflineMediaKey,
  clearOfflineMediaCache,
  getNativeMediaRoot,
  getWebBlobUrl,
  isOfflineMediaUrl,
  parseOfflineMediaRef,
  resolveOfflineMediaUrlSync,
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

const OfflineMaterialArchive = registerPlugin('OfflineMaterialArchive');

export function isNativeOfflineMediaAvailable() {
  try {
    return Boolean(Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('OfflineMaterialArchive'));
  } catch {
    return false;
  }
}

export function getOfflineMaterialArchivePlugin() {
  return OfflineMaterialArchive;
}

export function registerNativeMediaFiles(assets) {
  if (!Array.isArray(assets)) return;
  for (const asset of assets) {
    if (asset?.folder && asset?.filename) {
      addKnownOfflineMediaKey(`${asset.folder}/${asset.filename}`);
    }
  }
}

export async function initOfflineMediaStore(database) {
  if (!IS_STANDALONE) return { mode: 'disabled' };

  if (isNativeOfflineMediaAvailable()) {
    const res = await OfflineMaterialArchive.getMediaRoot();
    setNativeMediaConfig(res?.mediaRoot || null, filePath => Capacitor.convertFileSrc(filePath));
  }

  const nativeRoot = getNativeMediaRoot();

  if (database?.syncState) {
    const records = await database.syncState.where('key').startsWith(OFFLINE_MEDIA_KEY_PREFIX).toArray();
    for (const record of records) {
      if (record?.folder && record?.filename) {
        addKnownOfflineMediaKey(`${record.folder}/${record.filename}`);
      }
    }

    if (!nativeRoot && database.media && typeof URL?.createObjectURL === 'function') {
      const canonicalUrls = records
        .filter(r => r?.folder && r?.filename)
        .map(r => `/api/media/${r.folder}/${r.filename}`);
      if (canonicalUrls.length > 0) {
        const mediaEntries = await database.media.bulkGet(canonicalUrls);
        mediaEntries.forEach((entry, index) => {
          const canonicalUrl = canonicalUrls[index];
          if (entry?.blob && !getWebBlobUrl(canonicalUrl)) {
            try {
              setWebBlobUrl(canonicalUrl, URL.createObjectURL(entry.blob));
            } catch {
              // Ignore object URL errors in non-DOM test runtimes.
            }
          }
        });
      }
    }
  }

  return {
    mode: nativeRoot ? 'native' : 'web',
    nativeMediaRoot: nativeRoot,
  };
}

export async function resolveOfflineMediaUrlAsync(database, rawPath, defaultKind = 'images') {
  if (!IS_STANDALONE || typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const syncResolved = resolveOfflineMediaUrlSync(rawPath, defaultKind);
  if (syncResolved) return syncResolved;

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
      addKnownOfflineMediaKey(ref.relativePath);
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
      const existingBytes = new Uint8Array(await existing.blob.arrayBuffer());
      const existingSha = sha256BytesHex(existingBytes);
      if (existingSha !== entry.sha256 || existingBytes.length !== entry.size) {
        throw new Error(`Конфликт существующего медиа ${entry.filename}: файл не изменён.`);
      }
      reusedCount += 1;
    } else {
      itemsToWrite.push({
        url: canonicalUrl,
        blob: new Blob([bytes], { type: entry.mime || 'application/octet-stream' }),
        bytes,
        entry,
      });
    }
  }

  if (itemsToWrite.length > 0) {
    await database.transaction('rw', database.media, async () => {
      await database.media.bulkPut(itemsToWrite.map(item => ({ url: item.url, blob: item.blob })));
    });
  }

  for (const item of verifiedEntries) {
    addKnownOfflineMediaKey(`${item.entry.folder}/${item.entry.filename}`);
  }
  if (typeof URL?.createObjectURL === 'function') {
    for (const item of itemsToWrite) {
      if (!getWebBlobUrl(item.url)) {
        try {
          setWebBlobUrl(item.url, URL.createObjectURL(item.blob));
        } catch {
          // Ignore object URL errors in Node unit tests.
        }
      }
    }
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
  const buffer = await row.blob.arrayBuffer();
  return new Uint8Array(buffer);
}
