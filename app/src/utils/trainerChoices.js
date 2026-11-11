/** Choice generation shared by legacy authoring and native structured study. */
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

export const ADJECTIVE_ENDINGS = ['e', 'en', 'em', 'er', 'es'];

export const autoGenerateChoices = (correctWord, existingChoices = [], isAffix = false) => {
  if (existingChoices.length > 1) return existingChoices;
  const rawWord = (correctWord || '').trim();
  const lower = rawWord.toLowerCase();
  if (isAffix && ADJECTIVE_ENDINGS.includes(lower)) {
    return [correctWord, ...ADJECTIVE_ENDINGS.filter(ending => ending !== lower)];
  }
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

