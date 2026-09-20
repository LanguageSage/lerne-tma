import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClozeData, cleanBracketSyntax, normalizeAnswer } from '../clozeParser.js';
import { parseMatchData, normalizeMatchValue } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { parseQuizData } from '../quizParser.js';
import { hasCardSeparatorLine, parseBatchCardsText, splitImportedCards, LERNE_CARD_SEPARATOR } from '../batchCardParser.js';
import { resolveAiTranslation } from '../aiCardResult.js';
import { parseWordBankData } from '../wordBankParser.js';
import {
  assignWordBankOption,
  checkWordBankAssignments,
  getNextEmptyWordBankGapId,
  removeWordBankOption,
  sanitizeWordBankAssignments
} from '../wordBankState.js';
import {
  detectAiQuickActionType,
  detectExerciseType
} from '../exerciseDetector.js';
import { parseExerciseContent, restoreExerciseContent } from '../exerciseContentParser.js';

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

test('13. AI quick actions support trainer syntax and treat parentheses as ordinary text', () => {
  assert.equal(detectAiQuickActionType('Ich fahre {*mit|nach|zu} dem Bus.'), 'explain_rule');
  assert.equal(detectAiQuickActionType('Er [[hatte]] gestern [[angerufen]].'), 'explain_rule');

  for (const phrase of [
    'Ich möchte Brot (kaufen).',
    'Er will Lehrer (sein).',
    'Wir werden Zeit (haben).',
    'Ich fahre mit dem Bus.\n(почему dem, а не den?)'
  ]) {
    assert.equal(detectAiQuickActionType(phrase), null);
  }
});

test('14. Batch import preserves explicit @match and @puzzle markers', () => {
  const parsed = parseBatchCardsText(`@match
ich => hatte
wir => hatten
---
@puzzle
Ich kaufe heute Brot.`);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].card_type, 'match');
  assert.ok(parsed[0].front.startsWith('@match'));
  assert.equal(parsed[1].card_type, 'puzzle');
  assert.ok(parsed[1].front.startsWith('@puzzle'));
});

test('14a. Batch card separators use a standalone LERNE_CARD line and preserve legacy imports', () => {
  assert.deepEqual(
    splitImportedCards('card1\n<<<LERNE_CARD>>>\ncard2'),
    ['card1', 'card2']
  );
  assert.deepEqual(splitImportedCards('card1\n---\ncard2'), ['card1', 'card2']);
  assert.deepEqual(
    splitImportedCards('card1 <<<LERNE_CARD>>> text'),
    ['card1 <<<LERNE_CARD>>> text']
  );
  assert.deepEqual(splitImportedCards('card1 --- text'), ['card1 --- text']);
});

test('14b. Batch card separators trim blocks, handle CRLF, and support mixed separators', () => {
  assert.deepEqual(
    splitImportedCards('\n<<<LERNE_CARD>>>\n\ncard1\n\n<<<LERNE_CARD>>>\n\ncard2\n\n<<<LERNE_CARD>>>\n'),
    ['card1', 'card2']
  );
  assert.deepEqual(splitImportedCards('<<<LERNE_CARD>>>\ncard1\n<<<LERNE_CARD>>>\n'), ['card1']);
  assert.deepEqual(splitImportedCards('card1\r\n<<<LERNE_CARD>>>\r\ncard2'), ['card1', 'card2']);
  assert.deepEqual(
    splitImportedCards('card1\n<<<LERNE_CARD>>>\ncard2\n---\ncard3'),
    ['card1', 'card2', 'card3']
  );
});

test('14c. New batch separator preserves exercise type detection', () => {
  const cards = parseBatchCardsText(`Ich [[habe]] das Buch [[gelesen]].
(lesen)
<<<LERNE_CARD>>>
@puzzle
Morgen fahre ich nach Berlin.
<<<LERNE_CARD>>>
@match
ich => hatte
wir => hatten
<<<LERNE_CARD>>>
Haus
дом
<<<LERNE_CARD>>>
Welche Antwort ist richtig?

ja
*nein
vielleicht`);

  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map(card => card.card_type), ['trainer', 'puzzle', 'match', 'standard', 'quiz']);
});

test('14d. Inline separator text does not disable blank-line fallback parsing', () => {
  for (const inlineSeparator of ['Text with --- inside the sentence.', 'Text <<<LERNE_CARD>>> inside sentence']) {
    const cards = parseBatchCardsText(`${inlineSeparator}\n\n\nHaus\nдом`);
    assert.equal(cards.length, 2);
  }

  assert.equal(hasCardSeparatorLine('Text with --- inside the sentence.'), false);
  assert.equal(hasCardSeparatorLine('Text <<<LERNE_CARD>>> inside sentence'), false);
  assert.equal(hasCardSeparatorLine('card1\n  <<<LERNE_CARD>>>  \ncard2'), true);
});

test('14e. New standalone separator preserves Trainer information blocks and puzzle markers', () => {
  const cards = parseBatchCardsText(`::task
Wählen Sie das passende Wort.

::options
was | dass | wie | ob

Ich verstehe jetzt viel besser, [[wie das deutsche Hochschulsystem funktioniert]].
(das deutsche Hochschulsystem funktionieren)

<<<LERNE_CARD>>>

@puzzle
Am Wochenende fahren wir mit dem Zug nach Berlin.`);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].card_type, 'trainer');
  assert.ok(cards[0].front.includes('::task'));
  assert.ok(cards[0].front.includes('::options'));
  assert.ok(cards[0].front.includes('[[wie das deutsche Hochschulsystem funktioniert]]'));
  assert.ok(cards[0].front.includes('(das deutsche Hochschulsystem funktionieren)'));
  assert.equal(cards[1].card_type, 'puzzle');
  assert.ok(cards[1].front.startsWith('@puzzle'));
});

test('15. Rule action fills only an empty translation field', () => {
  assert.equal(resolveAiTranslation('', 'Новый перевод', 'explain_rule'), 'Новый перевод');
  assert.equal(resolveAiTranslation('   ', 'Новый перевод', 'explain_rule'), 'Новый перевод');
  assert.equal(resolveAiTranslation('Ручной перевод', 'Новый перевод', 'explain_rule'), 'Ручной перевод');
  assert.equal(resolveAiTranslation('', 'Новый перевод', 'custom_directive'), '');
});

test('16. Multiple asterisk synonyms in choice gap: {*Trotzdem|*Dennoch|Deshalb|Obwohl}', () => {
  const card = {
    front: 'Ich habe schlecht geschlafen. {*Trotzdem|*Dennoch|Deshalb|Obwohl} gehe ich heute zur Arbeit.'
  };

  const parsed = parseClozeData(card, 'trainer');
  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 1);
  assert.equal(parsed.gaps[0].mode, 'choice');
  assert.equal(parsed.gaps[0].correctAnswer, 'Trotzdem|Dennoch');
  assert.equal(parsed.gaps[0].choices.length, 4);
  assert.ok(parsed.gaps[0].choices.includes('Trotzdem'));
  assert.ok(parsed.gaps[0].choices.includes('Dennoch'));
  assert.ok(parsed.gaps[0].choices.includes('Deshalb'));
  assert.ok(parsed.gaps[0].choices.includes('Obwohl'));

  const cleaned = cleanBracketSyntax(card.front);
  assert.equal(cleaned, 'Ich habe schlecht geschlafen. Trotzdem gehe ich heute zur Arbeit.');
});

test('17. Connector distractor auto-generation and capitalization: {Trotzdem}', () => {
  const card = {
    front: 'Ich habe schlecht geschlafen. {Trotzdem} gehe ich heute zur Arbeit.'
  };

  const parsed = parseClozeData(card, 'trainer');
  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 1);
  assert.equal(parsed.gaps[0].mode, 'choice');
  assert.equal(parsed.gaps[0].correctAnswer, 'Trotzdem');
  assert.equal(parsed.gaps[0].choices.length, 4);
  assert.ok(parsed.gaps[0].choices.includes('Trotzdem'));
  // Ensure distractors are capitalized since 'Trotzdem' is capitalized
  for (const choice of parsed.gaps[0].choices) {
    assert.equal(choice[0], choice[0].toUpperCase());
  }
});

test('18. @wordbank is detected before trainer syntax without changing ordinary trainer cards', () => {
  assert.equal(detectExerciseType({ front: '@wordbank\nText <<31>>\n@options\nFÜR | AUF' }), 'word_bank');
  assert.equal(detectExerciseType({ front: '@wordbank\nText <<31>> and [[legacy]]\n@options\nFÜR' }), 'word_bank');
  assert.equal(detectExerciseType({ front: 'Text [[legacy]].' }), 'trainer');
});

test('19. word bank parser extracts numbered gaps, ordered options, and BACK answers', () => {
  const parsed = parseWordBankData({
    front: `@wordbank
Ein langer Text mit <<31>>, danach <<32>> und schließlich <<33>>.

@options
AN | AUF | FÜR | HABEN | VIEL`,
    back: `31=FÜR
32=VIEL
33=AUF`
  });

  assert.ok(parsed);
  assert.equal(parsed.isWordBank, true);
  assert.deepEqual(parsed.gaps.map(gap => gap.id), ['31', '32', '33']);
  assert.deepEqual(parsed.gaps.map(gap => gap.correctAnswer), ['FÜR', 'VIEL', 'AUF']);
  assert.deepEqual(parsed.options.map(option => option.value), ['AN', 'AUF', 'FÜR', 'HABEN', 'VIEL']);
  assert.match(parsed.maskedText, /___WORD_BANK_GAP_31___/);
  assert.equal(parsed.text.includes('@wordbank'), false);
  assert.equal(parsed.text.includes('@options'), false);
});

test('20. @@CARD word_bank batch import preserves the explicit type and syntax', () => {
  const [card] = parseBatchCardsText(`@@CARD word_bank
FRONT:
@wordbank
Text <<31>>.
@options
FÜR | AUF
BACK:
31=FÜR
CONTEXT:
Sprachbausteine Teil 2
@@END`);

  assert.ok(card);
  assert.equal(card.card_type, 'word_bank');
  assert.ok(card.front.includes('<<31>>'));
  assert.equal(card.back, '31=FÜR');
  assert.equal(card.context, 'Sprachbausteine Teil 2');
});

test('21. word bank supports 10 gaps, 15 ordered options, and extra distractors', () => {
  const gapIds = Array.from({ length: 10 }, (_, index) => String(index + 31));
  const optionValues = Array.from({ length: 15 }, (_, index) => `WORT_${index + 1}`);
  const parsed = parseWordBankData({
    front: `@wordbank\n${gapIds.map(id => `Satz <<${id}>>.`).join('\n')}\n@options\n${optionValues.join(' | ')}`,
    back: gapIds.map((id, index) => `${id}=${optionValues[index]}`).join('\n')
  });

  assert.ok(parsed);
  assert.equal(parsed.gaps.length, 10);
  assert.equal(parsed.options.length, 15);
  assert.deepEqual(parsed.options.map(option => option.value), optionValues);
});

test('22. word bank parser rejects invalid structures and [[...]] gaps', () => {
  assert.equal(parseWordBankData({
    front: '@wordbank\nText [[FÜR]].\n@options\nFÜR',
    back: '31=FÜR'
  }), null);
  assert.equal(parseWordBankData({
    front: '@wordbank\nText <<31>>.\n@options\nFÜR',
    back: '32=FÜR'
  }), null);
  assert.equal(parseWordBankData({
    front: '@wordbank\nText <<31>>.\n@options\nAUF',
    back: '31=FÜR'
  }), null);
});

test('22a. word bank parser removes blank-only lines from displayed text', () => {
  const parsed = parseWordBankData({
    front: '@wordbank\nSehr geehrte Frau Groß,\n\n\nIch habe Ihre Anzeige <<31>>.\n@options\nGELESEN | GESUCHT',
    back: '31=GELESEN'
  });

  assert.ok(parsed);
  assert.equal(parsed.text, 'Sehr geehrte Frau Groß,\nIch habe Ihre Anzeige <<31>>.');
  assert.equal(parsed.maskedText.includes('\n\n'), false);
});

test('23. one word-bank option cannot be assigned to two gaps', () => {
  const first = assignWordBankOption({}, '31', 'option-0');
  const second = assignWordBankOption(first, '32', 'option-0');
  assert.deepEqual(second, { 31: 'option-0' });
  assert.equal(second, first);
});

test('24. removing a filled word-bank gap returns its option to the bank', () => {
  const assigned = { 31: 'option-0', 32: 'option-1' };
  const removed = removeWordBankOption(assigned, '31');
  assert.deepEqual(removed, { 32: 'option-1' });
  assert.equal(Object.values(removed).includes('option-0'), false);
});

test('25. replacing a word-bank answer releases the previous option and activates the next empty gap', () => {
  const gaps = [{ id: '31' }, { id: '32' }, { id: '33' }];
  const replaced = assignWordBankOption({ 31: 'option-0' }, '31', 'option-2');
  assert.deepEqual(replaced, { 31: 'option-2' });
  assert.equal(Object.values(replaced).includes('option-0'), false);
  assert.equal(getNextEmptyWordBankGapId(gaps, replaced, '31'), '32');
});

test('26. word-bank checking marks correct and incorrect gaps without exposing answers', () => {
  const gaps = [
    { id: '31', correctAnswer: 'FÜR' },
    { id: '32', correctAnswer: 'VIEL' }
  ];
  const options = [
    { id: 'option-0', value: 'FÜR' },
    { id: 'option-1', value: 'AUF' },
    { id: 'option-2', value: 'VIEL' }
  ];
  const checked = checkWordBankAssignments(gaps, options, { 31: 'option-0', 32: 'option-1' });
  assert.deepEqual(checked.results, { 31: 'correct', 32: 'incorrect' });
  assert.equal(checked.allCorrect, false);
  assert.equal(Object.values(checked.results).includes('VIEL'), false);
});

test('27. saved word-bank assignments are restored safely and preserve single-use options', () => {
  const gaps = [{ id: '31' }, { id: '32' }, { id: '33' }];
  const options = [
    { id: 'option-0', value: 'FÜR' },
    { id: 'option-1', value: 'AUF' }
  ];
  const restored = sanitizeWordBankAssignments({
    31: 'option-0',
    32: 'option-0',
    33: 'missing-option',
    99: 'option-1'
  }, gaps, options);

  assert.deepEqual(restored, { 31: 'option-0' });
});

test('28. exercise content parser leaves legacy cards unchanged', () => {
  const source = 'Ich [[habe]] das Buch [[gelesen]].\n\n(lesen)';
  const parsed = parseExerciseContent(source);
  assert.equal(parsed.hasBlocks, false);
  assert.equal(parsed.exercise, source);
  assert.deepEqual(parsed.options, []);
});

test('29. task block ends before the trainer exercise', () => {
  const parsed = parseExerciseContent(`::task
Ergänzen Sie den Satz.

Ich glaube, [[dass er heute kommt]].

(er heute kommen)`);

  assert.equal(parsed.task, 'Ergänzen Sie den Satz.');
  assert.equal(parsed.exercise, 'Ich glaube, [[dass er heute kommt]].\n\n(er heute kommen)');
  assert.equal(detectExerciseType({ front: restoreExerciseContent(parsed, parsed.exercise) }), 'trainer');
});

test('30. task and options are parsed into visual values without entering cloze text', () => {
  const source = `::task
Wählen Sie das passende Wort.

::options
ob | dass | weil | obwohl

Ich weiß nicht, [[ob er heute kommt]].

(er heute kommen)`;
  const parsed = parseExerciseContent(source);
  const cloze = parseClozeData({ front: source }, 'trainer');

  assert.deepEqual(parsed.options, ['ob', 'dass', 'weil', 'obwohl']);
  assert.equal(cloze.maskedText, 'Ich weiß nicht, ___GAP_0___.\n\n(er heute kommen)');
  assert.equal(cloze.content.task, 'Wählen Sie das passende Wort.');
});

test('31. source and example blocks support multiline content and repeated examples', () => {
  const parsed = parseExerciseContent(`::task
Lesen Sie und antworten Sie.

::source
Anna studiert seit drei Jahren in Berlin.
Sie möchte später als Ärztin arbeiten.

::example
Was macht Paul?
Paul arbeitet als Lehrer.

::example
Was macht Mia?
Mia studiert Medizin.

Was möchte Anna später machen?

[[Sie möchte als Ärztin arbeiten.]]`);

  assert.equal(parsed.context, 'Anna studiert seit drei Jahren in Berlin.\nSie möchte später als Ärztin arbeiten.');
  assert.deepEqual(parsed.examples, [
    'Was macht Paul?\nPaul arbeitet als Lehrer.',
    'Was macht Mia?\nMia studiert Medizin.'
  ]);
  assert.equal(parsed.exercise, 'Was möchte Anna später machen?\n\n[[Sie möchte als Ärztin arbeiten.]]');
});

test('31a. source works as the only information block and populates internal context', () => {
  const parsed = parseExerciseContent(`::source
Anna studiert in Berlin.
Sie möchte Ärztin werden.

Was möchte Anna werden?

[[Sie möchte Ärztin werden.]]`);

  assert.equal(parsed.task, '');
  assert.equal(parsed.context, 'Anna studiert in Berlin.\nSie möchte Ärztin werden.');
  assert.equal(parsed.exercise, 'Was möchte Anna werden?\n\n[[Sie möchte Ärztin werden.]]');
});

test('31aa. source preserves a task and trainer input', () => {
  const parsed = parseExerciseContent(`::task
Ergänzen Sie das Verb.

::source
Wiedersehen nach 20 Jahren.

Er [[hatte]] sein Studium abgeschlossen.`);

  assert.equal(parsed.task, 'Ergänzen Sie das Verb.');
  assert.equal(parsed.context, 'Wiedersehen nach 20 Jahren.');
  assert.equal(parsed.exercise, 'Er [[hatte]] sein Studium abgeschlossen.');
});

test('31ab. source preserves options and the trainer sentence', () => {
  const parsed = parseExerciseContent(`::options
ob | weil | dass

::source
Ich weiß nicht, ob er kommt.

Ich weiß nicht, [[ob er kommt]].`);

  assert.deepEqual(parsed.options, ['ob', 'weil', 'dass']);
  assert.equal(parsed.context, 'Ich weiß nicht, ob er kommt.');
  assert.equal(parsed.exercise, 'Ich weiß nicht, [[ob er kommt]].');
});

test('31ac. example preserves the main trainer sentence', () => {
  const parsed = parseExerciseContent(`::example
Ich habe gestern gearbeitet.

Ich [[habe]] heute gearbeitet.`);

  assert.deepEqual(parsed.examples, ['Ich habe gestern gearbeitet.']);
  assert.equal(parsed.exercise, 'Ich [[habe]] heute gearbeitet.');
});

test('31b. example works as the only information block', () => {
  const parsed = parseExerciseContent(`::example
Obwohl es regnet, gehen wir spazieren.

Er ist müde. Er arbeitet weiter.

[[Obwohl er müde ist, arbeitet er weiter.]]`);

  assert.deepEqual(parsed.examples, ['Obwohl es regnet, gehen wir spazieren.']);
  assert.equal(parsed.exercise, 'Er ist müde. Er arbeitet weiter.\n\n[[Obwohl er müde ist, arbeitet er weiter.]]');
});

test('32. all information blocks preserve source order and restore around AI output', () => {
  const source = `::task
Wählen Sie das passende Wort und schreiben Sie den Satz zu Ende.

::source
Paul erzählt über sein Studium in Deutschland.

::options
was | dass | wie | ob

::example
Ich weiß jetzt, wie das funktioniert.

Ich verstehe jetzt viel besser, [[wie das deutsche Hochschulsystem funktioniert]].

(das deutsche Hochschulsystem funktionieren)`;
  const parsed = parseExerciseContent(source);
  const restored = restoreExerciseContent(parsed, 'Ich verstehe jetzt, [[wie alles funktioniert]].');

  assert.deepEqual(parsed.blocks.map(block => block.type), ['task', 'context', 'options', 'example']);
  assert.ok(restored.startsWith('::task\n'));
  assert.ok(restored.includes('::source\nPaul erzählt über sein Studium in Deutschland.'));
  assert.ok(restored.includes('::options\nwas | dass | wie | ob'));
  assert.ok(restored.endsWith('Ich verstehe jetzt, [[wie alles funktioniert]].'));
});

test('33. parser handles Windows and Unix line endings identically', () => {
  const unix = '::task\nErgänzen Sie.\n\nSatz [[hier]].';
  const windows = unix.replace(/\n/g, '\r\n');
  assert.deepEqual(parseExerciseContent(windows), parseExerciseContent(unix));
});

test('34. unknown markers inside exercise content are not silently removed', () => {
  const source = '::unknown\nText [[Antwort]].';
  const parsed = parseExerciseContent(source);
  assert.equal(parsed.hasBlocks, false);
  assert.equal(parsed.exercise, source);
});

test('34a. legacy ::context is supported as backward-compatible alias for context', () => {
  const source = '::context\nLegacy text.\n\nSatz [[Antwort]].';
  const parsed = parseExerciseContent(source);

  assert.equal(parsed.hasBlocks, true);
  assert.equal(parsed.context, 'Legacy text.');
  assert.equal(parsed.exercise, 'Satz [[Antwort]].');
  assert.equal(parsed.blocks[0].type, 'context');
});

test('34b. integration regression: task + multi-line source without ::exercise extracts cleanly', () => {
  const input = `::task
Ergänzen Sie „hatte“ oder „war“ in der richtigen Form.

::source
Wiedersehen nach 20 Jahren.
Sie trafen sich zufällig in Berlin auf der Straße wieder.

Er war ein paar Jahre älter als sie. Er [[hatte]] sein Studium schon abgeschlossen, sie studierte noch.`;

  const parsed = parseExerciseContent(input);

  assert.equal(parsed.task, 'Ergänzen Sie „hatte“ oder „war“ in der richtigen Form.');
  assert.equal(parsed.context, 'Wiedersehen nach 20 Jahren.\nSie trafen sich zufällig in Berlin auf der Straße wieder.');
  assert.equal(parsed.exercise, 'Er war ein paar Jahre älter als sie. Er [[hatte]] sein Studium schon abgeschlossen, sie studierte noch.');
  assert.ok(!parsed.exercise.includes('::task'));
  assert.ok(!parsed.exercise.includes('::source'));
  assert.ok(!parsed.exercise.includes('Wiedersehen'));
});

test('34c. multi-paragraph source with explicit ::exercise marker preserves blank lines inside source', () => {
  const input = `::task
Lesen Sie den Text und ergänzen Sie die richtige Form.

::source
Wiedersehen nach 20 Jahren.

Sie trafen sich zufällig in Berlin auf der Straße wieder.
20 Jahre lang hatten sie sich nicht gesehen.

::exercise
Er war ein paar Jahre älter als sie.
Er [[hatte]] sein Studium schon abgeschlossen.`;

  const parsed = parseExerciseContent(input);

  assert.equal(parsed.task, 'Lesen Sie den Text und ergänzen Sie die richtige Form.');
  assert.equal(parsed.context, 'Wiedersehen nach 20 Jahren.\n\nSie trafen sich zufällig in Berlin auf der Straße wieder.\n20 Jahre lang hatten sie sich nicht gesehen.');
  assert.equal(parsed.exercise, 'Er war ein paar Jahre älter als sie.\nEr [[hatte]] sein Studium schon abgeschlossen.');
  assert.ok(!parsed.exercise.includes('::task'));
  assert.ok(!parsed.exercise.includes('::source'));
  assert.ok(!parsed.exercise.includes('::exercise'));
});

test('34d. source-only card without ::exercise extracts source and isolates body', () => {
  const input = `::source
Wiedersehen nach 20 Jahren.
Sie trafen sich zufällig in Berlin auf der Straße wieder.

Er [[hatte]] sein Studium abgeschlossen.`;

  const parsed = parseExerciseContent(input);

  assert.equal(parsed.task, '');
  assert.equal(parsed.context, 'Wiedersehen nach 20 Jahren.\nSie trafen sich zufällig in Berlin auf der Straße wieder.');
  assert.equal(parsed.exercise, 'Er [[hatte]] sein Studium abgeschlossen.');
  assert.ok(!parsed.exercise.includes('::source'));
  assert.ok(!parsed.exercise.includes('Wiedersehen'));
});

test('34e. arbitrary block order works identically', () => {
  const input = `::options
hatte | war

::task
Wählen Sie die Form.

::source
Erinnerungen an damals.

::exercise
Er [[hatte]] recht.`;

  const parsed = parseExerciseContent(input);

  assert.deepEqual(parsed.options, ['hatte', 'war']);
  assert.equal(parsed.task, 'Wählen Sie die Form.');
  assert.equal(parsed.context, 'Erinnerungen an damals.');
  assert.equal(parsed.exercise, 'Er [[hatte]] recht.');
});

test('35. batch import preserves information blocks and detects the existing trainer type', () => {
  const [card] = parseBatchCardsText(`::task
Ergänzen Sie den Satz.

::options
ob | dass

Ich weiß, [[dass er kommt]].

(er kommen)`);

  assert.ok(card);
  assert.equal(card.card_type, 'trainer');
  assert.ok(card.front.startsWith('::task'));
  assert.ok(card.front.includes('::options'));
});

test('35a. full pipeline: splitImportedCards -> parseBatchCardsText with <<<LERNE_CARD>>> populates context', () => {
  const rawBatch = `::task
Ergänzen Sie das Verb.

::source
Wiedersehen nach 20 Jahren.
Sie trafen sich zufällig in Berlin wieder.

::exercise
Er [[hatte]] sein Studium abgeschlossen.

${LERNE_CARD_SEPARATOR}

::source
Kurze Geschichte.

Sie [[war]] müde.`;

  const blocks = splitImportedCards(rawBatch);
  assert.equal(blocks.length, 2);

  const cards = parseBatchCardsText(rawBatch);
  assert.equal(cards.length, 2);

  assert.equal(cards[0].card_type, 'trainer');
  assert.equal(cards[0].context, 'Wiedersehen nach 20 Jahren.\nSie trafen sich zufällig in Berlin wieder.');
  assert.equal(cards[0].back, 'hatte');

  assert.equal(cards[1].card_type, 'trainer');
  assert.equal(cards[1].context, 'Kurze Geschichte.');
  assert.equal(cards[1].back, 'war');
});

test('36. information blocks do not interfere with puzzle or quiz detection and parsing', () => {
  const puzzle = `::task
Bilden Sie den Satz.

@puzzle
Ich kaufe heute Brot.`;
  const quiz = `::source
Lesen Sie die Frage.

Wie heißt die Hauptstadt?

München
*Berlin
Hamburg`;

  assert.equal(detectExerciseType({ front: puzzle }), 'puzzle');
  assert.equal(detectExerciseType({ front: quiz }), 'quiz');
  assert.equal(parseQuizData({ front: quiz }).question, 'Wie heißt die Hauptstadt?');
});
