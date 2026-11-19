import axios from 'axios';
import { cardMediaView } from './mediaCache.js';
import { getSessionIdentity, getUserId } from '../utils/auth.js';
import { prepareLocalDb } from './localDb.js';
import { keepLocalCard, reconcileCardEditLifecycle, syncService } from './syncService.js';
import { mergeStudyProgress } from '../utils/structuredStudyCard.js';
import { tr } from '../i18n/locale.js';

export async function handleLocalFirstRequest({
  propKey,
  url,
  args,
  requestAccount,
  assertCurrent,
  localRequest,
  fetchFreshCard,
}) {
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
      await fetchFreshCard(args[0].card_ids[0]);
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

  return null;
}

export async function tryLocalFirstNativeCreate({
  nativeCreate,
  requestAccount,
  args,
  isCurrent,
  assertCurrent,
  localRequest,
}) {
  if (!nativeCreate || !requestAccount || args[1]?.offlineCreateFlag) return null;
  // Persist the same operation before the first HTTP attempt when the
  // destination supports offline creation.
  const local = await localRequest(args[0], { offlineCreateIfAvailable: true });
  if (!isCurrent()) throw new axios.CanceledError('Session changed before card delivery');
  if (!local) return null;
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

export async function reconcileOnlineResponse({
  propKey,
  url,
  args,
  response,
  requestAccount,
  requestIdentity,
  requestStartedAt,
  isLibraryRead,
  cardMatch,
  studyCardMatch,
  isCurrent,
  assertCurrent,
  localRequest,
  fetchFreshCard,
}) {
  const studyNextMatch = propKey === 'get' && response.data?.content_v2 && response.data?.id
    ? url.match(/^\/decks\/(\d+)\/next(?:\?|$)/) : null;
  const studyNext = Boolean(studyNextMatch);
  const studyNextDeckId = studyNextMatch ? Number(studyNextMatch[1]) : null;
  const studyCardRead = Boolean(studyCardMatch && response.data?.content_v2 && response.data?.id);
  const studyGrade = propKey === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)
    && Number(response.data?.graded_progress?.id) > 0;
  const deckMatch = propKey === 'get' && url.match(/^\/decks\/(\d+)\/cards$/);
  const trashRead = propKey === 'get' && url === '/trash';

  if (requestAccount && (isLibraryRead || deckMatch || cardMatch || studyNext || studyCardRead || studyGrade || trashRead)
      && requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
    try {
      const db = await prepareLocalDb();
      if (requestIdentity === getSessionIdentity() && requestAccount === getUserId()) {
        if (studyGrade) {
          const graded = response.data.graded_progress;
          const gradedId = Number(graded.id);
          const patch = {
            ...graded,
            _studyProgressAt: Date.now(),
            _studyProgressStartedAt: requestStartedAt,
          };
          await db.transaction('rw', db.cards, db.progress, async () => {
            const [existingCard, progressRows] = await Promise.all([
              db.cards.get(gradedId),
              db.progress.where('card_id').equals(gradedId).toArray(),
            ]);
            if (!isCurrent()) throw new axios.CanceledError('Session changed during grade progress update');
            if (existingCard) {
              const mergedCard = mergeStudyProgress(existingCard, patch);
              if (mergedCard === existingCard) return;
              await db.cards.put(mergedCard);
            }
            for (const row of progressRows) {
              if (String(row.user_id) === String(requestAccount) && !row.is_dirty) {
                const mergedProgress = mergeStudyProgress(row, patch);
                if (mergedProgress !== row) {
                  await db.progress.put({
                    ...row,
                    queue: mergedProgress.queue,
                    interval: mergedProgress.interval,
                    ease_factor: mergedProgress.ease_factor,
                    repetitions: mergedProgress.repetitions,
                    lapses: mergedProgress.lapses,
                    step_index: mergedProgress.step_index,
                    flag: mergedProgress.flag ?? row.flag ?? 0,
                    next_review: mergedProgress.next_review,
                    last_reviewed: mergedProgress.last_reviewed,
                    is_dirty: 0,
                  });
                }
              }
            }
          });
        }
        if (deckMatch || cardMatch || studyNext || studyCardRead) {
          const cards = deckMatch ? response.data : [response.data];
          if (!Array.isArray(cards)) return response;
          const deckId = deckMatch ? Number(deckMatch[1]) : null;
          const merged = await db.transaction('rw', db.cards, db.syncState, async () => {
            const [local, lastSync, existingDeckCards] = await Promise.all([
              db.cards.bulkGet(cards.map(card => card.id)),
              db.syncState.get('lastSync'),
              deckMatch ? db.cards.where('deck_id').equals(deckId).toArray() : [],
            ]);
            if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
            const reconciledCards = [];
            const reconciledSet = new Set();
            const visible = cards.map((card, index) => {
              const cached = local[index];
              const reconciled = card.content_v2 && reconcileCardEditLifecycle(cached, card, requestStartedAt);
              if (reconciled) {
                reconciledCards.push(reconciled);
                reconciledSet.add(reconciled);
                return reconciled;
              }
              if (keepLocalCard(cached, requestStartedAt)) return cached;
              return cached ? mergeStudyProgress({ ...card, _studyRequestStartedAt: requestStartedAt }, cached) : card;
            });
            if (reconciledCards.length) await db.cards.bulkPut(reconciledCards);
            const written = visible.filter((card, index) => card !== local[index] && !reconciledSet.has(card)
              && cards[index].content_v2?.schema_version === 2 && cards[index].revision
              && (local[index] ? local[index].content_v2 && !local[index].is_dirty
                : !(lastSync?.readStartedAt > requestStartedAt)))
              .map(card => ({ ...card, offline_read_started_at: requestStartedAt, is_dirty: 0 }));
            if (written.length) await db.cards.bulkPut(written);
            if (!isCurrent()) throw new axios.CanceledError('Session changed during card read');
            if (deckMatch) {
              await db.syncState.put({ key: `deck-cards:${deckId}`, complete: true, fetched_at: requestStartedAt });
              const ids = new Set(cards.map(card => card.id));
              const pending = existingDeckCards.filter(card => !ids.has(card.id) && !card.is_deleted
                && (card.offline_create_status || keepLocalCard(card, requestStartedAt)));
              return [...visible.filter((card, index) => !card.is_deleted
                && (card === cards[index] || card.deck_id === deckId)), ...pending];
            }
            const partialDeckIds = [...new Set(written
              .filter(card => card.deck_id > 0 && (!lastSync || !local[cards.findIndex(c => c.id === card.id)]))
              .map(card => card.deck_id))];
            for (const partialDeckId of partialDeckIds) {
              const existing = await db.syncState.get(`deck-cards:${partialDeckId}`);
              const uncached = !local[cards.findIndex(c => c.deck_id === partialDeckId)];
              if (!existing?.complete || uncached) {
                await db.syncState.put({ key: `deck-cards:${partialDeckId}`, complete: false, fetched_at: requestStartedAt });
              }
            }
            return visible[0];
          });
          if (isCurrent()) {
            if ((studyNext || studyCardRead) && (merged?.is_deleted || (studyNext && merged !== response.data && Number(merged?.deck_id) !== studyNextDeckId))) {
              return localRequest(...args);
            }
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
        } else if (isLibraryRead) {
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
      if (studyNext) {
        if (error && typeof error === 'object') error.skipOfflineFallback = true;
        throw error;
      }
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
      const fresh = await fetchFreshCard(id);
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
}
