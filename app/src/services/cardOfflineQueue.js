import { tr } from '../i18n/locale';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, CARD_LIFECYCLE_KEY, CARD_MOVE_KEY, prepareLocalDb, getNextTempId } from './localDb';
import { getUserId, getSessionIdentity } from '../utils/auth';
import { IS_STANDALONE, STANDALONE_DB_PREFIX } from '../utils/standaloneMode.js';

export const result = (data = {}) => ({ data });
export const notFound = () => { throw new Error(tr("Запись не найдена на устройстве. Сначала выполните синхронизацию.")); };
export const readOnly = () => { throw new Error(tr("У вас доступ только для чтения")); };
export const pendingCreate = () => { throw new Error(tr('Сначала синхронизируйте новую карточку.')); };
export const pendingMove = () => { throw new Error(tr('Сначала завершите синхронизацию переноса.')); };
export const pendingLifecycle = () => { throw new Error(tr('Сначала завершите синхронизацию удаления или восстановления.')); };
export const mediaPaths = ['image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'];

export const isStandaloneDb = db => (typeof IS_STANDALONE !== 'undefined' && IS_STANDALONE)
  || (typeof db?.name === 'string' && db.name.startsWith(STANDALONE_DB_PREFIX));

export function unsupported() {
  const error = new Error(tr("Для этого действия требуется подключение к интернету."));
  error.code = 'OFFLINE_UNSUPPORTED';
  return error;
}

export const isContentReadOnly = (owner, db = null) => isStandaloneDb(db)
  || !owner || owner.role === 'viewer'
  || (owner.is_global_readonly && owner.role !== 'owner' && owner.role !== 'editor');

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
  if (isStandaloneDb(db)) readOnly();
  if (!item) notFound();
  if (entity === 'cards' && item.offline_create_status) pendingCreate();
  const owner = entity === 'cards' ? await db.decks.get(item.deck_id) : item;
  if (isContentReadOnly(owner, db)) readOnly();
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

export async function saveNativeCard(db, body, {
  offlineCreateFlag: flag, offlineCreateIfAvailable: ifAvailable,
  offlineCreateId: tempId, offlineCreateRequestId: rejectedRequestId,
}, userId) {
  if (isStandaloneDb(db)) readOnly();
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
  if (isStandaloneDb(db)) readOnly();
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
  if (isStandaloneDb(db)) readOnly();
  if (!Number.isSafeInteger(id) || id <= 0) pendingCreate();
  return db.transaction('rw', db.cards, db.decks, db.folders, db.syncState, async () => {
    const card = await db.cards.get(id);
    if (!card?.content_v2) notFound();
    if (card.offline_lifecycle) pendingLifecycle();
    if (card.offline_move) pendingMove();
    const edit = card.offline_edit;
    const recoveringDraft = !deleting && edit?.status === 'conflict' && edit.server?.is_deleted;
    if (card.is_dirty || (edit && !recoveringDraft)) {
      throw new Error(tr('Сначала синхронизируйте правку карточки.'));
    }
    const revision = deleting ? payload.revisions?.[id] : payload.revision;
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
    await db.syncState.add({ key: CARD_LIFECYCLE_KEY + id, cardId: id, deleting, payload });
    if (!isCurrent()) throw new Error('Session changed');
    return result(local);
  });
}

export async function queueCardSelection(db, payload, action, isCurrent) {
  if (isStandaloneDb(db)) readOnly();
  const ids = payload.card_ids;
  if (!payload.request_id || !ids?.length || new Set(ids).size !== ids.length
      || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) pendingCreate();
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

export async function saveNativeEdit(db, id, body, expectedConflict) {
  if (isStandaloneDb(db)) readOnly();
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
