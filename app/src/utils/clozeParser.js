import { stripMarkdown } from './text.js';
import { parseExerciseContent } from './exerciseContentParser.js';

import { autoGenerateChoices } from './trainerChoices.js';
export { ARTICLE_GROUPS, ADJECTIVE_ENDINGS, autoGenerateChoices } from './trainerChoices.js';

// Only adjacent letters make a gap part of a word; punctuation does not.
export const isWordGap = (text, start, end) =>
  /[\p{L}\p{M}]$/u.test(text.slice(0, start)) || /^[\p{L}\p{M}]/u.test(text.slice(end));

export { normalizeAnswer } from './text.js';

export const cleanBracketSyntax = (text) => {
  if (!text) return '';
  const stripped = parseExerciseContent(text).exercise.replace(/^@(puzzle|match|free|edit)\s*/i, '');
  return stripped.replace(/(?:\[\[([^\]]+)\]\]|\{([^}]+)\}|\[([^\]]+)\](?!\())/g, (match, c1, c2, c3) => {
    const contents = c1 || c2 || c3 || '';
    const parts = contents.split(/[|;,/]/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const correct = parts.find(p => p.startsWith('*')) || parts[0];
    return correct.replace(/^\*/, '').trim();
  }).trim();
};

export const parseClozeData = (card, studyMode, sourceCards = []) => {
  if (!card) return null;
  const content = parseExerciseContent(card.front || card.front_text || '');
  // Parse answer markers before Markdown: {*a|*b|c} must not become an
  // italic span that silently removes both stars and accepts the wrong option.
  const originalText = content.exercise
    .split(/(\[\[[^\]]+\]\]|\{[^}]+\}|\[[^\]]+\](?!\())/g)
    .map((part, index) => index % 2 ? part : part.replace(/\S(?:[\s\S]*\S)?/g, stripMarkdown))
    .join('').trim();

  // 1. Explicit bracket syntax:
  // - [[...]] -> input gap (self-typed)
  // - {...}   -> choice gap (select from choices)
  // - [...]   -> fallback bracket syntax
  const bracketMatches = [...originalText.matchAll(/(?:\[\[([^\]]+)\]\]|\{([^}]+)\}|\[([^\]]+)\](?!\())/g)];
  if (bracketMatches.length > 0) {
    let maskedText = '';
    let lastEnd = 0;

    const gaps = bracketMatches.map((match, index) => {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const isAffix = isWordGap(originalText, matchStart, matchEnd);

      maskedText += originalText.substring(lastEnd, matchStart) + `___GAP_${index}___`;
      lastEnd = matchEnd;

      const isDoubleBracket = Boolean(match[1]);
      const innerContent = (match[1] || match[2] || match[3] || '').trim();

      if (isDoubleBracket) {
        // Strict input gap mode
        return {
          id: index,
          rawMatch: match[0],
          mode: 'input',
          isAffix,
          correctAnswer: stripMarkdown(innerContent),
          choices: []
        };
      }

      // Choice gap mode
      const optionsRaw = innerContent.split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
      const starredOptions = optionsRaw.filter(o => o.startsWith('*'));
      const correctList = starredOptions.length > 0
        ? starredOptions.map(o => stripMarkdown(o.replace(/^\*/, '')))
        : [optionsRaw[0] ? stripMarkdown(optionsRaw[0].replace(/^\*/, '')) : ''];
      const cleanCorrect = correctList.filter(Boolean).join('|');
      let cleanChoices = optionsRaw.map(o => stripMarkdown(o.replace(/^\*/, '')));
      if (correctList.length === 1 && cleanCorrect) {
        cleanChoices = autoGenerateChoices(cleanCorrect, cleanChoices, isAffix);
      }
      const shuffledChoices = [...cleanChoices].sort(() => Math.random() - 0.5);

      return {
        id: index,
        rawMatch: match[0],
        mode: 'choice',
        isAffix,
        correctAnswer: cleanCorrect,
        choices: shuffledChoices
      };
    });

    maskedText += originalText.substring(lastEnd);

    return {
      isMultiGap: true,
      content,
      gaps,
      maskedText,
      correctAnswer: gaps[0].correctAnswer,
      choices: gaps[0].choices
    };
  }

  // 2. Standard cloze fallback: choose longest word (ONLY if studyMode is explicitly 'cloze')
  if (studyMode !== 'cloze') return null;

  const words = originalText.split(/\s+/).map(w => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, "").trim()).filter(Boolean);
  if (words.length === 0) return { maskedText: originalText, correctAnswer: "", choices: [] };

  const validWords = words.filter(w => w.length >= 3);
  const targetWord = validWords.length > 0
    ? validWords.reduce((longest, current) => current.length > longest.length ? current : longest, validWords[0])
    : words[0];

  const cleanTarget = targetWord.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, "");

  let maskedText = originalText;
  try {
    const regex = new RegExp(`\\b${cleanTarget}\\b`, 'i');
    maskedText = originalText.replace(regex, '_____');
  } catch {
    maskedText = originalText.replace(cleanTarget, '_____');
  }

  const distractorWords = new Set();
  sourceCards.forEach(c => {
    if (c.id === card.id) return;
    const frontTxt = stripMarkdown(c.front || '');
    frontTxt.split(/\s+/).forEach(w => {
      const cleaned = w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, "").trim();
      if (cleaned.length >= 3 && cleaned.toLowerCase() !== cleanTarget.toLowerCase()) {
        distractorWords.add(cleaned);
      }
    });
  });

  let distractors = Array.from(distractorWords);
  const fallbackWords = ['Auto', 'Haus', 'Katze', 'Brot', 'Milch', 'Hund', 'Wasser', 'Apfel', 'Buch', 'Tee', 'Kaffee', 'Straße', 'Stadt', 'Land', 'Schule', 'Lehrer'];
  while (distractors.length < 3) {
    const randomFallback = fallbackWords[Math.floor(Math.random() * fallbackWords.length)];
    if (randomFallback.toLowerCase() !== cleanTarget.toLowerCase()) {
      distractors.push(randomFallback);
    }
  }

  const selectedDistractors = [];
  for (let i = 0; i < 3 && distractors.length > 0; i++) {
    const idx = Math.floor(Math.random() * distractors.length);
    selectedDistractors.push(distractors.splice(idx, 1)[0]);
  }

  const choices = [cleanTarget, ...selectedDistractors].sort(() => Math.random() - 0.5);

  return {
    content,
    maskedText,
    correctAnswer: cleanTarget,
    choices
  };
};
