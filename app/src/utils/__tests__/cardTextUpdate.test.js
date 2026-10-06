import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDeck } from '../cardTextSerializer.js';
import { parseBatchCardsText, LERNE_CARD_SEPARATOR } from '../batchCardParser.js';
import { parseCardTextUpdate } from '../cardTextUpdateParser.js';
import { extractCardTextMetadata } from '../cardTextMetadata.js';

const deck = { id: 10, name: 'Übungen' };
const original = { id: 101, front: 'Ich [[lerne]] Deutsch.', back: 'Я учу немецкий.', context: 'One\n\nTwo', topics: 'Verben', level: 'B1' };
const text = value => `::deck_id 10\n::card_id 101\nFRONT:\n${value}\nBACK:\nAnswer\nCONTEXT:\n`;

test('export → edit one card → parse keeps identities and projects only content', () => {
  const exported = serializeDeck(deck, [original, { id: 102, front: 'Haus', back: 'дом' }]).text;
  const parsed = parseCardTextUpdate(exported.replace('[[lerne]]', '[[lernte]]'));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.cards.map(card => card.card_id), [101, 102]);
  assert.deepEqual(parsed.cards.map(card => card.deck_id), [10, 10]);
  assert.equal(parsed.cards[0].front, 'Ich [[lernte]] Deutsch.');
  assert.equal(parsed.cards[0].context, original.context);
  assert.equal(parsed.cards[0].topics, 'Verben');
  assert.equal(parsed.cards[0].level, 'B1');
  assert.equal(parsed.cards[1].front, 'Haus');
  assert.equal(parsed.cards[1].level, null);
  assert.equal(Object.hasOwn(parsed.cards[0], 'history'), false);
});

test('new metadata remains invisible in ordinary creation import', () => {
  const exported = serializeDeck(deck, [original]).text;
  const [card] = parseBatchCardsText(exported);
  assert.equal(card.front, original.front);
  assert.equal(card.back, original.back);
  assert.equal(Object.hasOwn(card, 'card_id'), false);
  assert.equal(Object.hasOwn(card, 'deck_id'), false);
});

test('old idless files are new candidates and retain creation semantics', () => {
  const parsed = parseCardTextUpdate('FRONT:\nHallo\nBACK:\nHello\nCONTEXT:\n::level A1');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cards[0].card_id, null);
  assert.equal(parsed.cards[0].deck_id, null);
  assert.equal(parsed.cards[0].level, 'A1');
});

test('empty stored back and blank context lines round-trip without generated defaults', () => {
  const exported = serializeDeck(deck, [{ id: 101, front: '@puzzle\nMein Satz.', back: '', context: 'One\n\nTwo' }]);
  const parsed = parseCardTextUpdate(exported.text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cards[0].back, '');
  assert.equal(parsed.cards[0].context, 'One\n\nTwo');
});

test('all supported exercise types use the existing parsers with ID metadata', () => {
  const fixtures = [
    ['Ich [[hatte]] angerufen.', 'Я позвонил.', 'trainer'],
    ['Ich wohne {*in|an|auf} Berlin.', 'Я живу в Берлине.', 'trainer'],
    ['Was passt?\n*der lange Weg\nder lang Weg', 'der lange Weg', 'quiz'],
    ['@puzzle\nMorgen fahre ich nach Berlin.', '', 'puzzle'],
    ['@wordbank\nIch lerne <<1>>.\n@options\nDeutsch | Englisch', '1=Deutsch', 'word_bank'],
    ['@match\nHaus = дом\nBaum = дерево', '', 'match'],
    ['@free\nSchreiben Sie einen Satz mit als.', 'Als ich klein war...', 'free_text'],
    ['::task\nЗаполни пропуск.\n\n::source\nТекст.\n\n::example\nПример.\n\n::exercise\nIch [[lerne]].', 'Я учусь.', 'trainer']
  ];
  for (const [front, back, type] of fixtures) {
    const parsed = parseCardTextUpdate(serializeDeck(deck, [{ id: 101, front, back }]).text);
    assert.deepEqual(parsed.errors, [], type);
    assert.equal(parsed.cards[0].card_type, type);
    assert.equal(parsed.cards[0].front, front);
    assert.equal(parsed.cards[0].back, back);
  }
});

test('only preamble markers are metadata; literal metadata within content survives', () => {
  const source = text('::task\nExplain the marker\n::card_id 999\n\n::exercise\nHello');
  const parsed = parseCardTextUpdate(source);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cards[0].card_id, 101);
  assert.ok(parsed.cards[0].front.includes('::card_id 999'));
});

test('IDs cannot be duplicated, negative, temporary, UUID-shaped, or out of database range', () => {
  for (const id of ['-1', 'temp_1', 'abc-def', '2147483648', '0', '1 trailing']) {
    assert.ok(extractCardTextMetadata(`::card_id ${id}\nFRONT:\nHallo`).errors.includes('invalid_identifier'));
  }
  assert.ok(extractCardTextMetadata('::card_id 1\n::card_id 2\nFRONT:\nHallo').errors.includes('duplicate_metadata'));
  const parsed = parseCardTextUpdate(`${text('First')}\n${LERNE_CARD_SEPARATOR}\n${text('Second')}`);
  assert.deepEqual(parsed.errors.filter(error => error.code === 'duplicate_card_id').map(error => error.number), [1, 2]);
});

test('all broken blocks are reported and ambiguous section boundaries are rejected', () => {
  const parsed = parseCardTextUpdate(['FRONT:\nBACK:\nEmpty', text('Ich [[lerne'), 'FRONT:\nHallo\nBACK:\nOne\nBACK:\nTwo'].join(`\n${LERNE_CARD_SEPARATOR}\n`));
  assert.equal(parsed.total, 3);
  assert.deepEqual([...new Set(parsed.errors.map(error => error.number))], [1, 2, 3]);
  assert.equal(parsed.cards.length, 0);
  assert.ok(parsed.errors.some(error => error.code === 'duplicate_section'));
});

test('missing or reordered canonical sections cannot silently clear stored content', () => {
  for (const source of ['FRONT:\nHallo', 'FRONT:\nHallo\nBACK:\nHello', 'BACK:\nHello\nFRONT:\nHallo\nCONTEXT:\n']) {
    assert.ok(parseCardTextUpdate(source).errors.some(error => error.code === 'invalid_sections'));
  }
});

for (const source of ['@match', '@wordbank\nHello', '@free', '@puzzle', 'Hello {option', 'Hello <<1']) {
  test(`strict update validation rejects damaged exercise ${JSON.stringify(source)}`, () => {
    assert.ok(parseCardTextUpdate(text(source)).errors.length);
  });
}

test('unsynced temporary IDs are omitted with an explicit warning', () => {
  const exported = serializeDeck({ id: -10 }, [{ id: -101, front: 'Hallo', back: 'Hello' }]);
  assert.ok(exported.warnings.includes('unsynced'));
  assert.equal(exported.text.includes('::card_id'), false);
  assert.equal(exported.text.includes('::deck_id'), false);
});

test('empty files and empty folder headings do not turn into cards', () => {
  assert.deepEqual(parseCardTextUpdate('# Deck: Empty\n\n').errors, [{ number: 0, code: 'empty_file' }]);
});
