import { IS_STANDALONE } from '../utils/standaloneMode.js';

export const OFFLINE_MEDIA_KEY_PREFIX = 'offline-media:';
export const MEDIA_FOLDERS = new Set(['images', 'audio', 'videos', 'backgrounds']);
export const CANONICAL_ASSET_NAME_RE = /^archive_[a-f0-9]{64}\.[a-z0-9]{2,4}$/;

let nativeMediaRoot = null;
let nativeFileSrcConverter = (filePath) => {
  const cap = globalThis?.Capacitor;
  return typeof cap?.convertFileSrc === 'function' ? cap.convertFileSrc(filePath) : filePath;
};
const webBlobUrls = new Map();
const knownOfflineMediaKeys = new Set();

function normalizeKind(kind) {
  if (!kind) return 'images';
  if (kind === 'image') return 'images';
  if (kind === 'video') return 'videos';
  if (kind === 'background') return 'backgrounds';
  if (kind === 'tma-audio') return 'audio';
  return MEDIA_FOLDERS.has(kind) ? kind : 'images';
}

export function isOfflineMediaUrl(value) {
  if (typeof value !== 'string') return false;
  return /^(blob:|data:)/.test(value) || value.includes('/_capacitor_file_/');
}

export function parseOfflineMediaRef(rawPath, defaultKind = 'images') {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed || /^(blob:|data:|archive:\/\/)/i.test(trimmed)) return null;

  let pathPart = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.search || parsed.hash) return null;
      pathPart = parsed.pathname;
    } catch {
      return null;
    }
  } else if (trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }

  let folder = null;
  let filename = null;

  if (pathPart.startsWith('/api/media/')) {
    const rest = pathPart.slice('/api/media/'.length).split('/');
    if (rest.length !== 2) return null;
    folder = rest[0] === 'tma-audio' ? 'audio' : rest[0];
    filename = rest[1];
  } else if (!pathPart.startsWith('/')) {
    const parts = pathPart.split('/');
    if (parts.length === 2) {
      folder = parts[0] === 'tma-audio' ? 'audio' : parts[0];
      filename = parts[1];
    } else if (parts.length === 1 && CANONICAL_ASSET_NAME_RE.test(parts[0])) {
      folder = normalizeKind(defaultKind);
      filename = parts[0];
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!MEDIA_FOLDERS.has(folder) || !filename) return null;
  if (
    filename === '.'
    || filename === '..'
    || filename.includes('\\')
    || filename.includes(':')
    || filename.includes('\0')
    || filename.includes('/')
  ) {
    return null;
  }

  const relativePath = `${folder}/${filename}`;
  return {
    folder,
    filename,
    relativePath,
    canonicalUrl: `/api/media/${relativePath}`,
  };
}

export function setNativeMediaConfig(root, converter = null) {
  nativeMediaRoot = root ? String(root).replace(/\/+$/, '') : null;
  if (typeof converter === 'function') {
    nativeFileSrcConverter = converter;
  }
}

export function getNativeMediaRoot() {
  return nativeMediaRoot;
}

export function getWebBlobUrl(canonicalUrl) {
  return webBlobUrls.get(canonicalUrl) || null;
}

export function setWebBlobUrl(canonicalUrl, blobUrl) {
  webBlobUrls.set(canonicalUrl, blobUrl);
}

export function hasKnownOfflineMediaKey(relativePath) {
  return knownOfflineMediaKeys.has(relativePath);
}

export function addKnownOfflineMediaKey(relativePath) {
  if (relativePath) knownOfflineMediaKeys.add(relativePath);
}

export function resolveOfflineMediaUrlSync(rawPath, defaultKind = 'images') {
  if (!IS_STANDALONE || typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const trimmed = rawPath.trim();
  if (isOfflineMediaUrl(trimmed)) return trimmed;

  const ref = parseOfflineMediaRef(trimmed, defaultKind);
  if (!ref) return null;

  if (nativeMediaRoot) {
    if (!knownOfflineMediaKeys.has(ref.relativePath) && !CANONICAL_ASSET_NAME_RE.test(ref.filename)) {
      return null;
    }
    return nativeFileSrcConverter(`${nativeMediaRoot}/${ref.relativePath}`);
  }

  return webBlobUrls.get(ref.canonicalUrl) || null;
}

export function clearOfflineMediaCache() {
  for (const url of webBlobUrls.values()) {
    try {
      if (typeof URL?.revokeObjectURL === 'function' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Ignore cleanup errors.
    }
  }
  webBlobUrls.clear();
  knownOfflineMediaKeys.clear();
  nativeMediaRoot = null;
}
