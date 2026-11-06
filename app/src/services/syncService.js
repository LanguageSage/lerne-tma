import { tr } from '../i18n/locale.js';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, prepareLocalDb } from './localDb.js';
import { networkApi } from './networkApi.js';
import { getAccessToken, getSessionIdentity, getUserId } from '../utils/auth.js';
import { syncCardNotes } from './cardNotes.js';

const entities = ['folders', 'decks', 'cards', 'progress'];
const keyFor = (name, item, userId) => name === 'progress' ? [item.card_id, userId] : item.id;
const revision = item => item.local_revision || item.updated_at;
const remap = (map, id) => map?.[String(id)] ?? id;

export function notifyCardEdit(card, userId, confirmed = false) {
  window.dispatchEvent(new CustomEvent('lerne:card-edit-changed', { detail: { card, userId, confirmed } }));
}

async function deliverCardCreates(db, operations, userId, isCurrent) {
  let firstError;
  for (const operation of operations) {
    if (!isCurrent()) throw new Error('Session changed');
    try {
      const { data: card } = await networkApi.post('/cards/save', operation.payload, { _expectedUserId: userId });
      if (!Number.isSafeInteger(card?.id) || card.id <= 0 || card.deck_id !== operation.deckId
          || card.content_v2?.schema_version !== 2 || card.content_v2.card?.type !== 'standard' || !card.revision) {
        throw new Error(tr("Сервер не подтвердил сохранение изменений"));
      }
      if (!isCurrent()) throw new Error('Session changed');
      const mappings = { cards: { [operation.tempId]: card.id } };
      const acknowledged = await db.transaction('rw', db.cards, db.syncState, async () => {
        if (!await db.syncState.get(operation.key)) return false;
        const existing = await db.cards.get(card.id);
        if (existing && !existing.content_v2) throw new Error(tr('Серверный ID занят локальной карточкой V1.'));
        const aliases = (await db.syncState.get('aliases'))?.mappings || {};
        aliases.cards = { ...aliases.cards, ...mappings.cards };
        await db.cards.put({ ...card, is_dirty: 0, offline_confirmed_at: Date.now() });
        await db.cards.delete(operation.tempId);
        await db.syncState.put({ key: 'aliases', mappings: aliases });
        await db.syncState.delete(operation.key);
        return true;
      });
      if (acknowledged && isCurrent()) {
        window.dispatchEvent(new CustomEvent('lerne:ids-remapped', { detail: { mappings, userId, confirmedCard: card } }));
      }
    } catch (error) {
      if (!isCurrent()) throw error;
      const updated = await db.transaction('rw', db.cards, db.syncState, async () => {
        if (!await db.syncState.get(operation.key)) return false;
        return db.cards.update(operation.tempId, { offline_create_status: 'error' });
      });
      if (updated && isCurrent()) {
        window.dispatchEvent(new CustomEvent('lerne:card-create-error', { detail: { userId, id: operation.tempId } }));
      }
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}

async function deliverCardEdits(db, operations, userId, isCurrent) {
  let firstError;
  const options = { _expectedUserId: userId };
  for (const operation of operations) {
    const { cardId, key, payload } = operation;
    const path = `/cards/${cardId}`;
    const update = async (change, { confirmed = false, status } = {}) => {
      const ownsResponse = () => isCurrent()
        || (status === 401 && getUserId() === userId && getSessionIdentity() === null);
      if (!ownsResponse()) throw new Error('Session changed');
      const card = await db.transaction('rw', db.cards, db.syncState, async () => {
        const current = await db.cards.get(cardId);
        if (!ownsResponse() || current?.offline_edit?.requestId !== payload.request_id
            || (await db.syncState.get(key))?.payload.request_id !== payload.request_id) return;
        const next = change(current);
        await db.cards.put(next);
        if (confirmed) await db.syncState.delete(key);
        return next;
      });
      if (card && ownsResponse()) notifyCardEdit(card, userId, confirmed);
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
        if (card.content_v2.card?.type !== 'standard') throw new Error(tr('Сервер не подтвердил сохранение изменений'));
        await update(() => ({ ...card, is_dirty: 0, offline_confirmed_at: Date.now() }), { confirmed: true });
        continue;
      } catch (error) {
        const status = error.response?.status;
        if (status === 409 && error.response?.data?.detail?.code === 'card_revision_conflict') {
          // Persist rejection before fetching the remote side. A failed GET cannot cause a second PATCH.
          edit = (await update(card => ({ ...card, offline_edit: { requestId: edit.requestId, status: 'conflict' } })))?.offline_edit;
        } else {
          await update(card => ({ ...card, offline_edit: { ...card.offline_edit, status: 'error', httpStatus: status } }), { status });
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
        const status = error.response?.status;
        await update(card => ({ ...card, offline_edit: { ...card.offline_edit, httpStatus: status } }), { status });
        firstError ||= error;
      }
    }
  }
  if (firstError) throw firstError;
}

async function pendingBatch(db, userId) {
  return db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    const nativeIds = new Set((await db.cards.filter(card => card.id > 0 && !!card.content_v2).toArray()).map(card => card.id));
    const nativeProgress = item => nativeIds.has(item.card_id);
    const pending = await db.syncState.get('pending');
    if (pending) {
      // An existing V1 batch is immutable. Leave it intact, even if it also
      // contains non-card changes, and let native creates sync independently.
      if (pending.cards?.length || ![...pending.progress, ...(pending.reviews || [])].every(nativeProgress)) return null;
      return pending;
    }
    const batch = { key: 'pending', request_id: crypto.randomUUID(), userId, cards: [] };
    for (const name of ['folders', 'decks']) {
      batch[name] = await db[name].where('is_dirty').equals(1)
        .filter(item => item.role !== 'viewer' && (!item.is_global_readonly || ['owner', 'editor'].includes(item.role))).toArray();
    }
    batch.progress = await db.progress.where('is_dirty').equals(1).filter(nativeProgress).toArray();
    batch.reviews = await db.syncState.filter(item => item.key.startsWith('review:') && nativeProgress(item)).toArray();
    // Upgrade unsent legacy events using their already durable UUID. An existing
    // pending batch above remains byte-for-byte compatible with its receipt.
    for (const event of batch.reviews) {
      if (!event.action_id) {
        event.action_id = event.key.slice('review:'.length);
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
    payload[name] = batch[name].map(item => {
      const copy = { ...item };
      for (const key of ['metadata', 'tags']) {
        if (copy[key] != null && typeof copy[key] !== 'string') copy[key] = JSON.stringify(copy[key]);
      }
      return copy;
    });
  }
  return payload;
}

async function acknowledge(db, batch, mappings) {
  const userId = batch.userId;
  await db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    for (const name of entities) {
      for (const sent of batch[name]) {
        const key = keyFor(name, sent, userId);
        const current = await db[name].get(key);
        if (!current) continue;
        const isUnchanged = revision(current) === revision(sent);
        const mapped = name === 'progress'
          ? { ...current, card_id: remap(mappings.cards, current.card_id) }
          : { ...current, id: remap(mappings[name], current.id) };
        if (isUnchanged) mapped.is_dirty = 0;
        await db[name].delete(key);
        await db[name].put(mapped);
      }
    }
    // Include children created while the request was in flight.
    await db.folders.toCollection().modify(f => { f.parent_id = remap(mappings.folders, f.parent_id); });
    await db.decks.toCollection().modify(d => { d.folder_id = remap(mappings.folders, d.folder_id); });
    await db.cards.filter(c => !!c.content_v2).modify(c => { c.deck_id = remap(mappings.decks, c.deck_id); });
    for (const p of await db.progress.toArray()) {
      const id = remap(mappings.cards, p.card_id);
      if (id !== p.card_id) {
        await db.progress.delete([p.card_id, p.user_id]);
        await db.progress.put({ ...p, card_id: id });
      }
    }
    for (const sent of batch.reviews || []) await db.syncState.delete(sent.key);
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
  });
}

async function syncLearningPreferences(db, options) {
  for (const deck of await db.decks.filter(d => d.learning_dirty && d.id > 0).toArray()) {
    await networkApi.post(`/decks/${deck.id}/toggle-learning`, { is_learning: !!deck.is_learning }, options);
    const current = await db.decks.get(deck.id);
    if (current?.is_learning === deck.is_learning) {
      await db.decks.update(deck.id, { learning_dirty: 0 });
    }
  }
}

async function applySnapshot(db, data, userId, pullStartedAt) {
  if (data.status !== 'success' || data.card_schema !== 2 || !entities.every(name => Array.isArray(data[name]))
      || data.cards.some(card => card.content_v2?.schema_version !== 2)) {
    throw new Error(tr("Некорректный ответ синхронизации"));
  }
  await db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    const localCards = await db.cards.toArray();
    const legacyIds = new Set(localCards.filter(card => !card.content_v2).map(card => card.id));
    const nativeIds = new Set([...localCards.filter(card => card.content_v2), ...data.cards].map(card => card.id));
    for (const name of entities) {
      const incoming = new Set(data[name].map(item => name === 'progress' ? item.card_id : item.id));
      for (const item of data[name]) {
        const key = keyFor(name, item, userId);
        const local = await db[name].get(key);
        if (local?.is_dirty || (name === 'decks' && local?.learning_dirty)
            || (name === 'cards' && (legacyIds.has(item.id) || local?.offline_edit || local?.offline_confirmed_at >= pullStartedAt))
            || (name === 'progress' && legacyIds.has(item.card_id))) continue;
        await db[name].put({ ...item, ...(name === 'progress' ? { user_id: userId } : {}), is_dirty: 0 });
      }
      // A full snapshot also carries hard deletions and revoked access.
      for (const item of name === 'cards' ? localCards : await db[name].toArray()) {
        const id = name === 'progress' ? item.card_id : item.id;
        if ((name === 'cards' && (legacyIds.has(id) || item.offline_edit || item.offline_confirmed_at >= pullStartedAt))
            || (name === 'progress' && (legacyIds.has(id) || !nativeIds.has(id)))) continue;
        if (id > 0 && !item.is_dirty && !(name === 'decks' && item.learning_dirty) && !incoming.has(id)) await db[name].delete(keyFor(name, item, userId));
      }
    }
    await db.syncState.put({ key: 'lastSync', time: data.server_time });
  });
}

export const syncService = {
  isSyncing: false,
  async sync(options) {
    if (navigator.locks) {
      return navigator.locks.request('lerne-offline-sync', { ifAvailable: true }, lock =>
        lock ? this.runSync(options) : { success: false, reason: 'Already syncing' });
    }
    return this.runSync(options);
  },
  async runSync({ pendingNativeOnly = false } = {}) {
    if (this.isSyncing) return { success: false, reason: 'Already syncing' };
    if (!navigator.onLine) return { success: false, reason: tr("Нет подключения к интернету") };
    if (!getAccessToken() || !getUserId()) return { success: false, reason: tr("Требуется вход") };
    this.isSyncing = true;
    const userId = getUserId();
    const identity = getSessionIdentity();
    const isCurrent = () => getUserId() === userId && getSessionIdentity() === identity;
    const options = { _expectedUserId: userId };
    try {
      const db = await prepareLocalDb();
      if (!isCurrent()) throw new Error('Session changed');
      const creates = await db.syncState.where('key').startsWith(CARD_CREATE_KEY).toArray();
      const queuedEdits = await db.syncState.where('key').startsWith(CARD_EDIT_KEY).toArray();
      const editCards = await db.cards.bulkGet(queuedEdits.map(edit => edit.cardId));
      const edits = queuedEdits.filter((_edit, index) => {
        const edit = editCards[index]?.offline_edit;
        return edit && (edit.status !== 'conflict' || !edit.server);
      });
      if (pendingNativeOnly && !creates.length && !edits.length) return { success: true };
      let nativeError;
      try { await deliverCardCreates(db, creates, userId, isCurrent); }
      catch (error) { nativeError = error; }
      try { await deliverCardEdits(db, edits, userId, isCurrent); }
      catch (error) { nativeError ||= error; }
      if (!isCurrent()) throw new Error('Session changed');
      const batch = pendingNativeOnly ? null : await pendingBatch(db, userId);
      if (batch) {
        const response = await networkApi.post('/sync/v2/push', payloadFor(batch), options);
        if (response.data?.status !== 'success' || !response.data.mappings) throw new Error(tr("Сервер не подтвердил сохранение изменений"));
        if (batch.reviews?.length && response.data.review_count !== batch.reviews.length) {
          throw new Error(tr("Сервер не подтвердил сохранение оценок. Обновите сервер синхронизации."));
        }
        const mappings = response.data.mappings;
        for (const name of ['folders', 'decks', 'cards']) {
          for (const item of batch[name].filter(item => item.id < 0)) {
            if (!(mappings[name]?.[String(item.id)] > 0)) throw new Error(tr("Сервер не вернул идентификатор новой записи"));
          }
        }
        if (!isCurrent()) throw new Error('Session changed');
        await acknowledge(db, batch, mappings);
        if (isCurrent()) window.dispatchEvent(new CustomEvent('lerne:ids-remapped', { detail: { mappings, userId } }));
      }
      if (nativeError) throw nativeError;
      if (!pendingNativeOnly) await syncLearningPreferences(db, options);
      const pullStartedAt = Date.now();
      const response = await networkApi.get('/sync/v2/pull', { ...options, params: { card_schema: 2 } });
      if (!isCurrent()) throw new Error('Session changed');
      await applySnapshot(db, response.data, userId, pullStartedAt);
      let notesPending = false;
      try { if (!pendingNativeOnly) await syncCardNotes(db, userId); }
      catch { notesPending = true; } // Keep annotation errors separate from committed cards/reviews.
      if (isCurrent()) {
        localStorage.setItem('lerne_last_sync_time', response.data.server_time);
        localStorage.setItem('lerne_last_sync_user_id', String(userId));
        window.dispatchEvent(new CustomEvent('lerne:synced', { detail: { userId } }));
      }
      return { success: true, server_time: response.data.server_time, card_notes_pending: notesPending };
    } catch (error) {
      const reason = error.response?.status === 404
        ? tr("Сервер ещё не обновлён для офлайн-синхронизации. Данные сохранены на устройстве.")
        : error.response?.data?.detail || error.message;
      console.warn('[Sync]', reason);
      return { success: false, reason };
    } finally {
      this.isSyncing = false;
    }
  },
};
