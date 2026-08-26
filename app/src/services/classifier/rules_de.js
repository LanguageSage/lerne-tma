/**
 * app/src/services/classifier/rules_de.js
 *
 * Pure JavaScript German grammar rule detectors for CEFR classification.
 * Matches Python rules_de.py 1:1.
 */

const TOKENIZE_RE = /[a-zäöüß]+(?:-[a-zäöüß]+)*/g;

// Tokenize text into lowercased words
function tokenize(text) {
  if (!text) return [];
  const matches = text.toLowerCase().match(TOKENIZE_RE);
  return matches || [];
}

// Sets of verb forms
const HABEN_PRES = new Set(['habe', 'hast', 'hat', 'haben', 'habt']);
const SEIN_PRES  = new Set(['bin', 'bist', 'ist', 'sind', 'seid']);
const HABEN_PRÄT = new Set(['hatte', 'hattest', 'hatten', 'hattet']);
const SEIN_PRÄT  = new Set(['war', 'warst', 'waren', 'wart']);
const WERDEN_PRES = new Set(['wird', 'werden', 'werde', 'wirst', 'werdet']);
const WERDEN_PRÄT = new Set(['wurde', 'wurden', 'wurdest', 'wurdet']);

const MODALS_PRES = new Set([
  'kann', 'kannst', 'können',
  'muss', 'musst', 'müssen',
  'will', 'willst', 'wollen',
  'darf', 'darfst', 'dürfen',
  'soll', 'sollst', 'sollen',
  'mag',
]);

const MODAL_PRÄT = new Set([
  'musste', 'musstest', 'mussten', 'musstet',
  'konnte', 'konntest', 'konnten', 'konntet',
  'wollte', 'wolltest', 'wollten', 'wolltet',
  'sollte', 'solltest', 'sollten', 'solltet',
  'durfte', 'durftest', 'durften', 'durftet',
  'mochte', 'mochtest', 'mochten', 'mochtet',
]);

const KONJ_II_A2 = new Set([
  'möchte', 'möchten', 'möchtest', 'möchtet',
  'könnte', 'könnten', 'könntest', 'könntet',
  'dürfte', 'dürften', 'dürftest', 'dürftet',
  'hätte', 'hätten', 'hättest', 'hättet',
  'wäre', 'wären', 'wärst', 'wäret',
  'müsste', 'müssten', 'müsstest', 'müsstet',
]);

const KONJ_II_B1 = new Set([
  'würde', 'würden', 'würdest', 'würdet',
]);

const IRREG_PART_II = new Set([
  'gegangen', 'gewesen', 'geworden', 'gegessen', 'getrunken',
  'gefahren', 'geschrieben', 'gelesen', 'gesehen', 'gehört',
  'gesprochen', 'geblieben', 'gesessen', 'gestanden', 'gelegen',
  'gesungen', 'genommen', 'gegeben', 'gekommen', 'geflogen',
  'geschwommen', 'getroffen', 'gefunden', 'verloren', 'vergessen',
  'gefallen', 'geschlafen', 'gehalten', 'gerufen', 'geschnitten',
  'geholfen', 'geworfen', 'gezogen', 'getragen', 'geschlagen',
  'gebissen', 'gelaufen', 'gebracht', 'gedacht', 'gewusst',
  'gewaschen', 'gestiegen', 'gestorben',
  'aufgestanden', 'eingeschlafen', 'angekommen', 'abgefahren',
  'mitgenommen', 'weggegangen', 'ausgegangen', 'eingegangen',
  'eingegeben', 'angerufen', 'aufgehört', 'eingekauft',
  'herausgekommen', 'zurückgekommen', 'aufgewacht', 'eingestiegen',
  'ausgestiegen', 'stattgefunden', 'teilgenommen', 'aufgenommen',
  'angefangen', 'abgebrochen', 'angeschaut', 'umgezogen',
  'eingezogen', 'ausgezogen', 'aufgemacht', 'zugemacht',
  'aufgeräumt', 'abgeholt', 'abgegeben', 'angeboten', 'mitgemacht',
  'hergestellt', 'vorgestellt', 'eingestellt', 'vorgeschlagen',
  'aufgeschrieben', 'abgeschrieben', 'weitergegangen', 'umgestiegen',
  'beschrieben', 'bekommen', 'verstanden', 'entschieden',
  'empfohlen', 'versucht', 'erklärt',
  'gearbeitet', 'gelernt', 'geübt', 'gespielt', 'gemacht',
  'gekauft', 'gefragt', 'gewartet', 'geholfen', 'gewohnt',
  'gesucht', 'gestellt', 'gesagt', 'gebraucht', 'gezeigt',
  'geöffnet', 'geschlossen', 'bezahlt', 'bestellt', 'besucht',
  'erzählt', 'gereist', 'gewählt', 'bezeichnet', 'erklärt',
  'gepackt', 'telefoniert', 'reserviert', 'studiert', 'passiert',
]);

const FALSE_POS_PART = new Set([
  'gedicht', 'gericht', 'gesetz', 'gewicht', 'gesicht', 'gerät',
  'geschäft', 'geschlecht', 'gesundheit', 'gehalt', 'gewinn',
  'geruch', 'gesang', 'getränk', 'gespräch', 'gebiet', 'gelände',
  'bericht', 'bezirk', 'bereich', 'betrieb', 'besitz',
]);

const REG_PART_RE = /\b(?:ge[a-zäöüß]{3,}e?t|[a-zäöüß]{2,}ge[a-zäöüß]{2,}e?[nt]|[a-zäöüß]+iert|be[a-zäöüß]{3,}t|er[a-zäöüß]{3,}t|ver[a-zäöüß]{3,}t|ent[a-zäöüß]{3,}t)\b/i;

function hasPartizipII(textLower, tokens) {
  if (tokens.some(t => IRREG_PART_II.has(t))) return true;
  const m = textLower.match(REG_PART_RE);
  if (m && !FALSE_POS_PART.has(m[0].toLowerCase())) return true;
  return false;
}

const A2_SUBORDINATORS = new Set(['weil', 'dass', 'ob', 'wenn', 'als']);
const B1_SUBORDINATORS = new Set([
  'obwohl', 'während', 'nachdem', 'bevor', 'seitdem',
  'sodass', 'solange', 'sobald', 'indem', 'sofern', 'falls',
  'vorausgesetzt', 'insofern', 'damit', 'da', 'seit', 'ehe',
]);

const B1_GENITIV = new Set([
  'wegen', 'aufgrund', 'mithilfe', 'anstelle', 'anlässlich',
  'infolge', 'trotz', 'mangels', 'dank', 'kraft', 'laut',
]);

const RELATIV_RE = /,\s*(?:(?:in|auf|an|mit|bei|über|unter|vor|hinter|nach|von|zu|durch|für|ohne|um|gegen|wegen|trotz)\s+)?(?:der|die|das|den|dem|denen|deren|dessen)\b/i;
const SO_WIE_RE  = /\bso\s*,\s*wie\b/i;
const W_NEBENSATZ_RE = /,\s*(?:wie|wo|wohin|woher|wann|warum|weshalb|wieso|weswegen|was|wer|wen|wem|wessen|womit|worüber|wovon|woran|wozu|worauf|wobei|wodurch)\b/i;
const WORDEN_RE  = /\bworden\b/i;

const B2_JE_DESTO  = /\bje\b[\s\S]{1,80}\b(?:desto|umso)\b/i;
const B2_NICHT_NUR = /\bnicht\s+nur\b/i;
const B2_SOWOHL   = /\bsowohl\b[\s\S]{1,80}\bals\s+auch\b/i;
const B2_WEDER    = /\bweder\b[\s\S]{1,80}\bnoch\b/i;

const B1_INF_ADJECTIVES = new Set([
  'schwer', 'leicht', 'einfach', 'wichtig', 'möglich', 'unmöglich',
  'klar', 'interessant', 'schön', 'gut', 'hart', 'kompliziert', 'nützlich', 'nötig'
]);
const B1_ADJ_ZU = /\b(?:schwer|leicht|einfach|wichtig|möglich|unmöglich|klar|interessant|schön|gut|hart|kompliziert|nützlich|nötig)\b[\s\S]{0,30}\bzu\b\s+[a-zäöüß]+en\b/i;

const C1_SEIN_ZU     = /\b(?:ist|sind|war|waren|wäre|sei|wären)\b[\s\S]{0,40}\bzu\b\s+[a-zäöüß]+en\b/i;
const C1_LASSEN_SICH = /\b(?:lässt|lassen|ließ|ließen)\b[\s\S]{0,40}\bsich\b/i;

// Detectors
function detectC1(text) {
  if (C1_LASSEN_SICH.test(text)) return { name: 'sich lassen + Infinitiv', level: 'C1', confidence: 0.88 };
  if (C1_SEIN_ZU.test(text) && !B1_ADJ_ZU.test(text)) return { name: 'sein + zu + Infinitiv', level: 'C1', confidence: 0.82 };
  return null;
}

function detectB2(text) {
  if (B2_JE_DESTO.test(text))  return { name: 'je…desto Konstruktion', level: 'B2', confidence: 0.92 };
  if (B2_SOWOHL.test(text))    return { name: 'sowohl…als auch', level: 'B2', confidence: 0.90 };
  if (B2_WEDER.test(text))     return { name: 'weder…noch', level: 'B2', confidence: 0.90 };
  if (B2_NICHT_NUR.test(text)) return { name: 'nicht nur…sondern auch', level: 'B2', confidence: 0.85 };
  return null;
}

function detectPassiv(text, tokens) {
  const tl = text.toLowerCase();
  if (WORDEN_RE.test(tl)) return { name: 'Passiv Perfekt (…worden)', level: 'B2', confidence: 0.90 };
  if (tokens.some(t => WERDEN_PRES.has(t)) && hasPartizipII(tl, tokens)) {
    return { name: 'Passiv Präsens (wird + Part.II)', level: 'B1', confidence: 0.82 };
  }
  if (tokens.some(t => WERDEN_PRÄT.has(t)) && hasPartizipII(tl, tokens)) {
    return { name: 'Passiv Präteritum (wurde + Part.II)', level: 'B1', confidence: 0.82 };
  }
  return null;
}

function detectSubordinators(text, tokens) {
  if (SO_WIE_RE.test(text)) {
    return { name: 'Modalsatz (so, wie)', level: 'B1', confidence: 0.90 };
  }
  const wMatch = text.match(W_NEBENSATZ_RE);
  if (wMatch) {
    const wWord = wMatch[0].replace(/,/g, '').trim().toLowerCase();
    return { name: `B1-Nebensatz (${wWord})`, level: 'B1', confidence: 0.90 };
  }
  const b1 = tokens.find(t => B1_SUBORDINATORS.has(t));
  if (b1) return { name: `B1-Nebensatz (${b1})`, level: 'B1', confidence: 0.90 };
  const a2 = tokens.find(t => A2_SUBORDINATORS.has(t));
  if (a2) return { name: `A2-Nebensatz (${a2})`, level: 'A2', confidence: 0.88 };
  return null;
}

function detectRelativsatz(text) {
  if (RELATIV_RE.test(text)) return { name: 'Relativsatz', level: 'B1', confidence: 0.85 };
  return null;
}

function detectInfinitivKonstruktionen(text) {
  const tl = text.toLowerCase();
  if (B1_ADJ_ZU.test(tl)) return { name: 'Adjektiv + zu + Infinitiv', level: 'B1', confidence: 0.88 };
  if (/\bum\b[\s\S]{0,60}\bzu\b/i.test(tl)) return { name: 'um…zu Konstruktion', level: 'B1', confidence: 0.85 };
  if (/\bohne\b[\s\S]{0,60}\bzu\b/i.test(tl)) return { name: 'ohne…zu Konstruktion', level: 'B1', confidence: 0.88 };
  if (/\b(?:statt|anstatt)\b[\s\S]{0,60}\bzu\b/i.test(tl)) return { name: 'statt…zu Konstruktion', level: 'B1', confidence: 0.88 };
  return null;
}

function detectGenitivPreps(tokens) {
  const found = tokens.find(t => B1_GENITIV.has(t));
  if (found) return { name: `Genitiv-Präposition (${found})`, level: 'B1', confidence: 0.80 };
  return null;
}

function detectKonjunktiv(tokens) {
  const b1 = tokens.find(t => KONJ_II_B1.has(t));
  if (b1) return { name: `Konjunktiv II Konditional (${b1})`, level: 'B1', confidence: 0.85 };
  const a2 = tokens.find(t => KONJ_II_A2.has(t));
  if (a2) return { name: `Konjunktiv II höflich (${a2})`, level: 'A2', confidence: 0.88 };
  return null;
}

function detectReflexive(text, tokens) {
  if (tokens.includes('sich') && !C1_LASSEN_SICH.test(text)) {
    return { name: 'Reflexives Verb (sich)', level: 'A2', confidence: 0.85 };
  }
  const REFLEX_VERBS = new Set([
    'freue', 'freust', 'freut', 'freuen',
    'erinnere', 'erinnerst', 'erinnert', 'erinnern',
    'ärger', 'ärgere', 'ärgerst', 'ärgert', 'ärgern',
    'fühle', 'fühlst', 'fühlt', 'fühlen',
    'vorstelle', 'vorstellst', 'vorstellt', 'vorstellen',
    'befinde', 'befindest', 'befindet', 'befinden',
    'beschäftige', 'beschäftigst', 'beschäftigt', 'beschäftigen',
    'interessiere', 'interessierst', 'interessiert', 'interessieren',
    'entscheide', 'entscheidest', 'entscheidet', 'entscheiden',
    'bewege', 'bewegst', 'bewegt', 'bewegen',
    'wasche', 'wäschst', 'wäscht', 'waschen',
    'setze', 'setzt', 'setzen',
    'lege', 'legst', 'legt', 'legen',
    'ziehe', 'ziehst', 'zieht', 'ziehen',
  ]);
  const prons = ['mich', 'dich', 'uns', 'euch'];
  const foundPron = tokens.find(t => prons.includes(t));
  if (foundPron && tokens.some(t => REFLEX_VERBS.has(t))) {
    return { name: `Reflexives Verb (${foundPron})`, level: 'A2', confidence: 0.82 };
  }
  return null;
}

function detectModalPrät(tokens) {
  const found = tokens.find(t => MODAL_PRÄT.has(t));
  if (found) return { name: `Präteritum-Modal (${found})`, level: 'A2', confidence: 0.90 };
  return null;
}

function detectModalPres(tokens) {
  const found = tokens.find(t => MODALS_PRES.has(t));
  if (found) return { name: `Modalverb Präsens (${found})`, level: 'A1', confidence: 0.90 };
  return null;
}

function detectTense(text, tokens) {
  const tl = text.toLowerCase();
  const hasHabenPrät = tokens.some(t => HABEN_PRÄT.has(t));
  const hasSeinPrät  = tokens.some(t => SEIN_PRÄT.has(t));
  const hasHabenPres = tokens.some(t => HABEN_PRES.has(t));
  const hasSeinPres  = tokens.some(t => SEIN_PRES.has(t));
  const hasPart = hasPartizipII(tl, tokens);
  const hasIrr  = tokens.some(t => IRREG_PART_II.has(t));

  if ((hasHabenPrät || hasSeinPrät) && hasPart) {
    return [{ name: 'Plusquamperfekt', level: 'B1', confidence: 0.78 }];
  }
  if (hasHabenPrät || hasSeinPrät) {
    return [{ name: 'Präteritum (hatte/war)', level: 'A2', confidence: 0.88 }];
  }
  if (hasHabenPres && hasPart) {
    return [{ name: 'Perfekt (haben + Part.II)', level: 'A2', confidence: 0.92 }];
  }
  if (hasSeinPres && hasIrr) {
    if (!WORDEN_RE.test(tl)) {
      return [{ name: 'Perfekt (sein + Part.II)', level: 'A2', confidence: 0.85 }];
    }
  }
  return [];
}

export function detectAllFeaturesDe(text) {
  const tokens = tokenize(text);
  const features = [];

  const c1 = detectC1(text);
  if (c1) {
    features.push(c1);
    return features;
  }

  const b2 = detectB2(text);
  if (b2) features.push(b2);

  const passiv = detectPassiv(text, tokens);
  if (passiv) features.push(passiv);

  const subord = detectSubordinators(text, tokens);
  if (subord) features.push(subord);

  const rel = detectRelativsatz(text);
  if (rel) features.push(rel);

  const inf = detectInfinitivKonstruktionen(text);
  if (inf) features.push(inf);

  const gen = detectGenitivPreps(tokens);
  if (gen) features.push(gen);

  const konj = detectKonjunktiv(tokens);
  if (konj) features.push(konj);

  const modalP = detectModalPrät(tokens);
  if (modalP) features.push(modalP);

  const reflex = detectReflexive(text, tokens);
  if (reflex) features.push(reflex);

  const tenses = detectTense(text, tokens);
  features.push(...tenses);

  if (features.length === 0) {
    const modalPres = detectModalPres(tokens);
    if (modalPres) features.push(modalPres);
  }

  return features;
}
