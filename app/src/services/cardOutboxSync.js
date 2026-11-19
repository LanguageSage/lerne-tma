import { tr } from '../i18n/locale.js';
import { networkApi } from './networkApi.js';
import { getUserId, isRetiredSession } from '../utils/auth.js';
import { cardWriteError } from '../utils/cardDraft.js';
import { isGenerationConflict } from './serverGeneration.js';

// Other tabs receive only invalidation hints. Card data is read from the
// receiving tab's account database, never from a delayed broadcast payload.
const syncChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
  ? new window.BroadcastChannel('lerne-offline-sync') : null;

const assertCurrent = isCurrent => {
  if (!isCurrent()) throw new Error('Session changed');
};
const unconfirmedError = () => new Error(tr('Сервер не подтвердил сохранение изменений'));
const isHexRevision = value => /^[0-9a-f]{64}$/.test(value);
const isRejectedStatus = status => [403, 404, 409, 422].includes(status);

export function subscribeSyncUi(listener) {
  syncChannel?.addEventListener('message', listener);
  return () => syncChannel?.removeEventListener('message', listener);
}

export function notifySyncUi(type, detail, hint) {
  if (type === 'lerne:synced') detail = { complete: false, ...detail };
  window.dispatchEvent(new CustomEvent(type, { detail }));
  if (hint) syncChannel?.postMessage({ type, userId: detail.userId,
    ...(type === 'lerne:synced' && { complete: detail.complete }), ...hint });
}

export function notifyCardEdit(card, userId, confirmed = false, deliveredRequestId) {
  notifySyncUi('lerne:card-edit-changed', { card, userId, confirmed, deliveredRequestId },
    { id: card.id, deliveredRequestId });
}

async function deliverCardCreates(db, operations, options, isCurrent, notify) {
  const userId = options._expectedUserId;
  let firstError;
  for (const operation of operations) {
    assertCurrent(isCurrent);
    const ownsOperation = pending => pending?.tempId === operation.tempId
      && pending?.payload?.request_id === operation.payload.request_id;
    try {
      const { data: card } = await networkApi.post('/cards/save', operation.payload, options);
      if (!Number.isSafeInteger(card?.id) || card.id <= 0 || card.deck_id !== operation.deckId
          || card.content_v2?.schema_version !== 2 || card.content_v2.card?.type !== operation.payload.content_v2.card.type
          || !card.revision) {
        throw unconfirmedError();
      }
      assertCurrent(isCurrent);
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
        assertCurrent(isCurrent);
        return local;
      });
      if (confirmedCard && isCurrent()) {
        notify('lerne:ids-remapped', { mappings, userId, confirmedCard }, { mappings, id: card.id });
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
        assertCurrent(isCurrent);
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
        throw unconfirmedError();
      }
      return card;
    };

    const current = await db.cards.get(cardId);
    assertCurrent(isCurrent);
    if (current?.offline_edit?.requestId !== payload.request_id) continue;
    let edit = current.offline_edit;
    if (edit.status !== 'conflict') {
      try {
        const { data } = await networkApi.patch(path, payload, options);
        const card = validate(data);
        if (card.content_v2.card?.type !== payload.content_v2.card.type) {
          throw unconfirmedError();
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

async function deliverCardMoves(db, operations, options, isCurrent, notify) {
  let firstError;
  let changed = false;
  const userId = options._expectedUserId;
  for (const operation of operations) {
    const { key, payload, copy = false } = operation;
    const localIds = operation.localIds || [operation.cardId];
    const sourceDeckIds = operation.sourceDeckIds || [operation.sourceDeckId];
    assertCurrent(isCurrent);
    let receipt, error;
    const startedAt = Date.now();
    try {
      const { data } = await networkApi.post(copy ? '/cards/batch-copy' : '/cards/batch-move', payload, options);
      const items = copy ? data?.copies : data?.placements;
      const valid = Array.isArray(items) && items.length === payload.card_ids.length && items.every((item, index) => copy
        ? item.source_id === payload.card_ids[index] && (item.card === null || (Number.isSafeInteger(item.card?.id)
          && item.card.id > 0 && (payload.on_duplicate === 'overwrite' || !payload.card_ids.includes(item.card.id))
          && item.card.deck_id === payload.target_deck_id
          && item.card.content_v2?.schema_version === 2 && Number.isInteger(item.card.position) && isHexRevision(item.card?.revision)))
        : item.id === payload.card_ids[index] && [sourceDeckIds[index], payload.target_deck_id].includes(item.deck_id)
          && Number.isInteger(item.position) && isHexRevision(item?.revision));
      if (data?.status !== 'success' || !valid) throw unconfirmedError();
      receipt = data;
    } catch (cause) {
      if (isGenerationConflict(cause)) throw cause;
      error = cause;
    }
    assertCurrent(isCurrent);
    const httpStatus = error?.response?.status;
    const rejected = isRejectedStatus(httpStatus);
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
      assertCurrent(isCurrent);
      return { applied: Boolean(receipt || rejected), remapped };
    });
    if (confirmed && isCurrent()) {
      for (const { tempId, card } of confirmed.remapped) {
        const mappings = { cards: { [tempId]: card.id } };
        notify('lerne:ids-remapped', { mappings, userId, confirmedCard: card, silent: true }, { mappings, id: card.id });
      }
      changed ||= confirmed.applied;
    }
    firstError ||= error;
  }
  if (changed && isCurrent()) notify('lerne:synced', { userId }, {});
  if (firstError) throw firstError;
}

async function deliverCardSelection(db, operation, options, isCurrent, notify) {
  const { key, cardIds, action, payload } = operation;
  let receipt, error;
  try {
    const path = action === 'delete' ? '/cards/batch-delete' : '/cards/reorder';
    const { data } = await networkApi.post(path, payload, options);
    if (data?.status !== 'success' || data.cards?.length !== cardIds.length
        || !data.cards.every((card, index) => card?.id === cardIds[index] && card.content_v2?.schema_version === 2
          && card.is_deleted === (action === 'delete') && Number.isInteger(card.position) && isHexRevision(card.revision))) {
      throw unconfirmedError();
    }
    receipt = data;
  } catch (cause) {
    if (isGenerationConflict(cause)) throw cause;
    error = cause;
  }
  assertCurrent(isCurrent);
  const status = error?.response?.status;
  if (error && !isRejectedStatus(status)) throw error;
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
    assertCurrent(isCurrent);
    return true;
  });
  if (applied && isCurrent()) notify('lerne:synced', { userId: options._expectedUserId }, {});
  if (error) throw error;
}

async function deliverCardLifecycle(db, operations, options, isCurrent, notify) {
  const userId = options._expectedUserId;
  let firstError;
  for (const operation of operations) {
    assertCurrent(isCurrent);
    if (operation.cardIds) {
      try { await deliverCardSelection(db, operation, options, isCurrent, notify); }
      catch (error) { if (isGenerationConflict(error)) throw error; firstError ||= error; }
      continue;
    }
    const { key, cardId, deleting, payload } = operation;
    assertCurrent(isCurrent);
    let server, error;
    const valid = card => card?.id === cardId && card.content_v2?.schema_version === 2
      && typeof card.is_deleted === 'boolean' && isHexRevision(card.revision);
    try {
      const path = deleting ? '/cards/batch-delete' : `/trash/card/${cardId}/restore`;
      const { data } = await networkApi.post(path, payload, options);
      if (data?.status !== 'success' || !valid(data.card) || data.card.is_deleted !== deleting) {
        throw unconfirmedError();
      }
      server = data.card;
    } catch (cause) {
      if (isGenerationConflict(cause)) throw cause;
      error = cause;
      const state = cause.response?.data?.detail?.card;
      if (valid(state)) server = state;
    }
    assertCurrent(isCurrent);
    firstError ||= error;
    const status = error?.response?.status;
    if (error && !isRejectedStatus(status)) continue;
    const applied = await db.transaction('rw', db.cards, db.syncState, async () => {
      const [card, pending] = await Promise.all([db.cards.get(cardId), db.syncState.get(key)]);
      if (!isCurrent() || !card?.offline_lifecycle || pending?.payload.request_id !== payload.request_id) return false;
      const resolvedConflict = status === 409 && server && !card.offline_edit;
      const next = server && !card.offline_edit ? { ...card, ...server } : { ...card };
      next.is_deleted = (error && !resolvedConflict) ? card.is_deleted : server.is_deleted;
      if (server && card.offline_edit) next.offline_edit = { ...card.offline_edit, server };
      if (error && !resolvedConflict) next.offline_list_error = status;
      else { delete next.offline_lifecycle; delete next.offline_list_error; next.offline_confirmed_at = Date.now(); }
      await db.cards.put(next);
      if (error && !resolvedConflict) await db.syncState.update(key, { rejected: true });
      else await db.syncState.delete(key);
      assertCurrent(isCurrent);
      return true;
    });
    if (applied && isCurrent()) {
      notify('lerne:synced', { userId, cardLifecycleRejection: status }, {});
    }
  }
  if (firstError) throw firstError;
}

export async function deliverCardOutbox(db, { creates, edits, moves, lifecycle }, options, isCurrent, notify) {
  let nativeError;
  for (const [deliver, operations] of [
    [deliverCardCreates, creates],
    [deliverCardEdits, edits],
    [deliverCardMoves, moves],
    [deliverCardLifecycle, lifecycle],
  ]) {
    try {
      await deliver(db, operations, options, isCurrent, notify);
    } catch (error) {
      if (isGenerationConflict(error)) throw error;
      nativeError ||= error;
    }
  }
  return nativeError;
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
