/**
 * app/src/services/classifier/vocabulary.js
 *
 * Vocabulary level detector for German content words.
 */

import vocabBase from './data/vocab_de.json' with { type: 'json' };
import vocabMedium from './data/vocab_de_medium.json' with { type: 'json' };
import vocabMax from './data/vocab_de_max.json' with { type: 'json' };

const VOCAB_PROFILES = {
  base: vocabBase,
  medium: vocabMedium,
  max: vocabMax,
};
const configuredProfile = (import.meta.env?.VITE_DE_VOCAB_PROFILE || 'base').toLowerCase().trim();
const vocabData = VOCAB_PROFILES[configuredProfile] || VOCAB_PROFILES.base;

const SKIP_WORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'des', 'dem', 'den',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'mich', 'dich', 'sich', 'uns', 'euch',
  'mir', 'dir', 'ihm', 'ihr', 'uns', 'euch',
  'mein', 'dein', 'sein', 'unser', 'euer',
  'meinen', 'meinem', 'meiner', 'meines',
  'meine', 'deine', 'seine', 'seinen', 'seinem', 'seiner', 'seines',
  'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres', 'ihnen', 'unserer', 'unsere',
  'dieser', 'diese', 'dieses', 'diesem', 'diesen',
  'in', 'an', 'auf', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'aus',
  'um', 'für', 'durch', 'ohne', 'gegen', 'über', 'unter', 'neben',
  'vor', 'hinter', 'zwischen', 'ab', 'bis', 'laut', 'wegen', 'während', 'trotz',
  'und', 'oder', 'aber', 'denn', 'doch', 'auch', 'noch', 'schon',
  'nicht', 'kein', 'keine', 'keinen', 'keinem',
  'sehr', 'viel', 'viele', 'vielen', 'vieler', 'vielem', 'vieles',
  'wenig', 'wenige', 'wenigen', 'weniger', 'wenigem', 'weniges', 'mehr', 'mehrere',
  'immer', 'manchmal',
  'ja', 'nein', 'hier', 'dort', 'da', 'heute', 'morgen', 'gestern',
  'jetzt', 'dann', 'so', 'wie', 'wo', 'wann', 'warum', 'was',
  'wer', 'wen', 'wem', 'wessen', 'welche', 'welcher', 'welches', 'welchem',
  'welchen', 'etwas', 'nichts',
  'als', 'dass', 'wenn', 'weil', 'obwohl', 'bevor', 'nachdem', 'falls', 'damit',
  'alle', 'allen', 'aller', 'allem', 'alles', 'jeder', 'jede', 'jedes', 'jedem',
  'jeden', 'meiste', 'meisten', 'meistens', 'man', 'jemand', 'niemand',
  'dazu', 'dafür', 'dabei', 'darauf', 'darüber', 'darum', 'weiter', 'ganz',
  'ist', 'sind', 'war', 'waren', 'bin', 'bist', 'seid',
  'hat', 'haben', 'habe', 'hast', 'habt', 'hatte', 'hatten',
  'wird', 'werden', 'wurde', 'wurden',
  'kann', 'kannst', 'können', 'muss', 'musst', 'müssen', 'will', 'wollen',
  'soll', 'sollen', 'sollte', 'sollten', 'darf', 'darfst', 'dürfen', 'dürft',
  'durfte', 'durften', 'mag',
  'könnte', 'könnten', 'müsste', 'würde', 'hätte', 'wäre', 'möchte', 'möchtest',
  'sein', 'machen', 'gehen', 'kommen', 'sehen', 'geben', 'nehmen',
  'sagen', 'stehen', 'liegen', 'laufen', 'fahren', 'schreiben',
  'lesen', 'trinken', 'essen', 'kaufen', 'lernen', 'spielen',
  'hören', 'sprechen', 'fragen', 'antworten', 'wohnen', 'heißen',
  'brauchen', 'suchen', 'finden', 'kennen', 'wissen', 'denken',
  'glauben', 'meinen',
  'gehe', 'gehst', 'geht', 'ging', 'gingen', 'gibt', 'gebe', 'gibst',
  'heiße', 'heißt', 'heißen', 'nenne', 'nennst', 'nennt', 'nennen',
  'sage', 'sagst', 'sagt', 'mache', 'machst', 'macht', 'komme', 'kommst', 'kommt',
  'sehe', 'siehst', 'sieht', 'finde', 'findest', 'findet', 'denke', 'denkst', 'denkt',
  'gut', 'schlecht', 'groß', 'klein', 'alt', 'neu', 'schön',
  'richtig', 'falsch', 'schnell', 'langsam', 'früh', 'spät',
  'lang', 'kurz', 'hoch', 'tief', 'warm', 'kalt',
  'erste', 'erster', 'erstes', 'ersten', 'erstem', 'erstens',
  'zweite', 'zweiter', 'zweites', 'zweiten', 'zweitem',
  'bitte', 'danke', 'leider', 'natürlich', 'vielleicht', 'eigentlich',
  'berlin', 'brandenburg', 'bremen', 'hamburg', 'hessen', 'saarland', 'sachsen',
  'sachsen-anhalt', 'schleswig-holstein', 'thüringen', 'bayern', 'niedersachsen',
  'baden-württemberg', 'mecklenburg-vorpommern', 'nordrhein-westfalen',
  'rheinland-pfalz', 'münchen', 'frankreich', 'großbritannien', 'sowjetunion',
  'oscar', 'lisa',
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
