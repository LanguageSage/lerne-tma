import { mediaURL } from './apiConfig.js';

const objectUrls = new Map();
const pending = new Set();
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

export async function localMediaURL(database, path, kind) {
  const url = mediaURL(path, kind);
  if (!url || /^(blob:|data:)/.test(url)) return url;
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
  if (navigator.onLine && !pending.has(key) && pending.size < 4) {
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
export async function cardMediaView(database, card) {
  const result = { ...card };
  for (const [field, kind] of [['image', 'images'], ['audio', 'audio'], ['audio_back', 'audio'],
    ['video_front', 'videos'], ['video_back', 'videos']]) {
    const path = card[`${field}_path`] || card[`${field}_url`];
    result[`${field}_url`] = await localMediaURL(database, path, kind);
  }
  result.layout_media_urls = {};
  for (const item of card.content_v2?.card?.layout || []) {
    if (item.type === 'image') result.layout_media_urls[item.id] = await localMediaURL(database, item.path, 'images');
  }
  return result;
}
