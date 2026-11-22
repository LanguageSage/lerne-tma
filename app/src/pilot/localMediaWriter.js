import { tr } from '../i18n/locale.js';
import { prepareLocalDb } from '../services/localDb.js';
import { inspectMediaBytes, MAX_ASSET_BYTES } from './materialArchive.js';
import {
  getOfflineMaterialArchivePlugin,
  isNativeOfflineMediaAvailable,
  OFFLINE_MEDIA_KEY_PREFIX,
  registerNativeMediaFiles,
  resolveOfflineMediaUrlAsync,
  resolveOfflineMediaUrlSync,
  storeWebMediaAssets,
} from './offlineMediaStore.js';

function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function storeLocalMediaFile(file, folder, { db = null } = {}) {
  if (!['images', 'audio'].includes(folder)) {
    throw new Error(tr('Неподдерживаемый тип локального медиа.'));
  }
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_ASSET_BYTES) {
    throw new Error(folder === 'audio'
      ? tr('Выберите MP3 или PCM WAV до 20 МБ.')
      : tr('Выберите изображение до 20 МБ.'));
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entry = inspectMediaBytes(bytes, folder);
  const relativePath = `${entry.folder}/${entry.filename}`;
  const canonicalUrl = `/api/media/${relativePath}`;
  const metaRecord = {
    key: `${OFFLINE_MEDIA_KEY_PREFIX}${relativePath}`,
    sha256: entry.sha256,
    folder: entry.folder,
    filename: entry.filename,
    mime: entry.mime,
    size: entry.size,
    path: entry.path,
    updated_at: new Date().toISOString(),
  };

  const database = db || await prepareLocalDb();

  if (isNativeOfflineMediaAvailable()) {
    const dataBase64 = uint8ToBase64(bytes);
    await getOfflineMaterialArchivePlugin().storeMediaAsset({
      folder: entry.folder,
      filename: entry.filename,
      sha256: entry.sha256,
      size: entry.size,
      dataBase64,
    });
    await database.syncState.put(metaRecord);
    registerNativeMediaFiles([entry]);
    const url = resolveOfflineMediaUrlSync(canonicalUrl, entry.folder) || canonicalUrl;
    return {
      path: canonicalUrl,
      url,
      sha256: entry.sha256,
      size: entry.size,
      mime: entry.mime,
      relativePath,
    };
  }

  await database.transaction('rw', database.media, database.syncState, async () => {
    await storeWebMediaAssets(database, [entry], new Map([[entry.sha256, bytes]]));
    await database.syncState.put(metaRecord);
  });

  const url = (await resolveOfflineMediaUrlAsync(database, canonicalUrl, entry.folder)) || canonicalUrl;
  return {
    path: canonicalUrl,
    url,
    sha256: entry.sha256,
    size: entry.size,
    mime: entry.mime,
    relativePath,
  };
}
