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

export function cardWriteError(error) {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map(issue => `${issue.loc?.slice(1).join('.')}: ${issue.msg}`).join('\n');
  return typeof detail === 'string' ? detail : detail?.message || detail?.code || error.message;
}
