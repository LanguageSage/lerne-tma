import { parseQuizData } from './quizParser.js';
import { parseExerciseContent } from './exerciseContentParser.js';

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
  const parsed = parseExerciseContent(text);
  if (parsed.isTheory) return null;
  const front = parsed.exercise;
  if (hasTrainerSyntax(front)) return 'explain_rule';

  const hasQuizStar = (/\n\*/.test(front) || /^\*/.test(front)) && front.includes('\n');
  if (hasQuizStar) return 'full_card';

  return null;
};

/**
 * Detects the authored card type strictly based on its content (front).
 * DB card_type is NOT the source of truth — card content is.
 *
 * Strict Priority:
 * 1. match (@match)
 * 2. free_text (@free)
 * 3. editable_text (@edit)
 * 4. puzzle (@puzzle)
 * 5. word_bank (@wordbank)
 * 6. trainer ({...} or [[...]]) - absolute priority over quiz
 * 7. quiz (structured multiple choice test with * on option lines)
 * 8. puzzle (if studyMode === 'puzzle')
 * 9. null (standard card)
 *
 * @theory is explicit type metadata and takes priority over exercise syntax.
 * Returns: 'theory' | 'match' | 'free_text' | 'editable_text' | 'quiz' | 'trainer' | 'puzzle' | 'word_bank' | null
 */
export const detectCardType = (cardOrFront, studyMode = 'classic') => {
  if (!cardOrFront) return null;
  const front = typeof cardOrFront === 'string'
    ? cardOrFront
    : (cardOrFront.front || cardOrFront.front_text || '');
  const parsed = parseExerciseContent(front);
  if (parsed.isTheory) return 'theory';
  const trimmed = parsed.exercise.trim();
  if (!trimmed) return null;

  // 1. Match directive: @match
  if (/^[ \t]*@match[ \t]*$/im.test(trimmed)) {
    return 'match';
  }

  // 2. Free text writing directive: @free
  if (/^[ \t]*@free[ \t]*$/im.test(trimmed)) {
    return 'free_text';
  }

  if (/^[ \t]*@edit[ \t]*$/im.test(trimmed)) {
    return 'editable_text';
  }

  // 4. Sentence builder / puzzle directive: @puzzle
  if (/^[ \t]*@puzzle[ \t]*$/im.test(trimmed)) {
    return 'puzzle';
  }

  // 5. Shared word bank. Must win over trainer syntax if malformed legacy tokens are present.
  if (/^[ \t]*@wordbank[ \t]*$/im.test(trimmed)) {
    return 'word_bank';
  }

  // 6. Trainer / Cloze gaps: {...} or [[...]] (Strict priority over quiz)
  if (hasTrainerSyntax(trimmed)) {
    return 'trainer';
  }

  // 7. Quiz / Multiple Choice structure (Checked on content after masking trainer tokens)
  const cardObj = typeof cardOrFront === 'string'
    ? { front: trimmed }
    : { ...cardOrFront, front: trimmed, front_text: trimmed };
  const quizData = parseQuizData(cardObj);
  if (quizData?.isQuiz) {
    return 'quiz';
  }

  // 8. Explicit studyMode puzzle fallback
  if (studyMode === 'puzzle') {
    return 'puzzle';
  }

  return null;
};

// Theory uses the same non-interactive study path as Standard.
export const detectExerciseType = (cardOrFront, studyMode = 'classic') => {
  const type = detectCardType(cardOrFront, studyMode);
  return type === 'theory' ? null : type;
};
