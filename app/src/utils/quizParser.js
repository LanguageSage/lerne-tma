import { tr } from '../i18n/locale.js';
import { stripMarkdown } from './text.js';
import { parseExerciseContent } from './exerciseContentParser.js';

const cleanPunctuation = (str) => {
  if (!str) return '';
  return str.replace(/\s+([?!.,;:])/g, '$1').trim();
};

export const formatQuizText = (text) => cleanPunctuation(stripMarkdown(text));

export const maskTrainerTokens = (text) => {
  if (!text) return '';
  return text
    .replace(/\[\[[^\]]+\]\]/g, '__TRAINER_INPUT__')
    .replace(/\{[^}]+\}/g, '__TRAINER_CHOICE__');
};

// A)Text is valid; dotted labels require whitespace to avoid matching z.B. and 1.5.
export const isQuizOptionLine = (line) => /^\s*(?:\*(?!\*)|\[[*xX ]\]|[-○•]|(?:[a-zA-Z]|[0-9]{1,2})(?:\)|\.\s))/u.test(line);

/**
 * Helper to clean prefixes like ○, •, -, [ ], [*], A), 1., etc. from option line
 * and determine if it is marked as the correct answer.
 */
export const parseQuizOption = (line = '') => {
  const trimmed = line.trim();

  // Check if line begins with a correct-answer marker:
  // - ^\* (e.g. *Berlin, * A) Berlin, * 1. Berlin)
  // - ^\[\*\] (e.g. [*] Berlin)
  // - ^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\* (e.g. A) *Berlin, 1. *Berlin)
  // - ^[-○•]\s*\* (e.g. - *Berlin, • *Berlin)
  const isCorrect = (
    /^\*(?!\*)/.test(trimmed) ||
    /^\[\*\]/i.test(trimmed) ||
    /^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*\*(?!\*)/i.test(trimmed) ||
    /^[-○•]\s*\*(?!\*)/u.test(trimmed)
  );

  // Strip prefixes: *, ○, •, -, [ ], [*], [x], A), A., 1), 1.
  let display = line;
  let prefix = '';
  for (const pattern of [/^\s*/, /^\[[*xX ]\]\s*/i, /^\*(?!\*)\s*/, /^[-○•]\s*/u,
    /^(?:[a-zA-Z]|[0-9]{1,2})[).]\s*/i, /^\*(?!\*)\s*/]) {
    const match = pattern.exec(display);
    if (match) {
      prefix += match[0];
      display = display.slice(match[0].length);
    }
  }

  return { prefix, display, isCorrect, text: formatQuizText(display) };
};

export const findQuizOptionStart = (lines) => {
  // Keep this boundary contract in sync with lerne_card_core.input_parser.
  const maskedLines = lines.map(line => maskTrainerTokens(line).trim());
  let end = maskedLines.length;
  while (end && !maskedLines[end - 1]) end--;
  const validStart = (start, accepts) => {
    const options = maskedLines.slice(start, end).filter(Boolean);
    return start > 0 && maskedLines.slice(0, start).some(Boolean)
      && options.every(accepts)
      && options.filter(line => parseQuizOption(line).text).length >= 2 ? start : -1;
  };

  // Checkboxes explicitly delimit the WHOLE answer block. Numbered statements
  // before it belong to the question; holes or trailing prose make it unsafe.
  const bareStar = line => /^\*(?!\*)/.test(line)
    && !isQuizOptionLine(line.replace(/^\*(?!\*)\s*/, ''));
  let checkbox = maskedLines.findIndex(line => /^\[[*xX ]\]/.test(line));
  if (checkbox !== -1) {
    while (checkbox > 0 && bareStar(maskedLines[checkbox - 1])) checkbox--;
    return validStart(checkbox, line => /^\[[*xX ]\]/.test(line) || bareStar(line));
  }

  let paragraph = end;
  while (paragraph > 0 && maskedLines[paragraph - 1]) paragraph--;
  const tail = maskedLines.slice(paragraph, end);
  const withoutStar = line => line.replace(/^\*(?!\*)\s*/, '');
  const labelKind = line => {
    const match = /^(?:([a-zA-Z])|([0-9]{1,2}))(?:\)|\.\s)/.exec(withoutStar(line));
    return match ? (match[1] ? 'letter' : 'number') : null;
  };

  let start = end;
  while (start > paragraph && isQuizOptionLine(maskedLines[start - 1])) start--;
  const structuredSuffix = maskedLines.slice(start, end).some(line => isQuizOptionLine(withoutStar(line)));

  // Legacy unlabelled answers need a blank-line boundary. Never backtrack from
  // a star into question prose when that separator is absent.
  if (paragraph > 0 && tail.some(line => /^\*(?!\*)/.test(line))
    && tail.some(line => !isQuizOptionLine(line))
    && !tail.some(labelKind) && (!structuredSuffix || end - start < 2)) {
    const legacyStart = validStart(paragraph, () => true);
    if (legacyStart !== -1) return legacyStart;
  }

  const labelValue = line => /^([a-zA-Z]|[0-9]{1,2})(?:\)|\.\s)/.exec(withoutStar(line))?.[1].toLowerCase();
  const coherent = optionLines => {
    const labels = optionLines.map(labelValue).filter(Boolean);
    return new Set(optionLines.map(labelKind).filter(Boolean)).size <= 1 && new Set(labels).size === labels.length;
  };
  // Extend across blank lines only through coherent marked paragraphs. The
  // first paragraph remains the question even when it is entirely numbered.
  while (start > 0 && !maskedLines[start - 1]) {
    let previousEnd = start;
    while (previousEnd > 0 && !maskedLines[previousEnd - 1]) previousEnd--;
    let previousStart = previousEnd;
    while (previousStart > 0 && isQuizOptionLine(maskedLines[previousStart - 1])) previousStart--;
    if (previousStart === 0 || previousStart === previousEnd
      || !coherent(maskedLines.slice(previousStart, end))) break;
    start = previousStart;
  }
  let contextStart = start;
  while (contextStart > 0 && maskedLines[contextStart - 1]) contextStart--;
  const kinds = new Set(maskedLines.slice(start, end).map(labelKind).filter(Boolean));
  if (!coherent(maskedLines.slice(start, end))
    || maskedLines.slice(contextStart, start).some(line => kinds.has(labelKind(line)))) return -1;
  return validStart(start, isQuizOptionLine);
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
  const firstOptionIdx = findQuizOptionStart(lines);
  if (firstOptionIdx < 1) return null;

  const rawQuestion = lines.slice(0, firstOptionIdx).join('\n').trim();
  const optionLines = lines.slice(firstOptionIdx).map(line => line.trim()).filter(Boolean);
  if (optionLines.length < 2) return null;

  let hasCorrect = false;
  const optionsRaw = optionLines.map((line, idx) => {
    const { isCorrect, text } = parseQuizOption(line);
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
    question: formatQuizText(rawQuestion) || tr("Выберите правильный ответ:"),
    options: shuffledOptions,
    correctAnswerId: correctOption.id,
    correctAnswerText: correctOption.text
  };
};


