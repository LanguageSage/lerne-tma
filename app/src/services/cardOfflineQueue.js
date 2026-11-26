import { tr } from '../i18n/locale';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, CARD_LIFECYCLE_KEY, CARD_MOVE_KEY, prepareLocalDb, getNextTempId } from './localDb';
import { getUserId, getSessionIdentity } from '../utils/auth';
import { IS_STANDALONE, STANDALONE_DB_PREFIX } from '../utils/standaloneMode.js';
import { isBundledSeedDeck, isBundledSeedCard } from '../utils/deckUtils.js';
import { validateNativeV2Content } from '../utils/nativeV2Contract.js';
import { studySideText } from '../utils/structuredStudyCard.js';
import { cardDuplicateKey } from '../utils/search.js';
import { isKnowledgeKeyForLanguage } from '../utils/knowledgeEvidence.js';
import { assertArchiveSafeMetadata } from '../pilot/materialMetadataPolicy.js';
import {
  buildOriginKey,
  getMaterialExportSourceInTx,
  ID_COUNTERS_KEY,
  IMPORTED_ID_START,
} from '../pilot/materialArchiveIdentity.js';
import { parseOfflineMediaRef } from '../pilot/offlineMediaResolver.js';

export const result = (data = {}) => ({ data });
export const notFound = () => { throw new Error(tr("Запись не найдена на устройстве. Сначала выполните синхронизацию.")); };
export const readOnly = () => { throw new Error(tr("У вас доступ только для чтения")); };
export const pendingCreate = () => { throw new Error(tr('Сначала синхронизируйте новую карточку.')); };
export const pendingMove = () => { throw new Error(tr('Сначала завершите синхронизацию переноса.')); };
export const pendingLifecycle = () => { throw new Error(tr('Сначала завершите синхронизацию удаления или восстановления.')); };
export const mediaPaths = ['image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'];
export const STANDALONE_CARD_OP_PREFIX = 'standalone-card-op:';
export const STANDALONE_MAX_CARD_OP_RECEIPTS = 64;

const MEDIA_FIELD_FOLDER = {
  image_path: 'images',
  audio_path: 'audio',
  audio_back_path: 'audio',
  video_front_path: 'videos',
  video_back_path: 'videos',
};

let standaloneCardOpSeq = 0;

export const isStandaloneDb = db => (typeof IS_STANDALONE !== 'undefined' && IS_STANDALONE)
  || (typeof db?.name === 'string' && db.name.startsWith(STANDALONE_DB_PREFIX));

export function unsupported() {
  const error = new Error(tr("Для этого действия требуется подключение к интернету."));
  error.code = 'OFFLINE_UNSUPPORTED';
  return error;
}

export const isContentReadOnly = (owner) => !owner
  || isBundledSeedDeck(owner)
  || owner.role === 'viewer'
  || (owner.is_global_readonly && owner.role !== 'owner' && owner.role !== 'editor');

export function canonicalCompareValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : canonicalCompareValue(item))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalCompareValue(value[key])}`).join(',')}}`;
  }
  return 'null';
}

function normalizeStandaloneMediaPath(rawPath, field) {
  if (rawPath == null || rawPath === '') return null;
  if (typeof rawPath !== 'string') {
    throw new Error(tr('Некорректная локальная ссылка медиа: {{p0}}', { p0: field }));
  }
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const expectedFolder = MEDIA_FIELD_FOLDER[field];
  const parsed = parseOfflineMediaRef(trimmed, expectedFolder);
  if (!parsed || parsed.folder !== expectedFolder) {
    throw new Error(tr('Некорректная локальная ссылка медиа: {{p0}}', { p0: field }));
  }
  return parsed;
}

function normalizePureJson(envelope) {
  return JSON.parse(JSON.stringify(envelope));
}

function normalizeMediaForStorage(body, envelope) {
  const normalized = normalizePureJson(envelope);
  const mediaPatch = {};
  for (const field of mediaPaths) {
    if (!Object.hasOwn(body, field)) continue;
    const parsed = normalizeStandaloneMediaPath(body[field], field);
    mediaPatch[field] = parsed ? parsed.canonicalUrl : null;
  }
  if (normalized.card.image != null) {
    const parsedCardImage = normalizeStandaloneMediaPath(normalized.card.image, 'image_path');
    if (parsedCardImage) {
      normalized.card.image = parsedCardImage.relativePath;
    }
  }
  if (Array.isArray(normalized.card.layout)) {
    for (const item of normalized.card.layout) {
      if (item?.type === 'image' && item.path != null) {
        const parsedLayoutImage = normalizeStandaloneMediaPath(item.path, 'image_path');
        if (parsedLayoutImage) {
          item.path = parsedLayoutImage.relativePath;
        }
      }
    }
  }
  return { normalized, mediaPatch };
}

async function pruneCardOpReceipts(db, keepKey) {
  const receipts = await db.syncState.where('key').startsWith(STANDALONE_CARD_OP_PREFIX).toArray();
  if (receipts.length <= STANDALONE_MAX_CARD_OP_RECEIPTS) return;
  receipts.sort((a, b) => (a.created_at || 0) - (b.created_at || 0)
    || (a.seq || 0) - (b.seq || 0)
    || a.key.localeCompare(b.key));
  const excess = receipts.length - STANDALONE_MAX_CARD_OP_RECEIPTS;
  const keysToDelete = receipts
    .filter(item => item.key !== keepKey)
    .slice(0, excess)
    .map(item => item.key);
  if (keysToDelete.length > 0) {
    await db.syncState.bulkDelete(keysToDelete);
  }
}

async function writeCardOpReceipt(db, opKey, data) {
  standaloneCardOpSeq += 1;
  await db.syncState.put({
    ...data,
    key: opKey,
    created_at: Date.now(),
    seq: standaloneCardOpSeq,
  });
  await pruneCardOpReceipts(db, opKey);
}

function buildInitialProgressRow(cardId, userId, flag, nowIso) {
  return {
    card_id: cardId,
    user_id: userId,
    queue: 'new',
    interval: 0,
    ease_factor: 2.5,
    repetitions: 0,
    lapses: 0,
    step_index: 0,
    next_review: null,
    last_reviewed: null,
    flag: Number(flag) || 0,
    want_to_learn: false,
    is_dirty: 0,
    updated_at: nowIso,
  };
}

function stripOfflineQueueFields(card) {
  delete card.offline_edit;
  delete card.offline_create_status;
  delete card.offline_create_error;
  delete card.offline_create_request_id;
  delete card.offline_move;
  delete card.offline_lifecycle;
  return card;
}

export async function allocatePositiveLocalId(db, tableName, counterField) {
  const [countersRecord, [maxExistingId]] = await Promise.all([
    db.syncState.get(ID_COUNTERS_KEY),
    db[tableName].where(':id').between(IMPORTED_ID_START, Number.MAX_SAFE_INTEGER, false, true)
      .reverse().limit(1).primaryKeys(),
  ]);
  const nextId = Math.max(maxExistingId ?? IMPORTED_ID_START, Number(countersRecord?.[counterField]) || 0) + 1;
  if (!Number.isSafeInteger(nextId)) {
    throw new Error(`Local ${counterField} ID limit reached`);
  }
  await db.syncState.put({
    ...(countersRecord || {}),
    key: ID_COUNTERS_KEY,
    [counterField]: nextId,
  });
  return nextId;
}

export const buildFolderMap = (folders = []) => new Map(folders.map(folder => [folder.id, folder]));

export function isFolderActiveInCache(folderMap, folderId) {
  let currentId = folderId;
  const visited = new Set();
  while (currentId != null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const folder = folderMap.get(currentId);
    if (!folder) return true; // Shared branch root or partial cache; deleted folders present in map are caught below.
    if (folder.is_deleted) return false;
    currentId = folder.parent_id;
  }
  return true;
}

export function isFolderParentReadyForRestore(folderMap, parentId) {
  if (parentId == null) return { ok: true };
  const parent = folderMap.get(parentId);
  if (!parent) return { ok: false, reason: 'missing' };
  if (!isFolderActiveInCache(folderMap, parentId)) return { ok: false, reason: 'deleted' };
  return { ok: true };
}

export function isDeckActiveInCache(deck, folderMap) {
  return Boolean(deck && !deck.is_deleted && isFolderActiveInCache(folderMap, deck.folder_id));
}

export const isOwnedRecord = (item, userId) => Boolean(item)
  && (item.user_id == null || item.user_id === userId)
  && (!item.role || item.role === 'owner');

export function collectSubtreeFolderIds(rootIds, childrenByParent, includeChild = () => true) {
  const collected = [];
  const seen = new Set();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const fid = stack.pop();
    if (seen.has(fid)) continue;
    seen.add(fid);
    collected.push(fid);
    for (const child of childrenByParent.get(fid) || []) {
      if (!seen.has(child.id) && includeChild(child)) stack.push(child.id);
    }
  }
  return collected;
}

export function isCardDeckActiveInCache(deck, card, folderMap) {
  return deck ? isDeckActiveInCache(deck, folderMap) : !card?.deck_deleted;
}

export function assertParentActiveForRestore(folderMap, parentId, kind) {
  const parentReady = isFolderParentReadyForRestore(folderMap, parentId);
  if (parentReady.ok) return;
  const msg = parentReady.reason === 'missing'
    ? (kind === 'folder'
      ? tr('Нельзя восстановить папку: родительская папка отсутствует.')
      : tr('Нельзя восстановить колоду: родительская папка отсутствует.'))
    : (kind === 'folder'
      ? tr('Нельзя восстановить папку: сначала восстановите родительскую папку.')
      : tr('Нельзя восстановить колоду: сначала восстановите родительскую папку.'));
  const err = new Error(msg);
  err.response = {
    status: 409,
    data: { detail: { code: parentReady.reason === 'missing' ? 'parent_folder_missing' : 'parent_folder_deleted', message: msg } },
  };
  throw err;
}

export async function loadFolderMap(db) {
  return buildFolderMap(await db.folders.toArray());
}

export async function requireContentWrite(db, entity, item) {
  if (!item) notFound();
  if (entity === 'cards' && item.offline_create_status) pendingCreate();
  const owner = entity === 'cards' ? await db.decks.get(item.deck_id) : item;
  if (isStandaloneDb(db) && entity === 'cards') return;
  if (isContentReadOnly(owner)) readOnly();
}

async function allocateTempCardId(db, aliases) {
  let id;
  do { id = getNextTempId(); } while (aliases[id] || await db.cards.get(id));
  return id;
}

function assertCardReadyForBatch(card, expectedRevision) {
  if (card?.content_v2?.schema_version !== 2 || card.is_deleted) notFound();
  if (card.offline_lifecycle) pendingLifecycle();
  if (card.offline_move) pendingMove();
  if (card.offline_edit || card.is_dirty) throw new Error(tr('Сначала синхронизируйте правку карточки.'));
  if (!card.revision || card.revision !== expectedRevision) {
    throw new Error(tr('Исходная ревизия карточки недоступна.'));
  }
}

export async function saveNativeCard(db, body, options = {}, userId = null) {
  if (isStandaloneDb(db)) {
    const flag = options?.flag ?? options?.offlineCreateFlag ?? 0;
    if (!body?.request_id || typeof body.request_id !== 'string') {
      throw new Error('Missing card create request ID');
    }
    if (!body?.content_v2 || typeof body.content_v2 !== 'object' || !body.content_v2.card || typeof body.content_v2.card !== 'object') {
      validateNativeV2Content(body?.content_v2, { writable: true });
    }
    const { normalized: normalizedContent, mediaPatch } = normalizeMediaForStorage(body, body.content_v2);
    validateNativeV2Content(normalizedContent, { writable: true });
    assertArchiveSafeMetadata(normalizedContent.card.metadata);
    const fingerprint = canonicalCompareValue({
      op: 'create',
      deck_id: Number(body.deck_id),
      after_card_id: body.after_card_id ?? null,
      flag: Number(flag) || 0,
      content_v2: normalizedContent,
      mediaPatch,
    });
    const opKey = STANDALONE_CARD_OP_PREFIX + body.request_id;
    const nowIso = new Date().toISOString();

    const created = await db.transaction('rw', db.folders, db.cards, db.decks, db.progress, db.syncState, async () => {
      const existingOp = await db.syncState.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== fingerprint) {
          throw new Error('Card create request changed');
        }
        const existingCard = await db.cards.get(existingOp.cardId);
        if (!existingCard) notFound();
        return existingCard;
      }

      const deckId = Number(body.deck_id);
      const [deck, folderMap] = await Promise.all([
        Number.isSafeInteger(deckId) && deckId > 0 ? db.decks.get(deckId) : null,
        loadFolderMap(db),
      ]);
      if (!isDeckActiveInCache(deck, folderMap)) notFound();

      const [nextCardId, siblingsRaw, exportSource] = await Promise.all([
        allocatePositiveLocalId(db, 'cards', 'card'),
        db.cards.where('deck_id').equals(deck.id).filter(c => !c.is_deleted).toArray(),
        getMaterialExportSourceInTx(db),
      ]);

      const siblings = siblingsRaw.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
      let position;
      const shiftedSiblings = [];
      const afterCardId = body.after_card_id != null ? Number(body.after_card_id) : null;
      const afterIdx = afterCardId != null ? siblings.findIndex(c => c.id === afterCardId) : -1;
      if (afterIdx >= 0) {
        const afterPos = Number.isInteger(siblings[afterIdx].position) ? siblings[afterIdx].position : afterIdx;
        position = afterPos + 1;
        let prevPos = position;
        for (let i = afterIdx + 1; i < siblings.length; i += 1) {
          const sib = siblings[i];
          if (!Number.isInteger(sib.position) || sib.position <= prevPos) {
            const nextPos = prevPos + 1;
            shiftedSiblings.push({ ...sib, position: nextPos });
            prevPos = nextPos;
          } else {
            prevPos = sib.position;
          }
        }
        if (shiftedSiblings.length > 0) {
          await db.cards.bulkPut(shiftedSiblings);
        }
      } else {
        position = siblings.reduce(
          (max, c) => Math.max(max, Number.isInteger(c.position) ? c.position : -1),
          -1,
        ) + 1;
      }

      const localCard = {
        id: nextCardId,
        deck_id: deck.id,
        position,
        target_language: deck.target_language || 'de',
        content_v2: normalizedContent,
        front_text: studySideText(normalizedContent.card, 'front'),
        image_path: mediaPatch.image_path ?? null,
        audio_path: mediaPatch.audio_path ?? null,
        audio_back_path: mediaPatch.audio_back_path ?? null,
        video_front_path: mediaPatch.video_front_path ?? null,
        video_back_path: mediaPatch.video_back_path ?? null,
        difficulty: null,
        source: 'user',
        revision: 1,
        standalone_card_key: buildOriginKey(exportSource, 'card', nextCardId),
        standalone_local_created: true,
        standalone_local_edit: true,
        standalone_local_edited_at: nowIso,
        is_deleted: 0,
        is_dirty: 0,
        created_at: nowIso,
        updated_at: nowIso,
      };

      await db.cards.add(localCard);

      if (Number(flag) > 0 && userId != null) {
        await db.progress.put(buildInitialProgressRow(nextCardId, userId, flag, nowIso));
      }

      await writeCardOpReceipt(db, opKey, {
        op: 'create',
        cardId: nextCardId,
        fingerprint,
      });

      return localCard;
    });
    return result(created);
  }

  const {
    offlineCreateFlag: flag, offlineCreateIfAvailable: ifAvailable,
    offlineCreateId: tempId, offlineCreateRequestId: rejectedRequestId,
  } = options || {};
  if (flag) throw new Error(tr('Цветную метку можно установить после синхронизации.'));
  if (!body.request_id) throw new Error('Missing card create request ID');

  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    const key = CARD_CREATE_KEY + body.request_id;
    const pending = await db.syncState.get(key);
    if (pending) {
      const replay = tempId == null ? body
        : { ...body, deck_id: pending.payload.deck_id, after_card_id: pending.payload.after_card_id };
      if ((tempId != null && pending.tempId !== tempId) || JSON.stringify(pending.payload) !== JSON.stringify(replay)) {
        throw new Error('Card create request changed');
      }
      return result(await db.cards.get(pending.tempId));
    }
    const folderMap = await loadFolderMap(db);
    const decks = body.deck_id == null
      ? await db.decks.filter(d => d.id > 0 && d.is_inbox && (d.role === 'owner' || d.user_id === userId)
          && (!d.target_language || d.target_language === 'de') && !d.is_deleted).toArray()
      : null;
    const deck = body.deck_id == null
      ? decks.find(d => isDeckActiveInCache(d, folderMap))
      : await db.decks.get(body.deck_id);
    if (!deck || deck.id <= 0 || !isDeckActiveInCache(deck, folderMap)) {
      if (ifAvailable) return null;
      notFound();
    }
    if (isContentReadOnly(deck)) {
      if (ifAvailable) return null;
      readOnly();
    }
    if (tempId != null) {
      const [draft, rejected] = await Promise.all([
        db.cards.get(tempId),
        rejectedRequestId ? db.syncState.get(CARD_CREATE_KEY + rejectedRequestId)
          : db.syncState.where('key').startsWith(CARD_CREATE_KEY).filter(operation => operation.tempId === tempId).first(),
      ]);
      if (!rejected?.rejected || rejected.tempId !== tempId || rejected.deckId !== deck.id ||
          !draft?.offline_create_error || draft.offline_create_request_id !== rejectedRequestId) {
        throw new Error(tr('Состояние правки изменилось. Откройте карточку заново.'));
      }
      const payload = { ...body, deck_id: rejected.payload.deck_id, after_card_id: rejected.payload.after_card_id };
      const local = { ...draft, content_v2: body.content_v2, offline_create_status: 'pending' };
      delete local.offline_create_error;
      delete local.offline_create_request_id;
      for (const field of mediaPaths) if (Object.hasOwn(body, field)) {
        if (local[field] !== body[field]) delete local[field.replace('_path', '_url')];
        local[field] = body[field];
      }
      await db.cards.put(local);
      await db.syncState.delete(rejected.key);
      await db.syncState.add({ key, tempId, deckId: deck.id, payload });
      return result(local);
    }
    const siblings = await db.cards.where('deck_id').equals(deck.id).filter(c => !c.is_deleted).toArray();
    const after = body.after_card_id == null ? null
      : siblings.find(c => c.id === body.after_card_id && c.id > 0 && c.content_v2);
    if (body.after_card_id != null && !after) {
      if (ifAvailable) return null;
      pendingCreate();
    }
    const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
    const id = await allocateTempCardId(db, aliases);
    const local = { id, deck_id: deck.id, content_v2: body.content_v2, offline_create_status: 'pending',
      is_dirty: 0, is_deleted: 0, created_at: new Date().toISOString(),
      position: after ? after.position + 0.5 : siblings.reduce((max, c) => Math.max(max, c.position || 0), -1) + 1 };
    for (const field of mediaPaths) if (Object.hasOwn(body, field)) local[field] = body[field];
    await db.cards.add(local);
    await db.syncState.add({ key, tempId: id, deckId: deck.id, payload: body });
    return result(local);
  });
}

export async function queueCardMove(db, body, isCurrent, copy = false) {
  if (isStandaloneDb(db)) {
    const ids = (body?.card_ids || []).map(Number);
    const targetId = Number(body?.target_deck_id);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      pendingCreate();
    }
    if (!Number.isSafeInteger(targetId) || targetId <= 0) notFound();
    if (!body?.request_id || typeof body.request_id !== 'string') {
      throw new Error('Missing card transfer request ID');
    }
    const onDuplicate = ['skip', 'overwrite', 'keep'].includes(body.on_duplicate) ? body.on_duplicate : 'keep';
    const opKey = STANDALONE_CARD_OP_PREFIX + body.request_id;
    const fingerprint = canonicalCompareValue({
      op: copy ? 'batch-copy' : 'batch-move',
      ids,
      targetId,
      onDuplicate,
      revisions: body.revisions ?? null,
    });
    const nowIso = new Date().toISOString();

    return db.transaction('rw', [db.cards, db.decks, db.folders, db.syncState,
      ...(copy ? [] : [db.card_knowledge_items])], async () => {
      const existingOp = await db.syncState.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== fingerprint) {
          throw new Error('Card transfer request changed');
        }
        const replayedCards = (await db.cards.bulkGet(existingOp.resultIds || [])).filter(Boolean);
        return result(!copy && ids.length === 1
          ? (replayedCards[0] || {})
          : { cards: replayedCards, count: existingOp.count ?? 0, skipped: existingOp.skipped ?? 0 });
      }

      const [cards, target, folderMap, exportSource] = await Promise.all([
        db.cards.bulkGet(ids),
        db.decks.get(targetId),
        loadFolderMap(db),
        getMaterialExportSourceInTx(db),
      ]);
      if (!isDeckActiveInCache(target, folderMap)) notFound();

      for (const card of cards) {
        if (!card?.content_v2 || card.is_deleted) notFound();
        if (body.revisions && body.revisions[card.id] !== card.revision) {
          throw new Error(tr('Исходная ревизия карточки недоступна.'));
        }
        const source = await db.decks.get(card.deck_id);
        if (!isDeckActiveInCache(source, folderMap)) notFound();
      }

      if (!copy && ids.length === 1 && cards[0].deck_id === targetId) {
        return result(cards[0]);
      }

      const siblings = await db.cards.where('deck_id').equals(targetId).filter(item => !item.is_deleted).toArray();
      let position = siblings.reduce(
        (max, item) => Math.max(max, Number.isInteger(item.position) ? item.position : -1),
        -1,
      );
      const targetByDupKey = new Map();
      for (const sibling of siblings) {
        if (!sibling.content_v2) continue;
        const dk = cardDuplicateKey(sibling.content_v2);
        if (!targetByDupKey.has(dk)) targetByDupKey.set(dk, sibling);
      }

      const resultCards = [];
      let count = 0;
      let skipped = 0;

      for (const card of cards) {
        if (!copy && card.deck_id === targetId) {
          resultCards.push(card);
          continue;
        }
        const dupKey = cardDuplicateKey(card.content_v2);
        const existingTarget = targetByDupKey.get(dupKey);

        if (existingTarget && onDuplicate === 'skip') {
          skipped += 1;
          if (!copy && ids.length === 1) {
            resultCards.push(card);
          }
          continue;
        }

        if (existingTarget && onDuplicate === 'overwrite') {
          const overwritten = stripOfflineQueueFields({
            ...existingTarget,
            content_v2: structuredClone(card.content_v2),
            front_text: card.front_text ?? studySideText(card.content_v2.card, 'front'),
            ...Object.fromEntries(mediaPaths.map(field => [field, card[field] ?? null])),
            difficulty: card.difficulty ?? existingTarget.difficulty ?? null,
            source: card.source ?? existingTarget.source ?? 'user',
            revision: (Number(existingTarget.revision) || 0) + 1,
            standalone_local_edit: true,
            standalone_local_edited_at: nowIso,
            is_dirty: 0,
            updated_at: nowIso,
          });
          for (const field of mediaPaths) {
            if (overwritten[field] !== existingTarget[field]) {
              delete overwritten[field.replace('_path', '_url')];
            }
          }
          await db.cards.put(overwritten);
          targetByDupKey.set(dupKey, overwritten);
          if (!copy) {
            const deletedSource = stripOfflineQueueFields({
              ...card,
              is_deleted: 1,
              standalone_local_edit: true,
              standalone_local_edited_at: nowIso,
              is_dirty: 0,
              updated_at: nowIso,
            });
            await db.cards.put(deletedSource);
          }
          resultCards.push(overwritten);
          count += 1;
          continue;
        }

        if (copy) {
          const newId = await allocatePositiveLocalId(db, 'cards', 'card');
          const copiedCard = {
            id: newId,
            deck_id: targetId,
            position: ++position,
            target_language: target.target_language || card.target_language || 'de',
            content_v2: structuredClone(card.content_v2),
            front_text: card.front_text ?? studySideText(card.content_v2.card, 'front'),
            ...Object.fromEntries(mediaPaths.map(field => [field, card[field] ?? null])),
            difficulty: card.difficulty ?? null,
            source: card.source ?? 'user',
            revision: 1,
            standalone_card_key: buildOriginKey(exportSource, 'card', newId),
            standalone_local_created: true,
            standalone_local_edit: true,
            standalone_local_edited_at: nowIso,
            is_deleted: 0,
            is_dirty: 0,
            created_at: nowIso,
            updated_at: nowIso,
          };
          await db.cards.add(copiedCard);
          if (!targetByDupKey.has(dupKey)) targetByDupKey.set(dupKey, copiedCard);
          resultCards.push(copiedCard);
          count += 1;
        } else {
          const language = target.target_language || 'de';
          const movedCard = stripOfflineQueueFields({
            ...card,
            deck_id: targetId,
            position: ++position,
            target_language: language,
            revision: (Number(card.revision) || 0) + 1,
            standalone_local_edit: true,
            standalone_local_edited_at: nowIso,
            is_dirty: 0,
            updated_at: nowIso,
          });
          if ((card.target_language || 'de') !== language) {
            await db.card_knowledge_items.where('card_id').equals(card.id)
              .filter(link => !isKnowledgeKeyForLanguage(link.knowledge_item_id, language)).delete();
          }
          await db.cards.put(movedCard);
          if (!targetByDupKey.has(dupKey)) targetByDupKey.set(dupKey, movedCard);
          resultCards.push(movedCard);
          count += 1;
        }
      }

      await writeCardOpReceipt(db, opKey, {
        op: copy ? 'batch-copy' : 'batch-move',
        fingerprint,
        resultIds: resultCards.map(c => c.id),
        count,
        skipped,
      });

      if (typeof isCurrent === 'function' && !isCurrent()) throw new Error('Session changed');
      return result(!copy && ids.length === 1
        ? (resultCards[0] || cards[0])
        : { cards: resultCards, count, skipped });
    });
  }

  if (!body?.revisions) throw unsupported();
  const ids = body.card_ids;
  const targetId = body.target_deck_id;
  if (!ids?.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) pendingCreate();
  if (!Number.isSafeInteger(targetId) || targetId <= 0) notFound();
  if (!body.request_id) throw new Error('Missing card transfer request ID');
  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    // Keep the existing single-move key readable by previous builds.
    const key = CARD_MOVE_KEY + (!copy && ids.length === 1 ? ids[0] : body.request_id);
    const previous = await db.syncState.get(key);
    if (previous?.payload.request_id === body.request_id) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(body)) throw new Error('Card transfer request changed');
      const cards = await db.cards.bulkGet(previous.localIds || [previous.cardId]);
      return result(!copy && ids.length === 1 ? cards[0] : { cards, offline_transfer: true });
    }
    const [cards, target, folderMap] = await Promise.all([db.cards.bulkGet(ids), db.decks.get(targetId), loadFolderMap(db)]);
    if (!isDeckActiveInCache(target, folderMap)) notFound();
    if (isContentReadOnly(target)) readOnly();
    const sources = [];
    for (const card of cards) {
      assertCardReadyForBatch(card, body.revisions?.[card?.id]);
      const source = await db.decks.get(card.deck_id);
      if (!source || source.id <= 0 || !isDeckActiveInCache(source, folderMap)) notFound();
      if (!copy && isContentReadOnly(source)) readOnly();
      sources.push(source.id);
    }
    if (!copy && ids.length === 1 && cards[0].deck_id === targetId) return result(cards[0]);
    const siblings = await db.cards.where('deck_id').equals(targetId).filter(item => !item.is_deleted).toArray();
    let position = siblings.reduce((max, item) => Math.max(max, item.position || 0), 0);
    const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
    const locals = [];
    for (const card of cards) {
      const id = copy ? await allocateTempCardId(db, aliases) : card.id;
      // Copy only authored fields; personal progress/flags/notes stay at the source ID.
      const local = copy ? { id, content_v2: card.content_v2, creator_id: card.creator_id,
        creator_name: card.creator_name, creator_avatar: card.creator_avatar,
        created_at: new Date().toISOString(), is_dirty: 0, is_deleted: false, offline_create_status: 'pending',
        ...Object.fromEntries(mediaPaths.map(field => [field, card[field]])) } : { ...card };
      if (copy || card.deck_id !== targetId) Object.assign(local, { deck_id: targetId, position: ++position });
      local.offline_move = { status: 'pending', ...(copy && { copy: true }) };
      await db.cards.put(local);
      locals.push(local);
    }
    await db.syncState.add({ key, cardId: ids[0], sourceDeckId: sources[0],
      sourceDeckIds: sources, localIds: locals.map(card => card.id), copy, payload: body });
    if (!isCurrent()) throw new Error('Session changed');
    return result(!copy && ids.length === 1 ? locals[0] : { cards: locals, offline_transfer: true });
  });
}

export async function queueCardLifecycle(db, id, payload, deleting, userId, isCurrent) {
  const cardId = Number(id);
  if (!Number.isSafeInteger(cardId) || cardId <= 0) pendingCreate();

  if (isStandaloneDb(db)) {
    const nowIso = new Date().toISOString();
    const opKey = payload?.request_id ? STANDALONE_CARD_OP_PREFIX + payload.request_id : null;
    const fingerprint = opKey
      ? canonicalCompareValue({ op: deleting ? 'delete' : 'restore', cardId })
      : null;

    return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
      if (opKey) {
        const existingOp = await db.syncState.get(opKey);
        if (existingOp) {
          if (existingOp.fingerprint !== fingerprint) {
            throw new Error(deleting ? 'Card delete request changed' : 'Card restore request changed');
          }
          const existingCard = await db.cards.get(cardId);
          if (!existingCard) notFound();
          return result(existingCard);
        }
      }

      const current = await db.cards.get(cardId);
      if (!current) notFound();

      if (deleting) {
        if (current.is_deleted) {
          return result({ ...current, is_deleted: 1 });
        }
        if (payload?.revisions && payload.revisions[cardId] !== current.revision) {
          throw new Error(tr('Исходная ревизия карточки недоступна.'));
        }
        const [deck, folderMap] = await Promise.all([db.decks.get(current.deck_id), loadFolderMap(db)]);
        if (!isDeckActiveInCache(deck, folderMap)) notFound();

        const deletedCard = stripOfflineQueueFields({
          ...current,
          is_deleted: 1,
          is_dirty: 0,
          standalone_local_edit: true,
          standalone_local_edited_at: nowIso,
          updated_at: nowIso,
        });
        await db.cards.put(deletedCard);
        if (opKey) {
          await writeCardOpReceipt(db, opKey, { op: 'delete', cardId, fingerprint });
        }
        if (typeof isCurrent === 'function' && !isCurrent()) throw new Error('Session changed');
        return result(deletedCard);
      }

      if (!current.content_v2) notFound();
      if (payload?.revision != null && payload.revision !== current.revision) {
        throw new Error(tr('Исходная ревизия карточки недоступна.'));
      }
      const [deck, folderMap] = await Promise.all([db.decks.get(current.deck_id), loadFolderMap(db)]);
      if (deck) {
        if (deck.user_id !== userId && deck.role !== 'owner' && !isBundledSeedDeck(deck)) {
          readOnly();
        }
        if (deck.is_deleted) throw new Error(tr('Сначала восстановите родительскую колоду.'));
        if (!isFolderActiveInCache(folderMap, deck.folder_id)) {
          throw new Error(tr('Сначала восстановите родительскую папку.'));
        }
      } else if (current.deck_deleted) {
        throw new Error(tr('Сначала восстановите родительскую колоду.'));
      } else {
        notFound();
      }

      if (!current.is_deleted && !current.hard_deleted_locally) {
        return result(current);
      }
      const restoredCard = stripOfflineQueueFields({
        ...current,
        is_deleted: 0,
        hard_deleted_locally: false,
        is_dirty: 0,
        standalone_local_edit: true,
        standalone_local_edited_at: nowIso,
        updated_at: nowIso,
      });
      await db.cards.put(restoredCard);
      if (opKey) {
        await writeCardOpReceipt(db, opKey, { op: 'restore', cardId, fingerprint });
      }
      if (typeof isCurrent === 'function' && !isCurrent()) throw new Error('Session changed');
      return result(restoredCard);
    });
  }

  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    const card = await db.cards.get(cardId);
    if (!card?.content_v2) notFound();
    if (card.offline_lifecycle) pendingLifecycle();
    if (card.offline_move) pendingMove();
    const edit = card.offline_edit;
    const recoveringDraft = !deleting && edit?.status === 'conflict' && edit.server?.is_deleted;
    if (card.is_dirty || (edit && !recoveringDraft)) {
      throw new Error(tr('Сначала синхронизируйте правку карточки.'));
    }
    const revision = deleting ? payload.revisions?.[cardId] : payload.revision;
    if (!payload.request_id || !revision || revision !== (recoveringDraft ? edit.server.revision : card.revision)
        || Boolean(card.is_deleted) === deleting) {
      throw new Error(tr('Исходная ревизия карточки недоступна.'));
    }
    const [deck, folderMap] = await Promise.all([db.decks.get(card.deck_id), loadFolderMap(db)]);
    if (deleting) {
      if (!isDeckActiveInCache(deck, folderMap)) notFound();
      if (isContentReadOnly(deck)) readOnly();
    } else {
      if (deck && deck.user_id !== userId && deck.role !== 'owner') {
        readOnly();
      }
      if (deck) {
        if (deck.is_deleted) throw new Error(tr('Сначала восстановите родительскую колоду.'));
        if (!isFolderActiveInCache(folderMap, deck.folder_id)) {
          throw new Error(tr('Сначала восстановите родительскую папку.'));
        }
      } else if (card.deck_deleted) {
        throw new Error(tr('Сначала восстановите родительскую колоду.'));
      }
    }
    const local = { ...card, is_deleted: deleting, offline_lifecycle: deleting ? 'delete' : 'restore' };
    await db.cards.put(local);
    await db.syncState.add({ key: CARD_LIFECYCLE_KEY + cardId, cardId, deleting, payload });
    if (!isCurrent()) throw new Error('Session changed');
    return result(local);
  });
}

export async function queueCardSelection(db, payload, action, isCurrent) {
  const ids = (payload?.card_ids || []).map(Number);
  if (!payload?.request_id || !ids.length || new Set(ids).size !== ids.length
      || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) pendingCreate();

  if (isStandaloneDb(db)) {
    const opKey = STANDALONE_CARD_OP_PREFIX + payload.request_id;
    const fingerprint = canonicalCompareValue({
      op: `selection:${action}`,
      ids,
      revisions: payload.revisions ?? null,
    });
    const nowIso = new Date().toISOString();

    return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
      const existingOp = await db.syncState.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== fingerprint) {
          throw new Error('Card selection request changed');
        }
        return result({ cards: (await db.cards.bulkGet(ids)).filter(Boolean) });
      }
      const [cards, folderMap] = await Promise.all([db.cards.bulkGet(ids), loadFolderMap(db)]);
      for (const card of cards) {
        if (!card?.content_v2 || card.is_deleted) notFound();
        if (payload.revisions && payload.revisions[card.id] !== card.revision) {
          throw new Error(tr('Исходная ревизия карточки недоступна.'));
        }
        const deck = await db.decks.get(card.deck_id);
        if (!isDeckActiveInCache(deck, folderMap)) notFound();
      }
      if (action === 'reorder' && new Set(cards.map(card => card.deck_id)).size !== 1) {
        throw new Error('Reordering requires one deck');
      }
      const sortedPositions = cards
        .map(card => (Number.isInteger(card.position) ? card.position : 0))
        .sort((a, b) => a - b);
      const positions = [];
      for (const pos of sortedPositions) {
        positions.push(positions.length > 0 && pos <= positions[positions.length - 1]
          ? positions[positions.length - 1] + 1
          : pos);
      }
      const locals = cards.map((card, index) => stripOfflineQueueFields({
        ...card,
        ...(action === 'delete' ? { is_deleted: 1 } : { position: positions[index] }),
        is_dirty: 0,
        standalone_local_edit: true,
        standalone_local_edited_at: nowIso,
        updated_at: nowIso,
      }));
      await db.cards.bulkPut(locals);
      await writeCardOpReceipt(db, opKey, {
        op: `selection:${action}`,
        cardIds: ids,
        fingerprint,
      });
      if (typeof isCurrent === 'function' && !isCurrent()) throw new Error('Session changed');
      return result({ cards: locals });
    });
  }

  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    const key = CARD_LIFECYCLE_KEY + payload.request_id;
    const pending = await db.syncState.get(key);
    if (pending) {
      if (pending.action !== action || JSON.stringify(pending.payload) !== JSON.stringify(payload)) throw new Error('Card selection request changed');
      return result({ cards: await db.cards.bulkGet(ids), offline_lifecycle: action });
    }
    const [cards, folderMap] = await Promise.all([db.cards.bulkGet(ids), loadFolderMap(db)]);
    for (const card of cards) {
      assertCardReadyForBatch(card, payload.revisions?.[card?.id]);
      const deck = await db.decks.get(card.deck_id);
      if (!isDeckActiveInCache(deck, folderMap)) notFound();
      if (isContentReadOnly(deck)) readOnly();
    }
    if (action === 'reorder' && new Set(cards.map(card => card.deck_id)).size !== 1) throw new Error('Reordering requires one deck');
    const positions = cards.map(card => card.position).sort((a, b) => a - b);
    const locals = cards.map((card, index) => ({ ...card, offline_lifecycle: action,
      ...(action === 'delete' ? { is_deleted: true } : { position: positions[index] }) }));
    await db.cards.bulkPut(locals);
    await db.syncState.add({ key, cardIds: ids, action, payload });
    if (!isCurrent()) throw new Error('Session changed');
    return result({ cards: locals, offline_lifecycle: action });
  });
}

export async function saveNativeEdit(db, id, body, expectedConflictOrOptions, userId = null) {
  if (isStandaloneDb(db)) {
    const cardId = Number(id);
    if (!Number.isSafeInteger(cardId) || cardId <= 0) notFound();
    if (!body?.request_id || typeof body.request_id !== 'string') {
      throw new Error('Missing card edit request ID');
    }
    if (!body?.content_v2 || typeof body.content_v2 !== 'object' || !body.content_v2.card || typeof body.content_v2.card !== 'object') {
      validateNativeV2Content(body?.content_v2, { writable: true });
    }
    const flag = expectedConflictOrOptions && typeof expectedConflictOrOptions === 'object'
      ? (expectedConflictOrOptions.flag ?? expectedConflictOrOptions.standaloneFlag)
      : undefined;
    const { normalized: normalizedContent, mediaPatch } = normalizeMediaForStorage(body, body.content_v2);
    validateNativeV2Content(normalizedContent, { writable: true });
    assertArchiveSafeMetadata(normalizedContent.card.metadata);
    const fingerprint = canonicalCompareValue({
      op: 'update',
      cardId,
      flag: flag !== undefined ? (Number(flag) || 0) : undefined,
      content_v2: normalizedContent,
      mediaPatch,
    });
    const opKey = STANDALONE_CARD_OP_PREFIX + body.request_id;
    const nowIso = new Date().toISOString();
    const resolvedUserId = userId ?? getUserId();

    const updatedCard = await db.transaction('rw', db.folders, db.cards, db.decks, db.progress, db.syncState, async () => {
      const existingOp = await db.syncState.get(opKey);
      if (existingOp) {
        if (existingOp.fingerprint !== fingerprint) {
          throw new Error('Card edit request changed');
        }
        const existingCard = await db.cards.get(cardId);
        if (!existingCard || existingCard.is_deleted) notFound();
        return existingCard;
      }

      const current = await db.cards.get(cardId);
      if (!current?.content_v2 || current.is_deleted) notFound();
      if (body.revision !== current.revision) {
        const error = new Error(tr('Карточка изменилась на устройстве. Черновик сохранён в форме. Откройте актуальную карточку перед повторной правкой.'));
        error.response = { status: 409, data: { detail: { code: 'card_revision_conflict', card_id: cardId, message: error.message } } };
        throw error;
      }

      const [deck, folderMap] = await Promise.all([db.decks.get(current.deck_id), loadFolderMap(db)]);
      if (!isDeckActiveInCache(deck, folderMap)) notFound();

      const updated = stripOfflineQueueFields({
        ...current,
        content_v2: normalizedContent,
        front_text: studySideText(normalizedContent.card, 'front'),
        revision: (Number(current.revision) || 0) + 1,
        standalone_local_edit: true,
        standalone_local_edited_at: nowIso,
        is_dirty: 0,
        updated_at: nowIso,
      });

      for (const field of mediaPaths) {
        if (!Object.hasOwn(mediaPatch, field)) continue;
        if (updated[field] !== mediaPatch[field]) {
          delete updated[field.replace('_path', '_url')];
        }
        updated[field] = mediaPatch[field];
      }

      await db.cards.put(updated);

      if (flag !== undefined && resolvedUserId != null) {
        const normalizedFlag = Number(flag) || 0;
        const existingProgress = await db.progress.get([cardId, resolvedUserId]);
        if (existingProgress) {
          if (Number(existingProgress.flag ?? 0) !== normalizedFlag) {
            await db.progress.put({
              ...existingProgress,
              flag: normalizedFlag,
              is_dirty: 0,
              updated_at: nowIso,
            });
          }
        } else if (normalizedFlag > 0) {
          await db.progress.put(buildInitialProgressRow(cardId, resolvedUserId, normalizedFlag, nowIso));
        }
      }

      await writeCardOpReceipt(db, opKey, {
        op: 'update',
        cardId,
        fingerprint,
      });

      return updated;
    });
    return result(updatedCard);
  }

  const expectedConflict = expectedConflictOrOptions;
  if (!body.request_id || !body.revision) throw new Error(tr('Исходная ревизия карточки недоступна.'));
  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    const key = CARD_EDIT_KEY + id;
    const [current, folderMap] = await Promise.all([db.cards.get(id), loadFolderMap(db)]);
    if (!current?.content_v2) notFound();
    if (current.offline_move) pendingMove();
    if (current.offline_lifecycle) pendingLifecycle();
    const operation = await db.syncState.get(key);
    const sent = operation?.payload;
    const next = current.offline_edit?.next;
    if (sent?.request_id === body.request_id || next?.request_id === body.request_id) {
      const replay = sent?.request_id === body.request_id
        ? JSON.stringify(sent) === JSON.stringify(body)
        : Object.keys(body).every(field => JSON.stringify(next[field]) === JSON.stringify(body[field]));
      if (!replay) throw new Error('Card edit request changed');
      return result(current);
    }

    const conflict = current.offline_edit?.status === 'conflict';
    if ((conflict && expectedConflict !== sent?.request_id) || (expectedConflict && !conflict)
        || (sent && (current.offline_edit?.requestId !== sent.request_id || body.revision !== current.revision))) {
      throw new Error(tr('Состояние правки изменилось. Откройте карточку заново.'));
    }
    if (!conflict) {
      const parentDeck = await db.decks.get(current.deck_id);
      if (!isDeckActiveInCache(parentDeck, folderMap)) notFound();
      await requireContentWrite(db, 'cards', current);
    }
    const replace = !operation || (current.offline_edit?.status === 'error' && current.offline_edit.httpStatus === 422);
    const payload = replace && sent ? { ...body, revision: sent.revision } : body;
    const tombstone = current.is_deleted && (current.offline_edit ? current.offline_edit.server : current);
    const offlineEdit = replace
      ? { status: tombstone?.is_deleted ? 'conflict' : 'pending', requestId: payload.request_id,
        ...(tombstone?.is_deleted && { server: tombstone }) }
      : { ...current.offline_edit, draftId: body.request_id };
    if (!replace && !conflict) offlineEdit.next = { ...next, ...body };
    const draft = {
      ...current, content_v2: body.content_v2, revision: payload.revision,
      offline_edit: offlineEdit,
    };
    for (const field of mediaPaths) {
      if (!Object.hasOwn(body, field)) continue;
      if (draft[field] !== body[field]) delete draft[field.replace('_path', '_url')];
      draft[field] = body[field];
    }
    await db.cards.put(draft);
    // Keep the oldest payload until its outcome is known, including after a reload.
    if (!operation) await db.syncState.add({ key, cardId: id, payload });
    else if (replace) await db.syncState.put({ key, cardId: id, payload });
    return result(draft);
  });
}

export async function resolveCardEdit(id, expected, keepLocal) {
  const identity = getSessionIdentity();
  const userId = getUserId();
  const db = await prepareLocalDb();
  if (isStandaloneDb(db)) readOnly();
  const assertCurrent = () => {
    if (identity !== getSessionIdentity() || userId !== getUserId()) throw new Error('Session changed');
  };
  return db.transaction('rw', db.cards, db.syncState, async () => {
    assertCurrent();
    const key = CARD_EDIT_KEY + id;
    const [card, operation] = await Promise.all([db.cards.get(id), db.syncState.get(key)]);
    const edit = card?.offline_edit;
    const server = edit?.server;
    if (card?.offline_lifecycle) pendingLifecycle();
    if (server?.is_deleted && keepLocal) throw new Error(tr('Сначала восстановите карточку из корзины.'));
    if (!server || edit.status !== 'conflict' || edit.requestId !== expected.requestId || edit.draftId !== expected.draftId
        || server.revision !== expected.server?.revision || operation?.payload.request_id !== edit.requestId) {
      throw new Error(tr('Состояние правки изменилось. Откройте карточку заново.'));
    }
    if (!keepLocal) {
      const accepted = { ...server, is_dirty: 0, offline_confirmed_at: Date.now() };
      await db.cards.put(accepted);
      await db.syncState.delete(key);
      assertCurrent();
      return accepted;
    }

    const payload = { content_v2: card.content_v2, revision: server.revision, request_id: crypto.randomUUID() };
    for (const field of mediaPaths) if (Object.hasOwn(card, field)) payload[field] = card[field];
    const draft = { ...card, offline_edit: { status: 'pending', requestId: payload.request_id, server } };
    await db.cards.put(draft);
    await db.syncState.put({ key, cardId: id, payload });
    assertCurrent();
    return draft;
  });
}

export async function clearTrashInDb(db, userId, { isCurrent = () => true, localOnly = false } = {}) {
  const nowIso = new Date().toISOString();
  const tables = [db.folders, db.decks, db.cards, db.progress, ...(localOnly ? [db.syncState] : [])];
  return db.transaction('rw', tables, async () => {
    if (!isCurrent()) throw new Error('Session changed during trash clear');
    const [allFolders, allDecks, allCards] = await Promise.all([
      db.folders.toArray(),
      db.decks.toArray(),
      db.cards.toArray(),
    ]);

    const childrenByParent = new Map();
    for (const folder of allFolders) {
      if (!isOwnedRecord(folder, userId)) continue;
      const list = childrenByParent.get(folder.parent_id ?? null) || [];
      list.push(folder);
      childrenByParent.set(folder.parent_id ?? null, list);
    }

    const rootDelFolders = allFolders
      .filter(f => f.is_deleted && (localOnly || !f.is_dirty) && isOwnedRecord(f, userId))
      .map(f => f.id);
    const delFolderIds = new Set(
      collectSubtreeFolderIds(rootDelFolders, childrenByParent, child => localOnly || !child.is_dirty),
    );

    const decksById = new Map(allDecks.map(d => [d.id, d]));
    const delDeckIds = new Set(
      allDecks
        .filter(d => (!localOnly || !isBundledSeedDeck(d))
          && isOwnedRecord(d, userId)
          && (localOnly || !d.is_dirty)
          && (d.is_deleted || delFolderIds.has(d.folder_id)))
        .map(d => d.id),
    );

    const matchingCards = allCards.filter((c) => {
      if (!localOnly && (c.is_dirty || c.offline_lifecycle || c.offline_edit)) return false;
      if (delDeckIds.has(c.deck_id)) return true;
      if (!c.is_deleted) return false;
      const parentDeck = decksById.get(c.deck_id);
      if (localOnly && isBundledSeedDeck(parentDeck)) return true;
      return isOwnedRecord(parentDeck, userId);
    });

    if (localOnly) {
      const seedCardsToTombstone = [];
      const hardDeleteCardIds = [];
      const progressCardIds = [];
      for (const card of matchingCards) {
        progressCardIds.push(card.id);
        if (isBundledSeedCard(card)) {
          if (!card.hard_deleted_locally || !card.is_deleted || !card.standalone_local_edit) {
            seedCardsToTombstone.push(stripOfflineQueueFields({
              ...card,
              is_deleted: 1,
              hard_deleted_locally: true,
              standalone_local_edit: true,
              standalone_local_edited_at: nowIso,
              is_dirty: 0,
              updated_at: nowIso,
            }));
          }
        } else {
          hardDeleteCardIds.push(card.id);
        }
      }
      if (seedCardsToTombstone.length > 0) {
        await db.cards.bulkPut(seedCardsToTombstone);
      }
      if (hardDeleteCardIds.length > 0) {
        await db.cards.bulkDelete(hardDeleteCardIds);
      }
      if (progressCardIds.length > 0) {
        const progressKeys = (await db.progress.where('card_id').anyOf(progressCardIds).toArray())
          .map(p => [p.card_id, p.user_id]);
        if (progressKeys.length > 0) await db.progress.bulkDelete(progressKeys);
      }
      if (delDeckIds.size > 0) {
        await db.decks.bulkDelete([...delDeckIds]);
        await db.syncState.bulkDelete([...delDeckIds].map(id => `deck-cards:${id}`));
      }
      if (delFolderIds.size > 0) {
        await db.folders.bulkDelete([...delFolderIds]);
      }
      return;
    }

    const delCardIds = matchingCards.map(c => c.id);
    if (delCardIds.length > 0) {
      await db.cards.bulkDelete(delCardIds);
      const progressKeys = (await db.progress.where('card_id').anyOf(delCardIds).toArray())
        .map(p => [p.card_id, p.user_id]);
      if (progressKeys.length > 0) await db.progress.bulkDelete(progressKeys);
    }
    if (delDeckIds.size > 0) await db.decks.bulkDelete([...delDeckIds]);
    if (delFolderIds.size > 0) await db.folders.bulkDelete([...delFolderIds]);
  });
}
