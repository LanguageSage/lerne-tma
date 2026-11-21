import { tr } from '../i18n/locale.js';
import { validateStandaloneCardContent } from '../utils/cardDraft.js';
import { studySideText } from '../utils/structuredStudyCard.js';
import {
  buildOriginKey,
  getMaterialExportSourceInTx,
  ID_COUNTERS_KEY,
  IMPORTED_ID_START,
} from './materialArchiveIdentity.js';
import { parseOfflineMediaRef } from './offlineMediaResolver.js';
import { mediaPaths, notFound } from '../services/cardOfflineQueue.js';

export const STANDALONE_CARD_OP_PREFIX = 'standalone-card-op:';
export const STANDALONE_MAX_CARD_OP_RECEIPTS = 64;

const MEDIA_FIELD_FOLDER = {
  image_path: 'images',
  audio_path: 'audio',
  audio_back_path: 'audio',
  video_front_path: 'videos',
  video_back_path: 'videos',
};

let standaloneCardOpSeq = 0;

export function canonicalCompareValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined ? 'null' : canonicalCompareValue(item))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalCompareValue(value[key])}`).join(',')}}`;
  }
  return 'null';
}

function normalizeStandaloneMediaPath(rawPath, field) {
  if (rawPath == null || rawPath === '') return null;
  if (typeof rawPath !== 'string') {
    throw new Error(tr('Некорректная локальная ссылка медиа: {{p0}}', { p0: field }));
  }
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  const expectedFolder = MEDIA_FIELD_FOLDER[field];
  const parsed = parseOfflineMediaRef(trimmed, expectedFolder);
  if (!parsed || parsed.folder !== expectedFolder) {
    throw new Error(tr('Некорректная локальная ссылка медиа: {{p0}}', { p0: field }));
  }
  return parsed;
}

function normalizePureJson(envelope) {
  return JSON.parse(JSON.stringify(envelope));
}

function normalizeMediaForStorage(body, envelope) {
  const normalized = normalizePureJson(envelope);
  const mediaPatch = {};
  for (const field of mediaPaths) {
    if (!Object.hasOwn(body, field)) continue;
    const parsed = normalizeStandaloneMediaPath(body[field], field);
    mediaPatch[field] = parsed ? parsed.canonicalUrl : null;
  }
  if (normalized.card.image != null) {
    const parsedCardImage = normalizeStandaloneMediaPath(normalized.card.image, 'image_path');
    if (parsedCardImage) {
      normalized.card.image = parsedCardImage.relativePath;
    }
  }
  return { normalized, mediaPatch };
}

async function pruneCardOpReceipts(db, keepKey) {
  const receipts = await db.syncState.where('key').startsWith(STANDALONE_CARD_OP_PREFIX).toArray();
  if (receipts.length <= STANDALONE_MAX_CARD_OP_RECEIPTS) return;
  receipts.sort((a, b) => (a.created_at || 0) - (b.created_at || 0)
    || (a.seq || 0) - (b.seq || 0)
    || a.key.localeCompare(b.key));
  const excess = receipts.length - STANDALONE_MAX_CARD_OP_RECEIPTS;
  const keysToDelete = receipts
    .filter(item => item.key !== keepKey)
    .slice(0, excess)
    .map(item => item.key);
  if (keysToDelete.length > 0) {
    await db.syncState.bulkDelete(keysToDelete);
  }
}

function buildInitialProgressRow(cardId, userId, flag, nowIso) {
  return {
    card_id: cardId,
    user_id: userId,
    queue: 'new',
    interval: 0,
    ease_factor: 2.5,
    repetitions: 0,
    lapses: 0,
    step_index: 0,
    next_review: null,
    last_reviewed: null,
    flag: Number(flag) || 0,
    want_to_learn: false,
    is_dirty: 0,
    updated_at: nowIso,
  };
}

export async function createStandaloneCard(db, body, { flag = 0 } = {}, userId = null) {
  if (!body?.request_id || typeof body.request_id !== 'string') {
    throw new Error('Missing card create request ID');
  }
  validateStandaloneCardContent(body.content_v2);
  if (body.content_v2.card.layout != null) {
    throw new Error(tr('Изменение макета (layout) карточки пока недоступно без редактора дизайна. Редактируйте содержимое карточки без изменения layout.'));
  }

  const { normalized: normalizedContent, mediaPatch } = normalizeMediaForStorage(body, body.content_v2);
  const fingerprint = canonicalCompareValue({
    op: 'create',
    deck_id: Number(body.deck_id),
    after_card_id: body.after_card_id ?? null,
    flag: Number(flag) || 0,
    content_v2: normalizedContent,
    mediaPatch,
  });
  const opKey = STANDALONE_CARD_OP_PREFIX + body.request_id;
  const nowIso = new Date().toISOString();

  return db.transaction('rw', db.cards, db.decks, db.progress, db.syncState, async () => {
    const existingOp = await db.syncState.get(opKey);
    if (existingOp) {
      if (existingOp.fingerprint !== fingerprint) {
        throw new Error('Card create request changed');
      }
      const existingCard = await db.cards.get(existingOp.cardId);
      if (!existingCard) notFound();
      return existingCard;
    }

    const deckId = Number(body.deck_id);
    const deck = Number.isSafeInteger(deckId) ? await db.decks.get(deckId) : null;
    if (!deck || deck.is_deleted) notFound();

    const [countersRecord, existingCardKeys, siblingsRaw, exportSource] = await Promise.all([
      db.syncState.get(ID_COUNTERS_KEY),
      db.cards.toCollection().primaryKeys(),
      db.cards.where('deck_id').equals(deck.id).filter(c => !c.is_deleted).toArray(),
      getMaterialExportSourceInTx(db),
    ]);

    const maxExistingId = existingCardKeys.reduce((max, key) => {
      const n = Number(key);
      return Number.isFinite(n) && n > max ? n : max;
    }, IMPORTED_ID_START);
    const nextCardId = Math.max(IMPORTED_ID_START, Number(countersRecord?.card) || 0, maxExistingId) + 1;

    await db.syncState.put({
      ...(countersRecord || {}),
      key: ID_COUNTERS_KEY,
      card: nextCardId,
    });

    const siblings = siblingsRaw.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    let position;
    const shiftedSiblings = [];
    const afterCardId = body.after_card_id != null ? Number(body.after_card_id) : null;
    const afterIdx = afterCardId != null ? siblings.findIndex(c => c.id === afterCardId) : -1;
    if (afterIdx >= 0) {
      const afterPos = Number.isInteger(siblings[afterIdx].position) ? siblings[afterIdx].position : afterIdx;
      position = afterPos + 1;
      let prevPos = position;
      for (let i = afterIdx + 1; i < siblings.length; i += 1) {
        const sib = siblings[i];
        if (!Number.isInteger(sib.position) || sib.position <= prevPos) {
          const nextPos = prevPos + 1;
          shiftedSiblings.push({ ...sib, position: nextPos });
          prevPos = nextPos;
        } else {
          prevPos = sib.position;
        }
      }
      if (shiftedSiblings.length > 0) {
        await db.cards.bulkPut(shiftedSiblings);
      }
    } else {
      position = siblings.reduce(
        (max, c) => Math.max(max, Number.isInteger(c.position) ? c.position : -1),
        -1,
      ) + 1;
    }

    const localCard = {
      id: nextCardId,
      deck_id: deck.id,
      position,
      target_language: deck.target_language || 'de',
      content_v2: normalizedContent,
      front_text: studySideText(normalizedContent.card, 'front'),
      image_path: mediaPatch.image_path ?? null,
      audio_path: mediaPatch.audio_path ?? null,
      audio_back_path: mediaPatch.audio_back_path ?? null,
      video_front_path: mediaPatch.video_front_path ?? null,
      video_back_path: mediaPatch.video_back_path ?? null,
      difficulty: null,
      source: 'user',
      revision: 1,
      standalone_card_key: buildOriginKey(exportSource, 'card', nextCardId),
      standalone_local_created: true,
      standalone_local_edit: true,
      standalone_local_edited_at: nowIso,
      is_deleted: 0,
      is_dirty: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await db.cards.add(localCard);

    if (Number(flag) > 0 && userId != null) {
      await db.progress.put(buildInitialProgressRow(nextCardId, userId, flag, nowIso));
    }

    standaloneCardOpSeq += 1;
    await db.syncState.put({
      key: opKey,
      op: 'create',
      cardId: nextCardId,
      fingerprint,
      created_at: Date.now(),
      seq: standaloneCardOpSeq,
    });
    await pruneCardOpReceipts(db, opKey);

    return localCard;
  });
}

export async function updateStandaloneCard(db, id, body, { flag } = {}, userId = null) {
  const cardId = Number(id);
  if (!Number.isSafeInteger(cardId) || cardId <= 0) {
    notFound();
  }
  if (!body?.request_id || typeof body.request_id !== 'string') {
    throw new Error('Missing card edit request ID');
  }
  validateStandaloneCardContent(body.content_v2);

  const { normalized: normalizedContent, mediaPatch } = normalizeMediaForStorage(body, body.content_v2);
  const fingerprint = canonicalCompareValue({
    op: 'update',
    cardId,
    flag: flag !== undefined ? (Number(flag) || 0) : undefined,
    content_v2: normalizedContent,
    mediaPatch,
  });
  const opKey = STANDALONE_CARD_OP_PREFIX + body.request_id;
  const nowIso = new Date().toISOString();

  return db.transaction('rw', db.cards, db.decks, db.progress, db.syncState, async () => {
    const existingOp = await db.syncState.get(opKey);
    if (existingOp) {
      if (existingOp.fingerprint !== fingerprint) {
        throw new Error('Card edit request changed');
      }
      const existingCard = await db.cards.get(cardId);
      if (!existingCard || existingCard.is_deleted) notFound();
      return existingCard;
    }

    const current = await db.cards.get(cardId);
    if (!current?.content_v2 || current.is_deleted) notFound();

    const deck = await db.decks.get(current.deck_id);
    if (!deck || deck.is_deleted) notFound();

    const currentLayout = current.content_v2.card.layout ?? null;
    const nextLayout = normalizedContent.card.layout ?? null;
    if (canonicalCompareValue(currentLayout) !== canonicalCompareValue(nextLayout)) {
      throw new Error(tr('Изменение макета (layout) карточки пока недоступно без редактора дизайна. Сохраните исходный layout или редактируйте содержимое карточки.'));
    }

    const updated = {
      ...current,
      content_v2: normalizedContent,
      front_text: studySideText(normalizedContent.card, 'front'),
      revision: (Number(current.revision) || 0) + 1,
      standalone_local_edit: true,
      standalone_local_edited_at: nowIso,
      is_dirty: 0,
      updated_at: nowIso,
    };

    for (const field of mediaPaths) {
      if (!Object.hasOwn(mediaPatch, field)) continue;
      if (updated[field] !== mediaPatch[field]) {
        delete updated[field.replace('_path', '_url')];
      }
      updated[field] = mediaPatch[field];
    }

    delete updated.offline_edit;
    delete updated.offline_create_status;
    delete updated.offline_create_error;
    delete updated.offline_create_request_id;
    delete updated.offline_move;
    delete updated.offline_lifecycle;

    await db.cards.put(updated);

    if (flag !== undefined && userId != null) {
      const normalizedFlag = Number(flag) || 0;
      const existingProgress = await db.progress.get([cardId, userId]);
      if (existingProgress) {
        if (Number(existingProgress.flag ?? 0) !== normalizedFlag) {
          await db.progress.put({
            ...existingProgress,
            flag: normalizedFlag,
            updated_at: nowIso,
          });
        }
      } else if (normalizedFlag > 0) {
        await db.progress.put(buildInitialProgressRow(cardId, userId, normalizedFlag, nowIso));
      }
    }

    standaloneCardOpSeq += 1;
    await db.syncState.put({
      key: opKey,
      op: 'update',
      cardId,
      fingerprint,
      created_at: Date.now(),
      seq: standaloneCardOpSeq,
    });
    await pruneCardOpReceipts(db, opKey);

    return updated;
  });
}

export async function deleteStandaloneCard(db, id, body = {}) {
  const cardId = Number(id);
  if (!Number.isSafeInteger(cardId) || cardId <= 0) {
    notFound();
  }
  const nowIso = new Date().toISOString();
  const opKey = body?.request_id ? STANDALONE_CARD_OP_PREFIX + body.request_id : null;

  return db.transaction('rw', db.cards, db.decks, db.syncState, async () => {
    if (opKey) {
      const existingOp = await db.syncState.get(opKey);
      if (existingOp) {
        if (existingOp.op !== 'delete' || existingOp.cardId !== cardId) {
          throw new Error('Card delete request changed');
        }
        const existingCard = await db.cards.get(cardId);
        if (!existingCard) notFound();
        return existingCard;
      }
    }

    const current = await db.cards.get(cardId);
    if (!current) notFound();
    if (current.is_deleted) {
      return { ...current, is_deleted: 1 };
    }

    const deck = await db.decks.get(current.deck_id);
    if (!deck || deck.is_deleted) notFound();

    const deletedCard = {
      ...current,
      is_deleted: 1,
      is_dirty: 0,
      standalone_local_edit: true,
      standalone_local_edited_at: nowIso,
      updated_at: nowIso,
    };
    delete deletedCard.offline_lifecycle;
    delete deletedCard.offline_edit;
    delete deletedCard.offline_create_status;
    delete deletedCard.offline_create_error;
    delete deletedCard.offline_create_request_id;

    await db.cards.put(deletedCard);

    if (opKey) {
      standaloneCardOpSeq += 1;
      await db.syncState.put({
        key: opKey,
        op: 'delete',
        cardId,
        created_at: Date.now(),
        seq: standaloneCardOpSeq,
      });
      await pruneCardOpReceipts(db, opKey);
    }

    return deletedCard;
  });
}
