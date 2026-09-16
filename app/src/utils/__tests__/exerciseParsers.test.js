import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClozeData, cleanBracketSyntax, normalizeAnswer } from '../clozeParser.js';
import { parseQuizData } from '../quizParser.js';
import { parseMatchData } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { parseBatchCardsText } from '../batchCardParser.js';

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

test('normalizeAnswer helper check: trim, multi-spaces, case insensitive, umlauts preserved', () => {
  assert.equal(normalizeAnswer('   Hatte  '), 'hatte');
  assert.equal(normalizeAnswer('viel    Erfolg '), 'viel erfolg');
  assert.equal(normalizeAnswer('Überraschung'), 'überraschung');
  assert.equal(normalizeAnswer('groß'), 'groß');
});

test('4. @match syntax: Left => Right', () => {
  const matchCard = {
    front: `@match
Als ich Kind war => haben wir unsere Häuser im Dorf nie abgesperrt.
Als wir geheiratet haben => haben ungefähr 300 Gäste mit uns gefeiert.
Ich habe ihn sofort angerufen => als ich seine Nachricht bekommen habe.`
  };

  const parsed = parseMatchData(matchCard);
  assert.ok(parsed);
  assert.equal(parsed.isMatch, true);
  assert.equal(parsed.pairs.length, 3);
  assert.equal(parsed.pairs[0].left, 'Als ich Kind war');
  assert.equal(parsed.pairs[0].right, 'haben wir unsere Häuser im Dorf nie abgesperrt.');
  assert.equal(parsed.pairs[1].left, 'Als wir geheiratet haben');
  assert.equal(parsed.pairs[2].left, 'Ich habe ihn sofort angerufen');
});

test('5. @free syntax: Schreiben Sie einen Satz', () => {
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

test('6. Old quiz card detection and backward compatibility', () => {
  const quizCard = {
    front: 'Wie heißt die Hauptstadt von Deutschland?\n\n*Berlin\nMünchen\nHamburg'
  };
  const parsedQuiz = parseQuizData(quizCard);
  assert.ok(parsedQuiz);
  assert.equal(parsedQuiz.isQuiz, true);
  assert.equal(parsedQuiz.correctAnswerText, 'Berlin');

  // Should NOT be treated as trainer
  const clozeResult = parseClozeData(quizCard, 'classic');
  assert.equal(clozeResult, null);
});

test('7. @@CARD bulk import with explicit and auto-detected types', () => {
  const bulkText = `
@@CARD trainer
FRONT:
Ich [[hatte]] schon gegessen.
BACK:
hatte
CONTEXT:
Plusquamperfekt
TAGS:
B1,Grammar
@@END

@@CARD match
FRONT:
@match
A => B
C => D
BACK:
Соответствия
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
  assert.equal(parsed.length, 4);

  assert.equal(parsed[0].card_type, 'trainer');
  assert.equal(parsed[0].front, 'Ich [[hatte]] schon gegessen.');
  assert.equal(parsed[0].back, 'hatte');
  assert.equal(parsed[0].context, 'Plusquamperfekt');
  assert.equal(parsed[0].tags, 'B1,Grammar');

  assert.equal(parsed[1].card_type, 'match');
  assert.ok(parsed[1].front.includes('@match'));

  assert.equal(parsed[2].card_type, 'free_text');
  assert.ok(parsed[2].front.includes('@free'));

  // Auto-detected without explicit type
  assert.equal(parsed[3].card_type, 'trainer');
});

