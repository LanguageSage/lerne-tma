import { tr } from '../i18n/locale';
import { getLocalDb, prepareLocalDb, getNextTempId } from './localDb';
import { calculateCardReview, getNextIntervals, isLeech } from '../utils/srsEngine';
import { getUserId, getUserProfile, getSessionIdentity } from '../utils/auth';
import { cardMediaView, localMediaURL } from './mediaCache';
import { emptyStudyProgress } from '../utils/structuredStudyCard.js';
import { cardDuplicateKey, matchFolder, matchDeck, matchCard, getScopedFolders, getScopedDecks } from '../utils/search';
import { writeCardNote } from './cardNotes.js';
import { isBundledSeedDeck } from '../utils/deckUtils.js';
import { buildOriginKey, getMaterialExportSourceInTx } from '../pilot/materialArchiveIdentity.js';
import { isOfflineMediaUrl, parseOfflineMediaRef } from '../pilot/offlineMediaResolver.js';
import {
  result,
  notFound,
  readOnly,
  pendingCreate,
  unsupported,
  isStandaloneDb,
  isContentReadOnly,
  isOwnedRecord,
  collectSubtreeFolderIds,
  assertParentActiveForRestore,
  isCardDeckActiveInCache,
  buildFolderMap,
  isFolderActiveInCache,
  isFolderParentReadyForRestore,
  isDeckActiveInCache,
  loadFolderMap,
  requireContentWrite,
  allocatePositiveLocalId,
  clearTrashInDb,
  saveNativeCard,
  queueCardMove,
  queueCardLifecycle,
  queueCardSelection,
  saveNativeEdit,
} from './cardOfflineQueue.js';

export { resolveCardEdit } from './cardOfflineQueue.js';

export const STANDALONE_MAX_GRADE_RECEIPTS = 64;
let standaloneGradeSeq = 0;

export const dirtyFields = previous => ({
  is_dirty: 1, local_revision: crypto.randomUUID(), updated_at: new Date().toISOString(),
  ...(previous && !previous.is_dirty && Object.hasOwn(previous, 'updated_at')
    ? { sync_base: { updated_at: previous.updated_at } } : {}),
});
const localDirtyFields = (db, previous) => (
  isStandaloneDb(db)
    ? { is_dirty: 0, updated_at: new Date().toISOString() }
    : dirtyFields(previous)
);
const ordered = (items) => items.sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
const jsonObject = (value, fallback = {}) => {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const success = (data = {}) => result({ status: 'success', ...data });
const incompleteCache = () => { throw new Error(tr('Полный список карточек колоды ещё не загружен на устройство. Подключитесь к сети и повторите попытку.')); };
const initialProgress = (card, userId) => ({
  card_id: card.id, user_id: userId, queue: card.queue || 'new', interval: card.interval ?? 0,
  ease_factor: card.ease_factor || 2.5, repetitions: card.repetitions ?? 0, lapses: card.lapses ?? 0,
  step_index: card.step_index ?? 0, next_review: card.next_review ?? null, last_reviewed: card.last_reviewed ?? null,
  // Older caches stored personal fields on the card; retain them on first review.
  flag: card.flag ?? 0, want_to_learn: card.want_to_learn ?? false,
});

async function cardView(db, card, userId, reviewContext = 'scheduled', options = {}) {
  const progress = (Object.hasOwn(options, 'progress') ? options.progress : await db.progress.get([card.id, userId]))
    ?? initialProgress(card, userId);
  const content = card.content_v2?.card;
  if (!content) notFound();
  return {
    ...await cardMediaView(db, card, options.prefetch), level: content.level,
    intervals: getNextIntervals(progress, reviewContext), is_leech: isLeech(progress.lapses || 0),
    next_review: progress.next_review, last_reviewed: progress.last_reviewed,
    queue: progress.queue || 'new', interval: progress.interval || 0,
    ease_factor: progress.ease_factor || 2.5, repetitions: progress.repetitions ?? 0,
    step_index: progress.step_index ?? 0, lapses: progress.lapses || 0,
    flag: progress.flag ?? card.flag ?? 0,
    want_to_learn: progress.want_to_learn ?? card.want_to_learn ?? false,
  };
}

const isActiveCard = card => card.content_v2 && !card.is_deleted;
const readActiveDeckCards = async (db, deckId) =>
  (await db.cards.where('deck_id').equals(deckId).toArray()).filter(isActiveCard);
const readCardProgress = (db, cards, userId) =>
  (cards.length ? db.progress.bulkGet(cards.map(card => [card.id, userId])) : Promise.resolve([]));
const progressByCard = rows => new Map(rows.filter(Boolean).map(row => [row.card_id, row]));

async function deckCards(db, deckId, folderMap = null) {
  const [deck, resolvedFolderMap] = folderMap
    ? [await db.decks.get(deckId), folderMap]
    : await Promise.all([db.decks.get(deckId), loadFolderMap(db)]);
  if (!isDeckActiveInCache(deck, resolvedFolderMap)) notFound();
  return ordered(await readActiveDeckCards(db, deckId));
}

async function readDeckStudyData(db, deckId, userId, folderMap = null) {
  return db.transaction('r', db.folders, db.decks, db.cards, db.progress, async () => {
    const cards = await deckCards(db, deckId, folderMap);
    const progress = progressByCard(await readCardProgress(db, cards, userId));
    return { cards, progress };
  });
}

async function readCardsByDeck(db, deckIds) {
  // Each indexed equality can use IndexedDB getAll in the caller's read transaction.
  return new Map(await Promise.all(deckIds.map(async id => [id, await readActiveDeckCards(db, id)])));
}

const STANDALONE_SUPPORTED_LANGUAGES = new Set(['de', 'en', 'no']);
const matchesVisibleLanguage = (itemLang, language, standalone) => (
  !language
  || !itemLang
  || itemLang === language
  || (standalone && !STANDALONE_SUPPORTED_LANGUAGES.has(itemLang))
);
const RESOURCE_KIND_MAP = { image: 'images', audio: 'audio', video: 'videos', background: 'backgrounds' };

function normalizeDeckMetadataForStorage(rawMetadata) {
  const metadata = { ...(jsonObject(rawMetadata, {}) || {}) };
  delete metadata.is_learning;
  if (!Array.isArray(metadata.resources)) {
    return metadata;
  }
  metadata.resources = metadata.resources.map((res) => {
    if (!res || typeof res !== 'object') {
      throw new Error(tr('Некорректный ресурс в метаданных колоды.'));
    }
    if (res.type === 'link') {
      return { ...res };
    }
    const expectedFolder = RESOURCE_KIND_MAP[res.type];
    if (!expectedFolder) {
      return { ...res };
    }
    const candidates = [res.path, res.url].filter(v => typeof v === 'string' && v.trim());
    let parsed = null;
    for (const candidate of candidates) {
      if (isOfflineMediaUrl(candidate)) continue;
      const candidateParsed = parseOfflineMediaRef(candidate, expectedFolder);
      if (candidateParsed && candidateParsed.folder === expectedFolder) {
        parsed = candidateParsed;
        break;
      }
    }
    if (!parsed) {
      if (candidates.some(isOfflineMediaUrl) || candidates.length > 0) {
        throw new Error(tr('Ресурс колоды должен ссылаться на сохранённый локальный медиафайл.'));
      }
      throw new Error(tr('Отсутствует путь к локальному медиафайлу ресурса.'));
    }
    return {
      ...res,
      path: parsed.canonicalUrl,
      url: parsed.canonicalUrl,
    };
  });
  return metadata;
}

async function activeFolders(db, language, folderMap = null) {
  const standalone = isStandaloneDb(db);
  const allFolders = folderMap ? [...folderMap.values()] : await db.folders.toArray();
  const resolvedFolderMap = folderMap || buildFolderMap(allFolders);
  return allFolders.filter(folder => !folder.is_deleted
    && isFolderActiveInCache(resolvedFolderMap, folder.id)
    && matchesVisibleLanguage(folder.target_language, language, standalone));
}

export async function readPulledFolders() {
  const db = getLocalDb();
  return db.transaction('r', db.syncState, db.folders, async () => {
    if (!(await db.syncState.get('lastSync'))?.readStartedAt) return;
    return activeFolders(db);
  });
}

export async function readPulledDeckCards(deckId, userId, expectedTotal, apply) {
  const db = getLocalDb();
  return db.transaction('r', db.syncState, db.folders, db.decks, db.cards, db.progress, db.media, async () => {
    const [checkpoint, completeness] = await db.syncState.bulkGet(['lastSync', `deck-cards:${deckId}`]);
    if (!checkpoint?.readStartedAt || completeness?.complete === false) return;
    const cards = await deckCards(db, deckId);
    if (cards.filter(card => card.id > 0).length < expectedTotal) return;
    const progress = await readCardProgress(db, cards, userId);
    const startedAt = checkpoint.progressReadStartedAt ?? checkpoint.readStartedAt;
    const data = await Promise.all(cards.map((card, index) => cardView(db, card, userId, 'scheduled', {
      progress: progress[index] ?? (card._studyProgressAt >= startedAt ? initialProgress(card, userId) : emptyStudyProgress),
      prefetch: false,
    })));
    // Publish before IndexedDB can start a queued write to the same tables.
    return apply(data, startedAt);
  });
}

function deckStats(cards, progress, userId) {
  const stats = { total: cards.length, new: 0, learning: 0, due: 0 };
  for (const card of cards) {
    const p = progress.get(card.id) || initialProgress(card, userId);
    if (!p || p.queue === 'new') stats.new++;
    else if (['learning', 'relearning'].includes(p.queue)) stats.learning++;
    else if (!p.next_review || new Date(p.next_review) <= new Date()) stats.due++;
  }
  return stats;
}

async function isDeckCacheComplete(db, deckId, activeCount) {
  if (deckId < 0) return true;
  const [deck, deckCache, lastSync, totalCached] = await Promise.all([
    db.decks.get(deckId),
    db.syncState.get(`deck-cards:${deckId}`),
    db.syncState.get('lastSync'),
    db.cards.where('deck_id').equals(deckId).count(),
  ]);
  if (deckCache?.complete === false) {
    if (!lastSync || (lastSync.readStartedAt || 0) < (deckCache.fetched_at || 0)) {
      const expectedTotal = Number(deck?.stats?.total);
      if (!(lastSync && expectedTotal > 0 && Math.max(activeCount, totalCached) >= expectedTotal)) {
        return false;
      }
    }
  }
  if (deckCache?.complete || lastSync) return true;
  if (Number(deck?.stats?.total) > Math.max(activeCount, totalCached)) return false;
  return true;
}

async function nextCard(db, deckId, userId, params) {
  const { cards, progress } = await readDeckStudyData(db, deckId, userId);
  const exclude = new Set((params.get('exclude_ids') || '').split(',').map(Number));
  const now = Date.now();
  const candidates = cards.filter(c => !c.offline_create_status && !exclude.has(c.id))
    .map(card => ({ card, p: progress.get(card.id) || initialProgress(card, userId) }));
  const due = candidates.filter(({ p }) => !p || p.queue === 'new' || !p.next_review || new Date(p.next_review).getTime() <= now);
  const context = params.get('review_context') === 'forced' || params.get('learn_more') === 'true' ? 'forced' : 'scheduled';
  const pool = context === 'forced' ? candidates : due;
  const rank = (p) => !p || p.queue === 'new' ? 2 : ['learning', 'relearning'].includes(p.queue) ? 0 : 1;
  if (context !== 'forced') pool.sort((a, b) => rank(a.p) - rank(b.p)
    || new Date(a.p?.next_review || 0) - new Date(b.p?.next_review || 0)
    || (a.card.position || 0) - (b.card.position || 0));
  if (!pool.length) {
    if (!(await isDeckCacheComplete(db, deckId, cards.length))) incompleteCache();
    return result({ finished: true });
  }
  const { card, p } = pool[0];
  return result({ ...await cardView(db, card, userId, context, { progress: p }),
    deck_stats: deckStats(cards, progress, userId) });
}

export const offlineApi = {
  async handle(method, rawUrl, data = null, config = {}) {
    const notePath = rawUrl.match(/^\/card-notes\/(-?\d+)(?:\/([a-f0-9-]+))?$/i);
    if (notePath && method === 'put') {
      return result(await writeCardNote(Number(notePath[1]), { ...data, id: notePath[2] || data?.id }));
    }
    const userId = getUserId();
    const identity = getSessionIdentity();
    const db = config?._testDb || await prepareLocalDb();
    const isCurrent = () => userId === getUserId() && identity === getSessionIdentity();
    if (!isCurrent()) throw new Error('Session changed');
    const parsed = new URL(rawUrl, 'https://local.invalid');
    const url = parsed.pathname.replace(/\/$/, '') || '/';
    const params = parsed.searchParams;
    for (const [key, value] of Object.entries((method === 'get' ? data : config)?.params || {})) params.set(key, value);
    const m = method.toLowerCase();
    const body = data || {};
    const change = async (table, id, fields) => {
      const standalone = isStandaloneDb(db);
      const item = await table.get(id);
      if (!item) notFound();
      const owner = table.name === 'cards' ? await db.decks.get(item.deck_id) : item;
      if (standalone ? isContentReadOnly(owner) : owner?.role === 'viewer') readOnly();
      const nowIso = new Date().toISOString();
      const updated = {
        ...item,
        ...fields,
        ...localDirtyFields(db, item),
        ...(standalone && (table.name === 'folders' || table.name === 'decks')
          ? { standalone_local_edit: true, standalone_local_edited_at: nowIso }
          : {}),
      };
      await table.put(updated);
      return updated;
    };

    if (m === 'get' && ['/init', '/decks', '/folders'].includes(url)) {
      const language = localStorage.getItem('lerne_target_language') || 'de';
      if (url === '/folders') return result(ordered(await activeFolders(db, language)));
      const standalone = isStandaloneDb(db);
      const { rawDecks, cardsByDeck, progress, folderMap } = await db.transaction(
        'r', db.folders, db.decks, db.cards, db.progress, async () => {
          const [folderMap, allDecks] = await Promise.all([
            loadFolderMap(db),
            db.decks.toArray(),
          ]);
          const rawDecks = ordered(allDecks.filter(d => isDeckActiveInCache(d, folderMap)
            && matchesVisibleLanguage(d.target_language, language, standalone)));
          const [cardsByDeck, rows] = rawDecks.length ? await Promise.all([
            readCardsByDeck(db, rawDecks.map(deck => deck.id)),
            db.progress.where('user_id').equals(userId).toArray(),
          ]) : [new Map(), []];
          return { rawDecks, cardsByDeck, progress: progressByCard(rows), folderMap };
        },
      );
      const decks = await Promise.all(rawDecks.map(async (deck) => {
        deck.stats = deckStats(cardsByDeck.get(deck.id) ?? [], progress, userId);
        deck.metadata = jsonObject(deck.metadata);
        delete deck.metadata.is_learning;
        deck.is_learning = deck.is_learning ?? false;
        if (standalone && Array.isArray(deck.metadata?.resources) && deck.metadata.resources.length > 0) {
          const resolvedResources = await Promise.all(deck.metadata.resources.map(async (res) => {
            if (!res || typeof res !== 'object') return res;
            if (res.type === 'link') return res;
            const raw = res.path || res.url;
            if (!raw) return res;
            const folder = RESOURCE_KIND_MAP[res.type] || 'images';
            const resolvedUrl = await localMediaURL(db, raw, folder, false);
            const durablePath = res.path || (isOfflineMediaUrl(raw) ? undefined : raw);
            return {
              ...res,
              ...(durablePath ? { path: durablePath } : {}),
              url: resolvedUrl || '',
            };
          }));
          deck.metadata = { ...deck.metadata, resources: resolvedResources };
        }
        return deck;
      }));
      if (url === '/decks') return result(decks);
      const folders = ordered(await activeFolders(db, language, folderMap));
      return result({ decks, folders, settings: {}, prompts: {}, user_info: getUserProfile() });
    }
    if (m === 'get' && url === '/cards/search') {
      const q = params.get('q') || '';
      if (!q.trim()) return result({ folders: [], decks: [], cards: [] });
      const rawFolderId = params.get('folder_id');
      const folderId = rawFolderId !== null && rawFolderId !== undefined && rawFolderId !== '' ? Number(rawFolderId) : null;
      const targetLang = params.get('target_language') || localStorage.getItem('lerne_target_language') || 'de';
      const limit = Number(params.get('limit')) || 60;

      const folderMap = await loadFolderMap(db);
      if (folderId !== null && !isFolderActiveInCache(folderMap, folderId)) {
        return result({ folders: [], decks: [], cards: [] });
      }
      const allFolders = [...folderMap.values()].filter(f => !f.is_deleted && isFolderActiveInCache(folderMap, f.id));
      const allDecks = (await db.decks.toArray()).filter(d => isDeckActiveInCache(d, folderMap));

      const scopedFolders = getScopedFolders(allFolders, folderId, targetLang);
      const scopedDecks = getScopedDecks(allDecks, allFolders, folderId, targetLang);

      const matchedFolders = scopedFolders.filter(f => matchFolder(f, q));
      const matchedDecks = scopedDecks.filter(d => matchDeck(d, q));

      const deckIds = scopedDecks.map(d => d.id);
      const deckNameMap = new Map(scopedDecks.map(d => [d.id, d.name]));
      const deckFolderMap = new Map(scopedDecks.map(d => [d.id, d.folder_id]));

      const matchedCards = [];
      if (deckIds.length > 0) {
        const cardsByDeck = await db.transaction('r', db.cards, () => readCardsByDeck(db, deckIds.sort((a, b) => a - b)));
        const matches = [];
        search: for (const siblings of cardsByDeck.values()) {
          siblings.sort((a, b) => a.position - b.position || a.id - b.id);
          for (const [index, card] of siblings.entries()) {
            if (!matchCard(card, q)) continue;
            matches.push({ card, card_number: index + 1, total_cards: siblings.length });
            if (matches.length >= limit) break search;
          }
        }
        const progress = await readCardProgress(db, matches.map(match => match.card), userId);
        for (const [index, { card, card_number, total_cards }] of matches.entries()) {
          matchedCards.push({ ...await cardView(db, card, userId, 'scheduled', { progress: progress[index] }),
            deck_name: deckNameMap.get(card.deck_id) || '', folder_id: deckFolderMap.get(card.deck_id),
            card_number, total_cards,
          });
        }
      }

      return result({
        folders: matchedFolders,
        decks: matchedDecks,
        cards: matchedCards
      });
    }
    let match = url.match(/^\/decks\/(-?\d+)\/(cards|next)$/);
    if (m === 'get' && match) {
      const id = Number(match[1]);
      if (match[2] === 'next') return nextCard(db, id, userId, params);
      const { cards, progress } = await readDeckStudyData(db, id, userId);
      const complete = await isDeckCacheComplete(db, id, cards.length);
      return { ...result(await Promise.all(cards.map(card =>
        cardView(db, card, userId, 'scheduled', { progress: progress.get(card.id) })))), complete };
    }
    match = url.match(/^\/cards\/(-?\d+)$/);
    if (m === 'get' && match) {
      const card = await db.cards.get(Number(match[1]));
      if (!card?.content_v2 || card.is_deleted) notFound();
      const [deck, folderMap] = await Promise.all([db.decks.get(card.deck_id), loadFolderMap(db)]);
      if (!isCardDeckActiveInCache(deck, card, folderMap)) notFound();
      return result(await cardView(db, card, userId));
    }
    if (m === 'patch' && match && Number(match[1]) > 0) {
      if (isStandaloneDb(db)) {
        const updated = await saveNativeEdit(
          db,
          Number(match[1]),
          body,
          { flag: config.standaloneFlag },
          userId,
        );
        return result(await cardView(db, updated.data, userId, 'scheduled', { prefetch: false }));
      }
      if (config.offlineCardEdit) {
        return saveNativeEdit(db, Number(match[1]), body, config.offlineEditConflict);
      }
    }
    match = url.match(/^\/study\/card\/(-?\d+)$/);
    if (m === 'get' && match) {
      const card = await db.cards.get(Number(match[1]));
      if (!card || card.is_deleted) notFound();
      const { cards, progress } = await readDeckStudyData(db, card.deck_id, userId);
      return result({ ...await cardView(db, card, userId, 'scheduled', { progress: progress.get(card.id) }),
        deck_stats: deckStats(cards, progress, userId) });
    }
    if (m === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)) {
      const allowedGrades = body.is_extended ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3];
      if (!allowedGrades.includes(body.grade)) throw new Error(tr("Некорректная оценка"));
      const id = Number(body.card_id);
      const card = await db.cards.get(id);
      if (!card || card.is_deleted) notFound();
      const [deck, folderMap] = await Promise.all([db.decks.get(card.deck_id), loadFolderMap(db)]);
      if (!isCardDeckActiveInCache(deck, card, folderMap)) notFound();
      if (card.offline_create_status) pendingCreate();
      if (body.review_context && !['scheduled', 'forced'].includes(body.review_context)) throw new Error(tr('Некорректный контекст повторения'));
      const context = body.learn_more || body.review_context === 'forced' ? 'forced' : 'scheduled';
      const actionId = body.action_id || crypto.randomUUID();
      let gradedProgress;
      await db.transaction('rw', db.progress, db.syncState, async () => {
        const fingerprint = JSON.stringify([id, body.grade, Boolean(body.is_extended), context]);
        const receipt = await db.syncState.get(`grade:${actionId}`);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new Error('Grade action already used with different data');
          gradedProgress = receipt.graded_progress;
          return;
        }
        const progress = await db.progress.get([id, userId]) || initialProgress(card, userId);
        // UUID reviews own native server SRS; a later label edit may outlive their ack.
        const updated = { ...calculateCardReview(progress, body.grade, Boolean(body.is_extended), context),
          ...(card.content_v2 && { flag_only: true }), ...localDirtyFields(db, progress) };
        await db.progress.put(updated);
        gradedProgress = { id, ...Object.fromEntries(['queue', 'interval', 'ease_factor', 'repetitions',
          'step_index', 'lapses', 'flag', 'next_review', 'last_reviewed'].map(field => [field, updated[field]])),
          intervals: getNextIntervals(updated, context), is_leech: isLeech(updated.lapses || 0) };
        // Same transaction as progress; every grade survives reload and batch retry.
        if (isStandaloneDb(db)) {
          standaloneGradeSeq += 1;
          await db.syncState.put({
            key: `grade:${actionId}`,
            fingerprint,
            graded_progress: gradedProgress,
            created_at: Date.now(),
            seq: standaloneGradeSeq,
          });
          await db.syncState.where('key').startsWith('review:').delete();
          const receipts = await db.syncState.where('key').startsWith('grade:').toArray();
          if (receipts.length > STANDALONE_MAX_GRADE_RECEIPTS) {
            receipts.sort((a, b) => (a.created_at || 0) - (b.created_at || 0)
              || (a.seq || 0) - (b.seq || 0)
              || a.key.localeCompare(b.key));
            const excess = receipts.length - STANDALONE_MAX_GRADE_RECEIPTS;
            const keysToDelete = receipts
              .filter(item => item.key !== `grade:${actionId}`)
              .slice(0, excess)
              .map(item => item.key);
            if (keysToDelete.length > 0) {
              await db.syncState.bulkDelete(keysToDelete);
            }
          }
        } else {
          await db.syncState.put({ key: `grade:${actionId}`, fingerprint, graded_progress: gradedProgress });
          await db.syncState.put({ key: `review:${actionId}`, action_id: actionId, card_id: id,
            rating: body.grade, review_context: context, is_extended: Boolean(body.is_extended),
            review_time: updated.last_reviewed, scheduled_interval: updated.interval });
        }
      });
      const extra = body.include_progress && gradedProgress ? { graded_progress: gradedProgress } : {};
      if (body.return_next === false) return result({ status: 'success', ...extra });
      const exclude = [...new Set([...(body.exclude_ids || []), id])];
      const nextParams = new URLSearchParams({ exclude_ids: exclude.join(','), review_context: context });
      try {
        const next = await nextCard(db, card.deck_id, userId, nextParams);
        return { ...next, data: { ...next.data, ...extra } };
      } catch (err) {
        return result({ status: 'success', next_error: err.response?.data?.detail || err.message, ...extra });
      }
    }
    if (m === 'post' && url === '/cards/save') {
      if (isStandaloneDb(db)) {
        const created = await saveNativeCard(db, body, config, userId);
        return result(await cardView(db, created.data, userId, 'scheduled', { prefetch: false }));
      }
      return saveNativeCard(db, body, config, userId);
    }
    if (m === 'post' && url === '/cards/batch-move') return queueCardMove(db, body, isCurrent);
    if (m === 'post' && url === '/cards/batch-copy') return queueCardMove(db, body, isCurrent, true);
    if (m === 'post' && url === '/cards/batch-delete') {
      const cardIds = (body.card_ids || []).map(Number);
      return cardIds.length === 1 ? queueCardLifecycle(db, cardIds[0], body, true, userId, isCurrent)
        : queueCardSelection(db, body, 'delete', isCurrent);
    }
    match = url.match(/^\/(decks|folders)$/);
    if (m === 'post' && match) {
      const kind = match[1];
      const table = db[kind];
      if (isStandaloneDb(db)) {
        const parentIdRaw = kind === 'decks' ? body.folder_id : body.parent_id;
        const parentId = parentIdRaw == null ? null : Number(parentIdRaw);
        const created = await db.transaction('rw', db.folders, db.decks, db.syncState, async () => {
          const folderMap = await loadFolderMap(db);
          if (parentId != null) {
            const parent = folderMap.get(parentId);
            if (!parent || !isFolderActiveInCache(folderMap, parent.id)) notFound();
            await requireContentWrite(db, 'folders', parent);
          }
          const singular = kind.slice(0, -1);
          const [id, exportSource, siblings] = await Promise.all([
            allocatePositiveLocalId(db, kind, singular),
            getMaterialExportSourceInTx(db),
            table.filter(row => !row.is_deleted && (kind === 'decks' ? row.folder_id : row.parent_id) === parentId).toArray(),
          ]);
          const position = siblings.reduce(
            (max, row) => Math.max(max, Number.isInteger(row.position) ? row.position : -1),
            -1,
          ) + 1;
          const nowIso = new Date().toISOString();
          const originKey = buildOriginKey(exportSource, singular, id);
          const item = {
            ...body,
            id,
            user_id: userId,
            ...(kind === 'decks' ? { folder_id: parentId } : { parent_id: parentId }),
            is_deleted: 0,
            is_dirty: 0,
            position,
            role: 'owner',
            is_owner: true,
            is_global_readonly: false,
            is_builtin: false,
            standalone_origin_key: originKey,
            ...(kind === 'decks' ? { standalone_deck_key: originKey } : {}),
            standalone_local_created: true,
            standalone_local_edit: true,
            standalone_local_edited_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          };
          if (kind === 'decks') {
            item.metadata = { resources: [], deck_type: body.deck_type || 'standard' };
            item.is_pinned = Boolean(body.is_pinned);
            item.is_learning = Boolean(body.is_learning);
          } else {
            item.color = body.color || '#ffd043';
          }
          await table.put(item);
          if (kind === 'decks') {
            await db.syncState.put({ key: `deck-cards:${id}`, complete: true, fetched_at: Date.now() });
          }
          return item;
        });
        return success(created);
      }
      const parentId = body.folder_id || body.parent_id;
      if (parentId) {
        const [parent, folderMap] = await Promise.all([db.folders.get(Number(parentId)), loadFolderMap(db)]);
        if (!parent || !isFolderActiveInCache(folderMap, parent.id)) notFound();
        await requireContentWrite(db, 'folders', parent);
      }
      const item = { ...body, id: getNextTempId(), user_id: userId, is_deleted: 0,
        position: 0, role: 'owner', is_owner: true, created_at: new Date().toISOString(), ...dirtyFields() };
      if (kind === 'decks') item.metadata = { resources: [], deck_type: body.deck_type || 'standard' };
      await table.put(item);
      return success(item);
    }
    if (m === 'post' && url === '/cards/reorder' && (isStandaloneDb(db) || body.revisions)) {
      return queueCardSelection(db, body, 'reorder', isCurrent);
    }
    match = url.match(/^\/(decks|folders)\/reorder$/);
    if (m === 'post' && match) {
      const entity = match[1];
      const table = db[entity];
      const ids = (body[`${entity.slice(0, -1)}_ids`] || []).map(Number);
      await db.transaction('rw', table, db.decks, async () => {
        for (const id of ids) {
          const item = await table.get(id);
          await requireContentWrite(db, entity, item);
        }
        for (const [position, id] of ids.entries()) await change(table, id, { position });
      });
      return success();
    }
    match = url.match(/^\/(cards|decks|folders)\/(-?\d+)(?:\/(rename|color|move|pin|flag|metadata|toggle-learning|reset))?$/);
    if (match && (m === 'post' || m === 'delete')) {
      const [, entity, rawId, action] = match;
      const id = Number(rawId);
      const table = db[entity];
      return db.transaction('rw', db.folders, db.decks, db.cards, db.progress, async () => {
        const [item, folderMap] = await Promise.all([table.get(id), loadFolderMap(db)]);
        if (!item) notFound();
        if (entity === 'cards' && action !== 'flag') throw unsupported();
        if (m === 'delete' && !action) {
          const isOwner = (item.user_id == null || item.user_id === userId) && (!item.role || item.role === 'owner');
          if (!isOwner && item.role !== 'owner') readOnly();
          await requireContentWrite(db, entity, item);
          if (item.is_deleted) return success();
          const parentId = entity === 'folders' ? item.parent_id : item.folder_id;
          if (!isFolderActiveInCache(folderMap, parentId)) notFound();
          await change(table, id, { is_deleted: 1 });
          return success();
        }
        if (action === 'reset' && entity === 'decks') {
          if (!isDeckActiveInCache(item, folderMap)) notFound();
          for (const card of await db.cards.where('deck_id').equals(id).toArray()) {
            const oldProg = await db.progress.get([card.id, userId]) || {};
            await db.progress.put({ ...oldProg, card_id: card.id, user_id: userId, queue: 'new', interval: 0,
              ease_factor: 2.5, repetitions: 0, lapses: 0, step_index: 0, next_review: null, last_reviewed: null,
              flag_only: false, ...localDirtyFields(db, oldProg) });
          }
          return success();
        }
        let fields;
        if (action === 'rename') fields = { name: body.name };
        if (action === 'color') fields = { color: body.color };
        if (action === 'flag') {
          if (entity !== 'cards') throw unsupported();
          if (item.offline_create_status) pendingCreate();
          const deck = await db.decks.get(item.deck_id);
          if (!isDeckActiveInCache(deck, folderMap)) notFound();
          const prog = await db.progress.get([id, userId]) || initialProgress(item, userId);
          if (!prog.is_dirty) prog.flag_only = true;
          prog.flag = Number(body.flag) || 0;
          Object.assign(prog, localDirtyFields(db, prog));
          await db.progress.put(prog);
          return success({ id, flag: prog.flag });
        }
        if (action === 'toggle-learning' && entity === 'decks') {
          if (!isDeckActiveInCache(item, folderMap)) notFound();
          const isLearning = body.is_learning ?? !item.is_learning;
          await db.decks.put({ ...item, is_learning: isLearning, learning_dirty: isStandaloneDb(db) ? 0 : 1 });
          return success({ is_learning: isLearning });
        }
        await requireContentWrite(db, entity, item);
        if (entity === 'folders' && !isFolderActiveInCache(folderMap, id)) notFound();
        if (entity === 'decks' && !isDeckActiveInCache(item, folderMap)) notFound();
        if (action === 'pin') fields = { is_pinned: !item.is_pinned };
        if (action === 'move') {
          const key = entity === 'folders' ? 'parent_id' : 'folder_id';
          const target = body[key] == null ? null : Number(body[key]);
          let ancestor = target;
          const seen = new Set();
          while (ancestor != null) {
            if (seen.has(ancestor) || (entity === 'folders' && ancestor === id)) throw new Error(tr("Папку нельзя переместить внутрь себя"));
            seen.add(ancestor);
            const folder = await db.folders.get(ancestor);
            if (!folder || folder.is_deleted) notFound();
            await requireContentWrite(db, 'folders', folder);
            ancestor = folder.parent_id;
          }
          fields = { [key]: target };
        }
        if (action === 'metadata') {
          let metadata = { ...body };
          if (entity === 'decks') {
            delete metadata.is_learning;
            if (isStandaloneDb(db)) {
              metadata = normalizeDeckMetadataForStorage(metadata);
            }
          }
          fields = { metadata };
        }
        if (fields) return success(await change(table, id, fields));
        throw unsupported();
      });
    }
    if (url === '/cards/duplicates' && m === 'get') {
      const folderMap = await loadFolderMap(db);
      const decks = new Map((await db.decks.toArray())
        .filter(d => isDeckActiveInCache(d, folderMap) && (d.user_id === userId || d.role === 'owner'))
        .map(d => [d.id, d]));
      const cards = (await db.cards.filter(c => c.content_v2 && !c.is_deleted && decks.has(c.deck_id)).toArray())
        .sort((a, b) => a.deck_id - b.deck_id || a.position - b.position || a.id - b.id);
      const counts = new Map();
      for (const card of cards) {
        const key = cardDuplicateKey(card.content_v2);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return result(await Promise.all(cards.filter(c => counts.get(cardDuplicateKey(c.content_v2)) > 1)
        .map(async card => ({ ...await cardView(db, card, userId), deck_name: decks.get(card.deck_id).name }))));

    }
    if (url === '/trash' && m === 'get') {
      const [allFolders, decks, allCards] = await Promise.all([
        db.folders.toArray(),
        db.decks.toArray(),
        db.cards.toArray(),
      ]);
      const folderMap = buildFolderMap(allFolders);
      const ownFolders = allFolders.filter(f => isOwnedRecord(f, userId));
      const childrenByParent = new Map();
      for (const folder of ownFolders) {
        const list = childrenByParent.get(folder.parent_id ?? null) || [];
        list.push(folder);
        childrenByParent.set(folder.parent_id ?? null, list);
      }
      const activeDecksByFolder = new Map();
      for (const deck of decks) {
        if (!deck.is_deleted && !deck.hard_deleted_locally && isOwnedRecord(deck, userId)) {
          const list = activeDecksByFolder.get(deck.folder_id ?? null) || [];
          list.push(deck.id);
          activeDecksByFolder.set(deck.folder_id ?? null, list);
        }
      }
      const activeCardCounts = new Map();
      for (const card of allCards) {
        if (!card.is_deleted && !card.hard_deleted_locally) {
          activeCardCounts.set(card.deck_id, (activeCardCounts.get(card.deck_id) || 0) + 1);
        }
      }
      const folders = ownFolders
        .filter(f => !!f.is_deleted && !f.hard_deleted_locally)
        .sort((a, b) => b.id - a.id)
        .map(f => {
          const subtreeIds = collectSubtreeFolderIds([f.id], childrenByParent, child => !child.is_deleted && !child.hard_deleted_locally);
          const subtreeDeckIds = subtreeIds.flatMap(fid => activeDecksByFolder.get(fid) || []);
          return {
            ...f,
            parent_deleted: f.parent_id != null && !isFolderParentReadyForRestore(folderMap, f.parent_id).ok,
            decks_count: subtreeDeckIds.length,
            cards_count: subtreeDeckIds.reduce((sum, did) => sum + (activeCardCounts.get(did) || 0), 0),
          };
        });
      const decksById = new Map(decks.map(d => [d.id, d]));
      const standalone = isStandaloneDb(db);
      const ownDecks = new Map(
        decks
          .filter(d => d.user_id === userId || d.role === 'owner' || (standalone && isBundledSeedDeck(d)))
          .map(d => [d.id, d]),
      );
      const deletedDecks = decks
        .filter(d => !!d.is_deleted && !d.hard_deleted_locally && isOwnedRecord(d, userId))
        .map(d => ({
          ...d,
          parent_deleted: d.folder_id != null && !isFolderParentReadyForRestore(folderMap, d.folder_id).ok,
          cards_count: activeCardCounts.get(d.id) || 0,
        }));
      const deletedCards = allCards
        .filter(c => !!c.is_deleted && !c.hard_deleted_locally
          && c.content_v2 && (ownDecks.has(c.deck_id) || c.deck_name))
        .map(card => {
          const parentDeck = ownDecks.get(card.deck_id) || decksById.get(card.deck_id);
          return {
            ...card,
            deck_name: parentDeck?.name || card.deck_name,
            deck_deleted: parentDeck ? !isDeckActiveInCache(parentDeck, folderMap) : Boolean(card.deck_deleted),
          };
        });
      return result({ folders, decks: deletedDecks, cards: deletedCards });
    }
    match = url.match(/^\/trash\/(folder|deck|card)\/(-?\d+)\/restore$/);
    if (match && m === 'post') {
      const [, kind, rawId] = match;
      const id = Number(rawId);
      if (kind === 'card') {
        return queueCardLifecycle(db, id, body, false, userId, isCurrent);
      }
      const table = db[`${kind}s`];
      return db.transaction('rw', db.folders, db.decks, async () => {
        const [item, folderMap] = await Promise.all([table.get(id), loadFolderMap(db)]);
        if (!item) notFound();
        if (isContentReadOnly(item) || !isOwnedRecord(item, userId)) readOnly();
        assertParentActiveForRestore(folderMap, kind === 'folder' ? item.parent_id : item.folder_id, kind);
        if (!item.is_deleted && !item.hard_deleted_locally) return success();
        await change(table, id, { is_deleted: 0, hard_deleted_locally: false });
        return success();
      });
    }
    if (url === '/trash/clear' && m === 'delete') {
      if (!isStandaloneDb(db)) throw unsupported();
      await clearTrashInDb(db, userId, { isCurrent, localOnly: true });
      return success();
    }
    if (url === '/study/stats' && m === 'get') {
      const folderMap = await loadFolderMap(db);
      const active = new Set((await db.decks.toArray()).filter(d => isDeckActiveInCache(d, folderMap)).map(d => d.id));
      const cards = await db.cards.filter(c => !c.is_deleted && active.has(c.deck_id)).toArray();
      const progress = new Map((await db.progress.where('user_id').equals(userId).toArray()).map(p => [p.card_id, p]));
      const stats = { total_cards: cards.length, new_cards: 0, learning_cards: 0, young_cards: 0, mature_cards: 0, leech_cards: 0, retention_rate: null };
      const forecast = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(Date.now() + i * 86400000);
        return { day_index: i, date: date.toISOString().slice(0, 10), day_name: [tr("Вс"), tr("Пн"), tr("Вт"), tr("Ср"), tr("Чт"), tr("Пт"), tr("Сб")][date.getDay()], count: 0 };
      });
      for (const c of cards) {
        const p = progress.get(c.id);
        if (!p || p.queue === 'new') stats.new_cards++;
        else if (['learning', 'relearning'].includes(p.queue)) stats.learning_cards++;
        else if (p.interval >= 21) stats.mature_cards++;
        else stats.young_cards++;
        if (isLeech(p?.lapses)) stats.leech_cards++;
        const day = p?.next_review && forecast.find(d => d.date === p.next_review.slice(0, 10));
        if (day) day.count++;
      }
      return result({ ...stats, forecast_7d: forecast });
    }
    throw unsupported();
  },
};
