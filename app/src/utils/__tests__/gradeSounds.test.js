import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// SHA-256 of the eleven supplied MP3 entries, copied without transcoding.
const hashes = [
  '28ccc674e819d11200b6fe6e0f3a941b706c183c81715fe95edcf56351bd6369',
  '5d8fd8b562e8ebc46d431dc1db1b8ba66ce60f8e613108250804ff2bb6fdb1d2',
  '851d0680cc11899495c4e99a10cba846e47e240517b0685bbbd86b8608474d85',
  'da2fb4ba5c3aff70e3a70e261ba295633521773c989d58c59ac439db163a923c',
  '16cbaa5081bd5a9bd0e3b60a5bbbf89f5a03faf9f54fd86d6cab4833ca0725aa',
  'e57911a4057d32721c754c1869d62aca702b58a5cbd9e1d513941a25e9e3359c',
  '7bd224b4535b5dd966476aa2d5feacbc57fa82a859566e22df46616e8f455261',
  '6b9b1a086798adcb728127653b0b4e60d517ac542b50e56881b91b6c869e95cc',
  '4478622edd809fadfc39e64e06cd0d613625b1d9918cc3bd00151cf503d20601',
  '1ec82a2ba3e9394c5d56ad511ddfd83a8196ad0069138285d316b3bae4e256bd',
  'a2f9177a04692b9f69b0cd0d3101e01d27bb07419ff5ff953f2d3ebe61381078',
];

let moduleId = 0;
async function setup(t, initialState = 'running') {
  const sources = [];
  const contexts = [];
  const decoded = [];
  class AudioContext {
    constructor(options) { this.state = initialState; this.options = options; this.destination = {}; contexts.push(this); }
    resume() { this.resumed = true; this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(bytes) { const buffer = { bytes }; decoded.push(buffer); return Promise.resolve(buffer); }
    createBufferSource() {
      const source = { connect(destination) { this.destination = destination; }, disconnect() { this.disconnected = true; },
        start(...args) { this.started = args; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
  }
  const oldWindow = globalThis.window;
  globalThis.window = { AudioContext };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    const bytes = await readFile(new URL(url));
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });
  const sounds = await import(`../gradeSounds.js?test=${moduleId++}`);
  return { ...sounds, sources, contexts, decoded, fetch };
}

test('prepares all 11 original MP3 files once, decodes before playback, preserves their bytes', async t => {
  const s = await setup(t);
  await Promise.all([s.prepareGradeSounds(), s.prepareGradeSounds()]);
  await s.prepareGradeSounds();
  assert.equal(s.fetch.mock.callCount(), 11);
  assert.equal(s.decoded.length, 11);
  assert.deepEqual(s.decoded.map(({ bytes }) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).sort(), [...hashes].sort());
  assert.equal(s.contexts.length, 1);
  assert.equal(s.contexts[0].options.latencyHint, 'interactive');
  assert.equal(s.sources.length, 0);
});

test('random selection can reach all 11 buffers and never repeats the previous variant', async t => {
  const s = await setup(t);
  await s.prepareGradeSounds();
  const random = t.mock.method(Math, 'random');
  for (let i = 0; i < 11; i++) {
    random.mock.mockImplementation(() => i === 0 ? 0 : (i - 1 + 0.5) / 10);
    s.playGradeSound();
  }
  assert.equal(new Set(s.sources.map(source => source.buffer)).size, 11);
  random.mock.mockImplementation(() => 0.5);
  for (let i = 0; i < 100; i++) s.playGradeSound();
  s.sources.forEach((source, i) => {
    if (i) assert.notEqual(source.buffer, s.sources[i - 1].buffer);
    assert.deepEqual(source.started, []); // Immediate full-buffer playback, no offset/duration/rate/gain.
    assert.equal(source.destination, s.contexts[0].destination);
  });
  s.sources[0].onended();
  assert.equal(s.sources[0].disconnected, true);
  assert.equal(s.fetch.mock.callCount(), 11);
});

test('resumes a suspended or interrupted context in the gesture and reuses decoded buffers after close', async t => {
  const s = await setup(t, 'suspended');
  await s.prepareGradeSounds();
  assert.equal(s.contexts[0].resumed, undefined);
  s.playGradeSound();
  await Promise.resolve();
  assert.equal(s.contexts[0].resumed, true);
  assert.equal(s.sources.length, 1);
  s.contexts[0].state = 'interrupted';
  s.playGradeSound();
  await Promise.resolve();
  assert.equal(s.sources.length, 2);
  s.contexts[0].state = 'closed';
  s.playGradeSound();
  await Promise.resolve();
  assert.equal(s.contexts.length, 2);
  assert.equal(s.sources.length, 3);
  assert.equal(s.fetch.mock.callCount(), 11);
});

test('cold load never blocks the caller or queues a delayed sound', async t => {
  const s = await setup(t);
  const originalFetch = globalThis.fetch;
  const releases = [];
  const fetch = t.mock.method(globalThis, 'fetch', url => new Promise(resolve => {
    releases.push(() => resolve(originalFetch(url)));
  }));
  assert.equal(s.playGradeSound(), undefined);
  assert.equal(fetch.mock.callCount(), 11);
  assert.equal(s.sources.length, 0);
  releases.forEach(release => release());
  await s.prepareGradeSounds();
  assert.equal(s.sources.length, 0);
  s.playGradeSound();
  assert.equal(s.sources.length, 1);
});

test('a blocked resume cannot replay an old gesture when audio becomes available later', async t => {
  const s = await setup(t, 'suspended');
  await s.prepareGradeSounds();
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  let resume;
  t.mock.method(s.contexts[0], 'resume', () => new Promise(resolve => { resume = resolve; }));
  s.playGradeSound();
  assert.equal(s.sources.length, 0);
  now = 200;
  s.contexts[0].state = 'running';
  resume();
  await Promise.resolve();
  assert.equal(s.sources.length, 0);
  s.playGradeSound();
  assert.equal(s.sources.length, 1);
});

test('failed fetch/decode is isolated, retries later and can play the sole ready variant', async t => {
  const s = await setup(t);
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', url => url.endsWith('-01.mp3') ? originalFetch(url) : Promise.reject(new Error('offline')));
  await s.prepareGradeSounds();
  s.playGradeSound();
  s.playGradeSound();
  assert.equal(s.sources.length, 2);
  assert.equal(s.sources[0].buffer, s.sources[1].buffer);
  t.mock.method(globalThis, 'fetch', originalFetch);
  const decode = t.mock.method(s.contexts[0], 'decodeAudioData', () => Promise.reject(new Error('bad MP3')));
  await s.prepareGradeSounds();
  assert.equal(decode.mock.callCount(), 10);
  decode.mock.restore();
  await s.prepareGradeSounds();
  assert.equal(s.decoded.length, 11);
});

test('unsupported/prefixed/blocked audio never throws into grading', async t => {
  const s = await setup(t);
  const AudioContext = window.AudioContext;
  window.AudioContext = undefined;
  await s.prepareGradeSounds();
  assert.doesNotThrow(() => s.playGradeSound());
  window.webkitAudioContext = AudioContext;
  await s.prepareGradeSounds();
  s.contexts[0].state = 'suspended';
  t.mock.method(s.contexts[0], 'resume', () => Promise.reject(new Error('blocked')));
  assert.doesNotThrow(() => s.playGradeSound());
  await Promise.resolve();
  assert.equal(s.sources.length, 0);
  s.contexts[0].state = 'running';
  t.mock.method(s.contexts[0], 'createBufferSource', () => { throw new Error('device lost'); });
  assert.doesNotThrow(() => s.playGradeSound());
});
