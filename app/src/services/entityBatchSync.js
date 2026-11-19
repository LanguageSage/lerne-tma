import { tr } from '../i18n/locale.js';
import { networkApi } from './networkApi.js';
import { getUserId } from '../utils/auth.js';
import { inspectCardCutover } from './cardCutoverPreflight.js';

export const entities = ['folders', 'decks', 'cards', 'progress'];
export const keyFor = (name, item, userId) => name === 'progress' ? [item.card_id, userId] : item.id;
const revision = item => item.local_revision || item.updated_at;
const remap = (map, id) => map?.[String(id)] ?? id;

export async function hasPendingEntityChanges(db, userId) {
  const pending = await Promise.all([
    db.syncState.get('pending'),
    db.syncState.where('key').startsWith('review:').first(),
    db.folders.where('is_dirty').equals(1).first(),
    db.decks.where('is_dirty').equals(1).first(),
    db.cards.where('is_dirty').equals(1).filter(card => !card.content_v2).first(),
    db.progress.where('is_dirty').equals(1).filter(item => String(item.user_id) === String(userId)).first(),
  ]);
  return pending.some(Boolean);
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

export async function syncLearningPreferences(db, options, isCurrent) {
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

export async function deliverEntityBatch(db, userId, options, isCurrent, notifySyncUi) {
  // Historical import copied entities, not the old receipt UUID/reviews.
  // Never submit such copies under a fresh UUID while their source is
  // unresolved: the original request may already be committed remotely.
  const device = await inspectCardCutover();
  if (device.errors.length || device.databases.some(item => item.name === 'LerneLocalDB' && !item.pending_free)) {
    throw new Error(tr('В старой локальной базе есть непроверенные изменения. Нужна сверка исходной очереди; данные сохранены.'));
  }
  const batch = await pendingBatch(db, userId);
  if (!batch) return;
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
  // Native snapshots (not UUID review events) also require their server
  // base. In particular an offline reset must not erase a peer's grade.
  payload.drain_bases ??= {};
  for (const item of batch.progress || []) {
    if (item.sync_base && Object.hasOwn(item.sync_base, 'updated_at')) {
      payload.drain_bases[`progress:${item.card_id}`] = item.sync_base.updated_at;
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
  if (acknowledged) return { contentChanged: ['cards', 'decks', 'folders'].some(name => batch[name]?.length) };
}
