import { tr } from '../i18n/locale.js';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, CARD_LIFECYCLE_KEY, CARD_MOVE_KEY, prepareLocalDb } from './localDb.js';
import { networkApi } from './networkApi.js';
import { getAccessToken, getSessionIdentity, getUserId } from '../utils/auth.js';
import { syncCardNotes } from './cardNotes.js';
import { inspectCardCutover, inspectCutoverDatabase, inspectCutoverStorage } from './cardCutoverPreflight.js';
import { observeServerGeneration, generationError, isGenerationConflict } from './serverGeneration.js';
import { entities, keyFor, deliverEntityBatch, syncLearningPreferences } from './entityBatchSync.js';
import {
  subscribeSyncUi,
  notifySyncUi,
  notifyCardEdit,
  keepLocalCard,
  reconcileCardEditLifecycle,
  deliverCardOutbox,
} from './cardOutboxSync.js';

export { subscribeSyncUi, notifyCardEdit, keepLocalCard, reconcileCardEditLifecycle };

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && Object.is(left.getTime(), right.getTime());
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

function sameSnapshotRecord(name, local, next) {
  if (!local || (name === 'cards' && !(typeof local.offline_read_started_at === 'number' && Number.isFinite(local.offline_read_started_at)))) {
    return false;
  }
  const nextKeys = Object.keys(next);
  if (Object.keys(local).length !== nextKeys.length) return false;
  return nextKeys.every(key => Object.prototype.hasOwnProperty.call(local, key)
    && ((name === 'cards' && key === 'offline_read_started_at') || sameValue(local[key], next[key])));
}

async function applySnapshot(db, data, userId, pullStartedAt, isCurrent) {
  if (data.server_generation) await observeServerGeneration(db, data, isCurrent);
  if (await db.syncState.get('serverGenerationConflict')) throw generationError();
  if (data.status !== 'success' || data.card_schema !== 2 || !entities.every(name => Array.isArray(data[name]))
      || data.cards.some(card => card.content_v2?.schema_version !== 2)) {
    throw new Error(tr("Некорректный ответ синхронизации"));
  }
  return db.transaction('rw', [...entities.map(name => db[name]), db.syncState], async () => {
    if (!isCurrent()) throw new Error('Session changed');
    const [lastSync, ...localTables] = await Promise.all([
      db.syncState.get('lastSync'),
      ...entities.map(name => db[name].toArray()),
    ]);
    if (Date.parse(lastSync?.time) > Date.parse(data.server_time)) return false;
    const localCards = localTables[entities.indexOf('cards')];
    const otherIds = new Set(localCards.filter(card => !card.content_v2).map(card => card.id));
    const scopeIds = new Set([...localCards.filter(card => !!card.content_v2),
      ...data.cards].map(card => card.id));
    for (const [index, name] of entities.entries()) {
      const localRows = localTables[index];
      const localMap = name === 'progress'
        ? new Map(localRows.filter(row => Object.is(row.user_id, userId)).map(row => [row.card_id, row]))
        : new Map(localRows.map(row => [row.id, row]));
      const incoming = new Set(data[name].map(item => name === 'progress' ? item.card_id : item.id));
      const toPut = [];
      const toDelete = [];
      for (const item of data[name]) {
        const local = localMap.get(name === 'progress' ? item.card_id : item.id);
        if (name === 'cards' && local?.offline_edit) {
          const reconciled = reconcileCardEditLifecycle(local, item, pullStartedAt);
          if (reconciled) toPut.push(reconciled);
          continue;
        }
        if (local?.is_dirty || (name === 'decks' && local?.learning_dirty)
            || (name === 'cards' && (otherIds.has(item.id) || keepLocalCard(local, pullStartedAt)))
            || (name === 'progress' && otherIds.has(item.card_id))) continue;
        const next = { ...item,
          ...(name === 'cards' && { offline_read_started_at: pullStartedAt }),
          ...(name === 'progress' && { user_id: userId }), is_dirty: 0 };
        if (!sameSnapshotRecord(name, local, next)) toPut.push(next);
      }
      // A full snapshot also carries hard deletions and revoked access.
      for (const item of localRows) {
        const id = name === 'progress' ? item.card_id : item.id;
        if ((name === 'cards' && (otherIds.has(id) || keepLocalCard(item, pullStartedAt)))
            || (name === 'progress' && (otherIds.has(id) || !scopeIds.has(id)))) continue;
        if (id > 0 && !item.is_dirty && !(name === 'decks' && item.learning_dirty) && !incoming.has(id)) {
          toDelete.push(keyFor(name, item, userId));
        }
      }
      if (toPut.length) await db[name].bulkPut(toPut);
      if (toDelete.length) await db[name].bulkDelete(toDelete);
    }
    await db.syncState.where('key').startsWith('deck-cards:').delete();
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
  let notifiedSnapshot = false;
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
    nativeError = await deliverCardOutbox(db, { creates, edits, moves, lifecycle }, options, isCurrent);
    if (!isCurrent()) throw new Error('Session changed');
    try {
      if (!pendingNativeOnly && !pullOnly) {
        await deliverEntityBatch(db, userId, options, isCurrent, notifySyncUi);
      }
    } catch (error) { entityError = error; remember(error); }
    remember(nativeError);
    entityError ||= nativeError;
    if (!isCurrent()) throw new Error('Session changed');
    if (!pendingNativeOnly && !pullOnly) {
      try { await syncLearningPreferences(db, options, isCurrent); } catch (error) { entityError ||= error; remember(error); }
      try { await syncCardNotes(db, userId); } catch (error) { remember(error); }
    }
    // A committed creation with a lost acknowledgement has two IDs until its UUID receipt is replayed.
    // Do not discover the server copy through pull before that remap commits.
    const unacknowledgedCreates = !pullOnly && await db.syncState.where('key').startsWith(CARD_CREATE_KEY).filter(item => !item.rejected).count();
    if (!unacknowledgedCreates && !(pendingNativeOnly && (skipPull || !creates.length && !edits.length && !moves.length && !lifecycle.length))) {
      for (const cardSchema of [2]) {
        try {
          const pullStartedAt = Date.now();
          const response = await networkApi.get('/sync/v2/pull', { ...options, params: { card_schema: cardSchema } });
          if (response.data?.card_schema !== cardSchema) throw new Error(tr('Сервер не подтвердил формат синхронизации. Очередь сохранена.'));
          if (!isCurrent()) throw new Error('Session changed');
          const applied = await applySnapshot(db, response.data, userId, pullStartedAt, isCurrent);
          if (applied && isCurrent()) {
            notifiedSnapshot = true;
            notifySyncUi('lerne:synced', { userId, complete: false }, {});
          }
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
    const devicePending = !(await inspectCardCutover({ precomputed: new Map([[db.name, pending]]) })).pending_free;
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
      notifySyncUi('lerne:synced', { userId, complete: true, alreadyRefreshed: notifiedSnapshot }, {});
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
