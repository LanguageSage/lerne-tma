/**
 * Очищает путь медиа-файла от префикса API, оставляя только относительный путь.
 * @param {string} path - Полный URL или путь.
 * @returns {string} Относительный путь.
 */
export const cleanMedia = (path) => {
  if (!path) return '';
  if (path.startsWith('/api/media/')) {
    const parts = path.split('/');
    // Формат обычно: /api/media/images/filename.webp -> parts: ["", "api", "media", "images", "filename.webp"]
    // Нам нужно images/filename.webp или просто filename.webp
    // Backend resolve_media_url умеет работать с обоими, но лучше сохранять filename.webp или subdir/filename.webp
    return parts.slice(3).join('/');
  }
  return path;
};
