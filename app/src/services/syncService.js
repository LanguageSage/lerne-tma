import { tr } from '../i18n/locale.js';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, CARD_LIFECYCLE_KEY, CARD_MOVE_KEY, prepareLocalDb } from './localDb.js';
import { networkApi } from './networkApi.js';
import { getAccessToken, getSessionIdentity, getUserId, isRetiredSession } from '../utils/auth.js';
import { syncCardNotes } from './cardNotes.js';
import { cardWriteError } from '../utils/cardDraft.js';
import { inspectCardCutover, inspectCutoverDatabase, inspectCutoverStorage } from './cardCutoverPreflight.js';
import { observeServerGeneration, generationError, isGenerationConflict } from './serverGeneration.js';

const entities = ['folders', 'decks', 'cards', 'progress'];
const keyFor = (name, item, userId) => name === 'progress' ? [item.card_id, userId] : item.id;
const revision = item => item.local_revision || item.updated_at;
const remap = (map, id) => map?.[String(id)] ?? id;

// Other tabs receive only invalidation hints. Card data is read from the
// receiving tab's account database, never from a delayed broadcast payload.
const syncChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
  ? new window.BroadcastChannel('lerne-offline-sync') : null;

export function subscribeSyncUi(listener) {
  syncChannel?.addEventListener('message', listener);
  return () => syncChannel?.removeEventListener('message', listener);
}

function notifySyncUi(type, detail, hint) {
  if (type === 'lerne:synced') detail = { complete: false, ...detail };
  window.dispatchEvent(new CustomEvent(type, { detail }));
  if (hint) syncChannel?.postMessage({ type, userId: detail.userId,
    ...(type === 'lerne:synced' && { complete: detail.complete }), ...hint });
}

export function notifyCardEdit(card, userId, confirmed = false, deliveredRequestId) {
  notifySyncUi('lerne:card-edit-changed', { card, userId, confirmed, deliveredRequestId },
    { id: card.id, deliveredRequestId });
}

async function deliverCardCreates(db, operations, options, isCurrent) {
  const userId = options._expectedUserId;
  let firstError;
  for (const operation of operations) {
    if (!isCurrent()) throw new Error('Session changed');
    const ownsOperation = pending => pending?.tempId === operation.tempId
      && pending?.payload?.request_id === operation.payload.request_id;
    try {
      const { data: card } = await networkApi.post('/cards/save', operation.payload, options);
      if (!Number.isSafeInteger(card?.id) || card.id <= 0 || card.deck_id !== operation.deckId
          || card.content_v2?.schema_version !== 2 || card.content_v2.card?.type !== operation.payload.content_v2.card.type
          || !card.revision) {
        throw new Error(tr("Сервер не подтвердил сохранение изменений"));
      }
      if (!isCurrent()) throw new Error('Session changed');
      const mappings = { cards: { [operation.tempId]: card.id } };
      const confirmedCard = await db.transaction('rw', db.cards, db.syncState, async () => {
        const [pending, existing, aliasRow] = await Promise.all([
          db.syncState.get(operation.key), db.cards.get(card.id), db.syncState.get('aliases'),
        ]);
        if (!isCurrent() || !ownsOperation(pending)) return;
        if (existing && !existing.content_v2) throw new Error(tr('Серверный ID занят локальной карточкой V1.'));
        const aliases = aliasRow?.mappings || {};
        aliases.cards = { ...aliases.cards, ...mappings.cards };
        // A read may have discovered the server ID after the first commit.
        const local = { ...(existing || { ...card, is_dirty: 0 }), offline_confirmed_at: Date.now() };
        await db.cards.put(local);
        await db.cards.delete(operation.tempId);
        await db.syncState.put({ key: 'aliases', mappings: aliases });
        await db.syncState.delete(operation.key);
        if (!isCurrent()) throw new Error('Session changed');
        return local;
      });
      if (confirmedCard && isCurrent()) {
        notifySyncUi('lerne:ids-remapped', { mappings, userId, confirmedCard }, { mappings, id: card.id });
      }
    } catch (error) {
      if (isGenerationConflict(error)) throw error;
      if (!isCurrent()) throw error;
      const rejected = error.response?.status === 422;
      const changes = { offline_create_status: 'error',
        ...(rejected && { offline_create_error: cardWriteError(error) }) };
      const updated = await db.transaction('rw', db.cards, db.syncState, async () => {
        const pending = await db.syncState.get(operation.key);
        if (!isCurrent() || !ownsOperation(pending)) return false;
        const count = await db.cards.update(operation.tempId, changes);
        if (rejected) await db.syncState.update(operation.key, { rejected: true });
        if (!isCurrent()) throw new Error('Session changed');
        return count;
      });
      if (updated && isCurrent()) {
        notifySyncUi('lerne:card-create-error', { userId, id: operation.tempId, changes }, { id: operation.tempId });
      }
      firstError ||= rejected ? new Error(changes.offline_create_error) : error;
    }
  }
  if (firstError) throw firstError;
}

async function deliverCardEdits(db, operations, options, isCurrent) {
  let firstError;
  const userId = options._expectedUserId;
  for (const operation of operations) {
    const { cardId, key, payload } = operation;
    const path = `/cards/${cardId}`;
    const update = async (change, { confirmed = false, status } = {}) => {
      const ownsResponse = () => isCurrent()
        || (status === 401 && getUserId() === userId && isRetiredSession(options._expectedSessionIdentity));
      if (!ownsResponse()) throw new Error('Session changed');
      const card = await db.transaction('rw', db.cards, db.syncState, async () => {
        const [current, pending] = await Promise.all([db.cards.get(cardId), db.syncState.get(key)]);
        if (!ownsResponse() || current?.offline_edit?.requestId !== payload.request_id
            || pending?.payload?.request_id !== payload.request_id) return;
        let next = change(current);
        const draft = current.offline_edit.next;
        if (draft && (confirmed || status === 422)) {
          const promoted = { ...draft, revision: confirmed ? next.revision : payload.revision };
          await db.syncState.put({ key, cardId, payload: promoted });
          next = { ...current, revision: promoted.revision, offline_confirmed_at: next.offline_confirmed_at,
            offline_edit: { status: 'pending', requestId: promoted.request_id } };
        } else if (confirmed) {
          await db.syncState.delete(key);
        }
        await db.cards.put(next);
        if (!ownsResponse()) throw new Error('Session changed');
        return next;
      });
      if (card && ownsResponse()) notifyCardEdit(card, userId, confirmed && !card.offline_edit, payload.request_id);
      return card;
    };
    const validate = card => {
      if (card?.id !== cardId || card.content_v2?.schema_version !== 2 || !card.revision) {
        throw new Error(tr('Сервер не подтвердил сохранение изменений'));
      }
      return card;
    };

    const current = await db.cards.get(cardId);
    if (!isCurrent()) throw new Error('Session changed');
    if (current?.offline_edit?.requestId !== payload.request_id) continue;
    let edit = current.offline_edit;
    if (edit.status !== 'conflict') {
      try {
        const { data } = await networkApi.patch(path, payload, options);
        const card = validate(data);
        if (card.content_v2.card?.type !== payload.content_v2.card.type) {
          throw new Error(tr('Сервер не подтвердил сохранение изменений'));
        }
        await update(current => ({ ...(current.offline_edit.server?.is_deleted && !current.offline_edit.next
          ? current.offline_edit.server : card),
          is_dirty: 0, offline_confirmed_at: Date.now() }), { confirmed: true });
        continue;
      } catch (error) {
        if (isGenerationConflict(error)) throw error;
        const status = error.response?.status;
        if (status === 409 && error.response?.data?.detail?.code === 'card_revision_conflict') {
          // Persist rejection before fetching the remote side. A failed GET cannot cause a second PATCH.
          edit = (await update(card => {
            const { requestId, draftId } = card.offline_edit;
            const tombstone = error.response.data.detail.card;
            const server = tombstone?.is_deleted ? validate(tombstone) : undefined;
            return { ...card, ...(server && { is_deleted: true }),
              offline_edit: { requestId, ...(draftId && { draftId }), status: 'conflict', server } };
          }))?.offline_edit;
        } else {
          await update(card => ({ ...card, offline_edit: { ...card.offline_edit, status: 'error', httpStatus: status,
            error: status === 422 ? cardWriteError(error) : undefined } }), { status });
          firstError ||= error;
          continue;
        }
      }
    }
    if (edit && !edit.server) {
      try {
        const { data } = await networkApi.get(path, options);
        const server = validate(data);
        await update(card => ({ ...card, offline_edit: { ...card.offline_edit, server, httpStatus: undefined } }));
      } catch (error) {
        if (isGenerationConflict(error)) throw error;
        const status = error.response?.status;
        await update(card => ({ ...card, offline_edit: { ...card.offline_edit, httpStatus: status } }), { status });
        // The active card read omits tombstones. Let the existing V2 pull reconcile them.
        if (status !== 404) firstError ||= error;
      }
    }
  }
  if (firstError) throw firstError;
}

async function deliverCardMoves(db, operations, options, isCurrent) {
  let firstError;
  let changed = false;
  const userId = options._expectedUserId;
  for (const operation of operations) {
    const { key, payload, copy = false } = operation;
    const localIds = operation.localIds || [operation.cardId];
    const sourceDeckIds = operation.sourceDeckIds || [operation.sourceDeckId];
    if (!isCurrent()) throw new Error('Session changed');
    let receipt, error;
    const startedAt = Date.now();
    try {
      const { data } = await networkApi.post(copy ? '/cards/batch-copy' : '/cards/batch-move', payload, options);
      const items = copy ? data?.copies : data?.placements;
      const validRevision = item => /^[0-9a-f]{64}$/.test(item?.revision);
      const valid = Array.isArray(items) && items.length === payload.card_ids.length && items.every((item, index) => copy
        ? item.source_id === payload.card_ids[index] && (item.card === null || (Number.isSafeInteger(item.card?.id)
          && item.card.id > 0 && (payload.on_duplicate === 'overwrite' || !payload.card_ids.includes(item.card.id))
          && item.card.deck_id === payload.target_deck_id
          && item.card.content_v2?.schema_version === 2 && Number.isInteger(item.card.position) && validRevision(item.card)))
        : item.id === payload.card_ids[index] && [sourceDeckIds[index], payload.target_deck_id].includes(item.deck_id)
          && Number.isInteger(item.position) && validRevision(item));
      if (data?.status !== 'success' || !valid) throw new Error(tr('Сервер не подтвердил сохранение изменений'));
      receipt = data;
    } catch (cause) {
      if (isGenerationConflict(cause)) throw cause;
      error = cause;
    }
    if (!isCurrent()) throw new Error('Session changed');
    const httpStatus = error?.response?.status;
    const rejected = [403, 404, 409, 422].includes(httpStatus);
    const confirmed = await db.transaction('rw', db.cards, db.syncState, async () => {
      const [cards, pending] = await Promise.all([db.cards.bulkGet(localIds), db.syncState.get(key)]);
      if (!isCurrent() || pending?.payload.request_id !== payload.request_id
          || cards.some(card => !card?.offline_move)) return;
      const remapped = [];
      if (receipt) {
        const aliases = (await db.syncState.get('aliases'))?.mappings || {};
        for (const [index, card] of cards.entries()) {
          if (copy) {
            const server = receipt.copies[index].card;
            if (server) {
              const existing = await db.cards.get(server.id);
              if (existing && !existing.content_v2) throw new Error(tr('Серверный ID занят локальной карточкой V1.'));
              const next = keepLocalCard(existing, startedAt) ? existing
                : { creator_name: card.creator_name, creator_avatar: card.creator_avatar,
                  ...existing, ...server, is_dirty: 0, offline_confirmed_at: Date.now() };
              await db.cards.put(next);
              aliases.cards = { ...aliases.cards, [card.id]: server.id };
              remapped.push({ tempId: card.id, card: next });
            }
            await db.cards.delete(card.id);
          } else {
            const next = { ...card, ...receipt.placements[index], offline_confirmed_at: Date.now() };
            delete next.offline_move;
            await db.cards.put(next);
          }
        }
        if (copy) await db.syncState.put({ key: 'aliases', mappings: aliases });
        await db.syncState.delete(key);
      } else if (rejected) {
        const code = error.response?.data?.detail?.code;
        for (const card of cards) await db.cards.update(card.id, {
          offline_move: { ...card.offline_move, status: 'rejected', httpStatus, code },
        });
        await db.syncState.update(key, { rejected: true });
      }
      if (!isCurrent()) throw new Error('Session changed');
      return { applied: Boolean(receipt || rejected), remapped };
    });
    if (confirmed && isCurrent()) {
      for (const { tempId, card } of confirmed.remapped) {
        const mappings = { cards: { [tempId]: card.id } };
        notifySyncUi('lerne:ids-remapped', { mappings, userId, confirmedCard: card, silent: true }, { mappings, id: card.id });
      }
      changed ||= confirmed.applied;
    }
    firstError ||= error;
  }
  if (changed && isCurrent()) notifySyncUi('lerne:synced', { userId }, {});
  if (firstError) throw firstError;
}

async function deliverCardSelection(db, operation, options, isCurrent) {
  const { key, cardIds, action, payload } = operation;
  let receipt, error;
  try {
    const path = action === 'delete' ? '/cards/batch-delete' : '/cards/reorder';
    const { data } = await networkApi.post(path, payload, options);
    if (data?.status !== 'success' || data.cards?.length !== cardIds.length
        || !data.cards.every((card, index) => card?.id === cardIds[index] && card.content_v2?.schema_version === 2
          && card.is_deleted === (action === 'delete') && Number.isInteger(card.position) && /^[0-9a-f]{64}$/.test(card.revision))) {
      throw new Error(tr('Сервер не подтвердил сохранение изменений'));
    }
    receipt = data;
  } catch (cause) {
    if (isGenerationConflict(cause)) throw cause;
    error = cause;
  }
  if (!isCurrent()) throw new Error('Session changed');
  const status = error?.response?.status;
  if (error && ![403, 404, 409, 422].includes(status)) throw error;
  const applied = await db.transaction('rw', db.cards, db.syncState, async () => {
    const [cards, pending] = await Promise.all([db.cards.bulkGet(cardIds), db.syncState.get(key)]);
    if (!isCurrent() || pending?.payload.request_id !== payload.request_id || cards.some(card => card?.offline_lifecycle !== action)) return false;
    for (const [index, card] of cards.entries()) {
      const next = receipt ? { ...card, ...receipt.cards[index], offline_confirmed_at: Date.now() }
        : { ...card, offline_list_error: status };
      if (receipt) { delete next.offline_lifecycle; delete next.offline_list_error; }
      await db.cards.put(next);
    }
    if (receipt) await db.syncState.delete(key);
    else await db.syncState.update(key, { rejected: true });
    if (!isCurrent()) throw new Error('Session changed');
    return true;
  });
  if (applied && isCurrent()) notifySyncUi('lerne:synced', { userId: options._expectedUserId }, {});
  if (error) throw error;
}

async function deliverCardLifecycle(db, operations, options, isCurrent) {
  const userId = options._expectedUserId;
  let firstError;
  for (const operation of operations) {
    if (!isCurrent()) throw new Error('Session changed');
    if (operation.cardIds) {
      try { await deliverCardSelection(db, operation, options, isCurrent); }
      catch (error) { if (isGenerationConflict(error)) throw error; firstError ||= error; }
      continue;
    }
    const { key, cardId, deleting, payload } = operation;
    if (!isCurrent()) throw new Error('Session changed');
    let server, error;
    const valid = card => card?.id === cardId && card.content_v2?.schema_version === 2
      && typeof card.is_deleted === 'boolean' && /^[0-9a-f]{64}$/.test(card.revision);
    try {
      const path = deleting ? '/cards/batch-delete' : `/trash/card/${cardId}/restore`;
      const { data } = await networkApi.post(path, payload, options);
      if (data?.status !== 'success' || !valid(data.card) || data.card.is_deleted !== deleting) {
        throw new Error(tr('Сервер не подтвердил сохранение изменений'));
      }
      server = data.card;
    } catch (cause) {
      if (isGenerationConflict(cause)) throw cause;
      error = cause;
      const state = cause.response?.data?.detail?.card;
      if (valid(state)) server = state;
    }
    if (!isCurrent()) throw new Error('Session changed');
    firstError ||= error;
    const status = error?.response?.status;
    if (error && ![403, 404, 409, 422].includes(status)) continue;
    const applied = await db.transaction('rw', db.cards, db.syncState, async () => {
      const [card, pending] = await Promise.all([db.cards.get(cardId), db.syncState.get(key)]);
      if (!isCurrent() || !card?.offline_lifecycle || pending?.payload.request_id !== payload.request_id) return false;
      const next = server && !card.offline_edit ? { ...card, ...server } : { ...card };
      next.is_deleted = error ? card.is_deleted : server.is_deleted;
      if (server && card.offline_edit) next.offline_edit = { ...card.offline_edit, server };
      if (error) next.offline_list_error = status;
      else { delete next.offline_lifecycle; next.offline_confirmed_at = Date.now(); }
      await db.cards.put(next);
      if (error) await db.syncState.update(key, { rejected: true });
      else await db.syncState.delete(key);
      if (!isCurrent()) throw new Error('Session changed');
      return true;
    });
    if (applied && isCurrent()) {
      notifySyncUi('lerne:synced', { userId, cardLifecycleRejection: status }, {});
    }
  }
  if (firstError) throw firstError;
}

async function pendingBatch(db, userId) {
  return db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    const pending = await db.syncState.get('pending');
    if (pending) {
      if (String(pending.userId) !== String(userId)) throw new Error(tr('Владелец старого пакета не подтверждён. Очередь сохранена.'));
      return pending;
    }
    const batch = { key: 'pending', request_id: crypto.randomUUID(), userId, cards: [] };
    for (const name of ['folders', 'decks']) {
      batch[name] = await db[name].where('is_dirty').equals(1).toArray();
    }
    batch.cards = await db.cards.where('is_dirty').equals(1).filter(card => !card.content_v2).toArray();
    batch.progress = await db.progress.where('is_dirty').equals(1)
      .filter(item => String(item.user_id) === String(userId)).toArray();
    batch.reviews = await db.syncState.filter(item => item.key.startsWith('review:')).toArray();
    // Upgrade unsent legacy events using their already durable UUID. An existing
    // pending batch above remains byte-for-byte compatible with its receipt.
    for (const event of batch.reviews) {
      if (!event.action_id) {
        const original = event.key.slice('review:'.length);
        event.action_id = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(original) ? original : crypto.randomUUID();
        await db.syncState.put(event);
      }
    }
    if (!entities.some(name => batch[name].length) && !batch.reviews.length) return null;
    await db.syncState.put(batch);
    return batch;
  });
}

function payloadFor(batch) {
  const payload = { request_id: batch.request_id };
  if (batch.reviews?.length) payload.reviews = batch.reviews;
  for (const name of entities) {
    payload[name] = (batch[name] || []).map(item => {
      const copy = { ...item };
      for (const key of ['metadata', 'tags']) {
        if (copy[key] != null && typeof copy[key] !== 'string') copy[key] = JSON.stringify(copy[key]);
      }
      return copy;
    });
  }
  return payload;
}

async function acknowledge(db, batch, mappings, isCurrent, versions = {}) {
  const userId = getUserId();
  return db.transaction('rw', [...entities.map(name => db[name]), db.syncState, db.card_notes, db.knowledge_attempt_outbox], async () => {
    const pending = await db.syncState.get('pending');
    if (!isCurrent() || pending?.request_id !== batch.request_id || String(pending.userId) !== String(userId)) return false;
    for (const name of entities) {
      for (const sent of batch[name] || []) {
        const key = keyFor(name, sent, userId);
        const current = await db[name].get(key);
        if (!current) continue;
        const isUnchanged = revision(sent) ? revision(current) === revision(sent)
          : JSON.stringify(current) === JSON.stringify(sent);
        const mapped = name === 'progress'
          ? { ...current, card_id: remap(mappings.cards, current.card_id) }
          : { ...current, id: remap(mappings[name], current.id) };
        if (isUnchanged) { mapped.is_dirty = 0; delete mapped.sync_base; }
        const versionKey = `${name}:${name === 'progress' ? sent.card_id : sent.id}`;
        if (Object.hasOwn(versions, versionKey)) {
          if (isUnchanged) mapped.updated_at = versions[versionKey];
          else mapped.sync_base = { updated_at: versions[versionKey] };
        }
        await db[name].delete(key);
        await db[name].put(mapped);
      }
    }
    // Include children created while the request was in flight.
    await db.folders.toCollection().modify(f => { f.parent_id = remap(mappings.folders, f.parent_id); });
    await db.decks.toCollection().modify(d => { d.folder_id = remap(mappings.folders, d.folder_id); });
    await db.cards.toCollection().modify(c => { c.deck_id = remap(mappings.decks, c.deck_id); });
    for (const p of await db.progress.toArray()) {
      const id = remap(mappings.cards, p.card_id);
      if (id !== p.card_id) {
        await db.progress.delete([p.card_id, p.user_id]);
        await db.progress.put({ ...p, card_id: id });
      }
    }
    for (const sent of batch.reviews || []) await db.syncState.delete(sent.key);
    for (const table of [db.card_notes, db.knowledge_attempt_outbox]) {
      await table.filter(row => String(row.user_id) === String(userId)).modify(row => {
        row.card_id = remap(mappings.cards, row.card_id);
      });
    }
    for (const event of await db.syncState.filter(item => item.key.startsWith('review:') && remap(mappings.cards, item.card_id) !== item.card_id).toArray()) {
      await db.syncState.put({ ...event, card_id: remap(mappings.cards, event.card_id) });
    }
    for (const receipt of await db.syncState.filter(item => item.key.startsWith('grade:')).toArray()) {
      const fields = JSON.parse(receipt.fingerprint);
      const cardId = remap(mappings.cards, fields[0]);
      if (cardId === fields[0]) continue;
      fields[0] = cardId;
      await db.syncState.put({ ...receipt, fingerprint: JSON.stringify(fields) });
    }
    await db.syncState.delete('pending');
    const aliases = (await db.syncState.get('aliases'))?.mappings || {};
    for (const name of ['folders', 'decks', 'cards']) aliases[name] = { ...aliases[name], ...mappings[name] };
    await db.syncState.put({ key: 'aliases', mappings: aliases });
    if (!isCurrent()) throw new Error('Session changed');
    return true;
  });
}

async function syncLearningPreferences(db, options, isCurrent) {
  for (const deck of await db.decks.filter(d => d.learning_dirty && d.id > 0).toArray()) {
    await networkApi.post(`/decks/${deck.id}/toggle-learning`, { is_learning: !!deck.is_learning }, options);
    await db.transaction('rw', db.decks, async () => {
      const current = await db.decks.get(deck.id);
      if (isCurrent() && current?.is_learning === deck.is_learning) {
        await db.decks.update(deck.id, { learning_dirty: 0 });
        if (!isCurrent()) throw new Error('Session changed');
      }
    });
  }
}

export function keepLocalCard(card, requestStartedAt) {
  return card?.offline_edit || card?.offline_move || card?.offline_lifecycle || card?.offline_confirmed_at >= requestStartedAt
    || card?.offline_read_started_at > requestStartedAt;
}

export function reconcileCardEditLifecycle(local, server, readStartedAt) {
  const deleted = Boolean(server.is_deleted);
  if (!local?.offline_edit || local.offline_lifecycle || local.offline_confirmed_at >= readStartedAt
      || local.offline_read_started_at > readStartedAt) return;
  const edit = local.offline_edit;
  if (Boolean(local.is_deleted) === deleted && (!deleted || edit.server?.revision === server.revision)) return;
  // A tombstone or a restore changes visibility without replacing the local draft.
  return { ...local, is_deleted: deleted, offline_read_started_at: readStartedAt,
    offline_edit: { ...edit, server: edit.status === 'conflict' || deleted ? server : undefined } };
}

async function applySnapshot(db, data, userId, pullStartedAt, isCurrent) {
  if (data.server_generation) await observeServerGeneration(db, data, isCurrent);
  if (await db.syncState.get('serverGenerationConflict')) throw generationError();
  const legacy = data.card_schema === 1;
  if (data.status !== 'success' || ![1, 2].includes(data.card_schema) || !entities.every(name => Array.isArray(data[name]))
      || data.cards.some(card => legacy ? !!card.content_v2 : card.content_v2?.schema_version !== 2)) {
    throw new Error(tr("Некорректный ответ синхронизации"));
  }
  return db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    if (!isCurrent()) throw new Error('Session changed');
    const lastSync = await db.syncState.get('lastSync');
    if (Date.parse(lastSync?.time) > Date.parse(data.server_time)) return false;
    const localCards = await db.cards.toArray();
    const otherIds = new Set(localCards.filter(card => legacy ? !!card.content_v2 : !card.content_v2).map(card => card.id));
    const scopeIds = new Set([...localCards.filter(card => legacy ? !card.content_v2 : !!card.content_v2),
      ...(legacy ? [] : data.cards)].map(card => card.id));
    for (const name of entities) {
      const incoming = new Set(data[name].map(item => name === 'progress' ? item.card_id : item.id));
      for (const item of data[name]) {
        const key = keyFor(name, item, userId);
        const local = await db[name].get(key);
        // Drain refreshes the device's existing V1 cache. It does not opt a
        // native device into downloading/rendering the rest of the V1 library.
        if (legacy && name === 'cards' && !local) continue;
        if (legacy && name === 'progress' && !scopeIds.has(item.card_id)) continue;
        if (name === 'cards' && local?.offline_edit) {
          const reconciled = reconcileCardEditLifecycle(local, item, pullStartedAt);
          if (reconciled) await db.cards.put(reconciled);
          continue;
        }
        if (local?.is_dirty || (name === 'decks' && local?.learning_dirty)
            || (name === 'cards' && (otherIds.has(item.id) || keepLocalCard(local, pullStartedAt)))
            || (name === 'progress' && otherIds.has(item.card_id))) continue;
        await db[name].put({ ...item,
          ...(name === 'cards' && { offline_read_started_at: pullStartedAt }),
          ...(name === 'progress' && { user_id: userId }), is_dirty: 0 });
      }
      // A full snapshot also carries hard deletions and revoked access.
      for (const item of name === 'cards' ? localCards : await db[name].toArray()) {
        const id = name === 'progress' ? item.card_id : item.id;
        if ((name === 'cards' && (otherIds.has(id) || keepLocalCard(item, pullStartedAt)))
            || (name === 'progress' && (otherIds.has(id) || !scopeIds.has(id)))) continue;
        if (id > 0 && !item.is_dirty && !(name === 'decks' && item.learning_dirty) && !incoming.has(id)) await db[name].delete(keyFor(name, item, userId));
      }
    }
    await db.syncState.put({ key: 'lastSync', time: data.server_time, readStartedAt: pullStartedAt });
    if (!isCurrent()) throw new Error('Session changed');
    return true;
  });
}

export const syncService = {
  async sync(options) {
    if (!navigator.onLine) return { success: false, reason: tr("Нет подключения к интернету") };
    const userId = getUserId();
    const identity = getSessionIdentity();
    if (!getAccessToken() || !userId || !identity) return { success: false, reason: tr("Требуется вход") };
    const isCurrent = () => getUserId() === userId && getSessionIdentity() === identity;
    const unavailable = { success: false, reason: tr('Синхронизация недоступна в этом браузере. Данные сохранены на устройстве.') };
    try {
      if (typeof navigator.locks?.request !== 'function') return unavailable;
      // Keep the existing lock name so tabs on a previous build coordinate too.
      return await navigator.locks.request('lerne-offline-sync', { ifAvailable: true }, lock => {
        if (!lock) return { success: false, reason: 'Already syncing' };
        if (!isCurrent()) return { success: false, reason: 'Session changed' };
        return runSync(userId, identity, isCurrent, options);
      });
    } catch {
      return unavailable;
    }
  },
};

async function runSync(userId, identity, isCurrent, { pendingNativeOnly = false, skipPull = false, pullOnly = false } = {}) {
  const options = { _expectedUserId: userId, _expectedSessionIdentity: identity };
  let db, nativeError, entityError, firstError, serverTime;
  let pullSuccess = false;
  let pullFailed = false;
  const remember = error => { firstError ||= error; };
  try {
    db = await prepareLocalDb();
    if (!isCurrent()) throw new Error('Session changed');
    const { data: databaseState } = await networkApi.get('/sync/v2/status', options);
    await observeServerGeneration(db, databaseState, isCurrent);
    const creates = pullOnly ? [] : await db.syncState.where('key').startsWith(CARD_CREATE_KEY)
      .filter(create => !create.rejected).toArray();
    const queuedEdits = pullOnly ? [] : await db.syncState.where('key').startsWith(CARD_EDIT_KEY).toArray();
    const editCards = await db.cards.bulkGet(queuedEdits.map(edit => edit.cardId));
    const edits = queuedEdits.filter((_edit, index) => {
      const edit = editCards[index]?.offline_edit;
      return edit && (edit.status === 'conflict' ? !edit.server : edit.httpStatus !== 422);
    });
    const moves = pullOnly ? [] : await db.syncState.where('key').startsWith(CARD_MOVE_KEY)
      .filter(move => !move.rejected).toArray();
    const lifecycle = pullOnly ? [] : await db.syncState.where('key').startsWith(CARD_LIFECYCLE_KEY).filter(operation => !operation.rejected).toArray();
    try { await deliverCardCreates(db, creates, options, isCurrent); }
    catch (error) { if (isGenerationConflict(error)) throw error; nativeError = error; }
    try { await deliverCardEdits(db, edits, options, isCurrent); }
    catch (error) { if (isGenerationConflict(error)) throw error; nativeError ||= error; }
    try { await deliverCardMoves(db, moves, options, isCurrent); }
    catch (error) { if (isGenerationConflict(error)) throw error; nativeError ||= error; }
    try { await deliverCardLifecycle(db, lifecycle, options, isCurrent); }
    catch (error) { if (isGenerationConflict(error)) throw error; nativeError ||= error; }
    if (!isCurrent()) throw new Error('Session changed');
    try {
      if (!pendingNativeOnly && !pullOnly) {
        // Historical import copied entities, not the old receipt UUID/reviews.
        // Never submit such copies under a fresh UUID while their source is
        // unresolved: the original request may already be committed remotely.
        const device = await inspectCardCutover();
        if (device.errors.length || device.databases.some(item => item.name === 'LerneLocalDB' && !item.pending_free)) {
          throw new Error(tr('В старой локальной базе есть непроверенные изменения. Нужна сверка исходной очереди; данные сохранены.'));
        }
      }
      const batch = pendingNativeOnly || pullOnly ? null : await pendingBatch(db, userId);
      if (batch) {
        const payload = payloadFor(batch);
        const nativeCards = await db.cards.filter(card => !!card.content_v2).toArray();
        const nativeIds = new Set(nativeCards.map(card => card.id));
        const guarded = batch.cards?.length || ['folders', 'decks'].some(name => batch[name]?.length)
          || [...(batch.progress || []), ...(batch.reviews || [])].some(item => !nativeIds.has(item.card_id));
        if (guarded) {
          if (batch.cards?.some(card => card.content_v2 != null
            || ['topics', 'level', 'difficulty', 'history', 'image_data'].some(field => Object.hasOwn(card, field)))) {
            throw new Error(tr('Старый пакет содержит поля, которые этот транспорт не сохраняет. Требуется сверка; очередь сохранена.'));
          }
          payload.drain_bases = {};
          for (const name of entities) for (const item of batch[name] || []) {
            if (item.sync_base && Object.hasOwn(item.sync_base, 'updated_at')) {
              payload.drain_bases[`${name}:${name === 'progress' ? item.card_id : item.id}`] = item.sync_base.updated_at;
            }
          }
        }
        const response = await networkApi.post(guarded ? '/sync/v2/push-legacy' : '/sync/v2/push', payload, options);
        if (response.data?.status !== 'success' || !response.data.mappings) throw new Error(tr("Сервер не подтвердил сохранение изменений"));
        if (batch.reviews?.length && response.data.review_count !== batch.reviews.length) {
          throw new Error(tr("Сервер не подтвердил сохранение оценок. Обновите сервер синхронизации."));
        }
        const mappings = response.data.mappings;
        const versions = response.data.versions;
        if (versions !== undefined && (!versions || typeof versions !== 'object' || Array.isArray(versions)
          || Object.values(versions).some(value => value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))))) {
          throw new Error(tr('Сервер не подтвердил сохранение изменений'));
        }
        for (const name of ['folders', 'decks', 'cards']) {
          for (const item of (batch[name] || []).filter(item => item.id < 0)) {
            const mapped = mappings[name]?.[String(item.id)];
            if (!Number.isSafeInteger(mapped) || mapped <= 0) throw new Error(tr("Сервер не вернул идентификатор новой записи"));
          }
        }
        if (!isCurrent()) throw new Error('Session changed');
        const acknowledged = await acknowledge(db, batch, mappings, isCurrent, response.data.versions);
        if (acknowledged && isCurrent()) notifySyncUi('lerne:ids-remapped', { mappings, userId }, { mappings });
      }
    } catch (error) { entityError = error; remember(error); }
    remember(nativeError);
    entityError ||= nativeError;
    if (!isCurrent()) throw new Error('Session changed');
    if (!pendingNativeOnly && !pullOnly) {
      try { await syncLearningPreferences(db, options, isCurrent); } catch (error) { entityError ||= error; remember(error); }
      try { await syncCardNotes(db, userId); } catch (error) { remember(error); }
    }
    if (!(pendingNativeOnly && (skipPull || !creates.length && !edits.length && !moves.length && !lifecycle.length))) {
      const hasLegacy = !pendingNativeOnly && !pullOnly && await db.cards.filter(card => !card.content_v2).count();
      for (const cardSchema of hasLegacy ? [1, 2] : [2]) {
        try {
          const pullStartedAt = Date.now();
          const response = await networkApi.get('/sync/v2/pull', { ...options, params: { card_schema: cardSchema } });
          if (response.data?.card_schema !== cardSchema) throw new Error(tr('Сервер не подтвердил формат синхронизации. Очередь сохранена.'));
          if (!isCurrent()) throw new Error('Session changed');
          const applied = await applySnapshot(db, response.data, userId, pullStartedAt, isCurrent);
          if (applied && isCurrent()) notifySyncUi('lerne:synced', { userId, complete: false }, {});
          serverTime = response.data.server_time;
          pullSuccess = true;
        } catch (error) { pullFailed = true; entityError ||= error; remember(error); }
      }
    }
  } catch (error) {
    entityError ||= error;
    remember(error);
  }
  if (!db) return { success: false, native_success: false, reason: tr('Не удалось проверить оставшиеся изменения. Очередь сохранена.') };
  if (!isCurrent()) return { success: false, native_success: false, reason: tr('Сессия изменилась. Очередь сохранена.') };
  try {
    // Reuse the readonly cutover checks: no second definition of "empty queue".
    const pending = await inspectCutoverDatabase(db);
    const storagePending = inspectCutoverStorage(localStorage, userId);
    const devicePending = !(await inspectCardCutover()).pending_free;
    if (!isCurrent()) return { success: false, native_success: false, reason: 'Session changed' };
    const nativePending = pending.blockers['syncState:native_operation'] || pending.blockers['cards:unacknowledged_native_state']
      || pending.blockers['cards:native_dirty'];
    const success = !firstError && pending.pending_free && !Object.keys(storagePending).length && !devicePending;
    const entityPending = Object.keys(pending.blockers).some(key => !['card_notes:dirty', 'knowledge_attempt_outbox:retained'].includes(key));
    const detail = firstError?.response?.data?.detail;
    const reason = detail?.code === 'legacy_revision_conflict'
      ? tr('Старая правка конфликтует с изменениями на сервере. Очередь сохранена.')
      : detail?.code === 'legacy_base_unknown'
        ? tr('У старой правки нет подтверждённой серверной версии. Требуется сверка; очередь сохранена.')
        : firstError?.response?.status === 404 && firstError.config?.url?.startsWith('/sync/v2/')
          ? tr('Сервер ещё не обновлён для безопасной доставки старых изменений. Очередь сохранена.')
          : detail?.code === 'native_card_requires_v2_sync'
            ? tr('Серверная карточка уже имеет формат V2. Старая правка сохранена для сверки.')
            : detail?.code === 'card_revision_conflict'
              ? tr('Есть конфликт карточки V2. Локальная правка и очередь сохранены.')
            : firstError?.response?.status === 422
              ? tr('Сервер отклонил пакет изменений. Проверьте данные; очередь сохранена.')
            : typeof detail === 'string' ? detail : firstError?.message
              || (pending.pending_free && !Object.keys(storagePending).length && devicePending
                ? tr('В старой базе или другом аккаунте этого устройства остались изменения. Данные сохранены; требуется сверка.')
                : pendingReason(pending.blockers, storagePending));
    if (success && !pendingNativeOnly && !pullOnly) {
      localStorage.setItem('lerne_last_sync_time', serverTime || new Date().toISOString());
      localStorage.setItem('lerne_last_sync_user_id', String(userId));
      notifySyncUi('lerne:synced', { userId, complete: true }, {});
    }
    return { success, native_success: !isGenerationConflict(firstError) && !nativeError && !nativePending, pull_success: pullSuccess && !pullFailed,
      entities_success: !entityError && !entityPending,
      scope: pendingNativeOnly ? 'native-content' : pullOnly ? 'pull' : 'device', device_pending: devicePending,
      server_time: serverTime, pending, storage_pending: storagePending, reason: success ? undefined : reason,
      card_notes_pending: !!pending.blockers['card_notes:dirty'], error_code: detail?.code };
  } catch {
    return { success: false, native_success: false, reason: tr('Не удалось проверить оставшиеся изменения. Очередь сохранена.') };
  }
}

function pendingReason(blockers, storage) {
  if (blockers['cards:offline_conflict']) return tr('Есть конфликт карточки V2. Локальная правка и очередь сохранены.');
  if (blockers['syncState:rejected_operation']) return tr('Некоторые операции отклонены сервером. Локальные данные и очередь сохранены.');
  if (blockers['knowledge_attempt_outbox:retained']) return tr('Попытки Knowledge ещё не подтверждены сервером.');
  if (blockers['card_notes:dirty']) return tr('Часть заметок ожидает синхронизации.');
  if (Object.keys(storage).length) return tr('Импорт или настройки ещё не подтверждены сервером.');
  return tr('На устройстве остаются неподтверждённые изменения. Очередь сохранена.');
}
