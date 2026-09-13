/**
 * Возвращает канонический URL для аудиофайла через прокси-эндпоинт /api/media/audio/...
 * Это гарантирует правильный заголовок audio/mpeg, HTTP 206 Partial Content (диапазоны байт)
 * и обход кэша CDN Cloudflare (который мог закэшировать application/octet-stream).
 * @param {string} pathOrUrl - Путь или URL аудиофайла.
 * @returns {string} Канонический URL для воспроизведения или пустая строка.
 */
export const getAudioUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

  const cleanPath = trimmed.split('?')[0];
  const filename = cleanPath.split(/[\\/]/).pop();
  if (!filename) return '';

  if (cleanPath === `/api/media/audio/${filename}`) return cleanPath;

  return `/api/media/audio/${filename}`;
};

/**
 * Очищает путь медиа-файла от префикса API, оставляя только относительный путь.
 * @param {string} path - Полный URL или путь.
 * @returns {string} Относительный путь.
 */
export const cleanMedia = (path) => {
  if (!path) return '';
  if (path.startsWith('/lid_images/')) {
    return path.replace(/^\/lid_images\//, '');
  }
  if (path.startsWith('/api/media/')) {
    const parts = path.split('/');
    return parts.slice(3).join('/');
  }
  return path;
};

