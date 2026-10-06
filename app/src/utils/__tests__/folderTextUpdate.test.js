import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeFolder } from '../cardTextSerializer.js';
import { parseCardTextUpdate } from '../cardTextUpdateParser.js';
import { parseBatchCardsText } from '../batchCardParser.js';

const card = (id, front = 'Haus') => ({ id, front, back: 'дом', context: '' });
const block = (deck, id, front = 'Hallo') => `${deck == null ? '' : `::deck_id ${deck}\n`}${id == null ? '' : `::card_id ${id}\n`}FRONT:\n${front}\nBACK:\nHello\nCONTEXT:\n`;
const parse = source => parseCardTextUpdate(source, { requireDeckId: true });

test('folder export groups repeated stable deck IDs and ignores renamed navigation headings', () => {
  const source = serializeFolder([
    { deck: { id: 10, name: 'Root deck' }, cards: [card(101), card(102)] },
    { deck: { id: 11, name: 'Nested deck' }, cards: [card(201), card(202)] },
    { deck: { id: 12, name: 'Empty' }, cards: [] }
  ]).text.replaceAll('# Deck:', '# Deck: Renamed');
  const parsed = parse(source);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.total, 4);
  assert.deepEqual(parsed.deck_ids, [10, 11]);
  assert.deepEqual(parsed.cards.map(row => [row.deck_id, row.card_id]), [[10, 101], [10, 102], [11, 201], [11, 202]]);
  assert.deepEqual(parseBatchCardsText(source).map(row => row.front), ['Haus', 'Haus', 'Haus', 'Haus']);
});

test('multiple sections of the same deck remain one ID group', () => {
  const parsed = parse([block(10, 101), '# Deck: Another heading\n'+block(11, 201), '# Deck: Root again\n'+block(10, 102)].join('\n<<<LERNE_CARD>>>\n'));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.deck_ids, [10, 11]);
  assert.equal(parsed.cards.length, 3);
});

test('new candidates require explicit deck ID; missing ID is reported for every block', () => {
  const parsed = parse([block(10, null), block(null, null), block(null, 101)].join('\n<<<LERNE_CARD>>>\n'));
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].card_id, null);
  assert.equal(parsed.cards[0].deck_id, 10);
  assert.deepEqual(parsed.errors.map(row => [row.number, row.code]), [[2, 'missing_deck_id'], [3, 'missing_deck_id']]);
  assert.equal(parseCardTextUpdate(block(null, null)).errors.length, 0, 'single-deck mode stays compatible');
});

test('duplicate metadata and duplicate card identities are critical across decks', () => {
  const parsed = parse([block(10, 101), block(11, 101), '::deck_id 12\n'+block(12, 301)].join('\n<<<LERNE_CARD>>>\n'));
  assert.deepEqual(parsed.errors.filter(row => row.code === 'duplicate_card_id').map(row => [row.number, row.deck_id]), [[1, 10], [2, 11]]);
  assert.ok(parsed.errors.some(row => row.number === 3 && row.code === 'duplicate_metadata'));
});

test('all malformed metadata and syntax issues retain deck and global card numbers', () => {
  const parsed = parse([block('bad', 101), block(10, 102, '[[broken'), block(11, 201).replace('CONTEXT:', 'BACK:')].join('\n<<<LERNE_CARD>>>\n'));
  assert.deepEqual([...new Set(parsed.errors.map(row => row.number))], [1, 2, 3]);
  assert.equal(parsed.cards.length, 0);
  assert.ok(parsed.errors.some(row => row.deck_id === 10 && row.code === 'unclosed_syntax'));
});

test('5000 card limit is retained for the entire folder file', () => {
  const source = Array.from({ length: 5001 }, (_, index) => block(10, index+1)).join('\n<<<LERNE_CARD>>>\n');
  const parsed = parse(source);
  assert.equal(parsed.total, 5001);
  assert.ok(parsed.errors.some(row => row.code === 'too_many_cards'));
});
