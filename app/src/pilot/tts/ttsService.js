import { prepareLocalDb } from '../../services/localDb.js';
import { studySideText } from '../../utils/structuredStudyCard.js';
import { storeLocalMediaFile } from '../localMediaWriter.js';
import { inspectMediaBytes } from '../materialArchive.js';
import { readStandaloneTtsRate, readStandaloneTtsVoices } from '../standaloneSettings.js';
import { getStandaloneTtsProvider, parseStandaloneVoiceSpec } from './registry.js';
import { prepareTtsText } from './wavUtil.js';

const MAX_PREVIEW_CACHE = 24;
const previewCache = new Map();

function rememberPreviewUrl(cacheKey, url, mime) {
  if (previewCache.has(cacheKey)) {
    const existing = previewCache.get(cacheKey);
    previewCache.delete(cacheKey);
    previewCache.set(cacheKey, existing);
    return existing;
  }
  const entry = { url, mime };
  previewCache.set(cacheKey, entry);
  while (previewCache.size > MAX_PREVIEW_CACHE) {
    const oldestKey = previewCache.keys().next().value;
    const oldest = previewCache.get(oldestKey);
    previewCache.delete(oldestKey);
    if (oldest?.url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(oldest.url);
      } catch { /* ignore */ }
    }
  }
  return entry;
}

export function clearPreviewAudioCache() {
  for (const entry of previewCache.values()) {
    if (entry?.url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch { /* ignore */ }
    }
  }
  previewCache.clear();
}

export async function synthesizeStandaloneAudio({
  text,
  lang = 'de',
  voice = '',
  rate = null,
  persist = false,
  options = null,
  db = null,
  signal = undefined,
}) {
  const cleanText = prepareTtsText(text);
  if (!cleanText) {
    throw new Error('Текст для озвучки пуст');
  }
  const voicesByLang = readStandaloneTtsVoices();
  const code = String(lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
  const effectiveVoiceSpec = voice || voicesByLang[code] || '';
  const { providerId, voice: resolvedVoice, model, engine } = parseStandaloneVoiceSpec(effectiveVoiceSpec);
  const effectiveRate = rate || readStandaloneTtsRate('front');
  const provider = getStandaloneTtsProvider(providerId);

  if (!persist) {
    const cacheKey = `${providerId}|${model || ''}|${engine || ''}|${resolvedVoice}|${effectiveRate}|${cleanText}`;
    if (previewCache.has(cacheKey)) {
      const cached = rememberPreviewUrl(cacheKey, previewCache.get(cacheKey).url, previewCache.get(cacheKey).mime);
      return { url: cached.url, mime: cached.mime, word_boundaries: null, provider: providerId };
    }
  }

  const synth = await provider.synthesize({
    text: cleanText,
    lang: code,
    voice: resolvedVoice === 'default' ? '' : resolvedVoice,
    model,
    engine,
    rate: effectiveRate,
    options,
    signal,
  });

  // Validate container magic bytes before storing or returning to WebView audio element.
  const validated = inspectMediaBytes(synth.bytes, 'audio');

  if (!persist) {
    const blob = new Blob([synth.bytes], { type: validated.mime });
    const url = URL.createObjectURL(blob);
    const cacheKey = `${providerId}|${model || ''}|${engine || ''}|${resolvedVoice}|${effectiveRate}|${cleanText}`;
    rememberPreviewUrl(cacheKey, url, validated.mime);
    return { url, mime: validated.mime, word_boundaries: null, provider: providerId };
  }

  const audioFile = new File([synth.bytes], `tts_synth${validated.ext}`, { type: validated.mime });
  const stored = await storeLocalMediaFile(audioFile, 'audio', { db });
  return {
    path: stored.path,
    url: stored.url,
    sha256: stored.sha256,
    mime: stored.mime,
    word_boundaries: null,
    provider: providerId,
  };
}

export async function generateAndAttachCardAudio({
  cardId,
  side = 'front',
  text = null,
  lang = null,
  voice = '',
  rate = null,
  signal = undefined,
}) {
  const numId = Number(cardId);
  if (!Number.isSafeInteger(numId)) {
    throw new Error('Некорректный ID карточки');
  }
  const db = await prepareLocalDb();
  const initialCard = await db.cards.get(numId);
  if (!initialCard || initialCard.is_deleted || !initialCard.content_v2?.card) {
    const err = new Error('Карточка не найдена');
    err.response = { status: 404, data: { detail: 'Карточка не найдена' } };
    throw err;
  }

  const sideKey = side === 'back' ? 'back' : 'front';
  const snapshotRevision = initialCard.revision ?? 1;
  const snapshotSideText = studySideText(initialCard.content_v2.card, sideKey);
  const spokenText = String(text || snapshotSideText || '').trim();
  const targetLang = lang || initialCard.target_language || 'de';

  const saved = await synthesizeStandaloneAudio({
    text: spokenText,
    lang: targetLang,
    voice,
    rate: rate || readStandaloneTtsRate(sideKey),
    persist: true,
    db,
    signal,
  });

  const nowIso = new Date().toISOString();
  let updatedRevision = snapshotRevision + 1;

  await db.transaction('rw', db.cards, async () => {
    const latestCard = await db.cards.get(numId);
    if (!latestCard || latestCard.is_deleted || !latestCard.content_v2?.card) {
      const err = new Error('Карточка удалена во время синтеза аудио');
      err.response = { status: 404, data: { detail: 'Карточка не найдена' } };
      throw err;
    }
    const latestSideText = studySideText(latestCard.content_v2.card, sideKey);
    if ((latestCard.revision ?? 1) !== snapshotRevision || latestSideText !== snapshotSideText) {
      const err = new Error('Карточка была изменена во время синтеза аудио. Повторите озвучку.');
      err.response = { status: 409, data: { detail: err.message } };
      throw err;
    }

    updatedRevision = (latestCard.revision ?? 1) + 1;
    await db.cards.put({
      ...latestCard,
      ...(sideKey === 'back' ? { audio_back_path: saved.path } : { audio_path: saved.path }),
      revision: updatedRevision,
      standalone_local_edit: true,
      standalone_local_edited_at: nowIso,
      updated_at: nowIso,
    });
  });

  return {
    status: 'ok',
    path: saved.path,
    url: saved.url,
    revision: updatedRevision,
    word_boundaries: null,
  };
}
