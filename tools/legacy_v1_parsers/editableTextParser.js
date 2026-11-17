import { getInteractiveExerciseContent } from './exerciseContentParser.js';

/** Full source text stays visible in the input; BACK is the corrected answer. */
export function parseEditableTextData(card) {
  if (!card) return null;
  const front = typeof card === 'string' ? card : (card.front || card.front_text || '');
  const block = getInteractiveExerciseContent(front, 'edit');
  if (!block) return null;
  const sourceText = block.replace(/^@edit[ \t]*\r?\n/i, '').trim();
  const correctText = typeof card === 'object' ? (card.back || card.back_text || '').trim() : '';
  return sourceText && correctText ? { sourceText, correctText } : null;
}
