import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeckPedagogy } from '../deckUtils.js';

test('old decks and unsupported passport versions have no new sections', () => {
  for (const deck of [null, {}, { metadata: '{}' }, { metadata: 'invalid' },
    { metadata: { pedagogy: { schema_version: 2 } } }]) assert.equal(getDeckPedagogy(deck), null);
});

test('authored pedagogical text and ranges survive string metadata without SRS inference', () => {
  const pedagogy = { schema_version: 1, lesson_type: 'assessment', expected_result: '<script>test</script>',
    stages: [{ id: 'custom', title: 'Speaking', goal: 'Speak', support: 'independent', from_card: 2, to_card: 7 }],
    competencies: [{ id: 'custom_skill', title: 'Communication' }],
    review_recommendations: [{ id: 'review', title: 'Deck 12', when: 'If useful', reason: 'Practice' }] };
  const before = JSON.stringify(pedagogy);
  const result = getDeckPedagogy({ metadata: JSON.stringify({ pedagogy }), stats: { total: 7, learned: 7 } });
  assert.equal(result.stages[0].range, '2–7');
  assert.equal(result.expectedResult, '<script>test</script>');
  assert.equal(result.competencies[0].id, 'custom_skill');
  assert.equal(result.recommendations[0].when, 'If useful');
  assert.equal('completed' in result.stages[0], false);
  assert.equal('score' in result.competencies[0], false);
  assert.equal(JSON.stringify(pedagogy), before);
});

test('malformed legacy optional entries do not crash the UI', () => {
  const result = getDeckPedagogy({ metadata: { pedagogy: { schema_version: 1, stages: [null, {},
    { id: 's', title: 'Stage', from_card: -1, to_card: 3, goal: {} }], competencies: 'invalid' } } });
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].range, '');
  assert.equal(result.stages[0].goal, '');
  assert.deepEqual(result.competencies, []);
});
