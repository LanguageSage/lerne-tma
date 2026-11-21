import { tr } from '../i18n/locale.js';
import { studySideText } from './structuredStudyCard.js';
import { addLayoutImage, readableLayout } from './cardLayout.js';

const text = { type: 'text', text: '' };
const option = { text: '', correct: false };
const pair = { left: '', right: '' };
const defaults = {
  standard: { prompt: '', answer: '' },
  theory: { text: '', summary: '' },
  trainer: { parts: [text, { type: 'input', answers: [''] }], back_note: '' },
  quiz: { prompt: '', options: [{ ...option, correct: true }, option], back_note: '' },
  match: { pairs: [pair, pair], back_note: '' },
  puzzle: { tokens: [], translation: '' },
  word_bank: { options: [], parts: [text] },
  free_text: { prompt: '', sample_answer: '', accepted_answers: [] },
  editable_text: { source_text: '', correct_text: '', accepted_answers: [] },
};

export const cardTypes = Object.keys(defaults);
export const newCardContent = (type = 'standard') => ({
  schema_version: 2, card: { type, data: structuredClone(defaults[type]), info: [], explanation: '' },
});

export const promptField = { standard: 'prompt', theory: 'text', quiz: 'prompt', free_text: 'prompt', editable_text: 'source_text' };
export const answerField = { standard: 'answer', theory: 'summary', trainer: 'back_note', quiz: 'back_note',
  match: 'back_note', free_text: 'sample_answer', editable_text: 'correct_text' };

export function puzzleDraftTokens(sentence, originalTokens) {
  // Native V2 can contain multi-word tiles. Preserve them if the text was not changed.
  return sentence === originalTokens.join(' ') ? originalTokens : sentence.match(/[^\p{White_Space}]+/gu) || [];
}

export function patchGradingPolicy(card, field, value) {
  const current = card.data.grading_policy;
  if (value === undefined && !Object.hasOwn(current ?? {}, field)) return card;
  // In FreeText, an absent policy defaults to open_text, while an empty policy
  // object defaults to controlled_text. Keep the effective mode on the first edit.
  const gradingPolicy = { ...(current ?? (card.type === 'free_text' ? { mode: 'open_text' } : {})) };
  if (value === undefined) delete gradingPolicy[field];
  else gradingPolicy[field] = value;
  return { ...card, data: { ...card.data, grading_policy: gradingPolicy } };
}

export function changeDraft(setter, update) {
  setter(current => current?.content_v2 && !draftSourceError(current)
    ? withDraftCard(current, update(current.content_v2.card)) : current);
}

function withDraftCard(draft, card) {
  if (draft.content_v2.card === card) return draft;
  const content = { ...draft.content_v2, card };
  return { ...draft, content_v2: content,
    ...(draft.content_v2_source != null ? { content_v2_source: JSON.stringify(content, null, 2) } : {}) };
}

function readDraftSource(source) {
  try { return { content: parseCardSource(source), error: null }; }
  catch (failure) { return { error: failure.translationKey }; }
}

export function draftSourceError(draft) {
  if (draft?.content_v2_source == null) return null;
  return Object.hasOwn(draft, 'content_v2_source_error')
    ? draft.content_v2_source_error : readDraftSource(draft.content_v2_source).error;
}

export function changeDraftSource(setter, source) {
  const { content, error } = source === null ? { error: null } : readDraftSource(source);
  setter(current => {
    const next = { ...current, content_v2_source: source, content_v2_source_error: error,
      ...(content ? { content_v2: content } : {}) };
    if (!content || !current.pendingLayoutImages?.length) return next;
    delete next.pendingLayoutImages;
    const card = current.pendingLayoutImages.reduce(addLayoutImage, content.card);
    return withDraftCard(next, card);
  });
}

export function attachDraftImage(setter, cardId, path) {
  setter(current => {
    if (!current?.content_v2 || current.id !== cardId) return current;
    if (draftSourceError(current)) {
      return { ...current, pendingLayoutImages: [...(current.pendingLayoutImages ?? []), path] };
    }
    return withDraftCard(current, addLayoutImage(current.content_v2.card, path));
  });
}

function sourceFailure(translationKey) {
  return Object.assign(new Error(tr(translationKey)), { translationKey });
}

function readableTrainerPart(part) {
  switch (part?.type) {
    case 'text': return typeof part.text === 'string';
    case 'input': return Array.isArray(part.answers) && part.answers.every(answer => typeof answer === 'string');
    case 'choice': return Array.isArray(part.options) && part.options.every(option => typeof option?.text === 'string');
    default: return false;
  }
}

// Only guard the editor's readable shape. Domain validation still belongs to
// card-core on the server, including validation of queued offline writes.
export function parseCardSource(source) {
  let content;
  try { content = JSON.parse(source); }
  catch { throw sourceFailure('Некорректный JSON. Исправьте исходный текст.'); }
  const card = content?.card;
  try {
    if (content.schema_version !== 2 || !cardTypes.includes(card?.type)
      || !card.data || Array.isArray(card.data) || typeof card.data !== 'object'
      || (card.info != null && !Array.isArray(card.info))
      || card.info?.some(block => block?.type === 'options'
        ? !Array.isArray(block.items) || block.items.some(item => typeof item !== 'string')
        : typeof block?.text !== 'string')
      || (card.type === 'trainer' && (!Array.isArray(card.data.parts) || !card.data.parts.every(readableTrainerPart)))
      || (card.type === 'quiz' && (!Array.isArray(card.data.options)
        || card.data.options.some(option => typeof option?.text !== 'string')))
      || (card.type === 'match' && (!Array.isArray(card.data.pairs)
        || card.data.pairs.some(pair => typeof pair?.left !== 'string' || typeof pair?.right !== 'string')))
      || (['free_text', 'editable_text'].includes(card.type) && (
        (card.data.accepted_answers !== undefined && (!Array.isArray(card.data.accepted_answers)
          || card.data.accepted_answers.some(answer => typeof answer !== 'string')))
        || (card.data.grading_policy !== undefined && (!card.data.grading_policy
          || typeof card.data.grading_policy !== 'object' || Array.isArray(card.data.grading_policy)))))
      || (card.type === 'puzzle' && (!Array.isArray(card.data.tokens)
        || card.data.tokens.some(token => typeof token !== 'string')))
      || (card.type === 'word_bank' && (!Array.isArray(card.data.options)
        || card.data.options.some(option => typeof option !== 'string')
        || !Array.isArray(card.data.parts)
        || card.data.parts.some(part => part?.type === 'text' ? typeof part.text !== 'string'
          : part?.type !== 'gap' || !Number.isInteger(part.option) || part.option < 0
            || typeof card.data.options[part.option] !== 'string')))
      || !readableLayout(card)
      || (card.topics != null && !Array.isArray(card.topics))
      || (card.explanation != null && typeof card.explanation !== 'string')
      || typeof studySideText(card) !== 'string' || typeof studySideText(card, 'back') !== 'string') {
      throw new Error();
    }
  } catch { throw sourceFailure('Ожидается полный content_v2: schema_version: 2 и card с типом и данными.'); }
  return content;
}

export function validateStandardDraft(card) {
  const nonBlank = value => typeof value === 'string' && /[^\p{White_Space}]/u.test(value);
  if (!nonBlank(card.data?.prompt)
    || (card.data?.answer !== undefined && typeof card.data.answer !== 'string')
    || card.topics?.some(topic => !nonBlank(topic))
    || card.info?.some(block => block.type === 'options'
      ? !block.items?.length || block.items.some(item => !nonBlank(item))
      : !nonBlank(block.text))) {
    throw new Error(tr('Заполните вопрос, ответ и добавленные поля карточки.'));
  }
  const canonical = { id: null, image: null, info: [], explanation: '', level: null, topics: null, metadata: {}, ...card };
  let invalidText = false;
  const encoded = JSON.stringify(canonical, (key, value) => {
    if (key.includes('\0') || (typeof value === 'string' && value.includes('\0'))) invalidText = true;
    return value;
  });
  if (invalidText || new TextEncoder().encode(encoded).length > 256 * 1024) {
    throw new Error(tr('Недопустимый текст или размер карточки.'));
  }
}

const V2_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const V2_CARD_KEYS = new Set(['id', 'type', 'data', 'image', 'info', 'layout', 'explanation', 'level', 'topics', 'metadata']);
const V2_INFO_ROLES = new Set(['task', 'source', 'example', 'text']);
const V2_VISIBILITIES = new Set(['before_answer', 'after_answer']);
const V2_GRADING_MODES = new Set(['open_text', 'controlled_text', 'exact']);
const V2_GRADING_POLICY_KEYS = new Set([
  'mode', 'max_retries', 'typo_tolerance', 'semantic_equivalence',
  'grammar_requires_retry', 'case_sensitive', 'punctuation_sensitive',
]);
const V2_CARD_DEFAULTS = {
  id: null, image: null, info: [], layout: null, explanation: '', level: null, topics: null, metadata: {},
};
const V2_DATA_DEFAULTS = {
  standard: { answer: '' }, theory: { summary: '' }, puzzle: { translation: '' },
  trainer: { back_note: '' }, quiz: { back_note: '' }, match: { back_note: '' },
  free_text: { accepted_answers: [] }, editable_text: { accepted_answers: [] },
};
const V2_GRADING_DEFAULTS = {
  mode: 'controlled_text', typo_tolerance: true, semantic_equivalence: true,
  grammar_requires_retry: true, case_sensitive: false, punctuation_sensitive: false, max_retries: 3,
};
const V2_CONTENT_META_KEYS = new Set([
  'front', 'front_text', 'back', 'back_text', 'context', 'type', 'card_type',
  'image', 'image_path', 'data', 'parts', 'info', 'explanation', 'level', 'topics', 'cards',
  'accepted_answers', 'grading_policy', 'intro', 'pedagogy', 'passport',
  'text', 'prompt', 'answer', 'answers', 'options', 'pairs', 'tokens', 'back_note',
  'sample_answer', 'source_text', 'correct_text', 'summary', 'translation',
]);
const V2_FORBIDDEN_META_KEYS = new Set([
  'progress', 'srs', 'review_history', 'history', 'session', 'sessions',
  'access_token', 'refresh_token', 'password', 'secret', 'api_key', 'service_role',
  'apikey', 'accesstoken', 'refreshtoken', 'supabase_key', 'authorization',
  'auth', 'authentication', 'jwt', 'cookie', 'cookies', 'session_id', 'session_token',
  'client_secret', 'bot_token', 'credentials', 'user_progress', 'next_review',
  'last_reviewed', 'ease_factor', 'repetitions', 'lapses', 'review_count',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyAllowedKeys(obj, allowed) {
  return Object.keys(obj).every(key => allowed.has(key));
}

function isNonBlankText(value) {
  return typeof value === 'string' && /[^\p{White_Space}]/u.test(value);
}

function trimLikePython(value) {
  // str.strip() also strips U+001C–U+001F and retains U+FEFF.
  const spaces = String.raw`[\p{White_Space}${'\u001c-\u001f'}]`;
  return value.replace(new RegExp(`^${spaces}+|${spaces}+$`, 'gu'), '');
}

function exceedsAnswerLimit(value) {
  if (value.length <= 4000) return false;
  let index = 0;
  for (let characters = 0; index < value.length; characters += 1) {
    if (characters === 4000) return true;
    index += value.codePointAt(index) > 0xffff ? 2 : 1;
  }
  return false;
}

function validateSerializedCardSize(card) {
  // Match card-core's model dump for the byte limit without altering the stored draft.
  const withOptionDefaults = option => ({ correct: false, ...option });
  const data = { ...V2_DATA_DEFAULTS[card.type], ...card.data };
  if (card.type === 'quiz') data.options = data.options.map(withOptionDefaults);
  if (card.type === 'trainer') {
    data.parts = data.parts.map(part => part.type === 'choice'
      ? { distractors: null, ...part, options: part.options.map(withOptionDefaults) }
      : part);
  }
  if (card.type === 'free_text' || card.type === 'editable_text') {
    data.grading_policy = {
      ...V2_GRADING_DEFAULTS,
      ...(card.type === 'editable_text' ? { typo_tolerance: false }
        : data.grading_policy === undefined ? { mode: 'open_text' } : {}),
      ...data.grading_policy,
    };
  }
  const normalized = { ...V2_CARD_DEFAULTS, ...card, data };
  if (card.layout) {
    normalized.layout = card.layout.map(item => {
      if (item.type === 'image') return { alt: '', caption: '', visibility: 'before_answer', ...item };
      return item.type === 'info' ? { visibility: 'before_answer', ...item } : item;
    });
  }

  let invalidText = false;
  let numberByteAdjustment = 0;
  const invalidJsonText = text => text.includes('\0') || /[\ud800-\udfff]/u.test(text);
  const encoded = JSON.stringify(normalized, (key, value) => {
    if (invalidJsonText(key) || (typeof value === 'string' && invalidJsonText(value))) invalidText = true;
    if (typeof value === 'number' && value !== 0 && Math.abs(value) < 0.0001) {
      // Python formats small floats with a two-digit exponent.
      numberByteAdjustment += value.toExponential().replace(/e-(\d)$/, 'e-0$1').length - String(value).length;
    }
    return value;
  });
  if (invalidText || new TextEncoder().encode(encoded).length + numberByteAdjustment > 256 * 1024) {
    throw new Error(tr('Недопустимый текст или размер карточки.'));
  }
}

function checkAllowedKeys(obj, allowed, message) {
  if (!isPlainObject(obj) || !hasOnlyAllowedKeys(obj, allowed)) {
    throw new Error(message);
  }
}

function validateCardMetadata(metadata) {
  if (!isPlainObject(metadata)) {
    throw new Error(tr('Некорректный формат metadata карточки V2.'));
  }
  for (const key of Object.keys(metadata)) {
    if (V2_CONTENT_META_KEYS.has(key)) {
      throw new Error(tr('Недопустимое поле в metadata карточки V2.'));
    }
  }
  const visit = (item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new Error(tr('Недопустимый текст или размер карточки.'));
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (isPlainObject(item)) {
      for (const [key, value] of Object.entries(item)) {
        const normalized = key.toLowerCase().replaceAll('-', '_');
        if (
          V2_FORBIDDEN_META_KEYS.has(normalized)
          || normalized.endsWith('_secret')
          || normalized.endsWith('_password')
          || normalized.endsWith('_token')
        ) {
          throw new Error(tr('Метаданные содержат недопустимые служебные ключи.'));
        }
        visit(value);
      }
    }
  };
  visit(metadata);
}

function validateWrittenAnswers(data, allowOpenText) {
  if (data.accepted_answers !== undefined) {
    if (!Array.isArray(data.accepted_answers) || data.accepted_answers.length > 20
      || data.accepted_answers.some(ans => !isNonBlankText(ans) || exceedsAnswerLimit(ans))) {
      throw new Error(tr('Допустимые ответы: не более 20 непустых вариантов до 4000 символов.'));
    }
  }
  if (data.grading_policy !== undefined) {
    checkAllowedKeys(data.grading_policy, V2_GRADING_POLICY_KEYS, tr('Некорректные настройки проверки ответа.'));
    const p = data.grading_policy;
    if (p.mode !== undefined) {
      if (!V2_GRADING_MODES.has(p.mode)) throw new Error(tr('Некорректный режим проверки ответа.'));
      if (!allowOpenText && p.mode === 'open_text') {
        throw new Error(tr('Для Editable Text выберите controlled_text или exact.'));
      }
    }
    if (p.max_retries !== undefined && (!Number.isInteger(p.max_retries) || p.max_retries < 1 || p.max_retries > 10)) {
      throw new Error(tr('Лимит попыток должен быть от 1 до 10.'));
    }
    for (const boolKey of ['typo_tolerance', 'semantic_equivalence', 'grammar_requires_retry', 'case_sensitive', 'punctuation_sensitive']) {
      if (p[boolKey] !== undefined && typeof p[boolKey] !== 'boolean') {
        throw new Error(tr('Некорректные настройки проверки ответа.'));
      }
    }
  }
}

export function validateStandaloneCardContent(envelope) {
  if (!isPlainObject(envelope) || Object.keys(envelope).length !== 2 || envelope.schema_version !== 2 || !isPlainObject(envelope.card)) {
    throw new Error(tr('Ожидается полный content_v2: schema_version: 2 и card с типом и данными.'));
  }
  const card = envelope.card;
  if (!hasOnlyAllowedKeys(card, V2_CARD_KEYS) || !cardTypes.includes(card.type) || !isPlainObject(card.data)) {
    throw new Error(tr('Некорректный тип или данные карточки Native V2.'));
  }
  if (card.id !== undefined && card.id !== null && !isNonBlankText(card.id)) {
    throw new Error(tr('Некорректный идентификатор карточки V2.'));
  }
  if (card.level !== undefined && card.level !== null && !V2_LEVELS.has(card.level)) {
    throw new Error(tr('Некорректный уровень CEFR карточки V2.'));
  }
  if (card.explanation !== undefined && typeof card.explanation !== 'string') {
    throw new Error(tr('Некорректное поле контекста карточки V2.'));
  }
  if (card.image != null && !isNonBlankText(card.image)) {
    throw new Error(tr('Некорректный путь обложки карточки V2.'));
  }
  if (card.topics !== undefined && card.topics !== null) {
    if (!Array.isArray(card.topics) || card.topics.some(topic => !isNonBlankText(topic))) {
      throw new Error(tr('Темы карточки не должны быть пустыми.'));
    }
  }
  if (card.metadata !== undefined) {
    validateCardMetadata(card.metadata);
  }
  if (card.info !== undefined && !Array.isArray(card.info)) {
    throw new Error(tr('Некорректный блок info карточки V2.'));
  }

  const infoList = card.info || [];
  for (const block of infoList) {
    if (!isPlainObject(block)) throw new Error(tr('Некорректный элемент info в карточке V2.'));
    if (block.type === 'options') {
      checkAllowedKeys(block, new Set(['type', 'items']), tr('Некорректный элемент info в карточке V2.'));
      if (!Array.isArray(block.items) || block.items.length === 0 || block.items.some(item => !isNonBlankText(item))) {
        throw new Error(tr('Заполните варианты подсказки в info.'));
      }
    } else if (V2_INFO_ROLES.has(block.type)) {
      checkAllowedKeys(block, new Set(['type', 'text']), tr('Некорректный элемент info в карточке V2.'));
      if (!isNonBlankText(block.text)) {
        throw new Error(tr('Заполните или удалите пустые текстовые блоки карточки.'));
      }
    } else {
      throw new Error(tr('Неизвестный тип блока info в карточке V2.'));
    }
  }

  if (card.layout !== undefined && card.layout !== null) {
    if (!Array.isArray(card.layout) || card.layout.length === 0 || card.layout.length > 500) {
      throw new Error(tr('Некорректная разметка layout карточки V2.'));
    }
    const ids = new Set();
    let exerciseCount = 0;
    const infoIndices = [];
    for (const el of card.layout) {
      if (!isPlainObject(el) || typeof el.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(el.id)) {
        throw new Error(tr('Некорректный идентификатор элемента layout V2.'));
      }
      if (ids.has(el.id)) throw new Error(tr('Повторный ID элемента layout V2.'));
      ids.add(el.id);

      if (el.type === 'exercise') {
        checkAllowedKeys(el, new Set(['id', 'type']), tr('Неизвестный элемент layout V2.'));
        exerciseCount += 1;
      } else if (el.type === 'info') {
        checkAllowedKeys(el, new Set(['id', 'type', 'index', 'visibility']), tr('Неизвестный элемент layout V2.'));
        if (!Number.isInteger(el.index) || el.index < 0 || el.index >= infoList.length) {
          throw new Error(tr('Некорректный индекс info в layout V2.'));
        }
        if (el.visibility !== undefined && !V2_VISIBILITIES.has(el.visibility)) {
          throw new Error(tr('Некорректная видимость элемента layout V2.'));
        }
        infoIndices.push(el.index);
      } else if (el.type === 'image') {
        checkAllowedKeys(el, new Set(['id', 'type', 'path', 'alt', 'caption', 'visibility']), tr('Неизвестный элемент layout V2.'));
        if (typeof el.path !== 'string' || el.path.length > 1024
          || !/^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(el.path)) {
          throw new Error(tr('Некорректный путь изображения в layout V2.'));
        }
        if ((el.alt !== undefined && typeof el.alt !== 'string') || (el.caption !== undefined && typeof el.caption !== 'string')) {
          throw new Error(tr('Некорректное описание изображения в layout V2.'));
        }
        if (el.visibility !== undefined && !V2_VISIBILITIES.has(el.visibility)) {
          throw new Error(tr('Некорректная видимость элемента layout V2.'));
        }
      } else {
        throw new Error(tr('Неизвестный элемент layout V2.'));
      }
    }
    const sorted = [...infoIndices].sort((a, b) => a - b);
    if (exerciseCount !== 1 || infoIndices.length !== infoList.length || sorted.some((val, idx) => val !== idx)) {
      throw new Error(tr('Разметка layout V2 должна содержать ровно один exercise и все info.'));
    }
  }

  const { type, data } = card;
  switch (type) {
    case 'standard':
      checkAllowedKeys(data, new Set(['prompt', 'answer']), tr('Некорректные поля карточки Standard.'));
      if (!isNonBlankText(data.prompt) || (data.answer !== undefined && typeof data.answer !== 'string')) {
        throw new Error(tr('Заполните вопрос и добавленные поля карточки.'));
      }
      break;
    case 'theory':
      checkAllowedKeys(data, new Set(['text', 'summary']), tr('Некорректные поля карточки Theory.'));
      if (!isNonBlankText(data.text) || (data.summary !== undefined && typeof data.summary !== 'string')) {
        throw new Error(tr('Введите теоретический текст карточки.'));
      }
      break;
    case 'trainer': {
      checkAllowedKeys(data, new Set(['back_note', 'parts']), tr('Некорректные поля карточки Trainer.'));
      if (data.back_note !== undefined && typeof data.back_note !== 'string') {
        throw new Error(tr('Некорректные поля карточки Trainer.'));
      }
      if (!Array.isArray(data.parts) || data.parts.length === 0 || !data.parts.some(p => p?.type === 'input' || p?.type === 'choice')) {
        throw new Error(tr('Добавьте в тренажёр хотя бы один пропуск с вводом или выбором.'));
      }
      for (const part of data.parts) {
        if (!isPlainObject(part)) throw new Error(tr('Некорректный фрагмент в карточке тренажёра.'));
        if (part.type === 'text') {
          checkAllowedKeys(part, new Set(['type', 'text']), tr('Некорректный фрагмент в карточке тренажёра.'));
          if (typeof part.text !== 'string' || !part.text.length) {
            throw new Error(tr('Заполните или удалите пустой текстовый фрагмент тренажёра.'));
          }
        } else if (part.type === 'input') {
          checkAllowedKeys(part, new Set(['type', 'answers']), tr('Некорректный фрагмент в карточке тренажёра.'));
          if (!Array.isArray(part.answers) || part.answers.length === 0 || part.answers.some(a => !isNonBlankText(a))) {
            throw new Error(tr('Заполните ответы во всех пропусках тренажёра.'));
          }
          if (new Set(part.answers).size !== part.answers.length) {
            throw new Error(tr('Варианты ответа в пропуске тренажёра не должны повторяться.'));
          }
        } else if (part.type === 'choice') {
          checkAllowedKeys(part, new Set(['type', 'options', 'distractors']), tr('Некорректный фрагмент в карточке тренажёра.'));
          if (part.distractors !== undefined && part.distractors !== null && part.distractors !== 'auto') {
            throw new Error(tr('Некорректный режим вариантов тренажёра.'));
          }
          if (!Array.isArray(part.options) || part.options.length === 0
            || part.options.some(o => !isPlainObject(o) || !hasOnlyAllowedKeys(o, new Set(['text', 'correct']))
              || !isNonBlankText(o.text) || (o.correct !== undefined && typeof o.correct !== 'boolean'))) {
            throw new Error(tr('Заполните все варианты выбора в тренажёре.'));
          }
          const labels = part.options.map(o => o.text);
          if (new Set(labels).size !== labels.length || !part.options.some(o => o.correct === true)) {
            throw new Error(tr('Варианты выбора в тренажёре должны быть уникальными и иметь правильный ответ.'));
          }
          if (part.distractors === 'auto') {
            if (part.options.length !== 1 || part.options[0].correct !== true) {
              throw new Error(tr('Автоматические варианты требуют ровно один правильный ответ.'));
            }
          } else if (part.options.length < 2) {
            throw new Error(tr('Для пропуска с выбором нужны хотя бы два варианта.'));
          }
        } else {
          throw new Error(tr('Некорректный фрагмент в карточке тренажёра.'));
        }
      }
      break;
    }
    case 'quiz': {
      checkAllowedKeys(data, new Set(['back_note', 'prompt', 'options']), tr('Некорректные поля теста Quiz.'));
      if (data.back_note !== undefined && typeof data.back_note !== 'string') {
        throw new Error(tr('Некорректные поля теста Quiz.'));
      }
      if (typeof data.prompt !== 'string' || !Array.isArray(data.options) || data.options.length < 2) {
        throw new Error(tr('Тест должен содержать вопрос и минимум два варианта ответа.'));
      }
      if (data.options.some(o => !isPlainObject(o) || !hasOnlyAllowedKeys(o, new Set(['text', 'correct']))
        || !isNonBlankText(o.text) || (o.correct !== undefined && typeof o.correct !== 'boolean'))) {
        throw new Error(tr('Заполните все варианты ответа в тесте.'));
      }
      const labels = data.options.map(o => o.text);
      if (new Set(labels).size !== labels.length) {
        throw new Error(tr('Варианты ответа в тесте не должны повторяться.'));
      }
      if (!data.options.some(o => o.correct === true)) {
        throw new Error(tr('Отметьте хотя бы один правильный вариант ответа.'));
      }
      const visibleInfo = card.layout
        ? new Set(card.layout.filter(e => e.type === 'info' && e.visibility !== 'after_answer').map(e => e.index))
        : new Set(infoList.map((_, idx) => idx));
      const hasTaskOrSource = infoList.some((block, idx) => visibleInfo.has(idx) && (block.type === 'task' || block.type === 'source'));
      if (!trimLikePython(data.prompt) && !hasTaskOrSource) {
        throw new Error(tr('Введите вопрос теста или добавьте блок задания.'));
      }
      break;
    }
    case 'match':
      checkAllowedKeys(data, new Set(['back_note', 'pairs']), tr('Некорректные поля карточки Match.'));
      if ((data.back_note !== undefined && typeof data.back_note !== 'string')
        || !Array.isArray(data.pairs) || data.pairs.length < 2
        || data.pairs.some(p => !isPlainObject(p) || !hasOnlyAllowedKeys(p, new Set(['left', 'right']))
          || !isNonBlankText(p.left) || !isNonBlankText(p.right))) {
        throw new Error(tr('Добавьте минимум две заполненные пары.'));
      }
      break;
    case 'puzzle':
      checkAllowedKeys(data, new Set(['tokens', 'translation']), tr('Некорректные поля карточки Puzzle.'));
      if (!Array.isArray(data.tokens) || data.tokens.length < 1 || data.tokens.some(token => !isNonBlankText(token))
        || (data.translation !== undefined && typeof data.translation !== 'string')) {
        throw new Error(tr('Введите предложение'));
      }
      break;
    case 'word_bank': {
      checkAllowedKeys(data, new Set(['options', 'parts']), tr('Некорректные поля карточки Word Bank.'));
      if (!Array.isArray(data.options) || data.options.length < 1 || data.options.some(o => !isNonBlankText(o))) {
        throw new Error(tr('Добавьте слова в банк и создайте хотя бы один пропуск.'));
      }
      if (!Array.isArray(data.parts) || data.parts.length < 1) {
        throw new Error(tr('Введите текст задания и создайте хотя бы один пропуск.'));
      }
      const used = new Set();
      for (const part of data.parts) {
        if (!isPlainObject(part)) throw new Error(tr('Некорректный фрагмент в Word Bank.'));
        if (part.type === 'text') {
          checkAllowedKeys(part, new Set(['type', 'text']), tr('Некорректный фрагмент в Word Bank.'));
          if (typeof part.text !== 'string' || !part.text.length) {
            throw new Error(tr('Удалите пустой текстовый фрагмент в Word Bank.'));
          }
        } else if (part.type === 'gap') {
          checkAllowedKeys(part, new Set(['type', 'option']), tr('Некорректный фрагмент в Word Bank.'));
          if (!Number.isInteger(part.option) || part.option < 0 || part.option >= data.options.length || used.has(part.option)) {
            throw new Error(tr('Некорректная ссылка на слово в Word Bank.'));
          }
          used.add(part.option);
        } else {
          throw new Error(tr('Некорректный фрагмент в Word Bank.'));
        }
      }
      if (used.size === 0) {
        throw new Error(tr('Создайте хотя бы один пропуск в тексте.'));
      }
      break;
    }
    case 'free_text':
      checkAllowedKeys(data, new Set(['prompt', 'sample_answer', 'accepted_answers', 'grading_policy']), tr('Некорректные поля карточки Free Text.'));
      if (!isNonBlankText(data.prompt) || !isNonBlankText(data.sample_answer)) {
        throw new Error(tr('Заполните задание и образец ответа.'));
      }
      validateWrittenAnswers(data, true);
      break;
    case 'editable_text':
      checkAllowedKeys(data, new Set(['source_text', 'correct_text', 'accepted_answers', 'grading_policy']), tr('Некорректные поля карточки Editable Text.'));
      if (!isNonBlankText(data.source_text) || !isNonBlankText(data.correct_text)) {
        throw new Error(tr('Заполните исходный и исправленный тексты.'));
      }
      if (exceedsAnswerLimit(data.source_text) || exceedsAnswerLimit(data.correct_text)) {
        throw new Error(tr('Текст должен содержать не более 4000 символов.'));
      }
      if (trimLikePython(data.source_text) === trimLikePython(data.correct_text)) {
        throw new Error(tr('Исходный и исправленный тексты должны различаться.'));
      }
      validateWrittenAnswers(data, false);
      break;
    default:
      throw new Error(tr('Неизвестный тип карточки V2.'));
  }

  validateSerializedCardSize(card);
}

export function cardWriteError(error) {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map(issue => `${issue.loc?.slice(1).join('.')}: ${issue.msg}`).join('\n');
  return typeof detail === 'string' ? detail : detail?.message || detail?.code || error.message;
}
