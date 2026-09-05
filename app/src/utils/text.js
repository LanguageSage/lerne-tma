export const stripMarkdown = (text) => {
  if (!text) return "";
  return text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/```/g, "")
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/<center>/g, "")
    .replace(/<\/center>/g, "")
    .replace(/<large>/g, "")
    .replace(/<\/large>/g, "")
    .trim();
};

const GERMAN_SPEECH_MAP = [
  // Common spoken abbreviations
  [/\bz\s*\.?\s*b(?:\.|\b)/gi, ' zum beispiel '],
  [/\bd\s*\.?\s*h(?:\.|\b)/gi, ' das heisst '],
  [/\bu\s*\.\s*a(?:\.|\b)/gi, ' unter anderem '],
  [/\b(?:u\s*\.\s*s\s*\.\s*w|usw)\.?(?:\.|\b)/gi, ' und so weiter '],
  [/\bbzw\.?(?:\.|\b)/gi, ' beziehungsweise '],

  // Symbols & Numbers
  [/%/g, ' prozent '],
  [/€/g, ' euro '],
  [/\$/g, ' dollar '],
  [/&/g, ' und '],
  [/\b1000\b/g, 'tausend'],
  [/\b100\b/g, 'hundert'],
  [/\b90\b/g, 'neunzig'],
  [/\b80\b/g, 'achtzig'],
  [/\b70\b/g, 'siebzig'],
  [/\b60\b/g, 'sechzig'],
  [/\b50\b/g, 'fünfzig'],
  [/\b40\b/g, 'vierzig'],
  [/\b30\b/g, 'dreissig'],
  [/\b20\b/g, 'zwanzig'],
  [/\b19\b/g, 'neunzehn'],
  [/\b18\b/g, 'achtzehn'],
  [/\b17\b/g, 'siebzehn'],
  [/\b16\b/g, 'sechzehn'],
  [/\b15\b/g, 'fünfzehn'],
  [/\b14\b/g, 'vierzehn'],
  [/\b13\b/g, 'dreizehn'],
  [/\b12\b/g, 'zwölf'],
  [/\b11\b/g, 'elf'],
  [/\b10\b/g, 'zehn'],
  [/\b9\b/g, 'neun'],
  [/\b8\b/g, 'acht'],
  [/\b7\b/g, 'sieben'],
  [/\b6\b/g, 'sechs'],
  [/\b5\b/g, 'fünf'],
  [/\b4\b/g, 'vier'],
  [/\b3\b/g, 'drei'],
  [/\b2\b/g, 'zwei'],
  [/\b1\b/g, 'eins'],
  [/\b0\b/g, 'null']
];

export const normalizeSpeechText = (text, lang = 'de') => {
  if (!text) return "";
  let str = stripMarkdown(text).toLowerCase();

  if ((lang || 'de').toLowerCase() === 'de') {
    // Expand abbreviations, numbers & symbols to German words
    GERMAN_SPEECH_MAP.forEach(([regex, replacement]) => {
      str = str.replace(regex, replacement);
    });

    // Normalize Eszett for speech matching (dreißig <-> dreissig, das heißt <-> das heisst)
    str = str.replace(/ß/g, "ss");
  }

  // Remove punctuation
  str = str.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, " ").replace(/\s+/g, " ").trim();
  return str;
};

export const normalizeGermanSpeechText = (text) => normalizeSpeechText(text, 'de');


