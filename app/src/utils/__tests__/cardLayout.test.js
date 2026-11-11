import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enableLayout, moveLayout, removeLayout, addLayoutInfo, addLayoutImage, readableLayout } from '../cardLayout.js';
import { studyLayout, studySideText, layoutAnswerRevealed } from '../structuredStudyCard.js';

test('moving and removing repeated blocks preserves identities, text, answers and image paths', () => {
  const original = { type: 'standard', data: { prompt: 'Q', answer: 'SECRET' },
    info: [{ type: 'source', text: ' **Text**\n\nZeile zwei.\n' }, { type: 'source', text: 'Repeated' }] };
  let card = enableLayout(original);
  const first = card.layout[0].id;
  card = addLayoutImage(card, 'images/one.webp');
  const image = card.layout.at(-1).id;
  card = addLayoutInfo(card);
  card = moveLayout(card, image, -1);
  assert.equal(card.layout[2].id, image);
  assert.equal(card.info[0].text, original.info[0].text);
  card = removeLayout(card, first);
  assert.equal(card.info[0].text, 'Repeated');
  assert.equal(card.layout[0].index, 0);
  assert.equal(card.layout.at(-1).index, 1);
  assert.equal(card.layout.find(item => item.id === image).path, 'images/one.webp');
  assert.deepEqual(card.data, original.data);
  assert.deepEqual(original.info.map(item => item.type), ['source', 'source']);
  assert.deepEqual(JSON.parse(JSON.stringify(card)), card);
  assert.equal(removeLayout(card, card.layout.find(item => item.type === 'exercise').id), card);
});

test('after-answer content is absent before completion and does not become a quiz prompt', () => {
  const card = { type: 'quiz', data: { prompt: '' }, info: [{ type: 'task', text: 'SECRET' }],
    layout: [{ id: 'e', type: 'exercise' }, { id: 'i', type: 'info', index: 0, visibility: 'after_answer' },
      { id: 'p', type: 'image', path: 'images/secret.webp', visibility: 'after_answer' }] };
  assert.deepEqual(studyLayout(card).map(item => item.id), ['e']);
  assert.equal(studySideText(card), '');
  assert.deepEqual(studyLayout(card, { afterAnswer: true }).map(item => item.id), ['e', 'i', 'p']);
  assert.equal(layoutAnswerRevealed({ evaluationState: { completed: false } }), false);
  assert.equal(layoutAnswerRevealed({ evaluationState: { completed: true } }), true);
});

test('malformed layout JSON cannot crash the visual form or pending study draft', () => {
  assert.equal(readableLayout({ layout: [null] }), false);
  assert.equal(readableLayout({ layout: [{ id: 'i', type: 'info', index: 9 }], info: [] }), false);
  assert.equal(readableLayout({ layout: [{ id: 'i', type: 'image', path: 'images/example.webp' }] }), true);
});
