import { parseQuizData } from './quizParser.js';

/**
 * Detects the specific exercise type of a card.
 * Returns: 'match' | 'free_text' | 'quiz' | 'trainer' | 'puzzle' | null
 */
export const detectExerciseType = (card, studyMode = 'classic') => {
  if (!card) return null;
  const front = card.front || '';
  const type = card.card_type || '';

  // 1. Explicit Match or @match syntax
  if (type === 'match' || /^@match\b/i.test(front) || /\n@match\b/i.test(front)) {
    return 'match';
  }

  // 2. Explicit Free Text or @free syntax
  if (type === 'free_text' || /^@free\b/i.test(front) || /\n@free\b/i.test(front)) {
    return 'free_text';
  }

  // 3. Explicit Quiz or Quiz asterisks syntax
  if (type === 'quiz') {
    return 'quiz';
  }

  // 4. Explicit Trainer or Cloze syntax: {...} or [[...]]
  if (type === 'trainer' || /\{([^}]+)\}|\[\[([^\]]+)\]\]/.test(front)) {
    return 'trainer';
  }

  // 5. Check if text matches Quiz syntax (if not already identified as cloze)
  const quizData = parseQuizData(card);
  if (quizData?.isQuiz) {
    return 'quiz';
  }

  // 6. Explicit Puzzle
  if (type === 'puzzle' || studyMode === 'puzzle') {
    return 'puzzle';
  }

  return null;
};
