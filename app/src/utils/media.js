const SUPABASE_AUDIO_CDN = 'https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio';

/**
 * Возвращает прямой публичный CDN URL для аудиофайла из бакета audio в Supabase Storage.
 * Воспроизведение происходит напрямую из CDN без задержек проксирования.
 * @param {string} pathOrUrl - Путь или URL аудиофайла.
 * @returns {string} Прямой URL для воспроизведения или пустая строка.
 */
export const getAudioUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (trimmed.includes('/storage/v1/object/public/tma-audio/')) {
      return trimmed.replace('/storage/v1/object/public/tma-audio/', '/storage/v1/object/public/audio/');
    }
    return trimmed;
  }

  const cleanPath = trimmed.split('?')[0];
  const filename = cleanPath.split(/[\\/]/).pop();
  if (!filename) return '';

  return `${SUPABASE_AUDIO_CDN}/${filename}`;
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

