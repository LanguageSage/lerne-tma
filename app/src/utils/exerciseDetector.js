import { parseQuizData } from './quizParser.js';

/**
 * Checks if the text contains valid trainer cloze gaps:
 * - Choice gap: {...} (e.g. {*mit|nach|zu} or {mit|nach|zu})
 * - Input gap: [[...]] (e.g. [[hatte]])
 */
export const hasTrainerSyntax = (text) => {
  if (!text) return false;
  return /\{([^}]+)\}|\[\[([^\]]+)\]\]/.test(text);
};

/** Keep CardForm's quick-action policy testable and aligned with input syntax. */
export const detectAiQuickActionType = (text) => {
  const front = String(text || '');
  if (hasTrainerSyntax(front)) return 'explain_rule';

  const hasQuizStar = (/\n\*/.test(front) || /^\*/.test(front)) && front.includes('\n');
  if (hasQuizStar) return 'full_card';

  return null;
};

/**
 * Detects the specific exercise type of a card strictly based on its content (front).
 * DB card_type is NOT the source of truth — card content is.
 *
 * Strict Priority:
 * 1. match (@match)
 * 2. free_text (@free)
 * 3. puzzle (@puzzle)
 * 4. word_bank (@wordbank)
 * 5. trainer ({...} or [[...]]) - absolute priority over quiz
 * 6. quiz (structured multiple choice test with * on option lines)
 * 7. puzzle (if studyMode === 'puzzle')
 * 8. null (standard card)
 *
 * Returns: 'match' | 'free_text' | 'quiz' | 'trainer' | 'puzzle' | 'word_bank' | null
 */
export const detectExerciseType = (cardOrFront, studyMode = 'classic') => {
  if (!cardOrFront) return null;
  const front = typeof cardOrFront === 'string'
    ? cardOrFront
    : (cardOrFront.front || cardOrFront.front_text || '');
  const trimmed = front.trim();
  if (!trimmed) return null;

  // 1. Match directive: @match
  if (/^@match\b/i.test(trimmed) || /\n@match\b/i.test(trimmed)) {
    return 'match';
  }

  // 2. Free text writing directive: @free
  if (/^@free\b/i.test(trimmed) || /\n@free\b/i.test(trimmed)) {
    return 'free_text';
  }

  // 3. Sentence builder / puzzle directive: @puzzle
  if (/^@puzzle\b/i.test(trimmed) || /\n@puzzle\b/i.test(trimmed)) {
    return 'puzzle';
  }

  // 4. Shared word bank. Must win over trainer syntax if malformed legacy tokens are present.
  if (/^@wordbank\b/i.test(trimmed) || /\n@wordbank\b/i.test(trimmed)) {
    return 'word_bank';
  }

  // 5. Trainer / Cloze gaps: {...} or [[...]] (Strict priority over quiz)
  if (hasTrainerSyntax(trimmed)) {
    return 'trainer';
  }

  // 6. Quiz / Multiple Choice structure (Checked on content after masking trainer tokens)
  const cardObj = typeof cardOrFront === 'string' ? { front: cardOrFront } : cardOrFront;
  const quizData = parseQuizData(cardObj);
  if (quizData?.isQuiz) {
    return 'quiz';
  }

  // 7. Explicit studyMode puzzle fallback
  if (studyMode === 'puzzle') {
    return 'puzzle';
  }

  return null;
};
