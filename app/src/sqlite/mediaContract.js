import { sha256Hex } from '../pilot/sha256.js';

export const MEDIA_FOLDERS = ['images', 'audio', 'videos', 'backgrounds'];
const MEDIA_FOLDER_SET = new Set(MEDIA_FOLDERS);
const ROLE_TO_FOLDER = {
  image: 'images',
  images: 'images',
  audio: 'audio',
  'tma-audio': 'audio',
  video: 'videos',
  videos: 'videos',
  background: 'backgrounds',
  backgrounds: 'backgrounds',
};
const SHA256_RE = /^[a-f0-9]{64}$/;
const EXT_RE = /^\.[a-z0-9]{2,5}$/;
const CANONICAL_NAME_RE = /^archive_[a-f0-9]{64}\.[a-z0-9]{2,5}$/;
const CARD_ATTACHMENT_SLOTS = [
  ['image_path', 'images'],
  ['audio_path', 'audio'],
  ['audio_back_path', 'audio'],
  ['video_front_path', 'videos'],
  ['video_back_path', 'videos'],
];

function normalizeFolder(rawFolder) {
  if (!rawFolder) return null;
  return ROLE_TO_FOLDER[String(rawFolder).trim().toLowerCase()] || null;
}

export function isCanonicalMediaFilename(filename) {
  return typeof filename === 'string' && CANONICAL_NAME_RE.test(filename);
}

export function canonicalMediaFilename(sha256HexDigest, ext) {
  const digest = String(sha256HexDigest || '').trim().toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw new Error(`Invalid SHA-256 hex digest: ${sha256HexDigest}`);
  }
  let suffix = String(ext || '').trim().toLowerCase();
  if (!suffix.startsWith('.')) suffix = `.${suffix}`;
  if (!EXT_RE.test(suffix)) {
    throw new Error(`Invalid media file extension: ${ext}`);
  }
  return `archive_${digest}${suffix}`;
}

export function canonicalMediaRelPath(folder, sha256HexDigest, ext) {
  const normalized = normalizeFolder(folder);
  if (!MEDIA_FOLDER_SET.has(normalized)) {
    throw new Error(`Unsupported media folder: ${folder}`);
  }
  return `${normalized}/${canonicalMediaFilename(sha256HexDigest, ext)}`;
}

export function normalizeMediaRelPath(rawPath, defaultFolder = null) {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed || /^(blob:|data:|archive:\/\/)/i.test(trimmed)) return null;
  if (trimmed.includes('\\') || trimmed.includes('\0')) return null;

  let pathPart = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.search || parsed.hash) return null;
      pathPart = parsed.pathname;
    } catch {
      return null;
    }
  } else if (trimmed.includes(':') || trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }

  let folder = null;
  let filename = null;

  if (pathPart.startsWith('/api/media/')) {
    const rest = pathPart.slice('/api/media/'.length).split('/');
    if (rest.length !== 2) return null;
    folder = normalizeFolder(rest[0]);
    filename = rest[1];
  } else if (!pathPart.startsWith('/')) {
    const parts = pathPart.split('/');
    if (parts.length === 2) {
      folder = normalizeFolder(parts[0]);
      filename = parts[1];
    } else if (parts.length === 1 && defaultFolder !== null && isCanonicalMediaFilename(parts[0])) {
      folder = normalizeFolder(defaultFolder);
      filename = parts[0];
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!MEDIA_FOLDER_SET.has(folder) || !filename) return null;
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\') || filename.includes(':')) {
    return null;
  }
  return { folder, filename, relPath: `${folder}/${filename}` };
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : stableJson(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Unsupported value in TTS cache options');
}

export function computeTtsCacheKey({
  textNorm,
  lang = 'de',
  provider,
  voice,
  model = '',
  rate = '+0%',
  options = null,
}) {
  const cleanText = String(textNorm || '').trim();
  if (!cleanText) throw new Error('TTS cache key requires non-empty textNorm');
  const cleanLang = String(lang || 'de').trim().toLowerCase().replaceAll('_', '-');
  const cleanProvider = String(provider || '').trim().toLowerCase();
  if (!cleanProvider) throw new Error('TTS cache key requires provider');
  const cleanVoice = String(voice || '').trim();
  if (!cleanVoice) throw new Error('TTS cache key requires voice');
  const cleanModel = String(model || '').trim();
  const cleanRate = String(rate || '+0%').trim() || '+0%';
  const optionsJson = stableJson(options || {});
  const payload = [
    'lerne-tts-cache-v1',
    cleanProvider,
    cleanModel,
    cleanVoice,
    cleanLang,
    cleanRate,
    optionsJson,
    cleanText,
  ].join('|');
  return sha256Hex(payload);
}

function extractResources(resources, prefix = 'resource') {
  const refs = [];
  if (!Array.isArray(resources)) return refs;
  resources.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const expectedFolder = normalizeFolder(item.type);
    if (!expectedFolder) return;
    const parsed = normalizeMediaRelPath(item.path || item.url, expectedFolder);
    if (parsed && parsed.folder === expectedFolder) {
      refs.push({ slot: `${prefix}:${idx}`, ...parsed });
    }
  });
  return refs;
}

export function extractCardMediaRefs(cardRow = null, contentV2 = null) {
  const refs = [];
  const row = cardRow || {};
  for (const [field, folder] of CARD_ATTACHMENT_SLOTS) {
    const parsed = normalizeMediaRelPath(row[field], folder);
    if (parsed && parsed.folder === folder) {
      refs.push({ slot: field, ...parsed });
    }
  }
  let envelope = contentV2;
  if (!envelope && typeof row.content_v2_json === 'string') {
    try {
      envelope = JSON.parse(row.content_v2_json);
    } catch {
      envelope = null;
    }
  }
  const card = envelope?.card;
  if (card && typeof card === 'object') {
    const cover = normalizeMediaRelPath(card.image, 'images');
    if (cover && cover.folder === 'images') {
      refs.push({ slot: 'card.image', ...cover });
    }
    if (Array.isArray(card.layout)) {
      card.layout.forEach((item, idx) => {
        if (item?.type === 'image') {
          const parsed = normalizeMediaRelPath(item.path, 'images');
          if (parsed && parsed.folder === 'images') {
            refs.push({ slot: `layout:${item.id || idx}`, ...parsed });
          }
        }
      });
    }
    if (card.metadata && typeof card.metadata === 'object') {
      refs.push(...extractResources(card.metadata.resources, 'card_resource'));
    }
  }
  return refs;
}

export function extractDeckMediaRefs(metadata) {
  let parsed = metadata;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];
  return extractResources(parsed.resources, 'deck_resource');
}
