import { tr } from '../i18n/locale';
import { getLocalDb, prepareLocalDb, getNextTempId } from './localDb';
import { calculateCardReview, getNextIntervals, isLeech } from '../utils/srsEngine';
import { getUserId, getUserProfile, getSessionIdentity } from '../utils/auth';
import { cardMediaView } from './mediaCache';
import { emptyStudyProgress } from '../utils/structuredStudyCard.js';
import { cardDuplicateKey, matchFolder, matchDeck, matchCard, getScopedFolders, getScopedDecks } from '../utils/search';
import { writeCardNote } from './cardNotes.js';
import {
  result,
  notFound,
  readOnly,
  pendingCreate,
  unsupported,
  isStandaloneDb,
  requireContentWrite,
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
  const progress = options.progress ?? (await db.progress.get([card.id, userId])) ?? initialProgress(card, userId);
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

async function deckCards(db, deckId) {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.is_deleted) notFound();
  return ordered((await db.cards.where('deck_id').equals(deckId).toArray()).filter(c => c.content_v2 && !c.is_deleted));
}

const activeFolders = (db, language) => db.folders.filter(folder => !folder.is_deleted
  && (!language || !folder.target_language || folder.target_language === language)).toArray();

export async function readPulledFolders() {
  const db = getLocalDb();
  return db.transaction('r', db.syncState, db.folders, async () => {
    if (!(await db.syncState.get('lastSync'))?.readStartedAt) return;
    return activeFolders(db);
  });
}

export async function readPulledDeckCards(deckId, userId, expectedTotal, apply) {
  const db = getLocalDb();
  return db.transaction('r', db.syncState, db.decks, db.cards, db.progress, db.media, async () => {
    const [checkpoint, completeness] = await db.syncState.bulkGet(['lastSync', `deck-cards:${deckId}`]);
    if (!checkpoint?.readStartedAt || completeness?.complete === false) return;
    const cards = await deckCards(db, deckId);
    if (cards.filter(card => card.id > 0).length < expectedTotal) return;
    const progress = await db.progress.bulkGet(cards.map(card => [card.id, userId]));
    const startedAt = checkpoint.progressReadStartedAt ?? checkpoint.readStartedAt;
    const data = await Promise.all(cards.map((card, index) => cardView(db, card, userId, 'scheduled', {
      progress: progress[index] ?? (card._studyProgressAt >= startedAt ? initialProgress(card, userId) : emptyStudyProgress),
      prefetch: false,
    })));
    // Publish before IndexedDB can start a queued write to the same tables.
    return apply(data, startedAt);
  });
}

async function deckStats(db, deckId, userId) {
  const cards = await deckCards(db, deckId);
  const progress = new Map((await db.progress.where('user_id').equals(userId).toArray()).map(p => [p.card_id, p]));
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
  const cards = await deckCards(db, deckId);
  const exclude = new Set((params.get('exclude_ids') || '').split(',').map(Number));
  const progress = new Map((await db.progress.where('user_id').equals(userId).toArray()).map(p => [p.card_id, p]));
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
  return result({ ...await cardView(db, pool[0].card, userId, context), deck_stats: await deckStats(db, deckId, userId) });
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
      if (isStandaloneDb(db)) readOnly();
      const item = await table.get(id);
      if (!item) notFound();
      const owner = table.name === 'cards' ? await db.decks.get(item.deck_id) : item;
      if (owner?.role === 'viewer') throw new Error(tr("У вас доступ только для чтения"));
      const updated = { ...item, ...fields, ...dirtyFields(item) };
      await table.put(updated);
      return updated;
    };

    if (m === 'get' && ['/init', '/decks', '/folders'].includes(url)) {
      const language = localStorage.getItem('lerne_target_language') || 'de';
      const decks = ordered(await db.decks.filter(d => !d.is_deleted && (!d.target_language || d.target_language === language)).toArray());
      for (const deck of decks) {
        deck.stats = await deckStats(db, deck.id, userId);
        deck.metadata = jsonObject(deck.metadata);
        delete deck.metadata.is_learning;
        deck.is_learning = deck.is_learning ?? false;
      }
      const folders = ordered(await activeFolders(db, language));
      if (url === '/decks') return result(decks);
      if (url === '/folders') return result(folders);
      return result({ decks, folders, settings: {}, prompts: {}, user_info: getUserProfile() });
    }
    if (m === 'get' && url === '/cards/search') {
      const q = params.get('q') || '';
      if (!q.trim()) return result({ folders: [], decks: [], cards: [] });
      const rawFolderId = params.get('folder_id');
      const folderId = rawFolderId !== null && rawFolderId !== undefined && rawFolderId !== '' ? Number(rawFolderId) : null;
      const targetLang = params.get('target_language') || localStorage.getItem('lerne_target_language') || 'de';
      const limit = Number(params.get('limit')) || 60;

      const allFolders = await db.folders.filter(f => !f.is_deleted).toArray();
      const allDecks = await db.decks.filter(d => !d.is_deleted).toArray();

      const scopedFolders = getScopedFolders(allFolders, folderId, targetLang);
      const scopedDecks = getScopedDecks(allDecks, allFolders, folderId, targetLang);

      const matchedFolders = scopedFolders.filter(f => matchFolder(f, q));
      const matchedDecks = scopedDecks.filter(d => matchDeck(d, q));

      const deckIds = new Set(scopedDecks.map(d => d.id));
      const deckNameMap = new Map(scopedDecks.map(d => [d.id, d.name]));
      const deckFolderMap = new Map(scopedDecks.map(d => [d.id, d.folder_id]));

      const matchedCards = [];
      if (deckIds.size > 0 && q.trim()) {
        const allCards = (await db.cards.filter(c => c.content_v2 && !c.is_deleted && deckIds.has(c.deck_id)).toArray())
          .sort((a, b) => a.deck_id - b.deck_id || a.position - b.position || a.id - b.id);
        for (const c of allCards) {
          if (matchCard(c, q)) {
            const siblings = allCards.filter(card => card.deck_id === c.deck_id);
            matchedCards.push({ ...await cardView(db, c, userId),
              deck_name: deckNameMap.get(c.deck_id) || '', folder_id: deckFolderMap.get(c.deck_id),
              card_number: siblings.findIndex(card => card.id === c.id) + 1, total_cards: siblings.length,
            });
            if (matchedCards.length >= limit) break;
          }
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
      const cards = await deckCards(db, id);
      const complete = await isDeckCacheComplete(db, id, cards.length);
      return { ...result(await Promise.all(cards.map(c => cardView(db, c, userId)))), complete };
    }
    match = url.match(/^\/cards\/(-?\d+)$/);
    if (m === 'get' && match) {
      const card = await db.cards.get(Number(match[1]));
      if (!card?.content_v2 || card.is_deleted) notFound();
      return result(await cardView(db, card, userId));
    }
    if (m === 'patch' && match && Number(match[1]) > 0 && config.offlineCardEdit) {
      return saveNativeEdit(db, Number(match[1]), body, config.offlineEditConflict);
    }
    match = url.match(/^\/study\/card\/(-?\d+)$/);
    if (m === 'get' && match) {
      const card = await db.cards.get(Number(match[1]));
      if (!card || card.is_deleted) notFound();
      return result({ ...await cardView(db, card, userId), deck_stats: await deckStats(db, card.deck_id, userId) });
    }
    if (m === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)) {
      const allowedGrades = body.is_extended ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3];
      if (!allowedGrades.includes(body.grade)) throw new Error(tr("Некорректная оценка"));
      const id = Number(body.card_id);
      const card = await db.cards.get(id);
      if (!card || card.is_deleted) notFound();
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
          ...(card.content_v2 && { flag_only: true }), ...dirtyFields(progress) };
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
    if (m === 'post' && url === '/cards/save') return saveNativeCard(db, body, config, userId);
    if (m === 'post' && url === '/cards/batch-move') return queueCardMove(db, body, isCurrent);
    if (m === 'post' && url === '/cards/batch-copy') return queueCardMove(db, body, isCurrent, true);
    if (m === 'post' && url === '/cards/batch-delete') {
      const cardIds = (body.card_ids || []).map(Number);
      return cardIds.length === 1 ? queueCardLifecycle(db, cardIds[0], body, true, userId, isCurrent)
        : queueCardSelection(db, body, 'delete', isCurrent);
    }
    match = url.match(/^\/(decks|folders)$/);
    if (m === 'post' && match) {
      if (isStandaloneDb(db)) readOnly();
      const table = db[match[1]];
      const parentId = body.folder_id || body.parent_id;
      if (parentId) {
        const parent = await db.folders.get(Number(parentId));
        if (!parent || parent.is_deleted) notFound();
        await requireContentWrite(db, 'folders', parent);
      }
      const item = { ...body, id: getNextTempId(), user_id: userId, is_deleted: 0,
        position: 0, role: 'owner', is_owner: true, created_at: new Date().toISOString(), ...dirtyFields() };
      if (match[1] === 'decks') item.metadata = { resources: [], deck_type: body.deck_type || 'standard' };
      await table.put(item);
      return success(item);
    }
    if (m === 'post' && url === '/cards/reorder' && body.revisions) return queueCardSelection(db, body, 'reorder', isCurrent);
    match = url.match(/^\/(decks|folders)\/reorder$/);
    if (m === 'post' && match) {
      if (isStandaloneDb(db)) readOnly();
      const table = db[match[1]];
      const ids = body[`${match[1].slice(0, -1)}_ids`] || [];
      await db.transaction('rw', table, db.decks, async () => {
        for (const id of ids) {
          const card = await table.get(Number(id));
          await requireContentWrite(db, match[1], card);
        }
        for (const [position, id] of ids.entries()) await change(table, Number(id), { position });
      });
      return success();
    }
    match = url.match(/^\/(cards|decks|folders)\/(-?\d+)(?:\/(rename|color|move|pin|flag|metadata|toggle-learning|reset))?$/);
    if (match && (m === 'post' || m === 'delete')) {
      const [, entity, rawId, action] = match;
      const allowedInStandalone = m === 'post' && (
        (entity === 'cards' && action === 'flag')
        || (entity === 'decks' && (action === 'toggle-learning' || action === 'reset'))
      );
      if (isStandaloneDb(db) && !allowedInStandalone) readOnly();
      const id = Number(rawId);
      const table = db[entity];
      return db.transaction('rw', db.folders, db.decks, db.cards, db.progress, async () => {
        const item = await table.get(id);
        if (!item) notFound();
        if (entity === 'cards' && action !== 'flag') throw unsupported();
        if (m === 'delete' && !action) {
          await change(table, id, { is_deleted: 1 });
          if (entity === 'folders') {
            for (const child of await db.folders.filter(f => f.parent_id === id).toArray()) await change(db.folders, child.id, { parent_id: item.parent_id || null });
            for (const deck of await db.decks.where('folder_id').equals(id).toArray()) await change(db.decks, deck.id, { folder_id: item.parent_id || null });
          }
          return success();
        }
        if (action === 'reset' && entity === 'decks') {
          for (const card of await db.cards.where('deck_id').equals(id).toArray()) {
            const oldProg = await db.progress.get([card.id, userId]) || {};
            await db.progress.put({ ...oldProg, card_id: card.id, user_id: userId, queue: 'new', interval: 0,
              ease_factor: 2.5, repetitions: 0, lapses: 0, step_index: 0, next_review: null, last_reviewed: null,
              flag_only: false, ...dirtyFields(oldProg) });
          }
          return success();
        }
        let fields;
        if (action === 'rename') fields = { name: body.name };
        if (action === 'color') fields = { color: body.color };
        if (action === 'flag') {
          if (entity !== 'cards') throw unsupported();
          if (item.offline_create_status) pendingCreate();
          const prog = await db.progress.get([id, userId]) || initialProgress(item, userId);
          if (!prog.is_dirty) prog.flag_only = true;
          prog.flag = Number(body.flag) || 0;
          Object.assign(prog, dirtyFields(prog));
          await db.progress.put(prog);
          return success({ id, flag: prog.flag });
        }
        if (action === 'toggle-learning' && entity === 'decks') {
          const isLearning = body.is_learning ?? !item.is_learning;
          await db.decks.put({ ...item, is_learning: isLearning, learning_dirty: 1 });
          return success({ is_learning: isLearning });
        }
        await requireContentWrite(db, entity, item);
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
          const metadata = { ...body };
          if (entity === 'decks') delete metadata.is_learning;
          fields = { metadata };
        }
        if (fields) return success(await change(table, id, fields));
        throw unsupported();
      });
    }
    if (url === '/cards/duplicates' && m === 'get') {
      const decks = new Map((await db.decks.filter(d => !d.is_deleted
        && (d.user_id === userId || d.role === 'owner')).toArray()).map(d => [d.id, d]));
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
      const decks = await db.decks.toArray();
      const ownDecks = new Map(decks.filter(d => d.user_id === userId || d.role === 'owner').map(d => [d.id, d]));
      return result({ decks: await db.decks.filter(d => !!d.is_deleted && !d.hard_deleted_locally).toArray(),
        cards: (await db.cards.filter(c => !!c.is_deleted && !c.hard_deleted_locally
          && c.content_v2 && (ownDecks.has(c.deck_id) || c.deck_name)).toArray())
          .map(card => ({ ...card, deck_name: ownDecks.get(card.deck_id)?.name || card.deck_name })) });
    }
    match = url.match(/^\/trash\/(deck|card)\/(-?\d+)\/restore$/);
    if (match && m === 'post') {
      if (isStandaloneDb(db)) readOnly();
      if (match[1] === 'card') {
        const id = Number(match[2]);
        return queueCardLifecycle(db, id, body, false, userId, isCurrent);
      }
      await requireContentWrite(db, `${match[1]}s`, await db[`${match[1]}s`].get(Number(match[2])));
      await change(db[`${match[1]}s`], Number(match[2]), { is_deleted: 0, hard_deleted_locally: false });
      return success();
    }
    if (url === '/study/stats' && m === 'get') {
      const active = new Set((await db.decks.filter(d => !d.is_deleted).toArray()).map(d => d.id));
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
