import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpeechFollowupTarget } from '../speechFollowup.js';

test('puzzle gives an authored correct sentence, not the instruction', () => {
  assert.equal(getSpeechFollowupTarget({ front: '::task\nСобери предложение.\n\n::exercise\n@puzzle\nIch würde gern in Deutschland arbeiten.' }), 'Ich würde gern in Deutschland arbeiten.');
  assert.equal(getSpeechFollowupTarget({ front: 'Ich / würde / arbeiten' }, 'puzzle'), null);
});

test('trainer fills input and selected choice gaps', () => {
  assert.equal(getSpeechFollowupTarget({ front: '::exercise\nWenn ich Zeit [[hätte]], { *würde | werde } ich Deutsch lernen.' }), 'Wenn ich Zeit hätte, würde ich Deutsch lernen.');
});

test('trainer keeps complete words and refuses ambiguous accepted answers', () => {
  assert.equal(getSpeechFollowupTarget({ front: 'Ich sehe einen klein[[en]] Hund.' }), 'Ich sehe einen kleinen Hund.');
  assert.equal(getSpeechFollowupTarget({ front: 'Ich { *lerne | *spreche } Deutsch.' }), null);
  assert.equal(getSpeechFollowupTarget({ front: 'Ich [[lerne|spreche]] Deutsch.' }), null);
});

test('word bank resolves exactly from the answer map', () => {
  assert.equal(getSpeechFollowupTarget({
    front: '::task\nErgänze.\n\n::exercise\n@wordbank\nIch <<1>> Deutsch.\n@options\nlerne | lernst',
    back: '1=lerne',
  }), 'Ich lerne Deutsch.');
});

test('unsupported and ambiguous cards never enable mandatory speech', () => {
  assert.equal(getSpeechFollowupTarget({ front: '::exercise\n@free\nErzähle von deiner Arbeit.' }), null);
  assert.equal(getSpeechFollowupTarget({ front: '::exercise\nWas stimmt?\n*Ja\nNein' }), null);
  assert.equal(getSpeechFollowupTarget({ front: '::exercise\n@puzzle\nIch lerne.\nDu lernst.' }), null);
  assert.equal(getSpeechFollowupTarget({ front: '::exercise\n@wordbank\nIch <<1>> Deutsch.\n@options\nlerne|lernst', back: '1=gehe' }), null);
});
