import { stripMarkdown } from './text.js';
import { getInteractiveExerciseContent } from './exerciseContentParser.js';

/**
 * Detects and parses free text exercise cards (@free).
 * Syntax:
 * @free
 * Schreiben Sie einen Satz mit „als“.
 *
 * Example answer can be provided in back or context.
 */
export const parseFreeTextData = (card) => {
  if (!card) return null;

  const rawFront = (typeof card === 'string' ? card : (card.front || card.front_text || '')).trim();
  if (!rawFront) return null;

  const exerciseText = getInteractiveExerciseContent(rawFront, 'free');
  if (!exerciseText) return null;

  const prompt = exerciseText.replace(/@free\b/i, '').trim();

  return {
    isFreeText: true,
    prompt: stripMarkdown(prompt) || prompt,
    exampleAnswer: (typeof card === 'object' ? (card.back || card.back_text || card.context || '') : '').trim()
  };
};
