import test from 'node:test';
import assert from 'node:assert/strict';
import { getPhysicalSideText, getPhysicalSideAudioSource, getStudyRolePhysicalSide, resolveStudyAudio } from '../studyCardRoles.js';

const card = { front: 'Deutsch', back: 'Перевод', audio_path: 'front.mp3', audio_back_path: 'back.mp3' };

test('reverse rebinds prompt/answer while physical sides and translation keep their meaning', () => {
  assert.equal(getStudyRolePhysicalSide('prompt'), 'front');
  assert.equal(getStudyRolePhysicalSide('answer'), 'back');
  assert.equal(getStudyRolePhysicalSide('prompt', 'reverse'), 'back');
  assert.equal(getStudyRolePhysicalSide('answer', 'reverse'), 'front');
  assert.equal(getStudyRolePhysicalSide('translation', 'reverse'), 'back');
  assert.equal(getPhysicalSideText(card, 'front'), 'Deutsch');
  assert.equal(getPhysicalSideText(card, 'back'), 'Перевод');
  assert.equal(getPhysicalSideAudioSource(card, 'front'), 'front.mp3');
  assert.equal(getPhysicalSideAudioSource(card, 'back'), 'back.mp3');
  assert.equal(resolveStudyAudio(card, 'prompt', { studyMode: 'reverse' }).source, 'back.mp3');
  assert.equal(resolveStudyAudio(card, 'answer', { studyMode: 'reverse' }).source, 'front.mp3');
});

test('audio retains URL/path fallback and does not invent recordings for future roles', () => {
  assert.equal(getPhysicalSideAudioSource({ ...card, audio_url: 'front-url' }, 'front'), 'front-url');
  assert.equal(getPhysicalSideAudioSource({ ...card, audio_back_url: 'back-url' }, 'back'), 'back-url');
  for (const role of ['example', 'dialogue', 'future-role']) {
    assert.deepEqual(resolveStudyAudio(card, role), { audioRole: role, physicalSide: null, source: '' });
  }
  assert.equal(getPhysicalSideAudioSource(null, 'front'), '');
  assert.equal(getPhysicalSideText({ front_text: 'alias' }, 'front'), 'alias');
});

test('logical audio roles can bind independent recordings, legacy sides or explicit absence', () => {
  const roleBindings = { dialogue: { url: 'dialogue.mp3' }, example: { path: 'example.mp3' }, prompt: { physicalSide: 'front' }, translation: null };
  assert.deepEqual(resolveStudyAudio(card, 'dialogue', { roleBindings }), { audioRole: 'dialogue', physicalSide: null, source: 'dialogue.mp3' });
  assert.equal(resolveStudyAudio(card, 'example', { roleBindings }).source, 'example.mp3');
  assert.equal(resolveStudyAudio(card, 'prompt', { studyMode: 'reverse', roleBindings }).source, 'front.mp3');
  assert.equal(resolveStudyAudio(card, 'translation', { roleBindings }).source, '');
});
