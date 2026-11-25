import { mediaURL } from './apiConfig.js';
import * as localDb from './localDb.js';
import { IS_STANDALONE } from '../utils/standaloneMode.js';
import {
  clearOfflineMediaCache,
  isOfflineMediaUrl,
  resolveOfflineMediaUrlAsync,
} from '../pilot/offlineMediaStore.js';

const objectUrls = new Map();
const pending = new Set();
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

function revokeMediaObjectUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

export function clearMediaCache(databaseName = null) {
  const prefix = databaseName ? `${databaseName}:` : null;
  for (const [key, url] of objectUrls.entries()) {
    if (!prefix || key.startsWith(prefix)) {
      revokeMediaObjectUrl(url);
      objectUrls.delete(key);
    }
  }
  if (!databaseName) {
    pending.clear();
    clearOfflineMediaCache();
  } else {
    for (const key of pending) {
      if (key.startsWith(prefix)) {
        pending.delete(key);
      }
    }
    if (IS_STANDALONE) {
      clearOfflineMediaCache({ keepNativeConfig: true });
    }
  }
}

localDb.onLocalDbClose?.(({ databaseName, resetAll }) => {
  clearMediaCache(resetAll ? null : databaseName);
});

export async function localMediaURL(database, path, kind, prefetch = true) {
  if (IS_STANDALONE) {
    return resolveOfflineMediaUrlAsync(database, path, kind);
  }
  const url = mediaURL(path, kind);
  if (!url || isOfflineMediaUrl(url)) return url;
  const key = `${database.name}:${url}`;
  const cached = await database.media.get(url);
  if (cached && cached.blob) {
    try {
      if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(cached.blob));
      return objectUrls.get(key);
    } catch {
      // Fallback to network URL if blob is unreadable
    }
  }
  if (prefetch && navigator.onLine && !pending.has(key) && pending.size < 4) {
    pending.add(key);
    cacheMedia(database, url).catch(error => console.warn('Media cache:', error.message))
      .finally(() => pending.delete(key));
  }
  return url;
}

async function cacheMedia(database, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_FILE_BYTES) return;
    const blob = await response.blob();
    let finalBlob = blob;
    if (!/^(image|audio|video)\//.test(blob.type)) {
      if (/\.mp3(\?|$)/i.test(url)) {
        finalBlob = new Blob([blob], { type: 'audio/mpeg' });
      } else if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) {
        finalBlob = new Blob([blob], { type: 'image/webp' });
      } else {
        return;
      }
    }
    if (finalBlob.size > MAX_FILE_BYTES) return;
    await database.transaction('rw', database.media, async () => {
      let size = 0;
      await database.media.each(item => { size += item.blob.size; });
      if (size + finalBlob.size <= MAX_CACHE_BYTES) await database.media.put({ url, blob: finalBlob });
    });
  } finally {
    clearTimeout(timeout);
  }
}

// Derived URLs never replace the durable paths stored on the card.
export async function cardMediaView(database, card, prefetch = true) {
  const result = { ...card };
  for (const [field, kind] of [['image', 'images'], ['audio', 'audio'], ['audio_back', 'audio'],
    ['video_front', 'videos'], ['video_back', 'videos']]) {
    const path = field === 'image'
      ? (card.image_path || card.content_v2?.card?.image || card.image_url)
      : (card[`${field}_path`] || card[`${field}_url`]);
    result[`${field}_url`] = await localMediaURL(database, path, kind, prefetch);
  }
  result.layout_media_urls = {};
  for (const item of card.content_v2?.card?.layout || []) {
    if (item.type === 'image') result.layout_media_urls[item.id] = await localMediaURL(database, item.path, 'images', prefetch);
  }
  return result;
}
