import { mediaURL } from './apiConfig';

const objectUrls = new Map();
const pending = new Set();
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CACHE_BYTES = 150 * 1024 * 1024;

export async function localMediaURL(database, path, kind) {
  const url = mediaURL(path, kind);
  if (!url || /^(blob:|data:)/.test(url)) return url;
  const key = `${database.name}:${url}`;
  const cached = await database.media.get(url);
  if (cached) {
    if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(cached.blob));
    return objectUrls.get(key);
  }
  if (navigator.onLine && kind !== 'videos' && !pending.has(key) && pending.size < 4) {
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
    if (!/^(image|audio)\//.test(blob.type) || blob.size > MAX_FILE_BYTES) return;
    await database.transaction('rw', database.media, async () => {
      let size = 0;
      await database.media.each(item => { size += item.blob.size; });
      if (size + blob.size <= MAX_CACHE_BYTES) await database.media.put({ url, blob });
    });
  } finally {
    clearTimeout(timeout);
  }
}
