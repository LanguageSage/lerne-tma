import { prepareLocalDb, getNextTempId } from './localDb';
import { calculateCardReview, getNextIntervals, isLeech } from '../utils/srsEngine';
import { getUserId, getUserProfile } from '../utils/auth';
import { localMediaURL } from './mediaCache';

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
const notFound = () => { throw new Error('Запись не найдена на устройстве. Сначала выполните синхронизацию.'); };

async function cardView(db, card, userId) {
  const progress = await db.progress.get([card.id, userId]);
  const metadata = jsonObject(card.metadata);
  return {
    ...card, front: card.front_text, back: card.back_text,
    card_type: card.card_type || 'standard', metadata, cefr: metadata.cefr,
    level: card.level || metadata.cefr?.level,
    image_url: await localMediaURL(db, card.image_path, 'images'),
    audio_url: await localMediaURL(db, card.audio_path, 'audio'),
    audio_back_url: await localMediaURL(db, card.audio_back_path, 'audio'),
    video_front_url: await localMediaURL(db, card.video_front_path, 'videos'),
    video_back_url: await localMediaURL(db, card.video_back_path, 'videos'),
    intervals: getNextIntervals(progress), is_leech: isLeech(progress?.lapses || 0),
    queue: progress?.queue || 'new', interval: progress?.interval || 0, lapses: progress?.lapses || 0,
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
  const candidates = cards.filter(c => !exclude.has(c.id)).map(card => ({ card, p: progress.get(card.id) }));
  const due = candidates.filter(({ p }) => !p || p.queue === 'new' || !p.next_review || new Date(p.next_review).getTime() <= now);
  const pool = params.get('learn_more') === 'true' ? candidates : due;
  const rank = (p) => !p || p.queue === 'new' ? 2 : ['learning', 'relearning'].includes(p.queue) ? 0 : 1;
  pool.sort((a, b) => rank(a.p) - rank(b.p)
    || new Date(a.p?.next_review || 0) - new Date(b.p?.next_review || 0)
    || (a.card.position || 0) - (b.card.position || 0));
  if (!pool.length) return result({ finished: true });
  return result({ ...await cardView(db, pool[0].card, userId), deck_stats: await deckStats(db, deckId, userId) });
}

export const offlineApi = {
  async handle(method, rawUrl, data = null, config = {}) {
    const db = await prepareLocalDb();
    const userId = getUserId();
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
      if (owner?.role === 'viewer') throw new Error('У вас доступ только для чтения');
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
        deck.is_learning = !!deck.metadata.is_learning;
      }
      const folders = ordered(await db.folders.filter(f => !f.is_deleted && (!f.target_language || f.target_language === language)).toArray());
      if (url === '/decks') return result(decks);
      if (url === '/folders') return result(folders);
      return result({ decks, folders, settings: {}, prompts: {}, user_info: getUserProfile() });
    }
    let match = url.match(/^\/decks\/(-?\d+)\/(cards|next)$/);
    if (m === 'get' && match) {
      const id = Number(match[1]);
      if (match[2] === 'next') return nextCard(db, id, userId, params);
      return result(await Promise.all((await deckCards(db, id)).map(c => cardView(db, c, userId))));
    }
    match = url.match(/^\/study\/card\/(-?\d+)$/);
    if (m === 'get' && match) {
      const card = await db.cards.get(Number(match[1]));
      if (!card || card.is_deleted) notFound();
      return result({ ...await cardView(db, card, userId), deck_stats: await deckStats(db, card.deck_id, userId) });
    }
    if (m === 'post' && ['/study/grade', '/study/duplicates/grade'].includes(url)) {
      if (![0, 1, 2, 3].includes(body.grade)) throw new Error('Некорректная оценка');
      const id = Number(body.card_id);
      const card = await db.cards.get(id);
      if (!card || card.is_deleted) notFound();
      await db.transaction('rw', db.progress, async () => {
        const progress = await db.progress.get([id, userId]) || {
          card_id: id, user_id: userId, queue: 'new', ease_factor: 2.5, interval: 0, lapses: 0, repetitions: 0,
        };
        await db.progress.put({ ...calculateCardReview(progress, body.grade), ...dirtyFields() });
      });
      const nextParams = new URLSearchParams({ exclude_ids: String(id), learn_more: String(!!body.learn_more) });
      return nextCard(db, card.deck_id, userId, nextParams);
    }
    if (m === 'post' && url === '/cards/save') {
      return db.transaction('rw', db.cards, db.decks, async () => {
        const id = Number(body.card_id || body.id) || getNextTempId();
        const previous = await db.cards.get(id);
        const deckId = Number(body.deck_id || previous?.deck_id);
        const deck = await db.decks.get(deckId);
        if (!deck || deck.is_deleted) notFound();
        if (deck.role === 'viewer') throw new Error('У вас доступ только для чтения');
        const siblings = await db.cards.where('deck_id').equals(deckId).toArray();
        const card = { ...previous, id, deck_id: deckId,
          front_text: body.front ?? body.front_text ?? previous?.front_text ?? '',
          back_text: body.back ?? body.back_text ?? previous?.back_text ?? '',
          created_at: previous?.created_at || new Date().toISOString(),
          position: previous?.position ?? Math.max(-1, ...siblings.map(c => c.position || 0)) + 1, ...dirtyFields() };
        for (const key of ['context', 'level', 'tags', 'card_type', 'image_path', 'audio_path', 'audio_back_path', 'video_front_path', 'video_back_path', 'flag']) {
          if (Object.hasOwn(body, key)) card[key] = body[key];
        }
        if (body.cefr) card.metadata = { ...jsonObject(previous?.metadata), cefr: body.cefr };
        await db.cards.put(card);
        return result({ ...card, front: card.front_text, back: card.back_text });
      });
    }
    match = url.match(/^\/(decks|folders)$/);
    if (m === 'post' && match) {
      const table = db[match[1]];
      const parentId = body.folder_id || body.parent_id;
      if (parentId) {
        const parent = await db.folders.get(Number(parentId));
        if (!parent || parent.is_deleted) notFound();
        if (parent.role === 'viewer') throw new Error('У вас доступ только для чтения');
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
            await db.progress.put({ card_id: card.id, user_id: userId, queue: 'new', interval: 0,
              ease_factor: 2.5, repetitions: 0, lapses: 0, step_index: 0, next_review: null, last_reviewed: null, ...dirtyFields() });
          }
          return success();
        }
        let fields;
        if (action === 'rename') fields = { name: body.name };
        if (action === 'color') fields = { color: body.color };
        if (action === 'flag') fields = { flag: Number(body.flag) || 0 };
        if (action === 'pin') fields = { is_pinned: !item.is_pinned };
        if (action === 'move') {
          const key = entity === 'folders' ? 'parent_id' : 'folder_id';
          const target = body[key] == null ? null : Number(body[key]);
          let ancestor = target;
          const seen = new Set();
          while (ancestor != null) {
            if (seen.has(ancestor) || (entity === 'folders' && ancestor === id)) throw new Error('Папку нельзя переместить внутрь себя');
            seen.add(ancestor);
            const folder = await db.folders.get(ancestor);
            if (!folder || folder.is_deleted) notFound();
            ancestor = folder.parent_id;
          }
          fields = { [key]: target };
        }
        if (action === 'metadata') fields = { metadata: body };
        if (action === 'toggle-learning') fields = { metadata: { ...jsonObject(item.metadata), is_learning: body.is_learning ?? !jsonObject(item.metadata).is_learning } };
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
      return result({ decks: await db.decks.filter(d => !!d.is_deleted && !d.hard_deleted_locally).toArray(),
        cards: await db.cards.filter(c => !!c.is_deleted && !c.hard_deleted_locally).toArray() });
    }
    match = url.match(/^\/trash\/(deck|card)\/(-?\d+)\/restore$/);
    if (match && m === 'post') {
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
        return { day_index: i, date: date.toISOString().slice(0, 10), day_name: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][date.getDay()], count: 0 };
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
  const error = new Error('Для этого действия требуется подключение к интернету.');
  error.code = 'OFFLINE_UNSUPPORTED';
  return error;
}
