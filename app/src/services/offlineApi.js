import { tr } from '../i18n/locale';
import { CARD_CREATE_KEY, CARD_EDIT_KEY, CARD_LIFECYCLE_KEY, CARD_MOVE_KEY, prepareLocalDb, getNextTempId } from './localDb';
import { calculateCardReview, getNextIntervals, isLeech } from '../utils/srsEngine';
import { getUserId, getUserProfile, getSessionIdentity } from '../utils/auth';
import { localMediaURL } from './mediaCache';
import { matchFolder, matchDeck, matchCard, getScopedFolders, getScopedDecks } from '../utils/search';
import { writeCardNote } from './cardNotes.js';
import { cardTypes, validateStandardDraft } from '../utils/cardDraft.js';

export const dirtyFields = () => ({
  is_dirty: 1, local_revision: crypto.randomUUID(), updated_at: new Date().toISOString(),
});
const ordered = (items) => items.sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id);
const jsonObject = (value, fallback = {}) => {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const result = (data = {}) => ({ data });
const success = (data = {}) => result({ status: 'success', ...data });
const notFound = () => { throw new Error(tr("Запись не найдена на устройстве. Сначала выполните синхронизацию.")); };
const readOnly = () => { throw new Error(tr("У вас доступ только для чтения")); };
const pendingCreate = () => { throw new Error(tr('Сначала синхронизируйте новую карточку.')); };
const pendingMove = () => { throw new Error(tr('Сначала завершите синхронизацию переноса.')); };
const pendingLifecycle = () => { throw new Error(tr('Сначала завершите синхронизацию удаления или восстановления.')); };
const mediaPaths = ['image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path'];

async function saveNativeCard(db, body, { offlineCreateFlag: flag, offlineCreateIfAvailable: ifAvailable }, userId) {
  if (body.content_v2?.schema_version !== 2 || typeof body.content_v2.card?.type !== 'string') {
    throw new Error(tr('Некорректный JSON карточки V2.'));
  }
  if (flag) throw new Error(tr('Цветную метку можно установить после синхронизации.'));
  if (!body.request_id) throw new Error('Missing card create request ID');

  return db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
    const key = CARD_CREATE_KEY + body.request_id;
    const pending = await db.syncState.get(key);
    if (pending) {
      if (JSON.stringify(pending.payload) !== JSON.stringify(body)) throw new Error('Card create request changed');
      return result(await db.cards.get(pending.tempId));
    }
    const deck = body.deck_id == null
      ? await db.decks.filter(d => d.id > 0 && d.is_inbox && (d.role === 'owner' || d.user_id === userId)
          && (!d.target_language || d.target_language === 'de') && !d.is_deleted).first()
      : await db.decks.get(body.deck_id);
    if (!deck || deck.id <= 0 || deck.is_deleted) {
      if (ifAvailable) return null;
      notFound();
    }
    if (isContentReadOnly(deck)) {
      if (ifAvailable) return null;
      readOnly();
    }
    const siblings = await db.cards.where('deck_id').equals(deck.id).filter(c => !c.is_deleted).toArray();
    const after = body.after_card_id == null ? null
      : siblings.find(c => c.id === body.after_card_id && c.id > 0 && c.content_v2);
    if (body.after_card_id != null && !after) {
      if (ifAvailable) return null;
      pendingCreate();
    }
    const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
    let id;
    do { id = getNextTempId(); } while (aliases[id] || await db.cards.get(id));
    const local = { id, deck_id: deck.id, content_v2: body.content_v2, offline_create_status: 'pending',
      is_dirty: 0, is_deleted: 0, created_at: new Date().toISOString(),
      position: after ? after.position + 0.5 : siblings.reduce((max, c) => Math.max(max, c.position || 0), -1) + 1 };
    for (const field of mediaPaths) if (Object.hasOwn(body, field)) local[field] = body[field];
    await db.cards.add(local);
    await db.syncState.add({ key, tempId: id, deckId: deck.id, payload: body });
    return result(local);
  });
}

async function queueCardMove(db, body, isCurrent, copy = false) {
  const ids = body.card_ids;
  const targetId = body.target_deck_id;
  if (!ids?.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) pendingCreate();
  if (!Number.isSafeInteger(targetId) || targetId <= 0) notFound();
  if (!body.request_id) throw new Error('Missing card transfer request ID');
  return db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
    // Keep the existing single-move key readable by previous builds.
    const key = CARD_MOVE_KEY + (!copy && ids.length === 1 ? ids[0] : body.request_id);
    const previous = await db.syncState.get(key);
    if (previous?.payload.request_id === body.request_id) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(body)) throw new Error('Card transfer request changed');
      const cards = await db.cards.bulkGet(previous.localIds || [previous.cardId]);
      return result(!copy && ids.length === 1 ? cards[0] : { cards, offline_transfer: true });
    }
    const [cards, target] = await Promise.all([db.cards.bulkGet(ids), db.decks.get(targetId)]);
    if (!target || target.is_deleted) notFound();
    if (isContentReadOnly(target)) readOnly();
    const sources = [];
    for (const card of cards) {
      if (card?.content_v2?.schema_version !== 2 || card.is_deleted) notFound();
      if (card.offline_move) pendingMove();
      if (card.offline_lifecycle) pendingLifecycle();
      if (card.offline_edit || card.is_dirty) throw new Error(tr('Сначала синхронизируйте правку карточки.'));
      if (!card.revision || card.revision !== body.revisions?.[card.id]) {
        throw new Error(tr('Исходная ревизия карточки недоступна.'));
      }
      const source = await db.decks.get(card.deck_id);
      if (!source || source.id <= 0 || source.is_deleted) notFound();
      if (!copy && isContentReadOnly(source)) readOnly();
      sources.push(source.id);
    }
    if (!copy && ids.length === 1 && cards[0].deck_id === targetId) return result(cards[0]);
    const siblings = await db.cards.where('deck_id').equals(targetId).filter(item => !item.is_deleted).toArray();
    let position = siblings.reduce((max, item) => Math.max(max, item.position || 0), 0);
    const aliases = (await db.syncState.get('aliases'))?.mappings?.cards || {};
    const locals = [];
    for (const card of cards) {
      let id = card.id;
      if (copy) {
        do { id = getNextTempId(); } while (aliases[id] || await db.cards.get(id));
      }
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

async function queueCardLifecycle(db, id, payload, deleting, userId, isCurrent) {
  if (!Number.isSafeInteger(id) || id <= 0) pendingCreate();
  return db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
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
    const deck = await db.decks.get(card.deck_id);
    if (deleting) {
      if (!deck || deck.is_deleted) notFound();
      if (isContentReadOnly(deck)) readOnly();
    } else if (deck && deck.user_id !== userId && deck.role !== 'owner') {
      readOnly();
    }
    const local = { ...card, is_deleted: deleting, offline_lifecycle: deleting ? 'delete' : 'restore' };
    await db.cards.put(local);
    await db.syncState.add({ key: CARD_LIFECYCLE_KEY + id, cardId: id, deleting, payload });
    if (!isCurrent()) throw new Error('Session changed');
    return result(local);
  });
}

async function saveNativeEdit(db, id, body, expectedConflict) {
  if (body.content_v2?.schema_version !== 2 || !cardTypes.includes(body.content_v2.card?.type)) throw unsupported();
  if (body.content_v2.card.type === 'standard') validateStandardDraft(body.content_v2.card);
  if (!body.request_id || !body.revision) throw new Error(tr('Исходная ревизия карточки недоступна.'));
  return db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
    const key = CARD_EDIT_KEY + id;
    const current = await db.cards.get(id);
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
    if (!conflict) await requireContentWrite(db, 'cards', current);
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
const initialProgress = (card, userId) => ({
  card_id: card.id, user_id: userId, queue: 'new', interval: 0, ease_factor: 2.5,
  repetitions: 0, lapses: 0, step_index: 0, next_review: null, last_reviewed: null,
  // Older caches stored personal fields on the card; retain them on first review.
  flag: card.flag ?? 0, want_to_learn: card.want_to_learn ?? false,
});
const isContentReadOnly = owner => !owner || owner.role === 'viewer'
  || (owner.is_global_readonly && owner.role !== 'owner' && owner.role !== 'editor');

async function requireContentWrite(db, entity, item) {
  if (!item) notFound();
  if (entity === 'cards' && item.offline_create_status) pendingCreate();
  const owner = entity === 'cards' ? await db.decks.get(item.deck_id) : item;
  if (isContentReadOnly(owner)) readOnly();
}

export const normalizeCardKey = (text) => {
  if (!text) return '';
  // Comparison only: retain Unicode letters, marks and numbers (including ä/ß).
  // Final NFKC composes marks introduced by filtering/lowercase, e.g. J + caron.
  return String(text).normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '').toLowerCase().normalize('NFKC');
};

async function cardView(db, card, userId, reviewContext = 'scheduled') {
  const progress = await db.progress.get([card.id, userId]);
  const metadata = jsonObject(card.metadata);
  const content = card.content_v2?.card;
  return {
    ...card, ...(content ? { level: content.level } : {
      front: card.front_text, back: card.back_text,
      card_type: card.card_type || 'standard', metadata, cefr: metadata.cefr,
      level: card.level || metadata.cefr?.level,
    }),
    image_url: await localMediaURL(db, card.image_path, 'images'),
    audio_url: await localMediaURL(db, card.audio_path, 'audio'),
    audio_back_url: await localMediaURL(db, card.audio_back_path, 'audio'),
    video_front_url: await localMediaURL(db, card.video_front_path, 'videos'),
    video_back_url: await localMediaURL(db, card.video_back_path, 'videos'),
    intervals: getNextIntervals(progress, reviewContext), is_leech: isLeech(progress?.lapses || 0),
    next_review: progress?.next_review, last_reviewed: progress?.last_reviewed,
    queue: progress?.queue || 'new', interval: progress?.interval || 0, lapses: progress?.lapses || 0,
    flag: progress?.flag ?? card.flag ?? 0,
    want_to_learn: progress?.want_to_learn ?? card.want_to_learn ?? false,
  };
}

async function deckCards(db, deckId) {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.is_deleted) notFound();
  return ordered(await db.cards.where('deck_id').equals(deckId).filter(c => !c.is_deleted).toArray());
}

async function deckStats(db, deckId, userId) {
  const cards = await deckCards(db, deckId);
  const progress = new Map((await db.progress.where('user_id').equals(userId).toArray()).map(p => [p.card_id, p]));
  const stats = { total: cards.length, new: 0, learning: 0, due: 0 };
  for (const card of cards) {
    const p = progress.get(card.id);
    if (!p || p.queue === 'new') stats.new++;
    else if (['learning', 'relearning'].includes(p.queue)) stats.learning++;
    else if (!p.next_review || new Date(p.next_review) <= new Date()) stats.due++;
  }
  return stats;
}

async function nextCard(db, deckId, userId, params) {
  const cards = await deckCards(db, deckId);
  const exclude = new Set((params.get('exclude_ids') || '').split(',').map(Number));
  const progress = new Map((await db.progress.where('user_id').equals(userId).toArray()).map(p => [p.card_id, p]));
  const now = Date.now();
  const candidates = cards.filter(c => !c.offline_create_status && !exclude.has(c.id))
    .map(card => ({ card, p: progress.get(card.id) }));
  const due = candidates.filter(({ p }) => !p || p.queue === 'new' || !p.next_review || new Date(p.next_review).getTime() <= now);
  const context = params.get('review_context') === 'forced' || params.get('learn_more') === 'true' ? 'forced' : 'scheduled';
  const pool = context === 'forced' ? candidates : due;
  const rank = (p) => !p || p.queue === 'new' ? 2 : ['learning', 'relearning'].includes(p.queue) ? 0 : 1;
  if (context !== 'forced') pool.sort((a, b) => rank(a.p) - rank(b.p)
    || new Date(a.p?.next_review || 0) - new Date(b.p?.next_review || 0)
    || (a.card.position || 0) - (b.card.position || 0));
  if (!pool.length) return result({ finished: true });
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
    const db = await prepareLocalDb();
    const isCurrent = () => userId === getUserId() && identity === getSessionIdentity();
    if (!isCurrent()) throw new Error('Session changed');
    const parsed = new URL(rawUrl, 'https://local.invalid');
    const url = parsed.pathname.replace(/\/$/, '') || '/';
    const params = parsed.searchParams;
    for (const [key, value] of Object.entries((method === 'get' ? data : config)?.params || {})) params.set(key, value);
    const m = method.toLowerCase();
    const body = data || {};
    const change = async (table, id, fields) => {
      const item = await table.get(id);
      if (!item) notFound();
      const owner = table.name === 'cards' ? await db.decks.get(item.deck_id) : item;
      if (owner?.role === 'viewer') throw new Error(tr("У вас доступ только для чтения"));
      const updated = { ...item, ...fields, ...dirtyFields() };
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
      const folders = ordered(await db.folders.filter(f => !f.is_deleted && (!f.target_language || f.target_language === language)).toArray());
      if (url === '/decks') return result(decks);
      if (url === '/folders') return result(folders);
      return result({ decks, folders, settings: {}, prompts: {}, user_info: getUserProfile() });
    }
    if (m === 'get' && url === '/cards/search') {
      const q = params.get('q') || '';
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
        const allCards = await db.cards.filter(c => !c.is_deleted && deckIds.has(c.deck_id)).toArray();
        for (const c of allCards) {
          if (matchCard(c, q)) {
            const meta = jsonObject(c.metadata);
            matchedCards.push({
              id: c.id,
              front: c.front_text || c.front,
              back: c.back_text || c.back,
              context: c.context || '',
              level: c.level || meta?.cefr?.level,
              deck_id: c.deck_id,
              deck_name: deckNameMap.get(c.deck_id) || '',
              folder_id: deckFolderMap.get(c.deck_id)
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
      return result(await Promise.all((await deckCards(db, id)).map(c => cardView(db, c, userId))));
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
      await db.transaction('rw', db.progress, db.syncState, async () => {
        const fingerprint = JSON.stringify([id, body.grade, Boolean(body.is_extended), context]);
        const receipt = await db.syncState.get(`grade:${actionId}`);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new Error('Grade action already used with different data');
          return;
        }
        const progress = await db.progress.get([id, userId]) || initialProgress(card, userId);
        const updated = { ...calculateCardReview(progress, body.grade, Boolean(body.is_extended), context), ...dirtyFields() };
        await db.progress.put(updated);
        // Same transaction as progress; every grade survives reload and batch retry.
        await db.syncState.put({ key: `grade:${actionId}`, fingerprint });
        await db.syncState.put({ key: `review:${actionId}`, action_id: actionId, card_id: id,
          rating: body.grade, review_context: context, is_extended: Boolean(body.is_extended),
          review_time: updated.last_reviewed, scheduled_interval: updated.interval });
      });
      if (body.return_next === false) return result({ status: 'success' });
      const exclude = [...new Set([...(body.exclude_ids || []), id])];
      const nextParams = new URLSearchParams({ exclude_ids: exclude.join(','), review_context: context });
      return nextCard(db, card.deck_id, userId, nextParams);
    }
    if (m === 'post' && url === '/cards/save') {
      if (Object.hasOwn(body, 'content_v2')) return saveNativeCard(db, body, config, userId);
      return db.transaction('rw', db.cards, db.decks, db.progress, async () => {
        const id = Number(body.card_id || body.id) || getNextTempId();
        const previous = await db.cards.get(id);
        const deckId = Number(body.deck_id || previous?.deck_id);
        const deck = await db.decks.get(deckId);
        if (!deck || deck.is_deleted) notFound();
        await requireContentWrite(db, 'decks', deck);
        if (previous) await requireContentWrite(db, 'cards', previous);
        const siblings = await db.cards.where('deck_id').equals(deckId).toArray();
        const card = { ...previous, id, deck_id: deckId,
          front_text: body.front ?? body.front_text ?? previous?.front_text ?? '',
          back_text: body.back ?? body.back_text ?? previous?.back_text ?? '',
          created_at: previous?.created_at || new Date().toISOString(),
          position: previous?.position ?? Math.max(-1, ...siblings.map(c => c.position || 0)) + 1, ...dirtyFields() };
        for (const key of ['context', 'level', 'tags', 'card_type', 'image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path']) {
          if (Object.hasOwn(body, key)) card[key] = body[key];
        }
        if (body.cefr) card.metadata = { ...jsonObject(previous?.metadata), cefr: body.cefr };
        await db.cards.put(card);
        let progress = await db.progress.get([id, userId]);
        if (Object.hasOwn(body, 'flag')) {
          progress = { ...(progress || initialProgress(card, userId)), flag: Number(body.flag) || 0, ...dirtyFields() };
          await db.progress.put(progress);
        }
        return result({ ...card, front: card.front_text, back: card.back_text, flag: progress?.flag ?? card.flag ?? 0 });
      });
    }
    if (m === 'post' && url === '/cards/batch-move') {
      if (body.revisions) {
        return queueCardMove(db, body, () => userId === getUserId() && identity === getSessionIdentity());
      }
      const targetDeckId = Number(body.target_deck_id);
      const cardIds = (body.card_ids || []).map(Number);
      const onDuplicate = body.on_duplicate || 'skip';
      return db.transaction('rw', db.cards, db.decks, async () => {
        const targetDeck = await db.decks.get(targetDeckId);
        if (!targetDeck || targetDeck.is_deleted) notFound();
        await requireContentWrite(db, 'decks', targetDeck);
        const siblings = await db.cards.where('deck_id').equals(targetDeckId).filter(c => !c.is_deleted).toArray();
        const existingByFront = new Map();
        for (const c of siblings) {
          const key = normalizeCardKey(c.front_text || c.front);
          if (key) existingByFront.set(key, c);
        }
        let maxPos = siblings.reduce((max, c) => Math.max(max, c.position || 0), 0);
        let movedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (let idx = 0; idx < cardIds.length; idx++) {
          const cid = cardIds[idx];
          const card = await db.cards.get(cid);
          if (card?.content_v2) throw unsupported();
          if (card && !card.is_deleted && card.deck_id !== targetDeckId) {
            await requireContentWrite(db, 'cards', card);
            const frontKey = normalizeCardKey(card.front_text || card.front);
            const existingMatch = frontKey ? existingByFront.get(frontKey) : null;
            if (existingMatch && onDuplicate === 'skip') {
              skippedCount += 1;
              continue;
            }
            if (existingMatch && onDuplicate === 'overwrite') {
              const updatedPos = idx + 1;
              await db.cards.put({
                ...existingMatch,
                front_text: card.front_text || card.front || '',
                front: card.front_text || card.front || '',
                back_text: card.back_text || card.back || '',
                back: card.back_text || card.back || '',
                card_type: card.card_type || existingMatch.card_type || 'standard',
                context: card.context || '',
                image_path: card.image_path || existingMatch.image_path,
                audio_path: card.audio_path || existingMatch.audio_path,
                audio_back_path: card.audio_back_path || existingMatch.audio_back_path,
                video_front_path: card.video_front_path || existingMatch.video_front_path,
                video_back_path: card.video_back_path || existingMatch.video_back_path,
                tags: card.tags || existingMatch.tags,
                metadata: card.metadata || existingMatch.metadata,
                position: updatedPos,
                ...dirtyFields()
              });
              await db.cards.put({ ...card, is_deleted: 1, ...dirtyFields() });
              updatedCount += 1;
              continue;
            }

            let cardPos;
            if (maxPos === 0 && siblings.length === 0) {
              cardPos = (card.position !== undefined && card.position > 0) ? card.position : (idx + 1);
            } else {
              maxPos += 1;
              cardPos = maxPos;
            }

            await db.cards.put({ ...card, deck_id: targetDeckId, position: cardPos, ...dirtyFields() });
            movedCount += 1;
            if (frontKey) existingByFront.set(frontKey, card);
          }
        }
        return success({ count: movedCount + updatedCount, moved: movedCount, updated: updatedCount, skipped: skippedCount });
      });
    }
    if (m === 'post' && url === '/cards/batch-copy') {
      if (body.revisions) return queueCardMove(db, body, isCurrent, true);
      const targetDeckId = Number(body.target_deck_id);
      const cardIds = (body.card_ids || []).map(Number);
      const onDuplicate = body.on_duplicate || 'skip';
      return db.transaction('rw', db.cards, db.decks, async () => {
        const targetDeck = await db.decks.get(targetDeckId);
        if (!targetDeck || targetDeck.is_deleted) notFound();
        await requireContentWrite(db, 'decks', targetDeck);
        const siblings = await db.cards.where('deck_id').equals(targetDeckId).filter(c => !c.is_deleted).toArray();
        const existingByFront = new Map();
        for (const c of siblings) {
          const key = normalizeCardKey(c.front_text || c.front);
          if (key) existingByFront.set(key, c);
        }
        let maxPos = siblings.reduce((max, c) => Math.max(max, c.position || 0), 0);
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (let idx = 0; idx < cardIds.length; idx++) {
          const cid = cardIds[idx];
          const card = await db.cards.get(cid);
          if (card?.content_v2) throw unsupported();
          if (card && !card.is_deleted) {
            await requireContentWrite(db, 'cards', card);
            const frontKey = normalizeCardKey(card.front_text || card.front);
            const existingMatch = frontKey ? existingByFront.get(frontKey) : null;
            if (existingMatch && onDuplicate === 'skip') {
              skippedCount += 1;
              continue;
            }
            if (existingMatch && onDuplicate === 'overwrite') {
              const updatedPos = idx + 1;
              await db.cards.put({
                ...existingMatch,
                front_text: card.front_text || card.front || '',
                front: card.front_text || card.front || '',
                back_text: card.back_text || card.back || '',
                back: card.back_text || card.back || '',
                card_type: card.card_type || existingMatch.card_type || 'standard',
                context: card.context || '',
                image_path: card.image_path || existingMatch.image_path,
                audio_path: card.audio_path || existingMatch.audio_path,
                audio_back_path: card.audio_back_path || existingMatch.audio_back_path,
                video_front_path: card.video_front_path || existingMatch.video_front_path,
                video_back_path: card.video_back_path || existingMatch.video_back_path,
                tags: card.tags || existingMatch.tags,
                metadata: card.metadata || existingMatch.metadata,
                position: updatedPos,
                ...dirtyFields()
              });
              updatedCount += 1;
              continue;
            }

            let cardPos;
            if (maxPos === 0 && siblings.length === 0) {
              cardPos = (card.position !== undefined && card.position > 0) ? card.position : (idx + 1);
            } else {
              maxPos += 1;
              cardPos = maxPos;
            }

            const newId = getNextTempId();
            const newCard = {
              ...card,
              id: newId,
              deck_id: targetDeckId,
              position: cardPos,
              created_at: new Date().toISOString(),
              ...dirtyFields()
            };
            await db.cards.put(newCard);
            createdCount += 1;
            if (frontKey) existingByFront.set(frontKey, newCard);
          }
        }
        return success({ count: createdCount + updatedCount, created: createdCount, updated: updatedCount, skipped: skippedCount });
      });
    }
    if (m === 'post' && url === '/cards/batch-delete') {
      const cardIds = (body.card_ids || []).map(Number);
      if (cardIds.length === 1 && body.revisions) return queueCardLifecycle(db, cardIds[0], body, true, userId, isCurrent);
      return db.transaction('rw', db.cards, db.decks, async () => {
        for (const cid of cardIds) {
          const card = await db.cards.get(cid);
          if (card) {
            if (card.content_v2) throw unsupported();
            await requireContentWrite(db, 'cards', card);
            await db.cards.put({ ...card, is_deleted: 1, ...dirtyFields() });
          }
        }
        return success({ count: cardIds.length });
      });
    }
    match = url.match(/^\/(decks|folders)$/);
    if (m === 'post' && match) {
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
    match = url.match(/^\/(cards|decks|folders)\/reorder$/);
    if (m === 'post' && match) {
      const table = db[match[1]];
      const ids = body[`${match[1].slice(0, -1)}_ids`] || [];
      await db.transaction('rw', table, db.decks, async () => {
        for (const id of ids) await requireContentWrite(db, match[1], await table.get(Number(id)));
        for (const [position, id] of ids.entries()) await change(table, Number(id), { position });
      });
      return success();
    }
    match = url.match(/^\/(cards|decks|folders)\/(-?\d+)(?:\/(rename|color|move|pin|flag|metadata|toggle-learning|reset))?$/);
    if (match && (m === 'post' || m === 'delete')) {
      const [, entity, rawId, action] = match;
      const id = Number(rawId);
      const table = db[entity];
      return db.transaction('rw', db.folders, db.decks, db.cards, db.progress, async () => {
        const item = await table.get(id);
        if (!item) notFound();
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
              ease_factor: 2.5, repetitions: 0, lapses: 0, step_index: 0, next_review: null, last_reviewed: null, ...dirtyFields() });
          }
          return success();
        }
        let fields;
        if (action === 'rename') fields = { name: body.name };
        if (action === 'color') fields = { color: body.color };
        if (action === 'flag') {
          if (entity !== 'cards') throw unsupported();
          const prog = await db.progress.get([id, userId]) || initialProgress(item, userId);
          prog.flag = Number(body.flag) || 0;
          Object.assign(prog, dirtyFields());
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
      const decks = new Set((await db.decks.filter(d => !d.is_deleted).toArray()).map(d => d.id));
      const cards = await db.cards.filter(c => !c.is_deleted && decks.has(c.deck_id)).toArray();
      const counts = new Map();
      for (const c of cards) counts.set(c.front_text, (counts.get(c.front_text) || 0) + 1);
      return result(await Promise.all(cards.filter(c => counts.get(c.front_text) > 1).map(c => cardView(db, c, userId))));
    }
    if (url === '/trash' && m === 'get') {
      const decks = await db.decks.toArray();
      const ownDecks = new Map(decks.filter(d => d.user_id === userId || d.role === 'owner').map(d => [d.id, d]));
      return result({ decks: await db.decks.filter(d => !!d.is_deleted && !d.hard_deleted_locally).toArray(),
        cards: (await db.cards.filter(c => !!c.is_deleted && !c.hard_deleted_locally
          && (!c.content_v2 || ownDecks.has(c.deck_id) || c.deck_name)).toArray())
          .map(card => ({ ...card, deck_name: ownDecks.get(card.deck_id)?.name || card.deck_name })) });
    }
    match = url.match(/^\/trash\/(deck|card)\/(-?\d+)\/restore$/);
    if (match && m === 'post') {
      if (match[1] === 'card') {
        const id = Number(match[2]);
        if (body.revision) return queueCardLifecycle(db, id, body, false, userId, isCurrent);
        if ((await db.cards.get(id))?.content_v2) throw unsupported();
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

function unsupported() {
  const error = new Error(tr("Для этого действия требуется подключение к интернету."));
  error.code = 'OFFLINE_UNSUPPORTED';
  return error;
}
