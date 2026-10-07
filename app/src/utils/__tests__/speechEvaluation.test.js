import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStudySpeech } from '../speechEvaluation.js';

test('speech evaluator accepts an explicit phrase independently of the card front', () => {
  assert.equal(evaluateStudySpeech({ transcript: 'Ich lerne Deutsch', targetText: 'Ich lerne Deutsch' }).success, true);
  assert.equal(evaluateStudySpeech({ transcript: 'Guten Morgen', targetText: 'Ich lerne Deutsch' }).success, false);
});

test('existing threshold and German normalization are preserved', () => {
  assert.equal(evaluateStudySpeech({ transcript: 'Ich lerne heute', targetText: 'Ich lerne heute Deutsch', threshold: 75 }).success, true);
  assert.equal(evaluateStudySpeech({ transcript: 'Ich lerne heute', targetText: 'Ich lerne heute Deutsch', threshold: 100 }).success, false);
  assert.equal(evaluateStudySpeech({ transcript: 'Das heißt zehn Euro', targetText: 'Das heißt 10 €' }).success, true);
  assert.equal(evaluateStudySpeech({ transcript: '', targetText: 'Deutsch' }).success, false);
  assert.equal(evaluateStudySpeech({ transcript: 'Deutsch', targetText: '' }).success, false);
});
