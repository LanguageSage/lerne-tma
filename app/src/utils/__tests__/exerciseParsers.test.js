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

test('7. Quiz with braces in question text remains quiz (not cloze/trainer)', () => {
  const card = {
    card_type: 'translation',
    front: 'Was ist der Unterschied zwischen {sein} und {haben}?\n\n*A. Sein ist für Bewegung\nB. Haben ist für Bewegung'
  };

  const detected = detectExerciseType(card);
  assert.equal(detected, 'quiz');
});

test('8. General card_type="translation" or "standard" does not block auto-detection by syntax', () => {
  const trainerCard = {
    card_type: 'translation',
    front: '{*Als|Wenn} ich nach Hause kam...'
  };
  assert.equal(detectExerciseType(trainerCard), 'trainer');

  const quizCard = {
    card_type: 'standard',
    front: 'Wie geht es dir?\n\nGut\n*Sehr gut\nSchlecht'
  };
  assert.equal(detectExerciseType(quizCard), 'quiz');
});

test('9. Explicit specialized card_type has absolute priority', () => {
  const explicitQuiz = { card_type: 'quiz', front: 'Simple text' };
  assert.equal(detectExerciseType(explicitQuiz), 'quiz');

  const explicitMatch = { card_type: 'match', front: 'Simple text' };
  assert.equal(detectExerciseType(explicitMatch), 'match');

  const explicitPuzzle = { card_type: 'puzzle', front: 'Simple text' };
  assert.equal(detectExerciseType(explicitPuzzle), 'puzzle');
});

test('10. @@CARD bulk import with puzzle, free_text and auto-detected cards', () => {
  const bulkText = `
@@CARD puzzle
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

  assert.equal(parsed[0].card_type, 'puzzle');
  assert.equal(parsed[0].front, 'Ich hatte meine Freunde angerufen.');

  assert.equal(parsed[1].card_type, 'free_text');
  assert.ok(parsed[1].front.includes('@free'));

  assert.equal(parsed[2].card_type, 'trainer');
});

