import { tr } from '../i18n/locale.js';
import { studySideText } from './structuredStudyCard.js';
import { addLayoutImage } from './cardLayout.js';
import { NativeV2ValidationError, nativeV2Field, nativeV2Version, validateReadableNativeV2 } from './nativeV2Contract.js';

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
  schema_version: nativeV2Version, card: { type, data: structuredClone(defaults[type]), info: [], explanation: '' },
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
  const schema = nativeV2Field(card.type, 'grading_policy');
  // Materialize only the defaults that would change when the policy becomes explicit.
  const gradingPolicy = current ? { ...current } : Object.fromEntries(Object.entries(schema.default)
    .filter(([name, setting]) => setting !== schema.properties[name]?.default));
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

// Unfinished JSON may violate write rules. Here we only need safe reads for the visual form.
export function parseCardSource(source) {
  let content;
  try { content = JSON.parse(source); }
  catch { throw sourceFailure('Некорректный JSON. Исправьте исходный текст.'); }
  try {
    validateReadableNativeV2(content);
    const { card } = content;
    if (typeof studySideText(card) !== 'string' || typeof studySideText(card, 'back') !== 'string') {
      throw new Error();
    }
  } catch { throw sourceFailure('Ожидается полный content_v2: schema_version: 2 и card с типом и данными.'); }
  return content;
}

export function cardWriteError(error) {
  if (error instanceof NativeV2ValidationError && error.path[0] === 'card' && error.path[1] === 'data') {
    if (error.path[2] === 'prompt') return tr('Заполните вопрос, ответ и добавленные поля карточки.');
    if (error.path[2] === 'tokens') return tr('Введите предложение');
    if (error.path[2] === 'translation') return tr('Введите перевод');
  }
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map(issue => `${issue.loc?.slice(1).join('.')}: ${issue.msg}`).join('\n');
  return typeof detail === 'string' ? detail : detail?.message || detail?.code || error.message;
}
