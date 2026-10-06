import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBatchCardsText, LERNE_CARD_SEPARATOR } from '../batchCardParser.js';
import { detectExerciseType } from '../exerciseDetector.js';
import { parseExerciseContent } from '../exerciseContentParser.js';
import { parseClozeData } from '../clozeParser.js';
import { parseMatchData } from '../matchParser.js';
import { parseQuizData } from '../quizParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { parseWordBankData } from '../wordBankParser.js';
import {
  CardTextExportError, cardTextFilename, getFolderExportDecks,
  serializeCard, serializeDeck, serializeFolder
} from '../cardTextSerializer.js';

const fixtures = [
  { name: 'standard', front: 'obwohl', back: 'хотя', type: 'standard' },
  { name: 'input', front: 'Ich [[hatte]] sie [[angerufen]].', back: 'Я позвонил ей.', type: 'trainer', parser: card => parseClozeData(card, 'trainer') },
  { name: 'choices', front: 'Ich wohne {*in|an|auf} Berlin.', back: 'Я живу в Берлине.', type: 'trainer', parser: card => parseClozeData(card, 'trainer') },
  { name: 'quiz', front: 'Was passt?\n*der lange Weg\nder lang Weg', back: 'der lange Weg', type: 'quiz', parser: parseQuizData },
  { name: 'puzzle', front: '@puzzle\nMorgen fahre ich nach Berlin.', back: 'Завтра я еду в Берлин.', type: 'puzzle' },
  { name: 'wordbank', front: '@wordbank\nIch weiß nicht, <<31>> er kommt.\nSie sagt, <<32>> sie geht.\n\n@options\nob | dass', back: '31=ob\n32=dass', type: 'word_bank', parser: parseWordBankData },
  { name: 'match', front: '@match\nHaus = дом\nBaum = дерево', back: 'Сопоставление', type: 'match', parser: parseMatchData },
  { name: 'free', front: '@free\nSchreiben Sie einen Satz mit „als“.', back: 'Als ich klein war, wohnte ich in Berlin.', type: 'free_text', parser: parseFreeTextData },
  { name: 'blocks', front: '::task\nВыбери правильный вариант.\n\n::source\nИсходный текст.\n\n::example\nПример 1.\n\n::example\nПример 2.\n\n::options\nlang | lange\n\n::level\nB1\n\n::topic\nAdjektive\n\n::exercise\nWas passt?\n*der lange Weg\nder lang Weg', back: 'der lange Weg', type: 'quiz', parser: parseQuizData }
];

for (const fixture of fixtures) {
  test(`round-trip ${fixture.name} through the existing batch and exercise parsers`, t => {
    // Presentation parsers shuffle choices; fix randomness to compare their full output.
    t.mock.method(Math, 'random', () => 0.5);
    const original = { ...fixture, context: 'Заметка: Übung № 1', level: 'B2', topics: 'Grammatik', tags: 'B2' };
    const exported = serializeCard(original);
    const imported = parseBatchCardsText(exported.text);
    assert.equal(imported.length, 1);
    assert.deepEqual(exported.warnings, []);
    const card = imported[0];
    for (const field of ['front', 'back', 'context', 'level', 'topics', 'tags']) {
      assert.equal(card[field], original[field], field);
    }
    assert.equal(card.card_type, fixture.type);
    assert.equal(detectExerciseType(card) || 'standard', fixture.type);
    assert.deepEqual(parseExerciseContent(card.front), parseExerciseContent(original.front));
    if (fixture.parser) {
      assert.ok(fixture.parser(card), 'exercise must be parsed');
      assert.deepEqual(fixture.parser(card), fixture.parser(original));
    }
    assert.equal(exported.text.includes('::hint'), false);
  });
}

test('exports every live card in API order, with no database, SRS or audio fields', () => {
  const cards = fixtures.map((fixture, index) => ({
    front_text: fixture.front, back_text: fixture.back, context: '',
    id: 99 - index, position: index, created_at: 'timestamp-secret',
    interval: 1000, history: 'history-secret', audio_path: 'audio-secret',
    audio_back_path: 'audio-back-secret', uuid: 'uuid-secret'
  }));
  cards.splice(2, 0, { front: 'Deleted', is_deleted: true });
  const exported = serializeDeck({ name: 'Моя колода' }, cards);
  assert.equal(exported.cardCount, fixtures.length);
  const imported = parseBatchCardsText(exported.text);
  assert.deepEqual(imported.map(card => card.front), fixtures.map(card => card.front));
  assert.deepEqual(imported.map(card => card.back), fixtures.map(card => card.back));
  for (const forbidden of ['Deleted', 'timestamp-secret', 'history-secret', 'audio-secret', 'audio-back-secret', 'uuid-secret', 'interval']) {
    assert.equal(exported.text.includes(forbidden), false, forbidden);
  }
});

test('folder includes descendants in navigation order, ignoring deleted and unrelated items', () => {
  const root = { id: 1, name: 'Root', parent_id: null };
  const folders = [root, { id: 3, parent_id: 1 }, { id: 2, parent_id: 1 }, { id: 4, parent_id: 2 }, { id: 5, parent_id: 1, is_deleted: true }];
  const decks = [
    { id: 9, folder_id: 1, name: 'Pinned first' },
    { id: 8, folder_id: 1, name: 'Second' },
    { id: 2, folder_id: 2, name: 'Child' },
    { id: 4, folder_id: 4, name: 'Deep' },
    { id: 3, folder_id: 3, name: 'Earlier child' },
    { id: 6, folder_id: 1, name: 'Empty\nFRONT: unsafe heading' },
    { id: 7, folder_id: null }, { id: 10, folder_id: 5 },
    { id: 11, folder_id: 1, is_deleted: true }
  ];
  const ordered = getFolderExportDecks(root, folders, decks);
  assert.deepEqual(ordered.map(deck => deck.id), [3, 4, 2, 9, 8, 6]);
  const sections = ordered.map(deck => ({ deck, cards: deck.id === 6 ? [] : [
    { front: `First ${deck.id}`, back: 'Answer' }, { front: `Second ${deck.id}`, back: 'Answer 2' }
  ] }));
  const exported = serializeFolder(sections);
  const imported = parseBatchCardsText(exported.text);
  assert.equal(exported.cardCount, 10);
  assert.deepEqual(imported.map(card => card.front), sections.flatMap(section => section.cards.map(card => card.front)));
  assert.ok(exported.text.includes('# Deck: Empty FRONT: unsafe heading'));
  assert.equal(imported.some(card => card.front.includes('# Deck:')), false);
});

test('empty sections before and between decks do not produce spurious cards', () => {
  const exported = serializeFolder([
    { deck: { name: 'Empty first' }, cards: [] },
    { deck: { name: 'Nonempty' }, cards: [{ front: 'Hallo', back: 'Привет' }] },
    { deck: { name: 'Empty middle' }, cards: [] },
    { deck: { name: 'Last' }, cards: [{ front: 'Tschüss', back: 'Пока' }] }
  ]);
  assert.deepEqual(parseBatchCardsText(exported.text).map(card => card.front), ['Hallo', 'Tschüss']);
  assert.equal(serializeDeck({ name: 'Empty' }, []).cardCount, 0);
  assert.equal(serializeFolder([]).cardCount, 0);
});

test('folder export does not require access to its ancestors', () => {
  const folder = { id: 2, parent_id: 999, name: 'Shared child' };
  const nested = { id: 3, parent_id: 2 };
  const decks = [{ id: 4, folder_id: 2 }, { id: 5, folder_id: 3 }];
  assert.deepEqual(getFolderExportDecks(folder, [folder, nested], decks).map(deck => deck.id), [5, 4]);
});

test('repeated metadata in CONTEXT is reported even when the first parser leaves it intact', () => {
  const card = { front: 'Hallo', back: 'Hello', level: 'B1', topics: 'Existing', context: '::topic Another\nNote' };
  const exported = serializeCard(card);
  assert.deepEqual(exported.warnings, ['import-normalization']);
  assert.equal(parseBatchCardsText(exported.text)[0].context, card.context);
});

test('CRLF, blank optional sections and metadata CEFR are supported', () => {
  const original = { front_text: '::task\r\nAufgabe\r\n\r\n::exercise\r\nHallo', back_text: '', metadata: '{"cefr":{"level":"C1"}}' };
  const exported = serializeCard(original);
  const [imported] = parseBatchCardsText(exported.text);
  assert.equal(imported.front, original.front_text.replaceAll('\r\n', '\n'));
  assert.equal(imported.back, '');
  assert.equal(imported.context, '');
  assert.equal(imported.level, 'C1');
  assert.deepEqual(exported.warnings, []);
});

test('fails explicitly for reserved separator/section lines rather than corrupting a card', () => {
  for (const field of ['front', 'back', 'context']) {
    for (const marker of [LERNE_CARD_SEPARATOR, 'FRONT: literal', 'back: literal', '  CONTEXT: literal']) {
      assert.throws(() => serializeCard({ front: 'Question', back: 'Answer', [field]: `Before\n${marker}\nAfter` }, 'Deck', 2),
        error => error instanceof CardTextExportError && error.deckName === 'Deck' && error.cardNumber === 2);
    }
  }
  assert.throws(() => serializeCard({ front: '' }), CardTextExportError);
  assert.throws(() => serializeCard({ front: 'Hello', context: `Note\n${LERNE_CARD_SEPARATOR}` }), CardTextExportError);
});

test('reports the existing importer normalization and unsupported media/tags', () => {
  const card = { front: '@puzzle\nMein Satz.', back: '', context: 'One\n\nTwo\n::topic Legacy',
    image_path: 'image.png', video_front_path: 'video.mp4', tags: 'B1,custom' };
  const exported = serializeCard(card);
  assert.deepEqual(exported.warnings, ['import-normalization', 'media', 'tags']);
  assert.ok(exported.text.includes('One\n\nTwo\n::topic Legacy'));
  assert.equal(exported.text.includes('image.png'), false);
  const [imported] = parseBatchCardsText(exported.text);
  assert.notEqual(imported.back, card.back);
  assert.notEqual(imported.context, card.context);
  assert.equal(imported.topics, 'Legacy');
  const deckExport = serializeDeck({ name: 'With limitations' }, [card]);
  assert.ok(deckExport.text.startsWith('# '));
  assert.equal(parseBatchCardsText(deckExport.text).length, 1);
});

test('UTF-8 filenames retain human names and avoid unsafe or reserved basenames', () => {
  assert.equal(cardTextFilename('Meine Übungen — Карточки'), 'Meine Übungen — Карточки.txt');
  assert.equal(cardTextFilename('A/B:C*D?. '), 'A_B_C_D_.txt');
  assert.equal(cardTextFilename(''), 'Lerne.txt');
  assert.equal(cardTextFilename('CON'), 'Lerne.txt');
  assert.equal(cardTextFilename('nul.backup'), 'Lerne.txt');
  assert.ok(cardTextFilename('a'.repeat(200)).length <= 124);
});
