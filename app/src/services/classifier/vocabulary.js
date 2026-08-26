/**
 * app/src/services/classifier/vocabulary.js
 *
 * Vocabulary level detector for German content words.
 */

import vocabData from './data/vocab_de.json' with { type: 'json' };

const SKIP_WORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'des', 'dem', 'den',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'mich', 'dich', 'sich', 'uns', 'euch',
  'mir', 'dir', 'ihm', 'ihr', 'uns', 'euch',
  'mein', 'dein', 'sein', 'unser', 'euer',
  'meinen', 'meinem', 'meiner', 'meines',
  'dieser', 'diese', 'dieses', 'diesem', 'diesen',
  'in', 'an', 'auf', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'aus',
  'um', 'für', 'durch', 'ohne', 'gegen', 'über', 'unter', 'neben',
  'vor', 'hinter', 'zwischen', 'ab', 'bis', 'laut',
  'und', 'oder', 'aber', 'denn', 'doch', 'auch', 'noch', 'schon',
  'nicht', 'kein', 'keine', 'keinen', 'keinem',
  'sehr', 'viel', 'wenig', 'mehr', 'weniger', 'immer', 'manchmal',
  'ja', 'nein', 'hier', 'dort', 'da', 'heute', 'morgen', 'gestern',
  'jetzt', 'dann', 'so', 'wie', 'wo', 'wann', 'warum', 'was',
  'wer', 'wen', 'wem', 'wessen',
  'ist', 'sind', 'war', 'waren', 'bin', 'bist', 'seid',
  'hat', 'haben', 'habe', 'hast', 'habt', 'hatte', 'hatten',
  'wird', 'werden', 'wurde', 'wurden',
  'kann', 'muss', 'will', 'soll', 'darf', 'mag',
  'könnte', 'müsste', 'würde', 'hätte', 'wäre', 'möchte',
  'sein', 'machen', 'gehen', 'kommen', 'sehen', 'geben', 'nehmen',
  'sagen', 'stehen', 'liegen', 'laufen', 'fahren', 'schreiben',
  'lesen', 'trinken', 'essen', 'kaufen', 'lernen', 'spielen',
  'hören', 'sprechen', 'fragen', 'antworten', 'wohnen', 'heißen',
  'brauchen', 'suchen', 'finden', 'kennen', 'wissen', 'denken',
  'glauben', 'meinen',
  'gut', 'schlecht', 'groß', 'klein', 'alt', 'neu', 'schön',
  'richtig', 'falsch', 'schnell', 'langsam', 'früh', 'spät',
  'lang', 'kurz', 'hoch', 'tief', 'warm', 'kalt',
  'bitte', 'danke', 'leider', 'natürlich', 'vielleicht', 'eigentlich',
]);

const CEFR_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export function detectVocabularyLevel(text) {
  const rawTokens = text.match(/[a-zäöüßA-ZÄÖÜ]+(?:-[a-zäöüßA-ZÄÖÜ]+)*/g) || [];
  const foundWords = [];
  let unknownCount = 0;

  for (const raw of rawTokens) {
    const clean = raw.toLowerCase();
    if (SKIP_WORDS.has(clean) || clean.length < 4) continue;

    if (vocabData[clean]) {
      foundWords.push({ word: clean, level: vocabData[clean] });
    } else {
      if (clean.length >= 6) {
        unknownCount++;
      }
    }
  }

  let bestLevel = 'A1';
  if (foundWords.length > 0) {
    bestLevel = foundWords.reduce((best, w) => {
      return (CEFR_ORDER[w.level] || 0) > (CEFR_ORDER[best] || 0) ? w.level : best;
    }, 'A1');
  }

  return {
    level: bestLevel,
    words: foundWords,
    unknown_count: unknownCount,
  };
}
