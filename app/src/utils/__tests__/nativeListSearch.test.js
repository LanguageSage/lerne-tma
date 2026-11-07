import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDuplicateKey, matchCard } from '../search.js';

const card = { content_v2: { schema_version: 2, card: {
  type: 'standard', data: { prompt: 'Österreichische Grüße', answer: 'Lösung' },
  info: [{ type: 'example', text: 'Beispielnachweis' }], explanation: 'Erklärung',
  topics: ['Fachgebiet'], metadata: { hidden: 'unsearchable' },
} } };

test('native search covers authored fields with the same accent/case rules as HTTP', () => {
  for (const query of ['OSTERREICH', 'grusse', 'losung', 'Beispielnachweis', 'erklarung', 'Fachgebiet']) {
    assert.equal(matchCard(card, query), true, query);
  }
  for (const query of ['unsearchable', 'standard', 'missing']) assert.equal(matchCard(card, query), false, query);
  assert.equal(matchCard({ front: 'legacy', context: 'context' }, 'context'), false);
});

test('native duplicate identity ignores object key order and preserves full authored differences', () => {
  const reordered = JSON.parse(JSON.stringify(card.content_v2, (_key, value) =>
    value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(cardDuplicateKey(card.content_v2), cardDuplicateKey(reordered));
  for (const field of ['data', 'info', 'explanation', 'topics', 'metadata']) {
    const other = structuredClone(card.content_v2);
    other.card[field] = { changed: field };
    assert.notEqual(cardDuplicateKey(other), cardDuplicateKey(card.content_v2), field);
  }
  const ordered = { ...card.content_v2, card: { ...card.content_v2.card, topics: ['A', 'B'] } };
  const reversed = structuredClone(ordered);
  reversed.card.topics.reverse();
  assert.notEqual(cardDuplicateKey(ordered), cardDuplicateKey(reversed));
});
