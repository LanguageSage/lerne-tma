import { stripMarkdown } from './text.js';

export const normalizeMatchValue = (str) => {
  if (!str) return '';
  return str.trim().replace(/\s+/g, ' ');
};

/**
 * Detects and parses matching exercise cards (@match).
 * Syntax:
 * @match
 * [Optional prompt or instruction]
 * Left part 1 => Right part 1
 * Left part 2 => Right part 2
 *
 * Supported separators: =>, ->, —, =
 */
export const parseMatchData = (card) => {
  if (!card) return null;

  const rawFront = (typeof card === 'string' ? card : (card.front || card.front_text || '')).trim();
  if (!rawFront) return null;

  const hasMatchTag = /^@match\b/i.test(rawFront) || /\n@match\b/i.test(rawFront);
  if (!hasMatchTag) return null;

  // Remove @match directive
  const textWithoutDirective = rawFront.replace(/@match\b/i, '').trim();
  const lines = textWithoutDirective.split('\n').map(l => l.trim()).filter(Boolean);

  const pairSeparatorRegex = /\s*(?:=>|->|—|=)\s*/;
  const pairs = [];
  const promptLines = [];

  for (const line of lines) {
    if (pairSeparatorRegex.test(line)) {
      const parts = line.split(pairSeparatorRegex);
      if (parts.length >= 2) {
        const left = stripMarkdown(parts[0].trim());
        const right = stripMarkdown(parts.slice(1).join(' = ').trim());
        if (left && right) {
          pairs.push({
            id: pairs.length,
            left,
            right
          });
          continue;
        }
      }
    }
    // If not a pair line and pairs haven't started yet, collect as prompt
    if (pairs.length === 0) {
      promptLines.push(line);
    }
  }

  if (pairs.length < 2) return null;

  return {
    isMatch: true,
    prompt: promptLines.join('\n').trim(),
    pairs
  };
};
