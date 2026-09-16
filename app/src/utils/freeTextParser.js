import { stripMarkdown } from './text.js';

/**
 * Detects and parses free text exercise cards (@free).
 * Syntax:
 * @free
 * Schreiben Sie einen Satz mit „als“.
 *
 * Example answer can be provided in back or context.
 */
export const parseFreeTextData = (card) => {
  if (!card || !card.front) return null;

  const rawFront = card.front.trim();
  const isExplicitType = card.card_type === 'free_text';
  const hasFreeTag = /^@free\b/i.test(rawFront) || /\n@free\b/i.test(rawFront);

  if (!isExplicitType && !hasFreeTag) return null;

  const prompt = rawFront.replace(/@free\b/i, '').trim();

  return {
    isFreeText: true,
    prompt: stripMarkdown(prompt) || prompt,
    exampleAnswer: (card.back || card.context || '').trim()
  };
};
