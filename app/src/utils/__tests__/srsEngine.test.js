import test from 'node:test';
import assert from 'node:assert';
import { getLearning8States, getReview8States, getNextIntervals, calculateCardReview } from '../srsEngine.js';

const now = new Date('2026-10-05T12:00:00Z');
const early = { queue: 'review', interval: 10, ease_factor: 2.5, lapses: 0, repetitions: 3,
  last_reviewed: '2026-10-03T12:00:00Z', next_review: '2026-10-13T12:00:00Z' };

test('forced early Good grows in proportion to elapsed time; Hard shortens and Again relearns', () => {
  assert.equal(getReview8States(early, false, 'scheduled', now)[4].interval, 25);
  assert.equal(calculateCardReview(early, 2, false, 'forced', now).interval, 13);
  assert.equal(calculateCardReview(early, 1, false, 'forced', now).interval, 6);
  const again = calculateCardReview(early, 0, false, 'forced', now);
  assert.equal(again.queue, 'relearning');
  assert.equal(again.lapses, 1);
  assert.equal(again.repetitions, early.repetitions);
  assert.equal(again.next_review, '2026-10-05T12:05:00.000Z');
});

test('same-day forced Good cannot multiply the interval; overdue forced follows scheduled anchors', () => {
  assert.equal(calculateCardReview({ ...early, last_reviewed: now.toISOString(), next_review: '2026-10-15T12:00:00Z' }, 2, false, 'forced', now).interval, 10);
  const overdue = { ...early, next_review: '2026-10-01T12:00:00Z' };
  assert.deepEqual(getReview8States(overdue, false, 'forced', now), getReview8States(overdue, false, 'scheduled', now));
});

test('SRS Engine - 8 extended buttons for learning cards have no duplicate intervals and strictly increase', () => {
  const newCard = { queue: 'new', step_index: 0, interval: 0, lapses: 0 };
  const states = getLearning8States(newCard);
  assert.strictEqual(states.length, 8);

  const intervals = getNextIntervals(newCard).extended;
  assert.strictEqual(intervals.length, 8);
  const unique = new Set(intervals);
  assert.strictEqual(unique.size, 8, `Expected 8 unique intervals but got: ${intervals.join(', ')}`);

  // Verify anchors 0, 2, 4, 6 match standard SM-2 4-button scale
  assert.strictEqual(states[0].interval, 5); // Again: 5m
  assert.strictEqual(states[2].interval, 10); // Hard: 10m
  assert.strictEqual(states[4].interval, 1); // Good: 1d
  assert.strictEqual(states[6].interval, 3); // Easy: 3d
});

test('SRS Engine - 8 extended buttons for review cards at interval=1 have no duplicate intervals', () => {
  const revCard = { queue: 'review', interval: 1, ease_factor: 2.5, lapses: 0 };
  const intervals = getNextIntervals(revCard).extended;
  assert.strictEqual(intervals.length, 8);
  const unique = new Set(intervals);
  assert.strictEqual(unique.size, 8, `Expected 8 unique intervals but got: ${intervals.join(', ')}`);
});

test('SRS Engine - 8 extended buttons for review cards across intervals 1..50 have no duplicates', () => {
  for (let iv = 1; iv <= 50; iv++) {
    const card = { queue: 'review', interval: iv, ease_factor: 2.5, lapses: 0 };
    const states = getReview8States(card, false);
    assert.strictEqual(states.length, 8);
    const intervals = getNextIntervals(card).extended;
    const unique = new Set(intervals);
    assert.strictEqual(unique.size, 8, `Interval duplicate at card interval ${iv}: ${intervals.join(', ')}`);
  }
});
