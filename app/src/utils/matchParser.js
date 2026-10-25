import { stripMarkdown } from './text.js';
import { getInteractiveExerciseContent } from './exerciseContentParser.js';

export const normalizeMatchValue = (str) => {
  if (!str) return '';
  return str.trim().replace(/\s+/g, ' ');
};

// Include boundary spacing so the source editor can use the same label ranges.
export const findMatchSeparator = (line) => /\s*=>\s*/.exec(line);

/**
 * Detects and parses matching exercise cards (@match).
 * Syntax:
 * @match
 * [Optional prompt or instruction]
 * Left part 1 => Right part 1
 * Left part 2 => Right part 2
 *
 * The first => is the pair boundary; everything after it is one label.
 * Only => separates pairs. Other arrows, dashes and equals signs are text.
 */
export const parseMatchData = (card) => {
  if (!card) return null;

  const rawFront = (typeof card === 'string' ? card : (card.front || card.front_text || '')).trim();
  if (!rawFront) return null;

  const exerciseText = getInteractiveExerciseContent(rawFront, 'match');
  if (!exerciseText) return null;

  // Remove @match directive
  const textWithoutDirective = exerciseText.replace(/@match\b/i, '').trim();
  const lines = textWithoutDirective.split('\n').map(l => l.trim()).filter(Boolean);

  const pairs = [];
  const promptLines = [];

  for (const line of lines) {
    // Slice once so punctuation and later arrows remain unchanged.
    const separator = findMatchSeparator(line);
    if (separator) {
      const left = stripMarkdown(line.slice(0, separator.index).trim());
      const right = stripMarkdown(line.slice(separator.index + separator[0].length).trim());
      if (left && right) {
        pairs.push({
          id: pairs.length,
          left,
          right
        });
        continue;
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
