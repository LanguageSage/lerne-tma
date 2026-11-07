import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTypes, newCardContent, parseCardSource } from '../cardDraft.js';

test('source JSON preserves all nine typed drafts and arbitrary nested metadata literally', () => {
  for (const kind of cardTypes) {
    const content = newCardContent(kind);
    content.card.metadata = { literal: '{"quoted": "Grüße [[literal]] @quiz"}\nКонтекст',
      ordered: [null, true, { values: [3, 1, 2] }] };
    const source = JSON.stringify(content, null, 4) + '\n';
    assert.deepEqual(parseCardSource(source), content);
  }
});

test('source JSON rejects incomplete syntax and envelopes unsafe to open in the typed form', () => {
  for (const source of ['{"card":', 'null', '[]', '{}', '{"schema_version":1}',
    JSON.stringify({ schema_version: 2, card: { type: 'standard', data: [] } }),
    JSON.stringify({ schema_version: 2, card: { type: 'trainer', data: { parts: null } } })]) {
    assert.throws(() => parseCardSource(source));
  }
});

test('source parsing leaves domain validation to the existing save pipeline', () => {
  const content = newCardContent('quiz');
  content.card.data.options = [];
  assert.deepEqual(parseCardSource(JSON.stringify(content)), content);
});
