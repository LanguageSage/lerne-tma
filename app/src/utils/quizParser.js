import { stripMarkdown } from './text';

/**
 * Detects and parses Quiz / Exam (Multiple Choice) cards.
 * Card syntax expected in card.front:
 * 
 * Question text here...
 * [*] Correct option
 * [ ] Incorrect option 1
 * [ ] Incorrect option 2
 */
export const parseQuizData = (card) => {
  if (!card || !card.front) return null;

  const rawFront = card.front.trim();

  // Regex to detect markdown checkbox pattern: [*], [x], [X], [ ]
  const checkboxRegex = /^\s*\[([\*xX ]|\s*)\]\s*(.+)$/gm;

  const matches = [...rawFront.matchAll(checkboxRegex)];

  // Need at least 2 options to form a valid multiple-choice quiz
  if (matches.length < 2) {
    return null;
  }

  // Find index of first option line to extract question text
  const firstMatchIndex = matches[0].index;
  const rawQuestion = rawFront.substring(0, firstMatchIndex).trim();

  // Strip markdown from question if needed
  const question = stripMarkdown(rawQuestion);

  const options = matches.map((match, index) => {
    const mark = match[1].trim();
    const isCorrect = mark === '*' || mark.toLowerCase() === 'x';
    const text = stripMarkdown(match[2].trim());

    return {
      id: index,
      text,
      isCorrect,
      rawMatch: match[0]
    };
  });

  const correctOption = options.find(o => o.isCorrect) || options[0];

  return {
    isQuiz: true,
    question: question || 'Выберите правильный ответ:',
    options,
    correctAnswerId: correctOption.id,
    correctAnswerText: correctOption.text
  };
};
