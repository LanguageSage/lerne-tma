import { tr } from '../i18n/locale.js';
import { prepareLocalDb } from '../services/localDb.js';
import { getUserId } from '../utils/auth.js';
import { isLeech } from '../utils/srsEngine.js';
import { STANDALONE_APPLICATION_ID } from '../utils/standaloneMode.js';
import { buildOriginKey, getMaterialExportSource } from './materialArchiveIdentity.js';
import { getStandaloneCardLookup, getStandalonePack } from './standalonePack.js';
import { sha256Hex } from './sha256.js';

export const PROGRESS_BACKUP_FORMAT = 'lerne-offline-progress-backup';
export const PROGRESS_BACKUP_SCHEMA_VERSION = 1;
export const PROGRESS_BACKUP_INTEGRITY_SCOPE = 'full-v1';
export const PROGRESS_BACKUP_INTEGRITY_SCOPE_V2 = 'full-v2';
export const LAST_BACKUP_META_KEY = 'standalone_last_progress_backup';
export const LAST_RESTORE_META_KEY = 'standalone_last_progress_restore';

const ALLOWED_QUEUES = new Set(['new', 'learning', 'relearning', 'review']);
const ALLOWED_INTEGRITY_SCOPES = new Set(['core-v1', 'full-v1', 'full-v2']);
const validMaterialKey = (key, kind) => key === undefined || (
  typeof key === 'string' && key.length < 120
  && /^archive:LOCAL:[a-f0-9]{64}:(card|deck):[1-9]\d*$/.test(key)
  && key.includes(`:${kind}:`)
);

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Backup contains non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Backup contains unsupported value type');
}

export function computeBackupHash(payload) {
  const base = {
    format: payload.format,
    schema_version: payload.schema_version,
    exported_at: payload.exported_at,
    app: payload.app,
    summary: payload.summary,
    records: payload.records,
    deck_preferences: payload.deck_preferences,
  };
  if (payload.imported_records !== undefined || payload.imported_deck_preferences !== undefined) {
    base.imported_records = payload.imported_records || [];
    base.imported_deck_preferences = payload.imported_deck_preferences || [];
  }
  return sha256Hex(canonicalJson(base));
}

export function computeLegacyCoreBackupHash(payload) {
  return sha256Hex(canonicalJson({
    format: payload.format,
    schema_version: payload.schema_version,
    app: payload.app,
    records: payload.records,
    deck_preferences: payload.deck_preferences,
  }));
}

function isNullableIsoDate(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function isReviewedRecord(record) {
  return Boolean(record && (record.last_reviewed != null || record.queue !== 'new' || (record.repetitions || 0) > 0));
}

function hasValidSrsFields(record) {
  return (
    ALLOWED_QUEUES.has(record.queue)
    && typeof record.interval === 'number' && Number.isFinite(record.interval) && record.interval >= 0
    && typeof record.ease_factor === 'number' && Number.isFinite(record.ease_factor) && record.ease_factor >= 1.0 && record.ease_factor <= 5.0
    && Number.isInteger(record.repetitions) && record.repetitions >= 0
    && Number.isInteger(record.lapses) && record.lapses >= 0
    && (record.step_index === null || (Number.isInteger(record.step_index) && record.step_index >= 0))
    && Number.isInteger(record.flag) && record.flag >= 0 && record.flag <= 7
    && typeof record.want_to_learn === 'boolean'
    && isNullableIsoDate(record.next_review)
    && isNullableIsoDate(record.last_reviewed)
    && isNullableIsoDate(record.updated_at)
  );
}

function serializeProgressRecord(row, cardKey, extra = {}) {
  return {
    card_id: row.card_id,
    card_key: cardKey,
    ...extra,
    queue: ALLOWED_QUEUES.has(row.queue) ? row.queue : 'new',
    interval: typeof row.interval === 'number' && Number.isFinite(row.interval) && row.interval >= 0 ? row.interval : 0,
    ease_factor: typeof row.ease_factor === 'number' && Number.isFinite(row.ease_factor) && row.ease_factor >= 1.0 && row.ease_factor <= 5.0
      ? row.ease_factor : 2.5,
    repetitions: Number.isInteger(row.repetitions) && row.repetitions >= 0 ? row.repetitions : 0,
    lapses: Number.isInteger(row.lapses) && row.lapses >= 0 ? row.lapses : 0,
    step_index: Number.isInteger(row.step_index) && row.step_index >= 0 ? row.step_index : null,
    flag: Number.isInteger(row.flag) && row.flag >= 0 && row.flag <= 7 ? row.flag : 0,
    want_to_learn: Boolean(row.want_to_learn),
    next_review: typeof row.next_review === 'string' && Number.isFinite(Date.parse(row.next_review)) ? row.next_review : null,
    last_reviewed: typeof row.last_reviewed === 'string' && Number.isFinite(Date.parse(row.last_reviewed)) ? row.last_reviewed : null,
    updated_at: typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : null,
  };
}

function toDbProgressRow(cardId, userId, rec, fallbackNowIso) {
  return {
    card_id: cardId,
    user_id: userId,
    queue: rec.queue,
    interval: rec.interval,
    ease_factor: rec.ease_factor,
    repetitions: rec.repetitions,
    lapses: rec.lapses,
    step_index: rec.step_index,
    flag: rec.flag,
    want_to_learn: rec.want_to_learn,
    is_leech: isLeech(rec.lapses),
    next_review: rec.next_review,
    last_reviewed: rec.last_reviewed,
    updated_at: rec.updated_at || fallbackNowIso,
    is_dirty: 0,
  };
}

function formatBackupFileName(date) {
  const pad = n => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `lerne-offline-progress-${y}-${m}-${d}_${hh}-${mm}.json`;
}

export function validateBackupPayload(rawTextOrObject, pack = getStandalonePack()) {
  let parsed;
  if (typeof rawTextOrObject === 'string') {
    const trimmed = rawTextOrObject.replace(/^\uFEFF/, '').trim();
    if (!trimmed) {
      return { ok: false, code: 'EMPTY_FILE', error: tr('Выбранный файл пуст.') };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, code: 'INVALID_JSON', error: tr('Не удалось прочитать JSON-файл резервной копии.') };
    }
  } else {
    parsed = rawTextOrObject;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'UNSUPPORTED_FORMAT', error: tr('Неподдерживаемый формат файла резервной копии.') };
  }

  if (
    parsed.format === 'lerne-materials'
    || parsed.archive_version != null
    || (parsed.schema_version === 2 && parsed.deck && Array.isArray(parsed.cards))
  ) {
    return {
      ok: false,
      code: 'WRONG_ARCHIVE_FORMAT',
      error: tr('Этот файл содержит учебные материалы или колоду, а не резервную копию личного прогресса.'),
    };
  }

  if (parsed.format !== PROGRESS_BACKUP_FORMAT || parsed.schema_version !== PROGRESS_BACKUP_SCHEMA_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_FORMAT', error: tr('Неподдерживаемый формат или версия резервной копии.') };
  }

  if (!parsed.app || typeof parsed.app !== 'object'
    || !Array.isArray(parsed.records)
    || !Array.isArray(parsed.deck_preferences)
    || !parsed.integrity || typeof parsed.integrity !== 'object') {
    return { ok: false, code: 'MALFORMED_STRUCTURE', error: tr('Структура файла резервной копии повреждена.') };
  }

  if (
    parsed.integrity.algorithm !== 'sha256'
    || typeof parsed.integrity.payload_hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.integrity.payload_hash)
    || (parsed.integrity.scope !== undefined && !ALLOWED_INTEGRITY_SCOPES.has(parsed.integrity.scope))
  ) {
    return { ok: false, code: 'INVALID_INTEGRITY_HEADER', error: tr('Отсутствует или некорректна контрольная сумма резервной копии.') };
  }

  const integrityScope = parsed.integrity.scope;
  const hasImportedSection = parsed.imported_records !== undefined || parsed.imported_deck_preferences !== undefined;
  if (
    (integrityScope === 'full-v1' || integrityScope === 'full-v2')
    && (parsed.summary === undefined || parsed.exported_at === undefined)
  ) {
    return { ok: false, code: 'MALFORMED_STRUCTURE', error: tr('Структура файла резервной копии повреждена.') };
  }
  if (integrityScope === 'full-v2' && (!Array.isArray(parsed.imported_records) || !Array.isArray(parsed.imported_deck_preferences))) {
    return { ok: false, code: 'MALFORMED_STRUCTURE', error: tr('Структура файла резервной копии повреждена.') };
  }
  if (integrityScope !== 'full-v2' && hasImportedSection) {
    return { ok: false, code: 'MALFORMED_STRUCTURE', error: tr('Структура файла резервной копии повреждена.') };
  }

  let hashMatches = false;
  try {
    if (integrityScope === 'full-v1' || integrityScope === 'full-v2') {
      hashMatches = computeBackupHash(parsed) === parsed.integrity.payload_hash;
    } else {
      const legacyHash = computeLegacyCoreBackupHash(parsed);
      const fullHash = parsed.summary !== undefined && parsed.exported_at !== undefined
        ? computeBackupHash(parsed)
        : null;
      hashMatches = parsed.integrity.payload_hash === legacyHash || (fullHash !== null && parsed.integrity.payload_hash === fullHash);
    }
  } catch {
    return { ok: false, code: 'MALFORMED_STRUCTURE', error: tr('Структура файла резервной копии повреждена.') };
  }

  if (!hashMatches) {
    return {
      ok: false,
      code: 'INTEGRITY_MISMATCH',
      error: tr('Контрольная сумма файла не совпадает: файл повреждён или был изменён.'),
    };
  }

  if (!isNullableIsoDate(parsed.exported_at ?? null) || !parsed.exported_at) {
    return { ok: false, code: 'INVALID_METADATA', error: tr('В резервной копии указана некорректная дата экспорта.') };
  }

  if (
    (parsed.app.mode !== undefined && parsed.app.mode !== 'standalone-offline-pilot')
    || (parsed.app.application_id !== undefined && parsed.app.application_id !== STANDALONE_APPLICATION_ID)
    || typeof parsed.app.card_set_fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.app.card_set_fingerprint)
  ) {
    return { ok: false, code: 'INVALID_METADATA', error: tr('Метаданные приложения в резервной копии повреждены.') };
  }

  if (
    parsed.app.pack_id !== pack.packId
    || !Number.isInteger(parsed.app.pack_version)
    || parsed.app.pack_version < 1
    || parsed.app.pack_version > pack.packVersion
    || (parsed.app.pack_version === pack.packVersion && parsed.app.card_set_fingerprint !== pack.cardSetFingerprint)
  ) {
    return {
      ok: false,
      code: 'PACK_MISMATCH',
      error: tr('Резервная копия создана для другого набора колод и несовместима с этой установкой.'),
    };
  }

  if (integrityScope === 'full-v1' || integrityScope === 'full-v2' || parsed.summary !== undefined) {
    const baseSummaryMatches = parsed.summary
      && typeof parsed.summary === 'object'
      && !Array.isArray(parsed.summary)
      && parsed.summary.total_records === parsed.records.length
      && parsed.summary.reviewed_records === parsed.records.filter(isReviewedRecord).length
      && parsed.summary.deck_count === parsed.deck_preferences.length;
    const importedSummaryMatches = integrityScope !== 'full-v2' || (
      parsed.summary.imported_records === parsed.imported_records.length
      && parsed.summary.imported_reviewed_records === parsed.imported_records.filter(isReviewedRecord).length
      && parsed.summary.imported_deck_count === parsed.imported_deck_preferences.length
    );
    if (!baseSummaryMatches || !importedSummaryMatches) {
      return {
        ok: false,
        code: 'INVALID_METADATA',
        error: tr('Метаданные резервной копии не совпадают с содержимым файла.'),
      };
    }
  }

  const { byId } = getStandaloneCardLookup(pack);
  const seenCardIds = new Set();

  for (const record of parsed.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { ok: false, code: 'INVALID_RECORD', error: tr('Одна из записей прогресса в файле повреждена.') };
    }
    if (!Number.isInteger(record.card_id) || seenCardIds.has(record.card_id)) {
      return { ok: false, code: 'DUPLICATE_OR_INVALID_CARD_ID', error: tr('В файле найдены дубликаты или некорректные ID карточек.') };
    }
    seenCardIds.add(record.card_id);

    const cardMeta = byId.get(record.card_id);
    if (!cardMeta || record.card_key !== cardMeta.cardKey) {
      return {
        ok: false,
        code: 'CARD_IDENTITY_MISMATCH',
        error: tr('Идентификаторы карточек в резервной копии не совпадают со встроенными колодами.'),
      };
    }

    if (!hasValidSrsFields(record)) {
      return {
        ok: false,
        code: 'INVALID_SRS_FIELDS',
        error: tr('Некорректные значения SRS в резервной копии.'),
      };
    }
  }

  const deckById = new Map(pack.decks.map(d => [d.id, d]));
  const seenDeckIds = new Set();
  for (const pref of parsed.deck_preferences) {
    if (!pref || typeof pref !== 'object' || Array.isArray(pref)
      || !Number.isInteger(pref.deck_id) || seenDeckIds.has(pref.deck_id)) {
      return { ok: false, code: 'INVALID_DECK_PREF', error: tr('Некорректные настройки колод в резервной копии.') };
    }
    seenDeckIds.add(pref.deck_id);
    const deckMeta = deckById.get(pref.deck_id);
    if (!deckMeta || pref.slug !== deckMeta.slug || typeof pref.is_learning !== 'boolean') {
      return { ok: false, code: 'DECK_IDENTITY_MISMATCH', error: tr('Настройки колод в резервной копии не совпадают со встроенными колодами.') };
    }
  }

  if (integrityScope === 'full-v2') {
    const seenImportedKeys = new Set();
    for (const record of parsed.imported_records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || !Number.isInteger(record.card_id)
        || typeof record.card_key !== 'string' || !record.card_key.trim()
        || typeof record.deck_key !== 'string'
        || !validMaterialKey(record.material_key, 'card')
        || seenImportedKeys.has(record.card_key)) {
        return { ok: false, code: 'INVALID_RECORD', error: tr('Одна из записей прогресса в файле повреждена.') };
      }
      seenImportedKeys.add(record.card_key);
      if (!hasValidSrsFields(record)) {
        return { ok: false, code: 'INVALID_SRS_FIELDS', error: tr('Некорректные значения SRS в резервной копии.') };
      }
    }

    const seenImportedDecks = new Set();
    for (const pref of parsed.imported_deck_preferences) {
      if (!pref || typeof pref !== 'object' || Array.isArray(pref)
        || !Number.isInteger(pref.deck_id)
        || typeof pref.deck_key !== 'string' || !pref.deck_key.trim()
        || typeof pref.is_learning !== 'boolean'
        || !validMaterialKey(pref.material_key, 'deck')
        || seenImportedDecks.has(pref.deck_key)) {
        return { ok: false, code: 'INVALID_DECK_PREF', error: tr('Некорректные настройки колод в резервной копии.') };
      }
      seenImportedDecks.add(pref.deck_key);
    }
  }

  return { ok: true, backup: parsed };
}

export async function recordBackupExportMeta({ db = null, exportedAt, summary } = {}) {
  const database = db || await prepareLocalDb();
  const timestamp = exportedAt || new Date().toISOString();
  await database.syncState.put({
    key: LAST_BACKUP_META_KEY,
    exported_at: timestamp,
    total_records: (summary?.total_records ?? 0) + (summary?.imported_records ?? 0),
    reviewed_records: (summary?.reviewed_records ?? 0) + (summary?.imported_reviewed_records ?? 0),
  });
}

export async function exportProgressBackup({ db = null, userId = null, pack = null, now = new Date(), recordMeta = true } = {}) {
  const resolvedPack = pack || getStandalonePack();
  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  if (resolvedUserId == null) {
    throw new Error('Cannot export progress without active user ID');
  }

  const { byId } = getStandaloneCardLookup(resolvedPack);
  const builtInDeckIds = new Set(resolvedPack.decks.map(d => d.id));

  const [rawProgress, deckRows, allDecks, allCards] = await Promise.all([
    database.progress.where('user_id').equals(resolvedUserId).toArray(),
    database.decks.bulkGet(resolvedPack.decks.map(d => d.id)),
    database.decks.filter(d => !d.is_deleted).toArray(),
    database.cards.filter(c => !c.is_deleted).toArray(),
  ]);

  const records = rawProgress
    .filter(row => byId.has(row.card_id))
    .sort((a, b) => a.card_id - b.card_id)
    .map(row => serializeProgressRecord(row, byId.get(row.card_id).cardKey));

  const deckPreferences = resolvedPack.decks
    .map((deck, idx) => ({
      deck_id: deck.id,
      slug: deck.slug,
      is_learning: Boolean(deckRows[idx]?.is_learning),
    }))
    .sort((a, b) => a.deck_id - b.deck_id);

  const importedDecks = allDecks
    .filter(d => !builtInDeckIds.has(d.id) && typeof d.standalone_deck_key === 'string' && d.standalone_deck_key)
    .sort((a, b) => a.standalone_deck_key.localeCompare(b.standalone_deck_key));
  const importedDeckById = new Map(importedDecks.map(d => [d.id, d]));

  const importedCards = allCards.filter(c => (
    !byId.has(c.id) && typeof c.standalone_card_key === 'string' && c.standalone_card_key
  ));
  const importedCardById = new Map(importedCards.map(c => [c.id, c]));
  const exportSource = (importedDecks.length > 0 || importedCards.length > 0)
    ? await getMaterialExportSource(database)
    : null;

  const importedRecords = rawProgress
    .filter(row => importedCardById.has(row.card_id))
    .map(row => {
      const card = importedCardById.get(row.card_id);
      const deck = importedDeckById.get(card.deck_id);
      return serializeProgressRecord(row, card.standalone_card_key, {
        deck_key: deck?.standalone_deck_key || '',
        material_key: exportSource ? buildOriginKey(exportSource, 'card', card.id) : undefined,
      });
    })
    .sort((a, b) => a.card_key.localeCompare(b.card_key));

  const importedDeckPreferences = importedDecks.map(deck => ({
    deck_id: deck.id,
    deck_key: deck.standalone_deck_key,
    material_key: buildOriginKey(exportSource, 'deck', deck.id),
    name: deck.name || '',
    is_learning: Boolean(deck.is_learning),
  }));

  const hasImported = importedRecords.length > 0 || importedDeckPreferences.length > 0;
  const exportedAt = now.toISOString();
  const summary = {
    total_records: records.length,
    reviewed_records: records.filter(isReviewedRecord).length,
    deck_count: resolvedPack.decks.length,
    ...(hasImported ? {
      imported_records: importedRecords.length,
      imported_reviewed_records: importedRecords.filter(isReviewedRecord).length,
      imported_deck_count: importedDeckPreferences.length,
    } : {}),
  };

  const payload = {
    format: PROGRESS_BACKUP_FORMAT,
    schema_version: PROGRESS_BACKUP_SCHEMA_VERSION,
    exported_at: exportedAt,
    app: {
      mode: 'standalone-offline-pilot',
      application_id: STANDALONE_APPLICATION_ID,
      pack_id: resolvedPack.packId,
      pack_version: resolvedPack.packVersion,
      card_set_fingerprint: resolvedPack.cardSetFingerprint,
    },
    summary,
    records,
    deck_preferences: deckPreferences,
    ...(hasImported ? {
      imported_records: importedRecords,
      imported_deck_preferences: importedDeckPreferences,
    } : {}),
  };

  const backup = {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      scope: hasImported ? PROGRESS_BACKUP_INTEGRITY_SCOPE_V2 : PROGRESS_BACKUP_INTEGRITY_SCOPE,
      payload_hash: computeBackupHash(payload),
    },
  };

  if (recordMeta) {
    await recordBackupExportMeta({ db: database, exportedAt, summary });
  }

  return {
    json: JSON.stringify(backup, null, 2),
    fileName: formatBackupFileName(now),
    backup,
    summary,
  };
}

export async function inspectProgressBackup(rawText, { db = null, userId = null, pack = null } = {}) {
  const resolvedPack = pack || getStandalonePack();
  const validation = validateBackupPayload(rawText, resolvedPack);
  if (!validation.ok) {
    return validation;
  }

  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  const { byId } = getStandaloneCardLookup(resolvedPack);
  const [progressRows, allCards] = await Promise.all([
    database.progress.where('user_id').equals(resolvedUserId).toArray(),
    database.cards.filter(c => !c.is_deleted).toArray(),
  ]);

  const importedCards = allCards.filter(c => !byId.has(c.id) && typeof c.standalone_card_key === 'string' && c.standalone_card_key);
  const importedCardById = new Map(importedCards.map(c => [c.id, c]));
  const importedCardByKey = new Map(importedCards.map(c => [c.standalone_card_key, c]));

  const currentRows = progressRows.filter(row => byId.has(row.card_id) || importedCardById.has(row.card_id));
  const parsed = validation.backup;
  const importedRecords = Array.isArray(parsed.imported_records) ? parsed.imported_records : [];
  const matchedImported = importedRecords.filter(rec => (
    importedCardByKey.has(rec.card_key) || importedCardByKey.has(rec.material_key)
  ));
  const unmatchedImported = importedRecords.length - matchedImported.length;

  return {
    ok: true,
    backup: parsed,
    preview: {
      exportedAt: parsed.exported_at,
      packId: parsed.app.pack_id,
      packVersion: parsed.app.pack_version,
      fingerprintMatchesExact: parsed.app.card_set_fingerprint === resolvedPack.cardSetFingerprint,
      backupProgressCount: parsed.records.length,
      backupReviewedCount: parsed.records.filter(isReviewedRecord).length,
      backupImportedCount: importedRecords.length,
      backupImportedReviewedCount: importedRecords.filter(isReviewedRecord).length,
      matchedImportedRecords: matchedImported.length,
      unmatchedImportedRecords: unmatchedImported,
      totalBackupRecords: parsed.records.length + importedRecords.length,
      totalBackupReviewed: parsed.records.filter(isReviewedRecord).length + importedRecords.filter(isReviewedRecord).length,
      currentProgressCount: currentRows.length,
      currentReviewedCount: currentRows.filter(isReviewedRecord).length,
      willOverwriteLocalProgress: currentRows.length > 0,
    },
  };
}

export async function applyProgressBackup(validatedBackup, { db = null, userId = null, pack = null } = {}) {
  const resolvedPack = pack || getStandalonePack();
  const validation = validateBackupPayload(validatedBackup, resolvedPack);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const backup = validation.backup;
  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  if (resolvedUserId == null) {
    throw new Error('Cannot restore progress without active user ID');
  }

  const bundledCardIds = new Set(resolvedPack.cards.map(c => c.id));
  const nowIso = new Date().toISOString();
  let restoredImportedRecords = 0;
  let restoredImportedReviewed = 0;
  let unmatchedImportedRecords = 0;

  await database.transaction('rw', database.progress, database.decks, database.cards, database.syncState, async () => {
    const [existingProgressRows, allDecks, allCards] = await Promise.all([
      database.progress.where('user_id').equals(resolvedUserId).toArray(),
      database.decks.filter(d => !d.is_deleted).toArray(),
      database.cards.filter(c => !c.is_deleted).toArray(),
    ]);

    const importedDeckByKey = new Map();
    for (const deck of allDecks) {
      if (deck.standalone_source && deck.standalone_deck_key) importedDeckByKey.set(deck.standalone_deck_key, deck);
    }

    const importedCardByKey = new Map();
    for (const card of allCards) {
      if (!bundledCardIds.has(card.id) && card.standalone_card_key) {
        importedCardByKey.set(card.standalone_card_key, card);
      }
    }

    const importedDecksPrefs = Array.isArray(backup.imported_deck_preferences) ? backup.imported_deck_preferences : [];
    const importedRecords = Array.isArray(backup.imported_records) ? backup.imported_records : [];

    const matchedImportedPairs = [];
    const targetCardIdsToReplace = new Set(bundledCardIds);
    for (const rec of importedRecords) {
      const localCard = importedCardByKey.get(rec.card_key) || importedCardByKey.get(rec.material_key);
      if (localCard) {
        if (targetCardIdsToReplace.has(localCard.id)) throw new Error('Несколько записей SRS указывают на одну карточку.');
        targetCardIdsToReplace.add(localCard.id);
        matchedImportedPairs.push({ rec, localCard });
      } else {
        unmatchedImportedRecords += 1;
      }
    }
    restoredImportedRecords = matchedImportedPairs.length;
    restoredImportedReviewed = matchedImportedPairs.filter(({ rec }) => isReviewedRecord(rec)).length;

    const existingToDelete = existingProgressRows.filter(row => targetCardIdsToReplace.has(row.card_id));
    if (existingToDelete.length > 0) {
      await database.progress.bulkDelete(existingToDelete.map(row => [row.card_id, resolvedUserId]));
    }

    const rowsToPut = [
      ...backup.records.map(rec => toDbProgressRow(rec.card_id, resolvedUserId, rec, nowIso)),
      ...matchedImportedPairs.map(({ rec, localCard }) => toDbProgressRow(localCard.id, resolvedUserId, rec, nowIso)),
    ];

    if (rowsToPut.length > 0) {
      await database.progress.bulkPut(rowsToPut);
    }

    const prefMap = new Map(backup.deck_preferences.map(p => [p.deck_id, p.is_learning]));
    const deckIds = [...prefMap.keys()];
    const updatedDecks = [];
    if (deckIds.length > 0) {
      const existingDecks = await database.decks.bulkGet(deckIds);
      existingDecks.forEach((deck, index) => {
        if (!deck) return;
        updatedDecks.push({
          ...deck,
          is_learning: Boolean(prefMap.get(deckIds[index])),
          learning_dirty: 0,
        });
      });
    }
    for (const pref of importedDecksPrefs) {
      const localDeck = importedDeckByKey.get(pref.deck_key) || importedDeckByKey.get(pref.material_key);
      if (!localDeck) continue;
      updatedDecks.push({
        ...localDeck,
        is_learning: Boolean(pref.is_learning),
        learning_dirty: 0,
      });
    }
    if (updatedDecks.length > 0) {
      await database.decks.bulkPut(updatedDecks);
    }

    await database.syncState.where('key').startsWith('grade:').delete();
    await database.syncState.where('key').startsWith('review:').delete();
    await database.syncState.put({
      key: LAST_RESTORE_META_KEY,
      restored_at: nowIso,
      backup_exported_at: backup.exported_at,
      restored_records: rowsToPut.length,
    });
  });

  return {
    restoredRecords: backup.records.length + restoredImportedRecords,
    restoredReviewed: backup.records.filter(isReviewedRecord).length + restoredImportedReviewed,
    restoredBuiltInRecords: backup.records.length,
    restoredImportedRecords,
    unmatchedImportedRecords,
    restoredAt: nowIso,
  };
}

export async function getStandaloneBackupStatus({ db = null, userId = null, pack = null } = {}) {
  const resolvedPack = pack || getStandalonePack();
  const database = db || await prepareLocalDb();
  const resolvedUserId = userId ?? getUserId();
  const { byId } = getStandaloneCardLookup(resolvedPack);
  const [progressRows, allDecks, allCards, lastBackup, lastRestore] = await Promise.all([
    database.progress.where('user_id').equals(resolvedUserId).toArray(),
    database.decks.filter(d => !d.is_deleted).toArray(),
    database.cards.filter(c => !c.is_deleted && Boolean(c.content_v2)).toArray(),
    database.syncState.get(LAST_BACKUP_META_KEY),
    database.syncState.get(LAST_RESTORE_META_KEY),
  ]);

  const builtInDeckIds = new Set(resolvedPack.decks.map(d => d.id));
  const importedDecks = allDecks.filter(d => !builtInDeckIds.has(d.id) && Boolean(d.standalone_deck_key));
  const importedCardIds = new Set(allCards.filter(c => !byId.has(c.id) && Boolean(c.standalone_card_key)).map(c => c.id));
  const activeCardIds = new Set([...byId.keys(), ...importedCardIds]);
  const relevant = progressRows.filter(row => activeCardIds.has(row.card_id));

  return {
    deckCount: allDecks.length,
    cardCount: allCards.length,
    builtInDeckCount: resolvedPack.decks.length,
    builtInCardCount: resolvedPack.cards.length,
    importedDeckCount: importedDecks.length,
    importedCardCount: importedCardIds.size,
    progressCount: relevant.length,
    reviewedCount: relevant.filter(isReviewedRecord).length,
    lastBackupAt: lastBackup?.exported_at || null,
    lastRestoreAt: lastRestore?.restored_at || null,
  };
}
