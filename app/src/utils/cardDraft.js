import { tr } from '../i18n/locale.js';
import { studySideText } from './structuredStudyCard.js';
import { readableLayout } from './cardLayout.js';

const text = { type: 'text', text: '' };
const option = { text: '', correct: false };
const pair = { left: '', right: '' };
const defaults = {
  standard: { prompt: '', answer: '' },
  theory: { text: '', summary: '' },
  trainer: { parts: [text, { type: 'input', answers: [''] }], back_note: '' },
  quiz: { prompt: '', options: [{ ...option, correct: true }, option], back_note: '' },
  match: { pairs: [pair, pair], back_note: '' },
  puzzle: { tokens: [''], translation: '' },
  word_bank: { options: [''], parts: [text, { type: 'gap', option: 0 }] },
  free_text: { prompt: '', sample_answer: '', accepted_answers: [] },
  editable_text: { source_text: '', correct_text: '', accepted_answers: [] },
};

export const cardTypes = Object.keys(defaults);
export const newCardContent = (type = 'standard') => ({
  schema_version: 2, card: { type, data: structuredClone(defaults[type]), info: [], explanation: '' },
});

export const promptField = { standard: 'prompt', theory: 'text', quiz: 'prompt', free_text: 'prompt', editable_text: 'source_text' };
export const answerField = { standard: 'answer', theory: 'summary', trainer: 'back_note', quiz: 'back_note',
  match: 'back_note', puzzle: 'translation', free_text: 'sample_answer', editable_text: 'correct_text' };

export function changeDraft(setter, update) {
  setter(current => {
    // A pending upload can finish while the JSON view is open. Keep one draft,
    // and never overwrite a source string the author is still correcting.
    if (current.content_v2_source != null) {
      try { parseCardSource(current.content_v2_source); } catch { return current; }
    }
    const content = current.content_v2;
    const next = { ...content, card: update(content.card) };
    return { ...current, content_v2: next,
      ...(current.content_v2_source != null ? { content_v2_source: JSON.stringify(next, null, 2) } : {}) };
  });
}

// Only guard the editor's readable shape. Domain validation still belongs to
// card-core on the server, including validation of queued offline writes.
export function parseCardSource(source) {
  let content;
  try { content = JSON.parse(source); }
  catch { throw new Error(tr('Некорректный JSON. Исправьте исходный текст.')); }
  const card = content?.card;
  try {
    if (content.schema_version !== 2 || !cardTypes.includes(card?.type)
      || !card.data || Array.isArray(card.data) || typeof card.data !== 'object'
      || (card.info != null && !Array.isArray(card.info))
      || !readableLayout(card)
      || (card.topics != null && !Array.isArray(card.topics))
      || (card.explanation != null && typeof card.explanation !== 'string')
      || typeof studySideText(card) !== 'string' || typeof studySideText(card, 'back') !== 'string') {
      throw new Error();
    }
  } catch { throw new Error(tr('Ожидается полный content_v2: schema_version: 2 и card с типом и данными.')); }
  return content;
}

export function validateStandardDraft(card) {
  const nonBlank = value => typeof value === 'string' && /[^\p{White_Space}]/u.test(value);
  if (!nonBlank(card.data?.prompt) || !nonBlank(card.data?.answer)
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
