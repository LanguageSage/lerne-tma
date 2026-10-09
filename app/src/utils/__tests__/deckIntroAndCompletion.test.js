import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeckMetadata } from '../deckUtils.js';
import {
  evaluateReviewResult,
  formatDuration,
  calculateSessionStats,
  computeDeckSrsStats
} from '../sessionStats.js';

test('parseDeckMetadata extracts intro data safely', () => {
  const deckWithMeta = {
    id: 1,
    name: 'Akkusativ Übungen',
    metadata: JSON.stringify({
      resources: [],
      intro: {
        title: 'Урок 1: Akkusativ',
        topic: 'Akkusativ',
        goal: 'Понять окончания',
        learning_outcomes: ['Определять падеж', 'Использовать правильный артикль'],
        estimated_time: '15 минут'
      }
    })
  };

  const parsed = parseDeckMetadata(deckWithMeta);
  assert.equal(parsed.intro?.title, 'Урок 1: Akkusativ');
  assert.equal(parsed.intro?.topic, 'Akkusativ');
  assert.equal(parsed.intro?.goal, 'Понять окончания');
  assert.equal(parsed.intro?.learning_outcomes?.length, 2);
  assert.equal(parsed.intro?.estimated_time, '15 минут');
});

test('parseDeckMetadata handles missing or empty intro gracefully', () => {
  const plainDeck = {
    id: 2,
    name: 'Standard Deck',
    metadata: null
  };

  const parsed = parseDeckMetadata(plainDeck);
  assert.deepEqual(parsed, { resources: [] });
  assert.equal(parsed.intro, undefined);
});

test('parseDeckMetadata handles malformed json gracefully', () => {
  const brokenDeck = {
    id: 3,
    name: 'Broken Deck',
    metadata: '{ broken json'
  };

  const parsed = parseDeckMetadata(brokenDeck);
  assert.deepEqual(parsed, { resources: [] });
});

test('evaluateReviewResult correctly evaluates standard 4-grade scale', () => {
  assert.deepEqual(evaluateReviewResult({ grade: 0, isExtended: false }), { isCorrect: false, mistakes: 1 });
  assert.deepEqual(evaluateReviewResult({ grade: 1, isExtended: false }), { isCorrect: false, mistakes: 1 });
  assert.deepEqual(evaluateReviewResult({ grade: 2, isExtended: false }), { isCorrect: true, mistakes: 0 });
  assert.deepEqual(evaluateReviewResult({ grade: 3, isExtended: false }), { isCorrect: true, mistakes: 0 });
});

test('evaluateReviewResult correctly evaluates extended 8-grade scale', () => {
  assert.deepEqual(evaluateReviewResult({ grade: 0, isExtended: true }), { isCorrect: false, mistakes: 1 });
  assert.deepEqual(evaluateReviewResult({ grade: 2, isExtended: true }), { isCorrect: false, mistakes: 1 });
  assert.deepEqual(evaluateReviewResult({ grade: 3, isExtended: true }), { isCorrect: true, mistakes: 0 });
  assert.deepEqual(evaluateReviewResult({ grade: 7, isExtended: true }), { isCorrect: true, mistakes: 0 });
});

test('evaluateReviewResult honors interactive exercise evidence', () => {
  const cleanPass = evaluateReviewResult({
    grade: 3,
    exerciseEvidence: { isCorrect: true, mistakeCount: 0 }
  });
  assert.deepEqual(cleanPass, { isCorrect: true, mistakes: 0 });

  const passWithMistakes = evaluateReviewResult({
    grade: 2,
    exerciseEvidence: { isCorrect: true, mistakeCount: 2 }
  });
  assert.deepEqual(passWithMistakes, { isCorrect: true, mistakes: 2 });

  const failedInteractive = evaluateReviewResult({
    grade: 0,
    exerciseEvidence: { isCorrect: false, mistakeCount: 1 }
  });
  assert.deepEqual(failedInteractive, { isCorrect: false, mistakes: 1 });
});

test('formatDuration formats seconds accurately', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(45), '0:45');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3665), '1:01:05');
  assert.equal(formatDuration(-10), '0:00');
  assert.equal(formatDuration(NaN), '0:00');
});

test('calculateSessionStats calculates exercises, accuracy, and duration', () => {
  // Empty session returns null
  assert.equal(calculateSessionStats({ reviewsCount: 0, studyHistory: [] }), null);

  const start = 1700000000000;
  const end = start + 125000; // 125 seconds

  const stats = calculateSessionStats({
    reviewsCount: 10,
    correctCount: 8,
    mistakeCount: 2,
    startedAt: start,
    endedAt: end,
    studyHistory: [{ id: 1 }, { id: 2 }]
  });

  assert.deepEqual(stats, {
    exercises: 10,
    correct: 8,
    mistakes: 2,
    accuracy: '80%',
    duration: '2:05'
  });
});

test('calculateSessionStats handles perfect score and zero mistakes', () => {
  const start = 1700000000000;
  const end = start + 60000;

  const stats = calculateSessionStats({
    reviewsCount: 5,
    correctCount: 5,
    mistakeCount: 0,
    startedAt: start,
    endedAt: end
  });

  assert.deepEqual(stats, {
    exercises: 5,
    correct: 5,
    mistakes: 0,
    accuracy: '100%',
    duration: '1:00'
  });
});

test('computeDeckSrsStats derives queue breakdown from deckCards', () => {
  const refDate = new Date('2026-10-09T12:00:00Z');
  const cards = [
    { id: 1, queue: 'new' },
    { id: 2, queue: 'new' },
    { id: 3, queue: 'learning' },
    { id: 4, queue: 'review', next_review: '2026-10-09T10:00:00Z' }, // due
    { id: 5, queue: 'review', next_review: '2026-10-15T10:00:00Z' }, // not due
  ];

  const srs = computeDeckSrsStats({ id: 99 }, cards, refDate);
  assert.deepEqual(srs, {
    total: 5,
    new: 2,
    learning: 1,
    due: 1
  });
});

test('computeDeckSrsStats falls back to deck.stats when deckCards empty', () => {
  const deck = {
    id: 10,
    card_count: 20,
    stats: { total: 20, new: 5, learning: 3, due: 7 }
  };

  const srs = computeDeckSrsStats(deck, []);
  assert.deepEqual(srs, {
    total: 20,
    new: 5,
    learning: 3,
    due: 7
  });
});
