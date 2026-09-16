import { parseQuizData } from './quizParser.js';

const SPECIALIZED_TYPES = ['match', 'free_text', 'quiz', 'trainer', 'puzzle'];

/**
 * Detects the specific exercise type of a card.
 * Returns: 'match' | 'free_text' | 'quiz' | 'trainer' | 'puzzle' | null
 */
export const detectExerciseType = (card, studyMode = 'classic') => {
  if (!card) return null;
  const front = card.front || card.front_text || '';
  const type = (card.card_type || '').toLowerCase().trim();

  // 1. Explicit specialized types have absolute priority
  if (SPECIALIZED_TYPES.includes(type)) {
    return type;
  }

  // 2. Syntax-based auto-detection for general/missing types (standard, translation, etc.):
  if (/^@match\b/i.test(front) || /\n@match\b/i.test(front)) {
    return 'match';
  }

  if (/^@free\b/i.test(front) || /\n@free\b/i.test(front)) {
    return 'free_text';
  }

  if (/^@puzzle\b/i.test(front) || /\n@puzzle\b/i.test(front)) {
    return 'puzzle';
  }

  // 3. Quiz check BEFORE cloze braces so question text with braces (e.g. "Difference between {A} and {B}?") stays quiz
  const quizData = parseQuizData(card);
  if (quizData?.isQuiz) {
    return 'quiz';
  }

  // 4. Cloze / Trainer braces {...} or brackets [[...]]
  if (/\{([^}]+)\}|\[\[([^\]]+)\]\]/.test(front)) {
    return 'trainer';
  }

  // 5. Explicit studyMode puzzle
  if (studyMode === 'puzzle') {
    return 'puzzle';
  }

  return null;
};
