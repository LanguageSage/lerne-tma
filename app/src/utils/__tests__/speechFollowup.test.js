import { nativeCard } from './nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpeechFollowupTarget } from '../speechFollowup.js';

test('puzzle gives an authored correct sentence, not the instruction', () => {
  assert.equal(getSpeechFollowupTarget(nativeCard("puzzle", {  }, {"data": {"tokens": ["Ich", "würde", "gern", "in", "Deutschland", "arbeiten."], "translation": "Synthetic answer"}, "info": [{"type": "task", "text": "Собери предложение."}]})), 'Ich würde gern in Deutschland arbeiten.');
  assert.equal(getSpeechFollowupTarget(nativeCard("standard", {  }, {"data": {"prompt": "Ich / würde / arbeiten", "answer": "Synthetic answer"}}), 'puzzle'), null);
});

test('trainer fills input and selected choice gaps', () => {
  assert.equal(getSpeechFollowupTarget(nativeCard("trainer", {  }, {"data": {"back_note": "Synthetic answer", "parts": [{"type": "text", "text": "Wenn ich Zeit "}, {"type": "input", "answers": ["hätte"]}, {"type": "text", "text": ", "}, {"type": "choice", "options": [{"text": "würde", "correct": true}, {"text": "werde", "correct": false}], "distractors": null}, {"type": "text", "text": " ich Deutsch lernen."}]}})), 'Wenn ich Zeit hätte, würde ich Deutsch lernen.');
});

test('trainer keeps complete words and refuses ambiguous accepted answers', () => {
  assert.equal(getSpeechFollowupTarget(nativeCard("trainer", {  }, {"data": {"back_note": "Synthetic answer", "parts": [{"type": "text", "text": "Ich sehe einen klein"}, {"type": "input", "answers": ["en"]}, {"type": "text", "text": " Hund."}]}})), 'Ich sehe einen kleinen Hund.');
  assert.equal(getSpeechFollowupTarget(nativeCard("trainer", {  }, {"data": {"back_note": "Synthetic answer", "parts": [{"type": "text", "text": "Ich "}, {"type": "choice", "options": [{"text": "lerne", "correct": true}, {"text": "spreche", "correct": true}], "distractors": null}, {"type": "text", "text": " Deutsch."}]}})), null);
  assert.equal(getSpeechFollowupTarget(nativeCard("trainer", {  }, {"data": {"back_note": "Synthetic answer", "parts": [{"type": "text", "text": "Ich "}, {"type": "input", "answers": ["lerne", "spreche"]}, {"type": "text", "text": " Deutsch."}]}})), null);
});

test('word bank resolves exactly from the answer map', () => {
  assert.equal(getSpeechFollowupTarget(nativeCard("word_bank", {  }, {"data": {"options": ["lerne", "lernst"], "parts": [{"type": "text", "text": "Ich "}, {"type": "gap", "option": 0}, {"type": "text", "text": " Deutsch."}]}, "info": [{"type": "task", "text": "Ergänze."}]})), 'Ich lerne Deutsch.');
});

test('unsupported types and old payloads never enable mandatory speech', () => {
  assert.equal(getSpeechFollowupTarget(nativeCard('free_text')), null);
  assert.equal(getSpeechFollowupTarget(nativeCard('quiz')), null);
  assert.equal(getSpeechFollowupTarget({ front: '@puzzle\nIch lerne Deutsch.' }), null);
});
