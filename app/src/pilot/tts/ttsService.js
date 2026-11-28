import { prepareLocalDb } from '../../services/localDb.js';
import { canEditContainer, isBundledSeedCard } from '../../utils/deckUtils.js';
import { studySideText } from '../../utils/structuredStudyCard.js';
import { computeTtsCacheKey } from '../../sqlite/mediaContract.js';
import { storeLocalMediaFile } from '../localMediaWriter.js';
import { inspectMediaBytes } from '../materialArchive.js';
import {
  OFFLINE_MEDIA_KEY_PREFIX,
  getOfflineMaterialArchivePlugin,
  isNativeOfflineMediaAvailable,
  parseOfflineMediaRef,
  registerNativeMediaFiles,
  resolveOfflineMediaUrlAsync,
} from '../offlineMediaStore.js';
import { sha256Hex } from '../sha256.js';
import {
  readStandaloneAndroidTtsEngine,
  readStandaloneTtsProvider,
  readStandaloneTtsRate,
  readStandaloneTtsVoices,
} from '../standaloneSettings.js';
import { piperTtsProvider } from './piperTtsProvider.js';
import { getStandaloneTtsProvider, isVoiceSpecCompatibleWithProvider, parseStandaloneVoiceSpec } from './registry.js';
import { normalizeRateString, prepareTtsText } from './wavUtil.js';

const MAX_PREVIEW_CACHE = 24;
const MAX_STUDY_TTS_CACHE_ENTRIES = 400;
const previewCache = new Map();
const inFlightStudySynthesis = new Map();

const HIDDEN_ANSWER_EXERCISE_TYPES = new Set(['trainer', 'word_bank', 'puzzle', 'match']);
const TARGET_LANG_BACK_TYPES = new Set(['free_text', 'editable_text']);
const STUDY_TTS_CACHE_PREFIX = 'tts_study_cache:';
const NON_LATIN_SCRIPT_LANGS = new Set([
  'ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky',
  'ar', 'he', 'fa', 'zh', 'ja', 'ko', 'el', 'hi', 'th', 'ka', 'hy',
]);

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

export function filterStudyTextForLanguage(rawText, lang = '') {
  const raw = String(rawText || '').trim();
  if (!raw || !lang) return raw;
  const base = String(lang).toLowerCase().replace('_', '-').split('-')[0];
  if (!base || NON_LATIN_SCRIPT_LANGS.has(base)) return raw;
  if (!/[\u0400-\u052F]/.test(raw)) return raw;

  const latinSegments = raw.match(
    /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF][^\u0400-\u052F]*[A-Za-z\u00C0-\u024F\u1E00-\u1EFF.!?]|[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+/g
  );
  if (!latinSegments || latinSegments.length === 0) return '';
  const cleaned = latinSegments
    .map((seg) => seg.replace(/^[\s,;:—–\-()[\]«»"']+|[\s,;:—–\-()[\]«»"']+$/g, '').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned
    .map((seg, idx) => (idx < cleaned.length - 1 && !/[.!?]$/.test(seg) ? `${seg}.` : seg))
    .join(' ');
}

export function cleanStudySpeakableText(rawText, maxChars = 900, lang = '') {
  if (!rawText) return '';
  const stripped = String(rawText)
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gi, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]*(?:#{1,6}|>|-|\*|\+)[ \t]+/gm, '')
    .replace(/→/g, ' — ');
  const langFiltered = filterStudyTextForLanguage(stripped, lang);
  return prepareTtsText(langFiltered, maxChars);
}

export function isTargetLanguageCardSide(content, side = 'front') {
  if (side !== 'back') return true;
  return Boolean(content?.type && TARGET_LANG_BACK_TYPES.has(content.type));
}

/**
 * Return speakable text for a Native V2 card side while protecting unrevealed exercise answers.
 * For trainer, word_bank, puzzle, and match, front-side answers remain silent until answerRevealed or isFlipped.
 */
export function getStudySpeakableText(content, side = 'front', { isFlipped = false, answerRevealed = false, lang = '' } = {}) {
  if (!content || !content.type || !content.data) return '';
  const sideKey = side === 'back' ? 'back' : 'front';

  if (sideKey === 'front' && HIDDEN_ANSWER_EXERCISE_TYPES.has(content.type)) {
    if (!isFlipped && !answerRevealed) {
      return '';
    }
    if (content.type === 'match' && Array.isArray(content.data.pairs)) {
      return cleanStudySpeakableText(
        content.data.pairs.map((p) => `${p.left} — ${p.right}`).join('. '),
        900,
        lang,
      );
    }
  }

  return cleanStudySpeakableText(studySideText(content, sideKey), 900, lang);
}

export function canUseLocalOfflineTtsForLang(lang = 'de', { piperVoices = null, providerOverride = null } = {}) {
  const code = String(lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
  const langPrefix = code === 'no' ? 'nb' : code;
  let provider;
  try {
    provider = getStandaloneTtsProvider(providerOverride || readStandaloneTtsProvider());
  } catch {
    return false;
  }
  if (!provider?.offline || !provider.isSupported()) {
    return false;
  }
  if (provider.id === 'piper' && Array.isArray(piperVoices)) {
    return piperVoices.some(
      (v) => String(v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === langPrefix
    );
  }
  return true;
}

export async function canUseLocalOfflineTtsForLangAsync(lang = 'de', { providerOverride = null } = {}) {
  const providerId = providerOverride || readStandaloneTtsProvider();
  if (!canUseLocalOfflineTtsForLang(lang, { providerOverride: providerId })) {
    return false;
  }
  if (providerId === 'piper') {
    try {
      const catalog = await piperTtsProvider.listVoices();
      return canUseLocalOfflineTtsForLang(lang, {
        piperVoices: catalog?.voices || [],
        providerOverride: 'piper',
      });
    } catch {
      return false;
    }
  }
  return true;
}

async function resolveValidCachedStudyMediaUrl(database, canonicalPath, expectedSha256) {
  if (!canonicalPath || typeof canonicalPath !== 'string') return null;
  const ref = parseOfflineMediaRef(canonicalPath, 'audio');
  if (!ref) return null;

  if (isNativeOfflineMediaAvailable()) {
    try {
      const stat = await getOfflineMaterialArchivePlugin().statMediaAsset({
        folder: ref.folder,
        filename: ref.filename,
      });
      if (!stat?.exists || !stat?.valid || (expectedSha256 && stat.sha256 !== expectedSha256)) {
        return null;
      }
      registerNativeMediaFiles([{
        folder: ref.folder,
        filename: ref.filename,
        sha256: stat.sha256,
        size: stat.size,
        mime: stat.mime || 'audio/wav',
        path: stat.path || `media/${stat.sha256}.wav`,
      }]);
      return (await resolveOfflineMediaUrlAsync(database, ref.canonicalUrl, 'audio')) || ref.canonicalUrl;
    } catch {
      return null;
    }
  }

  if (!database?.media) return null;
  const mediaRow = await database.media.get(ref.canonicalUrl);
  if (!mediaRow?.blob) return null;
  const url = await resolveOfflineMediaUrlAsync(database, ref.canonicalUrl, 'audio');
  return url || null;
}

async function pruneStudyTtsCacheIfNeeded(database) {
  if (!database?.syncState) return;
  try {
    const entries = await database.syncState.where('key').startsWith(STUDY_TTS_CACHE_PREFIX).toArray();
    if (entries.length <= MAX_STUDY_TTS_CACHE_ENTRIES) return;
    entries.sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    const excess = entries.slice(0, entries.length - MAX_STUDY_TTS_CACHE_ENTRIES);
    const excessKeys = excess.map((e) => e.key);
    await database.syncState.bulkDelete(excessKeys);

    if (!isNativeOfflineMediaAvailable() && database.media && database.cards) {
      const remainingCache = new Set(entries.slice(excess.length).map((e) => e.path).filter(Boolean));
      const allCards = await database.cards.toArray();
      const cardPaths = new Set();
      for (const c of allCards) {
        if (c?.audio_path) cardPaths.add(c.audio_path);
        if (c?.audio_back_path) cardPaths.add(c.audio_back_path);
      }
      for (const item of excess) {
        const p = item?.path;
        if (p && !remainingCache.has(p) && !cardPaths.has(p)) {
          await database.media.delete(p).catch(() => {});
          const ref = parseOfflineMediaRef(p, 'audio');
          if (ref) {
            await database.syncState.delete(`${OFFLINE_MEDIA_KEY_PREFIX}${ref.relativePath}`).catch(() => {});
          }
        }
      }
    }
  } catch {
    // Best-effort bounded cache eviction.
  }
}

function selectPiperVoiceModelForCache(voices, requestedVoiceSpec, langCode, { strictExplicit = false } = {}) {
  const clean = String(requestedVoiceSpec || '').replace(/^piper:/, '').replace(/^:/, '').trim();
  const [modelPart, speakerPart] = clean.includes(':') ? clean.split(':', 2) : [clean, ''];
  const langPrefix = langCode === 'no' ? 'nb' : langCode;

  if (modelPart && modelPart !== 'default') {
    const exact = (voices || []).find((v) => v.id === modelPart);
    if (exact && String(exact.lang || '').toLowerCase().startsWith(langPrefix)) {
      return { model: exact, speakerSuffix: speakerPart ? `:${speakerPart}` : '' };
    }
    if (strictExplicit) {
      if (!exact) {
        throw new Error(`Голосовая модель Piper не найдена: ${modelPart}`);
      }
      throw new Error(`Модель Piper ${modelPart} не соответствует языку '${langPrefix}'`);
    }
  }

  const matching = (voices || []).filter((v) => String(v.lang || '').toLowerCase().startsWith(langPrefix));
  const chosen = matching.find((v) => v.commercialSafe !== false) || matching[0];
  if (!chosen) {
    throw new Error(`Для языка '${langPrefix}' не установлена локальная голосовая модель Piper`);
  }
  return { model: chosen, speakerSuffix: '' };
}

/**
 * Synthesize or reuse locally cached offline TTS audio for study playback without mutating db.cards.
 * Never triggers paid/online providers (Gemini / Azure) and never overwrites authored card audio.
 */
export async function synthesizeOrGetCachedStudyAudio({
  text,
  lang = 'de',
  side = 'front',
  voice = '',
  rate = null,
  db = null,
  signal = undefined,
}) {
  if (signal?.aborted) {
    throw new DOMException('TTS canceled', 'AbortError');
  }
  const cleanText = cleanStudySpeakableText(text, 900, lang);
  if (!cleanText) {
    throw new Error('Текст для озвучки пуст');
  }

  const code = String(lang || 'de').toLowerCase().replace('_', '-').split('-')[0] || 'de';
  const activeProvider = readStandaloneTtsProvider();
  const voicesByLang = readStandaloneTtsVoices();
  const storedLangVoice = voicesByLang[code] || '';
  const hasExplicitCallerVoice = Boolean(String(voice || '').trim());
  const effectiveVoiceSpec = hasExplicitCallerVoice
    ? String(voice).trim()
    : (isVoiceSpecCompatibleWithProvider(storedLangVoice, activeProvider) ? storedLangVoice : '');
  const { providerId, voice: resolvedVoice, engine } = parseStandaloneVoiceSpec(effectiveVoiceSpec, activeProvider);
  const provider = getStandaloneTtsProvider(providerId);

  if (!provider.offline || !provider.isSupported()) {
    throw new Error('Автоматическая озвучка при обучении доступна только для локальных офлайн-провайдеров TTS');
  }

  let effectiveVoiceKey = resolvedVoice || 'default';
  let modelVersionKey = engine || '';
  let explicitSynthVoice = effectiveVoiceSpec;

  if (providerId === 'piper') {
    const catalog = await piperTtsProvider.listVoices();
    const { model: chosenModel, speakerSuffix } = selectPiperVoiceModelForCache(
      catalog.voices,
      resolvedVoice,
      code,
      { strictExplicit: hasExplicitCallerVoice && resolvedVoice !== '' && resolvedVoice !== 'default' },
    );
    effectiveVoiceKey = `${chosenModel.id}${speakerSuffix}`;
    modelVersionKey = chosenModel.sha256 || String(chosenModel.sizeBytes || '');
    explicitSynthVoice = `piper:${chosenModel.id}${speakerSuffix}`;
  } else if (providerId === 'android_system') {
    modelVersionKey = engine || readStandaloneAndroidTtsEngine() || 'default';
    explicitSynthVoice = effectiveVoiceSpec || 'android_system::default';
  }

  const sideKey = side === 'back' ? 'back' : 'front';
  const effectiveRate = normalizeRateString(rate || readStandaloneTtsRate(sideKey));
  const lookupHash = isNativeOfflineMediaAvailable()
    ? computeTtsCacheKey({
        textNorm: cleanText,
        lang: code,
        provider: providerId,
        voice: effectiveVoiceKey,
        model: modelVersionKey,
        rate: effectiveRate,
      })
    : sha256Hex(
        `lerne-study-tts-v1|${providerId}|${effectiveVoiceKey}|${modelVersionKey}|${code}|${effectiveRate}|${cleanText}`,
      );
  const syncKey = `${STUDY_TTS_CACHE_PREFIX}${lookupHash}`;

  const database = db || await prepareLocalDb();
  const cachedRecord = await database.syncState.get(syncKey);
  if (cachedRecord?.path) {
    const validUrl = await resolveValidCachedStudyMediaUrl(database, cachedRecord.path, cachedRecord.sha256);
    if (validUrl) {
      return {
        path: cachedRecord.path,
        url: validUrl,
        sha256: cachedRecord.sha256 || '',
        mime: cachedRecord.mime || 'audio/wav',
        word_boundaries: null,
        provider: providerId,
        cached: true,
      };
    }
    await database.syncState.delete(syncKey).catch(() => {});
  }

  let entry = inFlightStudySynthesis.get(syncKey);
  if (!entry) {
    const sharedAbort = new AbortController();
    const runSynthesis = async () => {
      const saved = await synthesizeStandaloneAudio({
        text: cleanText,
        lang: code,
        voice: explicitSynthVoice,
        rate: effectiveRate,
        persist: true,
        db: database,
        signal: sharedAbort.signal,
      });
      await database.syncState.put({
        key: syncKey,
        path: saved.path,
        sha256: saved.sha256,
        mime: saved.mime,
        provider: providerId,
        voice: effectiveVoiceKey,
        lang: code,
        rate: effectiveRate,
        updated_at: new Date().toISOString(),
      });
      void pruneStudyTtsCacheIfNeeded(database);
      return {
        ...saved,
        cached: false,
      };
    };

    entry = {
      sharedAbort,
      subscribers: 0,
      promise: null,
    };
    entry.promise = runSynthesis().finally(() => {
      if (inFlightStudySynthesis.get(syncKey) === entry) {
        inFlightStudySynthesis.delete(syncKey);
      }
    });
    inFlightStudySynthesis.set(syncKey, entry);
  }

  entry.subscribers += 1;
  if (!signal) {
    return entry.promise;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const onCallerAbort = () => {
      if (settled) return;
      settled = true;
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      if (entry.subscribers === 0) {
        entry.sharedAbort.abort();
      }
      reject(new DOMException('TTS canceled', 'AbortError'));
    };
    if (signal.aborted) {
      onCallerAbort();
      return;
    }
    signal.addEventListener('abort', onCallerAbort, { once: true });
    entry.promise.then(
      (res) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onCallerAbort);
        resolve(res);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onCallerAbort);
        reject(err);
      },
    );
  });
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
  const activeProvider = readStandaloneTtsProvider();
  const storedLangVoice = voicesByLang[code] || '';
  const effectiveVoiceSpec = voice
    || (isVoiceSpecCompatibleWithProvider(storedLangVoice, activeProvider) ? storedLangVoice : '');
  const { providerId, voice: resolvedVoice, model, engine } = parseStandaloneVoiceSpec(effectiveVoiceSpec, activeProvider);
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

  const initialDeck = initialCard.deck_id != null ? await db.decks.get(Number(initialCard.deck_id)) : null;
  if (isBundledSeedCard(initialCard) || (initialDeck && !canEditContainer(initialDeck, false))) {
    const err = new Error('Колода доступна только для чтения: перезапись карточек запрещена.');
    err.response = { status: 403, data: { detail: err.message } };
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

  await db.transaction('rw', db.decks, db.cards, async () => {
    const latestCard = await db.cards.get(numId);
    if (!latestCard || latestCard.is_deleted || !latestCard.content_v2?.card) {
      const err = new Error('Карточка удалена во время синтеза аудио');
      err.response = { status: 404, data: { detail: 'Карточка не найдена' } };
      throw err;
    }
    const latestDeck = latestCard.deck_id != null ? await db.decks.get(Number(latestCard.deck_id)) : null;
    if (isBundledSeedCard(latestCard) || (latestDeck && !canEditContainer(latestDeck, false))) {
      const err = new Error('Колода доступна только для чтения: перезапись карточек запрещена.');
      err.response = { status: 403, data: { detail: err.message } };
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
