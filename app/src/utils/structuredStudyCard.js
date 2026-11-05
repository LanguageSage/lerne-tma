/** Study views over the canonical API envelope. No authoring syntax is interpreted here. */
const exerciseTypes = new Set(['trainer', 'quiz', 'match', 'puzzle', 'word_bank', 'free_text', 'editable_text']);
const supportedTypes = new Set(['standard', 'theory', ...exerciseTypes]);

export function studyContent(card) {
  const envelope = card?.content_v2;
  if (envelope?.schema_version !== 2 || !supportedTypes.has(envelope.card?.type) || !envelope.card?.data) {
    return null;
  }
  return envelope.card;
}

export const isNativeStudyCard = card => Boolean(studyContent(card));
export const studyExerciseType = content => exerciseTypes.has(content?.type) ? content.type : null;
export const studyExplanation = card => studyContent(card)?.explanation || '';

export function studyInfoBlocks(content) {
  return (content?.info || []).map(block => block.type === 'options'
    ? { type: block.type, options: block.items }
    : { type: block.type, content: block.text });
}

const firstAnswer = part => part.type === 'input' ? part.answers[0] : part.options.find(option => option.correct)?.text;

export function studySideText(content, side = 'front') {
  if (!content) return '';
  const { type, data } = content;
  if (side === 'back') {
    return ({
      theory: data.summary,
      standard: data.answer,
      trainer: data.back_note,
      quiz: data.back_note,
      match: data.back_note,
      puzzle: data.translation,
      free_text: data.sample_answer,
      editable_text: data.correct_text,
    })[type] || '';
  }
  switch (type) {
    case 'theory': return data.text;
    case 'standard':
    case 'free_text': return data.prompt;
    case 'quiz': return data.prompt || content.info?.find(block => block.type === 'task' || block.type === 'source')?.text || '';
    case 'trainer': return data.parts.map(part => part.type === 'text' ? part.text : firstAnswer(part)).join('');
    case 'match': return data.pairs.map(pair => `${pair.left} → ${pair.right}`).join('\n');
    case 'puzzle': return data.tokens.join(' ');
    case 'word_bank': return data.parts.map(part => part.type === 'text' ? part.text : data.options[part.option]).join('');
    case 'editable_text': return data.source_text;
    default: return '';
  }
}

export function studyTrainer(data) {
  const gaps = [];
  const parts = data.parts.map((part, index) => {
    if (part.type === 'text') return part;
    const previous = data.parts[index - 1];
    const next = data.parts[index + 1];
    const gap = {
      id: gaps.length,
      mode: part.type,
      isAffix: (previous?.type === 'text' && /[\p{L}\p{M}]$/u.test(previous.text))
        || (next?.type === 'text' && /^[\p{L}\p{M}]/u.test(next.text)),
      answers: part.type === 'input' ? part.answers : part.options.filter(option => option.correct).map(option => option.text),
      choices: part.type === 'choice' ? part.options.map(option => option.text) : [],
    };
    gaps.push(gap);
    return gap;
  });
  return { parts, gaps };
}

export function studyQuiz(data) {
  return {
    question: data.prompt,
    options: data.options.map((option, id) => ({ id, text: option.text, isCorrect: option.correct })),
  };
}

export function studyMatch(data) {
  return { native: true, pairs: data.pairs.map((pair, id) => ({ ...pair, id })) };
}

export function studyWordBank(data) {
  const gaps = [];
  const options = data.options.map((value, index) => ({ id: `option-${index}`, value }));
  const parts = data.parts.map(part => {
    if (part.type === 'text') return part;
    const gap = { id: `gap-${gaps.length}`, index: gaps.length, correctOptionId: options[part.option].id };
    gaps.push(gap);
    return gap;
  });
  return { parts, gaps, options };
}

/** Group trainer parts for wrapping without turning gap identities into text. */
export function trainerWords(parts) {
  const words = [];
  let word = [];
  const flush = () => {
    if (word.length) words.push(word);
    word = [];
  };
  for (const part of parts) {
    if (part.type !== 'text') {
      word.push(part);
      continue;
    }
    for (const text of part.text.split(/(\s+)/u).filter(Boolean)) {
      if (/^\s/u.test(text)) {
        flush();
        words.push([{ type: 'text', text }]);
      } else word.push({ type: 'text', text });
    }
  }
  flush();
  return words;
}

const migrationErrors = new Set(['card_requires_migration', 'deck_requires_migration']);
export const isStudyMigrationError = detail => migrationErrors.has(detail?.code);

export function studyErrorDetail(error) {
  const detail = error.response?.data?.detail;
  if (error.response?.status === 409 && isStudyMigrationError(detail)) return detail;
  return typeof detail === 'string' ? detail : error.message;
}
