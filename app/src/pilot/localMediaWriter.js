import { tr } from '../i18n/locale.js';
import { prepareLocalDb } from '../services/localDb.js';
import { inspectMediaBytes, MAX_ASSET_BYTES } from './materialArchive.js';
import { openNativeMediaDb, storeNativeMediaMetadata } from './nativeMediaDb.js';
import {
  getOfflineMaterialArchivePlugin,
  isNativeOfflineMediaAvailable,
  OFFLINE_MEDIA_KEY_PREFIX,
  resolveOfflineMediaUrlAsync,
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

export async function storeLocalMediaFile(file, folder, { db = null, ttsCache = null } = {}) {
  if (!['images', 'audio', 'videos'].includes(folder)) {
    throw new Error(tr('Неподдерживаемый тип локального медиа.'));
  }
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > MAX_ASSET_BYTES) {
    if (folder === 'audio') {
      throw new Error(tr('Выберите MP3 или PCM WAV до 20 МБ.'));
    }
    if (folder === 'videos') {
      throw new Error(tr('Выберите MP4 или WebM видео до 20 МБ.'));
    }
    throw new Error(tr('Выберите изображение до 20 МБ.'));
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entry = inspectMediaBytes(bytes, folder);
  const relativePath = `${entry.folder}/${entry.filename}`;
  const canonicalUrl = `/api/media/${relativePath}`;
  let database = db;

  if (isNativeOfflineMediaAvailable()) {
    await openNativeMediaDb();
    const dataBase64 = uint8ToBase64(bytes);
    await getOfflineMaterialArchivePlugin().storeMediaAsset({
      folder: entry.folder,
      filename: entry.filename,
      sha256: entry.sha256,
      size: entry.size,
      dataBase64,
      ...(ttsCache ? { repairCorruptAudio: true } : {}),
    });
    await storeNativeMediaMetadata([entry], ttsCache);
  } else {
    database ||= await prepareLocalDb();
    await database.transaction('rw', database.media, database.syncState, async () => {
      await storeWebMediaAssets(database, [entry], new Map([[entry.sha256, bytes]]));
      await database.syncState.put({
        ...entry,
        key: `${OFFLINE_MEDIA_KEY_PREFIX}${relativePath}`,
        updated_at: new Date().toISOString(),
      });
    });
  }

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
