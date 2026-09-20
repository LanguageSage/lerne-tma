import { stripMarkdown } from './text.js';
import { parseExerciseContent } from './exerciseContentParser.js';

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

  const exerciseText = parseExerciseContent(rawFront).exercise.trim();
  if (!exerciseText) return null;

  const hasFreeTag = /^@free\b/i.test(exerciseText) || /\n@free\b/i.test(exerciseText);
  if (!hasFreeTag) return null;

  const prompt = exerciseText.replace(/@free\b/i, '').trim();

  return {
    isFreeText: true,
    prompt: stripMarkdown(prompt) || prompt,
    exampleAnswer: (typeof card === 'object' ? (card.back || card.back_text || card.context || '') : '').trim()
  };
};
