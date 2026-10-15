import test from 'node:test';
import assert from 'node:assert/strict';
import { getAudioUrl } from '../media.js';

test('Game Test relative audio uses its own API, including local TTS fallback', () => {
  for (const path of ['edge_audio_probe.mp3', 'audio/edge_audio_probe.mp3', '/api/media/audio/edge_audio_probe.mp3']) {
    assert.equal(getAudioUrl(path, '/api/media/audio'), '/api/media/audio/edge_audio_probe.mp3');
  }
  assert.equal(getAudioUrl('audio/edge_audio_probe.mp3', '/api/media/audio/'), '/api/media/audio/edge_audio_probe.mp3');
});

test('existing absolute audio, blob and data URLs retain their source', () => {
  for (const path of ['https://rkkviifehykdeugovlgp.supabase.co/storage/v1/object/public/audio/probe.mp3', 'blob:probe', 'data:audio/mpeg;base64,AA==']) {
    assert.equal(getAudioUrl(path, '/api/media/audio'), path);
  }
  assert.equal(getAudioUrl(null, '/api/media/audio'), '');
});
