import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClozeData, cleanBracketSyntax, normalizeAnswer } from '../clozeParser.js';
import { parseMatchData, normalizeMatchValue } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { parseBatchCardsText } from '../batchCardParser.js';
import { detectExerciseType } from '../exerciseDetector.js';

test('1. Choice gap syntax: Ich lebe {*seit|in|vor} 17 Jahren in Deutschland.', () => {
  const card = {
    front: 'Ich lebe {*seit|in|vor} 17 Jahren in Deutschland.',
    back: 'Я живу 17 лет в Германии.'
  };

  const parsed = parseClozeData(card, 'trainer');
  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 1);
  assert.equal(parsed.gaps[0].mode, 'choice');
  assert.equal(parsed.gaps[0].correctAnswer, 'seit');
  assert.ok(parsed.gaps[0].choices.includes('seit'));
  assert.ok(parsed.gaps[0].choices.includes('in'));
  assert.ok(parsed.gaps[0].choices.includes('vor'));

  const cleaned = cleanBracketSyntax(card.front);
  assert.equal(cleaned, 'Ich lebe seit 17 Jahren in Deutschland.');
});

test('2. Input gap syntax: Ich [[hatte]] meine Freunde [[angerufen]].', () => {
  const card = {
    front: 'Ich [[hatte]] meine Freunde [[angerufen]].',
    back: 'Я позвонил своим друзьям.'
  };

  const parsed = parseClozeData(card, 'trainer');
  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 2);

  assert.equal(parsed.gaps[0].mode, 'input');
  assert.equal(parsed.gaps[0].correctAnswer, 'hatte');
  assert.equal(parsed.gaps[0].choices.length, 0);

  assert.equal(parsed.gaps[1].mode, 'input');
  assert.equal(parsed.gaps[1].correctAnswer, 'angerufen');
  assert.equal(parsed.gaps[1].choices.length, 0);

  const cleaned = cleanBracketSyntax(card.front);
  assert.equal(cleaned, 'Ich hatte meine Freunde angerufen.');
});

test('3. Mixed gaps: {*Als|Wenn} ich ankam, [[hatte]] sie schon [[gegessen]].', () => {
  const card = {
    front: '{*Als|Wenn} ich ankam, [[hatte]] sie schon [[gegessen]].',
    back: 'Когда я пришел, она уже поела.'
  };

  const parsed = parseClozeData(card, 'trainer');
  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 3);

  // First is choice
  assert.equal(parsed.gaps[0].mode, 'choice');
  assert.equal(parsed.gaps[0].correctAnswer, 'Als');
  assert.ok(parsed.gaps[0].choices.includes('Als'));
  assert.ok(parsed.gaps[0].choices.includes('Wenn'));

  // Second is input
  assert.equal(parsed.gaps[1].mode, 'input');
  assert.equal(parsed.gaps[1].correctAnswer, 'hatte');
  assert.equal(parsed.gaps[1].choices.length, 0);

  // Third is input
  assert.equal(parsed.gaps[2].mode, 'input');
  assert.equal(parsed.gaps[2].correctAnswer, 'gegessen');
  assert.equal(parsed.gaps[2].choices.length, 0);

  const cleaned = cleanBracketSyntax(card.front);
  assert.equal(cleaned, 'Als ich ankam, hatte sie schon gegessen.');
});

test('4. normalizeAnswer: multiple spaces, case-insensitive, umlauts, trailing punctuation, and hyphen check', () => {
  assert.equal(normalizeAnswer('   Hatte  '), 'hatte');
  assert.equal(normalizeAnswer('viel    Erfolg '), 'viel erfolg');
  assert.equal(normalizeAnswer('Überraschung'), 'überraschung');
  assert.equal(normalizeAnswer('groß'), 'groß');

  // Trailing sentence punctuation optional:
  assert.equal(normalizeAnswer('Ich hatte die Tickets gekauft.'), 'ich hatte die tickets gekauft');
  assert.equal(normalizeAnswer('Ich hatte die Tickets gekauft'), 'ich hatte die tickets gekauft');
  assert.equal(normalizeAnswer('Viel Erfolg!'), 'viel erfolg');
  assert.equal(normalizeAnswer('Wie geht es dir?'), 'wie geht es dir');

  // Internal hyphens remain significant:
  assert.equal(normalizeAnswer('E-Mail'), 'e-mail');
  assert.notEqual(normalizeAnswer('E-Mail'), normalizeAnswer('Email'));
});

test('5. @match parsing and duplicated right values with normalizeMatchValue', () => {
  const matchCard = {
    front: `@match
ich => hatte
er => hatte
wir => hatten`
  };

  const parsed = parseMatchData(matchCard);
  assert.ok(parsed);
  assert.equal(parsed.isMatch, true);
  assert.equal(parsed.pairs.length, 3);

  // Check right value normalization for duplicates
  assert.equal(normalizeMatchValue(parsed.pairs[0].right), 'hatte');
  assert.equal(normalizeMatchValue(parsed.pairs[1].right), 'hatte');
  assert.equal(normalizeMatchValue(parsed.pairs[0].right), normalizeMatchValue(parsed.pairs[1].right));
});

test('6. @free syntax: prompt and example answer', () => {
  const freeCard = {
    front: `@free
Schreiben Sie einen Satz mit „als“.`,
    back: 'Als ich klein war, spielte ich oft im Garten.'
  };

  const parsed = parseFreeTextData(freeCard);
  assert.ok(parsed);
  assert.equal(parsed.isFreeText, true);
  assert.equal(parsed.prompt, 'Schreiben Sie einen Satz mit „als“.');
  assert.equal(parsed.exampleAnswer, 'Als ich klein war, spielte ich oft im Garten.');
});

test('7. Trainer priority: {*Wenn|Seit|Als} and {mit|nach|zu} are detected as trainer', () => {
  assert.equal(detectExerciseType({ front: '{*Wenn|Seit|Als}' }), 'trainer');
  assert.equal(detectExerciseType({ front: 'Ich fahre {*mit|nach|zu} dem Bus.' }), 'trainer');
  assert.equal(detectExerciseType({ front: 'Ich fahre {mit|nach|zu} dem Bus.' }), 'trainer');
  assert.equal(detectExerciseType({ front: 'Er [[hatte]] gestern [[angerufen]].' }), 'trainer');
});

test('8. Quiz detection with valid test structure vs asterisks in normal text', () => {
  const validQuiz = {
    front: 'Wie heißt die Hauptstadt?\n\nMünchen\n*Berlin\nHamburg'
  };
  assert.equal(detectExerciseType(validQuiz), 'quiz');

  // Normal text with asterisk is NOT quiz
  assert.equal(detectExerciseType({ front: 'Das ist ein *wichtiges Wort.' }), null);
  assert.equal(detectExerciseType({ front: 'Text * irgendwo.' }), null);
});

test('9. Stored card_type in DB is NOT source of truth: content overrides stored card_type', () => {
  const conflictingCard = {
    card_type: 'quiz',
    front: 'Ich fahre {*mit|nach|zu} dem Bus.'
  };
  assert.equal(detectExerciseType(conflictingCard), 'trainer');

  const standardStoredTrainer = {
    card_type: 'standard',
    front: 'Ich fahre {*mit|nach|zu} dem Bus.'
  };
  assert.equal(detectExerciseType(standardStoredTrainer), 'trainer');

  const quizStoredStandard = {
    card_type: 'quiz',
    front: 'Das ist ein *wichtiges Wort.'
  };
  assert.equal(detectExerciseType(quizStoredStandard), null);
});

test('10. Full realistic German letter card is recognized as trainer regardless of stored card_type', () => {
  const letterFront = `Sehr geehrter {Herr Bauer|Frau Bauer|Firma Mustermann},
wir möchten Sie daran erinnern, dass Ihre Bestellung vom 15. Februar 2024 noch zur Abholung bereitliegt. Leider konnten wir bisher keinen Kontakt mit {Ihnen|Sie|Ihr} aufnehmen.

Bitte holen Sie Ihre {aktuelle|alte|vergangene} Bestellung spätestens bis zum 15. März 2024 in unserer Filiale ab. Bringen Sie Ihre Bestellnummer mit, {damit|weil|um} wir Ihnen den Artikel problemlos aushändigen können.

{*Wenn|Seit|Als} Sie den Artikel bereits abgeholt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Falls Sie Fragen zu Ihrer Bestellung haben, {*können|möchten|sollen} Sie sich gerne an unseren Kundenservice unter der Telefonnummer 030-123456 wenden.

Mit freundlichen {*Grüßen|Gruß|Grüße}
Mustermann GmbH.`;

  // Without card_type
  assert.equal(detectExerciseType({ front: letterFront }), 'trainer');

  // With stored card_type = 'quiz'
  assert.equal(detectExerciseType({ card_type: 'quiz', front: letterFront }), 'trainer');

  // With stored card_type = 'standard'
  assert.equal(detectExerciseType({ card_type: 'standard', front: letterFront }), 'trainer');
});

test('11. @@CARD and delimiter bulk import with auto-detected exercise types', () => {
  const bulkText = `
@@CARD
FRONT:
Ich hatte meine Freunde angerufen.
BACK:
Я позвонил друзьям.
TAGS:
B1
@@END

@@CARD free_text
FRONT:
@free
Beschreiben Sie Ihren Tag.
BACK:
Morgens stehe ich um 7 Uhr auf.
@@END

@@CARD
FRONT:
{*Der|Die|Das} Hund bellt.
BACK:
Der
@@END
`;

  const parsed = parseBatchCardsText(bulkText);
  assert.equal(parsed.length, 3);

  assert.equal(parsed[0].card_type, 'standard');
  assert.equal(parsed[0].front, 'Ich hatte meine Freunde angerufen.');

  assert.equal(parsed[1].card_type, 'free_text');
  assert.ok(parsed[1].front.includes('@free'));

  assert.equal(parsed[2].card_type, 'trainer');
});

test('12. Delimiter import with trainer letter and multiple choices', () => {
  const delimiterText = `
Wie heißt die Hauptstadt?

München
*Berlin
Hamburg
---
Ich fahre {*mit|nach|zu} dem Bus.
---
Das ist ein *wichtiges Wort.
Перевод
`;

  const parsed = parseBatchCardsText(delimiterText);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].card_type, 'quiz');
  assert.equal(parsed[1].card_type, 'trainer');
  assert.equal(parsed[2].card_type, 'standard');
});

