import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectExerciseType } from '../exerciseDetector.js';

// The same corpus is checked by scripts/tests/test_exercise_detection_corpus.py
// against api/services/input_parser.py. Real lesson FRONT texts, no DB access.
const corpus = JSON.parse(fs.readFileSync(
  new URL('../../../../tests/fixtures/exercise_detection_corpus.json', import.meta.url), 'utf8'));

const detect = (front) => detectExerciseType(front) || 'standard';

for (const entry of corpus.cards) {
  test(`corpus card ${entry.source_card_id}`, () => {
    assert.equal(detect(entry.front), entry.js);
    if (!entry.known_divergence) assert.equal(detect(entry.front), entry.type);
  });
}

test('agreeing entries equal the Python result, divergent ones are explicitly marked', () => {
  for (const entry of corpus.cards) {
    assert.equal(entry.python === entry.js, !entry.known_divergence, String(entry.source_card_id));
  }
});
