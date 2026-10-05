import test from 'node:test';
import assert from 'node:assert/strict';
import { getThemeDecks, getNextThemeDeck, isLastThemeDeck } from '../studyFlow.js';

const decks = [
  { id: 8, folder_id: 3, position: 0, is_pinned: true },
  { id: 2, folder_id: 3, position: 1 },
  { id: 'duplicates', folder_id: 3 },
  { id: 4, folder_id: 3, is_deleted: true },
  { id: 5, folder_id: 3, is_pseudo: true },
  { id: 6, folder_id: 4 },
  { id: 7, folder_id: 3, position: 2 },
];

test('next theme deck follows the existing store order and grid visibility', () => {
  assert.deepEqual(getThemeDecks(decks, 3).map(d => d.id), [8, 2, 7]);
  assert.equal(getNextThemeDeck(decks, decks[1]).id, 7);
  assert.equal(getNextThemeDeck(decks, decks[0]).id, 2);
});

test('last deck, absent current deck and root do not invent a next lesson', () => {
  assert.equal(getNextThemeDeck(decks, decks.at(-1)), null);
  assert.equal(isLastThemeDeck(decks, decks.at(-1)), true);
  assert.equal(getNextThemeDeck(decks, { id: 99, folder_id: 3 }), null);
  assert.equal(isLastThemeDeck(decks, { id: 99, folder_id: 3 }), false);
  assert.equal(getNextThemeDeck(decks, { id: 8, folder_id: null }), null);
});
