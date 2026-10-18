import { tr } from '../i18n/locale.js';
import { stripMarkdown } from './text.js';
import { parseExerciseContent } from './exerciseContentParser.js';

const cleanPunctuation = (str) => {
  if (!str) return '';
  return str.replace(/\s+([?!.,;:])/g, '$1').trim();
};

export const maskTrainerTokens = (text) => {
  if (!text) return '';
  return text
    .replace(/\[\[[^\]]+\]\]/g, '__TRAINER_INPUT__')
    .replace(/\{[^}]+\}/g, '__TRAINER_CHOICE__');
};

/**
 * Helper to clean prefixes like ○, •, -, [ ], [*], A), 1., etc. from option line
 * and determine if it is marked as the correct answer.
 */
const cleanOptionPrefix = (line) => {
  if (!line) return { isCorrect: false, text: '' };
  const trimmed = line.trim();

  // Check if line begins with a correct-answer marker:
  // - ^\* (e.g. *Berlin, * A) Berlin, * 1. Berlin)
  // - ^\[\*\] (e.g. [*] Berlin)
  // - ^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\* (e.g. A) *Berlin, 1. *Berlin)
  // - ^[-○•]\s*\* (e.g. - *Berlin, • *Berlin)
  const isCorrect = (
    /^\*(?!\*)/.test(trimmed) ||
    /^\[\*\]/i.test(trimmed) ||
    /^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\*/i.test(trimmed) ||
    /^[-○•]\s*\*/u.test(trimmed)
  );

  // Strip prefixes: *, ○, •, -, [ ], [*], [x], A), A., 1), 1.
  const cleaned = trimmed
    .replace(/^\[[*xX ]\]\s*/i, '') // strip [*], [ ], [x]
    .replace(/^[-*○•\s]+/u, '')     // strip leading *, ○, •, - and spaces
    .replace(/^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*/i, '') // strip A) , A. , 1) , 1.
    .replace(/^[-*○•\s]+/u, '')     // strip remaining bullets/stars after letter
    .trim();

  return { isCorrect, text: cleanPunctuation(stripMarkdown(cleaned)) };
};

/**
 * Detects and parses Quiz / Exam (Multiple Choice) cards.
 */
export const parseQuizData = (card) => {
  if (!card) return null;
  const rawFront = parseExerciseContent(card.front || card.front_text || '').exercise.trim();
  if (!rawFront) return null;

  // Mask trainer tokens so asterisks inside {...} or [[...]] are never seen as quiz markers
  const maskedFront = maskTrainerTokens(rawFront);

  const lines = maskedFront.split('\n');
  // Use the same option markers as projectQuizSection; blank lines belong to the question.
  let firstOptionIdx = lines.findIndex((line, index) => index > 0
    && /^\s*(?:\*(?!\*)|\[[*xX ]\]|[-○•]|(?:[a-zA-Z]|[0-9]{1,2})[).]\s)/u.test(line));
  if (firstOptionIdx < 1) return null;

  // Legacy unprefixed answers share a paragraph, with only the correct answer starred.
  // Include unmarked answers before that star, using the last blank line before it.
  if (/^\s*\*(?!\*)/.test(lines[firstOptionIdx])
    && !/^\s*\*\s*(?:[a-zA-Z]|[0-9]{1,2})[).]\s/.test(lines[firstOptionIdx])
    && !lines.slice(firstOptionIdx + 1).some(line => /^\s*(?:\[[*xX ]\]|[-○•]|(?:[a-zA-Z]|[0-9]{1,2})[).]\s)/u.test(line))) {
    for (let i = firstOptionIdx - 1; i > 0; i--) {
      if (!lines[i].trim()) {
        firstOptionIdx = i + 1;
        break;
      }
    }
  }

  const rawQuestion = lines.slice(0, firstOptionIdx).join('\n').trim();
  const optionLines = lines.slice(firstOptionIdx).map(line => line.trim()).filter(Boolean);
  if (optionLines.length < 2) return null;

  let hasCorrect = false;
  const optionsRaw = optionLines.map((line, idx) => {
    const { isCorrect, text } = cleanOptionPrefix(line);
    if (isCorrect) hasCorrect = true;
    return {
      id: idx,
      text,
      isCorrect
    };
  }).filter(o => Boolean(o.text));

  if (!hasCorrect || optionsRaw.length < 2) return null;

  const correctOption = optionsRaw.find(o => o.isCorrect) || optionsRaw[0];

  // Shuffle options so correct choice isn't always in same position
  const shuffledOptions = [...optionsRaw].sort(() => Math.random() - 0.5);

  return {
    isQuiz: true,
    question: cleanPunctuation(stripMarkdown(rawQuestion)) || tr("Выберите правильный ответ:"),
    options: shuffledOptions,
    correctAnswerId: correctOption.id,
    correctAnswerText: correctOption.text
  };
};


