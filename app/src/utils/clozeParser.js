import { stripMarkdown } from './text';

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
  ['euch', 'ihr', 'euer', 'eure']
];

export const autoGenerateChoices = (correctWord, existingChoices = []) => {
  if (existingChoices.length > 1) return existingChoices;
  const lower = (correctWord || '').toLowerCase().trim();
  for (const group of ARTICLE_GROUPS) {
    if (group.includes(lower)) {
      const distractors = group.filter(w => w !== lower);
      const chosen = [];
      const copy = [...distractors];
      while (chosen.length < 3 && copy.length > 0) {
        const idx = Math.floor(Math.random() * copy.length);
        chosen.push(copy.splice(idx, 1)[0]);
      }
      return [correctWord, ...chosen];
    }
  }
  return existingChoices;
};

export const cleanBracketSyntax = (text) => {
  if (!text) return '';
  return text.replace(/\{([^}]+)\}/g, (match, contents) => {
    const parts = contents.split(/[|;]/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const correct = parts.find(p => p.startsWith('*')) || parts[0];
    return correct.replace(/^\*/, '').trim();
  });
};

export const parseClozeData = (card, studyMode, sourceCards = []) => {
  if (!card) return null;
  const hasBracketSyntax = /\{([^}]+)\}/.test(card?.front || '');
  const effectiveStudyMode = (hasBracketSyntax || studyMode === 'trainer') ? 'trainer' : studyMode;

  if (effectiveStudyMode !== 'cloze' && effectiveStudyMode !== 'trainer' && !hasBracketSyntax) return null;
  const originalText = stripMarkdown(card.front);

  // 1. Explicit bracket syntax: supports 1, 2, or multiple gaps!
  const bracketMatches = [...originalText.matchAll(/\{([^}]+)\}/g)];
  if (bracketMatches.length > 0) {
    const gaps = bracketMatches.map((match, index) => {
      const optionsRaw = match[1].split(/[|;]/).map(o => o.trim()).filter(Boolean);
      let correctAnswer = optionsRaw.find(o => o.startsWith('*')) || optionsRaw[0] || '';
      const cleanCorrect = correctAnswer.replace(/^\*/, '').trim();
      let cleanChoices = optionsRaw.map(o => o.replace(/^\*/, '').trim());
      cleanChoices = autoGenerateChoices(cleanCorrect, cleanChoices);
      const shuffledChoices = [...cleanChoices].sort(() => Math.random() - 0.5);

      return {
        id: index,
        rawMatch: match[0],
        correctAnswer: cleanCorrect,
        choices: shuffledChoices
      };
    });

    let maskedText = originalText;
    gaps.forEach((gap) => {
      maskedText = maskedText.replace(gap.rawMatch, `___GAP_${gap.id}___`);
    });

    return {
      isMultiGap: true,
      gaps,
      maskedText,
      correctAnswer: gaps[0].correctAnswer,
      choices: gaps[0].choices
    };
  }

  // 2. Standard cloze fallback: choose longest word
  const words = originalText.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim()).filter(Boolean);
  if (words.length === 0) return { maskedText: originalText, correctAnswer: "", choices: [] };
  
  const validWords = words.filter(w => w.length >= 3);
  const targetWord = validWords.length > 0 
    ? validWords.reduce((longest, current) => current.length > longest.length ? current : longest, validWords[0])
    : words[0];

  const cleanTarget = targetWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "");
  
  let maskedText = originalText;
  try {
    const regex = new RegExp(`\\b${cleanTarget}\\b`, 'i');
    maskedText = originalText.replace(regex, '_____');
  } catch(e) {
    maskedText = originalText.replace(cleanTarget, '_____');
  }

  const distractorWords = new Set();
  sourceCards.forEach(c => {
    if (c.id === card.id) return;
    const frontTxt = stripMarkdown(c.front || '');
    frontTxt.split(/\s+/).forEach(w => {
      const cleaned = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim();
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
