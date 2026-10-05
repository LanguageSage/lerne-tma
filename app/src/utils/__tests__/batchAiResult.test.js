import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatchAiResult } from '../batchAiResult.js';

test('saved array and partial failure evidence drive the client result', () => {
  const saved = [{ id: 1, front: 'Hallo' }];
  const result = normalizeBatchAiResult({ cards: [...saved, { front: 'Danke' }], saved_cards: saved,
    save_result: { created_count: 1, failed_count: 1, failed: [{ index: 1 }] } }, true);
  assert.deepEqual(result.cards.map(card => card.id), [1]);
  assert.equal(result.failedCount, 1);
});

test('older bulk envelope is normalized to an array without losing partial failures', () => {
  const result = normalizeBatchAiResult({ saved_cards: {
    status: 'success', cards: [{ id: 1 }], failed: [{ index: 1 }] } }, true);
  assert.equal(result.cards.length, 1);
  assert.equal(result.failedCount, 1);
});

test('an unconfirmed save cannot be shown as successful generated cards', () => {
  assert.throws(() => normalizeBatchAiResult({ cards: [{ front: 'Hallo' }] }, true));
  assert.throws(() => normalizeBatchAiResult({ saved_cards: { unexpected: true } }, true));
  assert.deepEqual(normalizeBatchAiResult({ cards: [{ front: 'Hallo' }] }, false).cards, [{ front: 'Hallo' }]);
});
