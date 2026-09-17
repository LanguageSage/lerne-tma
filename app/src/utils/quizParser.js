import { tr } from '../i18n/locale.js';
import { stripMarkdown } from './text.js';

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
  const rawFront = (card.front || card.front_text || '').trim();
  if (!rawFront) return null;

  // Mask trainer tokens so asterisks inside {...} or [[...]] are never seen as quiz markers
  const maskedFront = maskTrainerTokens(rawFront);

  let rawQuestion = '';
  let optionLines = [];

  // 1. Primary Strategy: Split by double newline (\n\n)
  if (maskedFront.includes('\n\n')) {
    const parts = maskedFront.split(/\n\s*\n/);
    rawQuestion = parts[0].trim();
    const remainingText = parts.slice(1).join('\n\n').trim();
    optionLines = remainingText.split('\n').map(l => l.trim()).filter(Boolean);
  } else {
    // 2. Fallback Strategy: Split by lines and find first option-like line
    const lines = maskedFront.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    let firstOptionIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^[-*○•]/u.test(l) || /^\[[*xX ]\]/i.test(l) || /^[a-zA-Z0-9]+[).]\s/.test(l)) {
        firstOptionIdx = i;
        break;
      }
    }

    if (firstOptionIdx !== -1 && firstOptionIdx > 0) {
      rawQuestion = lines.slice(0, firstOptionIdx).join('\n').trim();
      optionLines = lines.slice(firstOptionIdx);
    } else {
      // If no markers found, but at least 2 lines and one starts with star
      const starIdx = lines.findIndex(l => /^\*(?!\*)|^\[\*\]/i.test(l));
      if (starIdx > 0) {
        rawQuestion = lines.slice(0, 1).join('\n').trim();
        optionLines = lines.slice(1);
      } else {
        return null;
      }
    }
  }

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


