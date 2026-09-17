import { stripMarkdown } from './text.js';

export const ARTICLE_GROUPS = [
  ['der', 'die', 'das', 'den', 'dem', 'des'],
  ['ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
  ['mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines'],
  ['dein', 'deine', 'deinen', 'deinem', 'deiner', 'deines'],
  ['sein', 'seine', 'seinen', 'seinem', 'seiner', 'seines'],
  ['ihr', 'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres'],
  ['unser', 'unsere', 'unseren', 'unserem', 'unserer', 'unseres'],
  ['euer', 'eure', 'euren', 'eurem', 'eurer', 'eures'],
  ['kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines'],
  ['diese', 'dieser', 'dieses', 'diesen', 'diesem'],
  ['welche', 'welcher', 'welches', 'welchen', 'welchem'],
  ['jede', 'jeder', 'jedes', 'jeden', 'jedem'],
  ['dich', 'dir', 'du', 'dein'],
  ['mich', 'mir', 'ich', 'mein'],
  ['ihn', 'ihm', 'er', 'sein'],
  ['uns', 'wir', 'unser', 'unsere'],
  ['euch', 'ihr', 'euer', 'eure'],
  ['aus', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'gegenüber'],
  ['durch', 'für', 'gegen', 'ohne', 'um', 'bis', 'entlang'],
  ['an', 'auf', 'hinter', 'in', 'neben', 'über', 'unter', 'vor', 'zwischen'],
  ['am', 'ans', 'im', 'ins', 'zum', 'zur', 'vom', 'beim'],
  ['sich', 'mich', 'mir', 'dich', 'dir', 'uns', 'euch'],
  ['trotzdem', 'deshalb', 'darum', 'dennoch', 'deswegen', 'daher'],
  ['obwohl', 'weil', 'da', 'wenn', 'als', 'dass', 'damit'],
  ['und', 'aber', 'oder', 'sondern', 'denn'],
  ['außerdem', 'ausserdem', 'jedoch', 'sonst']
];

export const autoGenerateChoices = (correctWord, existingChoices = []) => {
  if (existingChoices.length > 1) return existingChoices;
  const rawWord = (correctWord || '').trim();
  const lower = rawWord.toLowerCase();
  const isCapitalized = rawWord.length > 0 && rawWord[0] === rawWord[0].toUpperCase() && rawWord[0] !== rawWord[0].toLowerCase();
  for (const group of ARTICLE_GROUPS) {
    if (group.includes(lower)) {
      const distractors = group.filter(w => w !== lower);
      const chosen = [];
      const copy = [...distractors];
      while (chosen.length < 3 && copy.length > 0) {
        const idx = Math.floor(Math.random() * copy.length);
        const w = copy.splice(idx, 1)[0];
        const formatted = isCapitalized ? (w.charAt(0).toUpperCase() + w.slice(1)) : w;
        chosen.push(formatted);
      }
      return [correctWord, ...chosen];
    }
  }
  return existingChoices;
};

export const normalizeAnswer = (str) => {
  if (!str) return '';
  let res = str.trim().replace(/\s+/g, ' ').toLowerCase();
  res = res.replace(/[.!?]+$/, '').trim();
  return res;
};

export const cleanBracketSyntax = (text) => {
  if (!text) return '';
  const stripped = text.replace(/^@(puzzle|match|free)\s*/i, '');
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
  const originalText = stripMarkdown(card.front || '');

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
          correctAnswer: innerContent,
          choices: []
        };
      }

      // Choice gap mode
      const optionsRaw = innerContent.split(/[|;,/]/).map(o => o.trim()).filter(Boolean);
      const starredOptions = optionsRaw.filter(o => o.startsWith('*'));
      const correctList = starredOptions.length > 0
        ? starredOptions.map(o => o.replace(/^\*/, '').trim())
        : [optionsRaw[0] ? optionsRaw[0].replace(/^\*/, '').trim() : ''];
      const cleanCorrect = correctList.filter(Boolean).join('|');
      let cleanChoices = optionsRaw.map(o => o.replace(/^\*/, '').trim());
      if (correctList.length === 1 && cleanCorrect) {
        cleanChoices = autoGenerateChoices(cleanCorrect, cleanChoices);
      }
      const shuffledChoices = [...cleanChoices].sort(() => Math.random() - 0.5);

      return {
        id: index,
        rawMatch: match[0],
        mode: 'choice',
        correctAnswer: cleanCorrect,
        choices: shuffledChoices
      };
    });

    maskedText += originalText.substring(lastEnd);

    return {
      isMultiGap: true,
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
    maskedText,
    correctAnswer: cleanTarget,
    choices
  };
};
