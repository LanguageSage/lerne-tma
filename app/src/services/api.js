import axios from 'axios';
import { cardMediaView } from './mediaCache.js';
import { getSessionIdentity, getUserId } from '../utils/auth.js';
import { isOfflineMode, resolveLocalRequest, prepareLocalDb } from './localDb.js';
import { offlineApi } from './offlineApi.js';
import { networkApi as axiosInstance } from './networkApi.js';
import { keepLocalCard, reconcileCardEditLifecycle, syncService } from './syncService.js';
import { tr } from '../i18n/locale.js';

// Проксируем методы Axios для поддержки офлайн-режима и автоматического фоллбека
const api = new Proxy(axiosInstance, {
  get(target, propKey, receiver) {
    if (['get', 'post', 'put', 'delete', 'patch'].includes(propKey)) {
      return async (url, ...args) => {
        if (propKey === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)) {
          args[0] = { ...args[0], action_id: args[0]?.action_id || crypto.randomUUID() };
        }
        const requestIdentity = getSessionIdentity();
        const requestAccount = getUserId();
        const isCurrent = () => requestIdentity === getSessionIdentity() && requestAccount === getUserId();
        const assertCurrent = () => {
          if (!isCurrent()) throw new axios.CanceledError('Session changed');
        };
        const localRequest = async (...params) => {
          assertCurrent();
          const response = await offlineApi.handle(propKey, url, ...params);
          assertCurrent();
          return response;
        };
        if (url.startsWith('/card-notes/')) return localRequest(...args);
        if (propKey === 'patch' && /^\/cards\/\d+$/.test(url) && args[1]?.offlineCardEdit) {
          return localRequest(...args);
        }
        if (propKey === 'post' && ['/cards/batch-move', '/cards/batch-copy'].includes(url) && args[0]?.revisions) {
          const local = await localRequest(...args);
          if (!(local.data.offline_move || local.data.offline_transfer) || !navigator.onLine) return local;
          const db = await prepareLocalDb();
          assertCurrent();
          await syncService.sync({ pendingNativeOnly: true, skipPull: true });
          const cards = await db.transaction('r', db.cards, db.syncState, async () => {
            const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
            return (await db.cards.bulkGet((local.data.cards || [local.data]).map(card => aliases[card.id] ?? card.id))).filter(Boolean);
          });
          assertCurrent();
          if (!local.data.cards) return { data: cards[0] ?? local.data };
          const pending = cards.some(card => card.offline_move);
          const count = cards.filter(card => card.deck_id === args[0].target_deck_id).length;
          return { data: { cards, offline_transfer: pending, count, skipped: args[0].card_ids.length - count } };
        }

        const selection = propKey === 'post' && args[0]?.revisions
          && (url === '/cards/reorder' || (url === '/cards/batch-delete' && args[0]?.card_ids?.length > 1));
        if (selection) {
          const db = await prepareLocalDb();
          const local = await localRequest(...args);
          if (navigator.onLine) await syncService.sync({ pendingNativeOnly: true, skipPull: true });
          const cards = await db.cards.bulkGet(args[0].card_ids);
          assertCurrent();
          return { data: { cards, offline_lifecycle: cards.some(card => card?.offline_lifecycle) ? local.data.offline_lifecycle : undefined } };
        }
        const singleDelete = propKey === 'post' && url === '/cards/batch-delete'
          && args[0]?.card_ids?.length === 1 && args[0].revisions;
        const nativeRestore = propKey === 'post' && /^\/trash\/card\/\d+\/restore$/.test(url) && args[0]?.revision;
        if (singleDelete || nativeRestore) {
          const db = await prepareLocalDb();
          assertCurrent();
          if (singleDelete && navigator.onLine && args[0].card_ids[0] > 0
              && !await db.cards.get(args[0].card_ids[0])) {
            await api.get(`/cards/${args[0].card_ids[0]}`, { freshCard: true });
          }
          const local = await localRequest(...args);
          if (!navigator.onLine) return local;
          await syncService.sync({ pendingNativeOnly: true, skipPull: true });
          const card = await db.cards.get(local.data.id);
          assertCurrent();
          return { data: card ?? local.data };
        }
        if (requestAccount && propKey === 'delete' && url === '/trash/clear') {
          const db = await prepareLocalDb();
          const pending = await db.cards.filter(card => card.offline_lifecycle
            || (card.is_deleted && card.offline_edit)).first();
          assertCurrent();
          if (pending) throw new Error(tr('Сначала завершите синхронизацию удаления или восстановления.'));
        }
        const requestStartedAt = Date.now();
        const nativeCreate = propKey === 'post' && url === '/cards/save' && Object.hasOwn(args[0] ?? {}, 'content_v2');
        const configIndex = ['get', 'delete'].includes(propKey) ? 0 : 1;
        args[configIndex] = {
          _expectedUserId: requestAccount, _expectedSessionIdentity: requestIdentity, ...args[configIndex],
        };
        if (isOfflineMode() || /\/-\d+(?:\/|\?|$)/.test(url) || (nativeCreate && args[0]?.after_card_id < 0)) {
          await prepareLocalDb();
          const resolved = await resolveLocalRequest(url, args[0]);
          url = resolved.url;
          if (configIndex === 1) args[0] = resolved.body;
          if (requestIdentity !== getSessionIdentity() || requestAccount !== getUserId()) {
            throw new axios.CanceledError('Session changed before offline routing');
          }
        }
        const isOfflineEndpoint = 
          url.startsWith('/decks') || 
          url.startsWith('/folders') ||
          url.startsWith('/cards') || 
          url.startsWith('/study') || 
          url.startsWith('/trash') ||
          url.startsWith('/init');

        const cardMatch = propKey === 'get' && url.match(/^\/cards\/(\d+)$/);
        const studyCardMatch = propKey === 'get' && url.match(/^\/study\/card\/(\d+)$/);
        if (requestAccount && (cardMatch || studyCardMatch)) {
          const local = await prepareLocalDb().then(db => db.cards.get(Number((cardMatch || studyCardMatch)[1])))
            .catch(error => { if (cardMatch) throw error; });
          assertCurrent();
          if (local?.offline_lifecycle || (cardMatch && (local?.offline_edit || local?.offline_move))) {
            return localRequest(...args);
          }
        }
        const forceOffline = (!nativeCreate && !(cardMatch && args[0]?.freshCard) && isOfflineMode())
          || !navigator.onLine || /^\/cards\/-\d+$/.test(url);
        const isLibraryRead = propKey === 'get' && /^\/(init|decks|folders)(?:\?|$)/.test(url);

        if (forceOffline && isOfflineEndpoint) {
          try {
            const response = await localRequest(...args);
            // A browser without a downloaded library must not turn a failed
            // network request into an authoritative empty-account response.
            if (isLibraryRead && !isOfflineMode()) {
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (!items?.length) throw new Error('Library unavailable offline');
            }
            return isLibraryRead ? { ...response, dataSource: isOfflineMode() ? 'local' : 'cache' } : response;
          } catch (err) {
            if (err.code !== 'OFFLINE_UNSUPPORTED' || !navigator.onLine) throw err;
          }
        }

        if (nativeCreate && requestAccount && !args[1]?.offlineCreateFlag) {
          // Persist the same operation before the first HTTP attempt when the
          // destination supports offline creation.
          const local = await localRequest(args[0], { offlineCreateIfAvailable: true });
          if (!isCurrent()) throw new axios.CanceledError('Session changed before card delivery');
          if (local) {
            const db = await prepareLocalDb();
            assertCurrent();
            await syncService.sync({ pendingNativeOnly: true, skipPull: true });
            const card = await db.transaction('r', db.cards, db.syncState, async () => {
              const aliases = (await db.syncState.get('aliases'))?.mappings.cards;
              return db.cards.get(aliases?.[local.data.id] ?? local.data.id);
            });
            if (!isCurrent()) throw new axios.CanceledError('Session changed during card delivery');
            return { data: card ?? local.data };
          }
        }

        // Try online server request first
        try {
          const needsRefresh = !nativeCreate && isOfflineMode() && isOfflineEndpoint && propKey !== 'get';
          if (needsRefresh) {
            const synced = await syncService.sync();
            if (!(synced.entities_success ?? synced.success)) throw new Error(synced.reason);
            assertCurrent();
            const resolved = await resolveLocalRequest(url, args[0]);
            url = resolved.url;
            if (configIndex === 1) args[0] = resolved.body;
          }
          const response = await Reflect.get(target, propKey, receiver).call(target, url, ...args);
          assertCurrent();
          if (requestAccount && propKey === 'get' && /^\/decks\/\d+\/next(?:\?|$)/.test(url) && response.data?.id) {
            const local = await prepareLocalDb().then(db => db.cards.get(response.data.id)).catch(() => undefined);
            assertCurrent();
            if (local?.is_deleted && local.offline_lifecycle) return localRequest(...args);
          }
          if (needsRefresh) {
            await syncService.sync();
            assertCurrent();
          }
          const deckMatch = propKey === 'get' && url.match(/^\/decks\/(\d+)\/cards$/);
          const trashRead = propKey === 'get' && url === '/trash';
          if (requestAccount && (isLibraryRead || deckMatch || cardMatch || trashRead)
              && requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
            try {
              const db = await prepareLocalDb();
              if (requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
                if (deckMatch || cardMatch) {
                  const cards = deckMatch ? response.data : [response.data];
                  if (!Array.isArray(cards)) return response;
                  const merged = await db.transaction('rw', db.cards, db.syncState, async () => {
                    const [local, lastSync] = await Promise.all([
                      db.cards.bulkGet(cards.map(card => card.id)), db.syncState.get('lastSync'),
                    ]);
                    if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
                    const visible = await Promise.all(cards.map(async (card, index) => {
                      const cached = local[index];
                      const reconciled = card.content_v2 && reconcileCardEditLifecycle(cached, card, requestStartedAt);
                      if (reconciled) {
                        await db.cards.put(reconciled);
                        return reconciled;
                      }
                      if (keepLocalCard(cached, requestStartedAt)) return cached;
                      return card;
                    }));
                    await db.cards.bulkPut(cards.filter((card, index) => visible[index] === card
                      && card.content_v2?.schema_version === 2 && card.revision
                      && (local[index] ? local[index].content_v2 && !local[index].is_dirty
                        : !(lastSync?.readStartedAt > requestStartedAt)))
                      .map(card => ({ ...card, offline_read_started_at: requestStartedAt, is_dirty: 0 })));
                    if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
                    if (deckMatch) {
                      const deckId = Number(deckMatch[1]);
                      const ids = new Set(cards.map(card => card.id));
                      const pending = await db.cards.where('deck_id').equals(deckId)
                        .filter(card => !ids.has(card.id) && !card.is_deleted && (card.offline_create_status
                          || keepLocalCard(card, requestStartedAt))).toArray();
                      return [...visible.filter((card, index) => !card.is_deleted
                        && (card === cards[index] || card.deck_id === deckId)), ...pending];
                    }
                    return visible[0];
                  });
                  if (isCurrent()) {
                    const data = deckMatch ? merged : await cardMediaView(db, merged);
                    assertCurrent();
                    return { ...response, data };
                  }
                } else if (trashRead && Array.isArray(response.data?.cards)) {
                  const cards = await db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
                    const [lastSync, decks] = await Promise.all([db.syncState.get('lastSync'), db.decks.toArray()]);
                    const ownDecks = new Map(decks.filter(d => d.user_id === requestAccount || d.role === 'owner')
                      .map(d => [d.id, d.name]));
                    const incoming = new Set();
                    const visible = [];
                    for (const server of response.data.cards) {
                      incoming.add(server.id);
                      if (!server.content_v2) {
                        visible.push(server);
                        continue;
                      }
                      const local = await db.cards.get(server.id);
                      const reconciled = reconcileCardEditLifecycle(local, server, requestStartedAt);
                      if (reconciled) await db.cards.put(reconciled);
                      const card = reconciled || (keepLocalCard(local, requestStartedAt) ? local : server);
                      if (card === server && (!local || (local.content_v2 && !local.is_dirty))
                          && !(lastSync?.readStartedAt > requestStartedAt)) {
                        await db.cards.put({ ...server, is_dirty: 0, offline_read_started_at: requestStartedAt });
                      }
                      if (card.is_deleted) visible.push({ ...card, deck_name: server.deck_name });
                    }
                    const pending = await db.cards.filter(card => card.content_v2 && card.is_deleted
                      && !incoming.has(card.id) && ownDecks.has(card.deck_id)
                      && keepLocalCard(card, requestStartedAt)).toArray();
                    assertCurrent();
                    return [...visible, ...pending.map(card => ({ ...card, deck_name: ownDecks.get(card.deck_id) }))];
                  });
                  assertCurrent();
                  return { ...response, data: { ...response.data, cards } };
                } else {
                  const library = url.startsWith('/init') ? response.data
                    : { [url.startsWith('/decks') ? 'decks' : 'folders']: response.data };
                  await db.transaction('rw', db.decks, db.folders, async () => {
                    assertCurrent();
                    for (const name of ['folders', 'decks']) {
                      if (!Array.isArray(library?.[name])) continue;
                      const items = library[name].filter(item => item.id > 0);
                      const existing = await db[name].bulkGet(items.map(item => item.id));
                      await db[name].bulkAdd(items.filter((_item, index) => !existing[index]));
                    }
                    assertCurrent();
                  });
                }
              }
            } catch (error) {
              if (!isCurrent()) throw new axios.CanceledError('Session changed during offline cache update');
              console.warn('Offline library unavailable', error.name);
            }
          }
          if (requestAccount && propKey === 'get' && response.data?.content_v2
              && (studyCardMatch || /^\/decks\/\d+\/next(?:\?|$)/.test(url))) {
            try {
              const db = await prepareLocalDb();
              response.data = await cardMediaView(db, response.data);
            } catch (error) {
              assertCurrent();
              console.warn('Offline media unavailable', error.name);
            }
          }
          if (requestAccount && propKey === 'post' && url === '/media/generate-card-audio') {
            // Re-read through the existing reconciliation path: persist the new
            // revision and paths, without overwriting an unsent local draft.
            const { card_id: id, side = 'front' } = args[0];
            try {
              const fresh = await api.get(`/cards/${id}`, { freshCard: true });
              const field = side === 'back' ? 'audio_back' : 'audio';
              if (fresh.data[`${field}_path`] === response.data.path) {
                response.data.url = fresh.data[`${field}_url`] || response.data.url;
              }
            } catch (error) {
              assertCurrent();
              console.warn('Audio saved; local refresh unavailable', error.name);
            }
          }
          assertCurrent();
          return response;
        } catch (networkErr) {
          // Automatic fallback to local Dexie DB when network is disconnected or server unavailable
          const isNetworkFailure = 
            !navigator?.onLine || 
            networkErr.code === 'ERR_NETWORK' || 
            !networkErr.response || 
            networkErr.message?.includes('Network Error');

          if (isNetworkFailure && (requestIdentity !== getSessionIdentity() || requestAccount !== getUserId())) {
            throw new axios.CanceledError('Session changed before offline fallback');
          }

          if (isOfflineEndpoint && isNetworkFailure && !axios.isCancel(networkErr)) {
            console.log(`[Network Unavailable] Falling back to local offline DB for ${propKey.toUpperCase()} ${url}`);
            try {
              const response = await localRequest(...args);
              const items = url.startsWith('/init') ? [...(response.data?.decks || []), ...(response.data?.folders || [])] : response.data;
              if (isLibraryRead && !items?.length) throw networkErr;
              return isLibraryRead ? { ...response, dataSource: 'cache' } : response;
            } catch (localError) {
              if (nativeCreate) throw localError;
              console.warn('Offline fallback unavailable', { method: propKey.toUpperCase() });
            }
          }
          throw networkErr;
        }
      };
    }
    return Reflect.get(target, propKey, receiver);
  },
  
  apply(target, thisArg, argumentsList) {
    return Reflect.apply(target, thisArg, argumentsList);
  }
});

export default api;
export { axiosInstance as networkApi };
