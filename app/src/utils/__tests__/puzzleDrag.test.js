import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzleLists, getPuzzleInsertion, movePuzzleToken } from '../puzzleDrag.js';

test('all directions and every insertion position preserve every token exactly once', () => {
  const initial = { pool: [0, 1, 2], answer: [3, 4, 5] };
  for (const id of [...initial.pool, ...initial.answer]) {
    for (const destination of ['pool', 'answer']) {
      const remaining = initial[destination].filter(value => value !== id);
      for (let index = 0; index <= remaining.length; index++) {
        const next = movePuzzleToken(initial, id, destination, index);
        assert.equal(next[destination][index], id);
        assert.deepEqual(next[destination].filter(value => value !== id), remaining);
        assert.deepEqual([...next.pool, ...next.answer].sort(), [0, 1, 2, 3, 4, 5]);
      }
    }
  }
  assert.deepEqual(initial, { pool: [0, 1, 2], answer: [3, 4, 5] });
});

test('empty areas, single tokens, repeated fast transfers, no-op and invalid drops', () => {
  let lists = { pool: [0], answer: [] };
  for (let i = 0; i < 100; i++) {
    lists = movePuzzleToken(lists, 0, 'answer', 0);
    assert.deepEqual(lists, { pool: [], answer: [0] });
    lists = movePuzzleToken(lists, 0, 'pool', 0);
  }
  assert.strictEqual(movePuzzleToken(lists, 0, 'pool', 0), lists);
  assert.strictEqual(movePuzzleToken(lists, 99, 'answer', 0), lists);
  assert.strictEqual(movePuzzleToken(lists, 0, 'outside', 0), lists);
});

test('old saved state, duplicate text, punctuation and stale IDs restore canonical token lists', () => {
  const words = ['den', 'Mann,', 'den', 'Hund.'].map((text, id) => ({ id, text }));
  assert.deepEqual(createPuzzleLists(words, {
    selectedPuzzles: [{ id: 2 }, { id: 2 }, { id: 99 }],
    poolOrder: [3, 3, 2, 99]
  }), { pool: [3, 0, 1], answer: [2] });
  assert.deepEqual(createPuzzleLists(words, { selectedPuzzles: [{ id: 2 }] }),
    { pool: [0, 1, 3], answer: [2] });
});

const zone = { left: 0, top: 0, width: 300 };
const rect = (left, top, width = 60, height = 44) => ({
  left, top, right: left + width, bottom: top + height
});
const wrapped = [rect(10, 10), rect(80, 10), rect(10, 70), rect(80, 70), rect(10, 130)];

test('row-aware insertion finds start, gaps, ends and jumps across several lines', () => {
  for (const [point, index] of [
    [{ x: 0, y: 25 }, 0], [{ x: 75, y: 25 }, 1], [{ x: 250, y: 25 }, 2],
    [{ x: 0, y: 85 }, 2], [{ x: 75, y: 85 }, 3], [{ x: 250, y: 85 }, 4],
    [{ x: 0, y: 145 }, 4], [{ x: 250, y: 145 }, 5]
  ]) assert.equal(getPuzzleInsertion(wrapped, point, zone).index, index);
});

test('browser DOMRect prototype coordinates are read without losing the insertion position', () => {
  const browserRects = wrapped.map(value => Object.create(value));
  assert.equal(getPuzzleInsertion(browserRects, { x: 75, y: 25 }, zone).index, 1);
  assert.equal(getPuzzleInsertion(browserRects, { x: 75, y: 85 }, zone).x, 76);
});

test('empty areas and rows with tall wrapped words give a visible insertion marker', () => {
  assert.deepEqual(getPuzzleInsertion([], { x: 10, y: 10 }, zone), { index: 0, x: 150, y: 12, height: 32 });
  const rows = [rect(10, 10, 100, 90), rect(120, 33), rect(10, 110)];
  assert.equal(getPuzzleInsertion(rows, { x: 115, y: 20 }, zone).index, 1);
  assert.equal(getPuzzleInsertion(rows, { x: 0, y: 130 }, zone).index, 2);
});
