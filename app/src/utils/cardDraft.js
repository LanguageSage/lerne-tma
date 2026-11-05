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
    const content = current.content_v2;
    return { ...current, content_v2: { ...content, card: update(content.card) } };
  });
}

export function cardWriteError(error) {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map(issue => `${issue.loc?.slice(1).join('.')}: ${issue.msg}`).join('\n');
  return typeof detail === 'string' ? detail : detail?.message || detail?.code || error.message;
}
