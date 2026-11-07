import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

mock.module('../apiConfig.js', { namedExports: {
  mediaURL: (path, kind) => path ? (/^(https?:|blob:|data:)/.test(path) ? path : `https://fixture.invalid/${kind}/${path}`) : null,
} });
const { localMediaURL, cardMediaView } = await import('../mediaCache.js');
let online = true;
Object.defineProperty(navigator, 'onLine', { get: () => online, configurable: true });
const database = () => {
  const db = new Dexie(`media-${crypto.randomUUID()}`);
  db.version(1).stores({ media: '&url' });
  return db;
};
const settled = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Media cache did not settle');
};
beforeEach(() => { online = true; });

test('online views cache image/audio/video once; offline blobs survive a database reopen', async () => {
  const db = database();
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    const type = url.includes('videos') ? 'video/mp4' : url.includes('audio') ? 'audio/mpeg' : 'image/webp';
    return new Response(new Blob(['synthetic bytes'], { type }));
  };
  const card = { image_path: 'picture.webp', audio_path: 'speech.mp3', audio_back_path: 'speech.mp3',
    video_front_path: 'clip.mp4', video_back_path: 'clip.mp4' };
  try {
    await Promise.all([cardMediaView(db, card), cardMediaView(db, card)]);
    await settled(async () => await db.media.count() === 3);
    assert.equal(requests.length, 3);
    const name = db.name;
    db.close();
    const reopened = new Dexie(name); reopened.version(1).stores({ media: '&url' });
    online = false;
    try {
      const view = await cardMediaView(reopened, card);
      for (const field of ['image', 'audio', 'audio_back', 'video_front', 'video_back']) {
        assert.match(view[`${field}_url`], /^blob:/);
        assert.equal(view[`${field}_path`], card[`${field}_path`]);
        const response = await fetchBlob(view[`${field}_url`]);
        assert.equal(await response.text(), 'synthetic bytes');
      }
      assert.equal(requests.length, 3);
    } finally { await reopened.delete(); }
  } finally { if (db.isOpen()) await db.delete(); }
});

// Use native blob fetch only; the test network stub above has no external I/O.
const fetchBlob = async url => new Response(await (await import('node:buffer')).resolveObjectURL(url));

test('uncached offline media retains its URL and another account cannot reuse cached blobs', async () => {
  const owner = database(), other = database();
  const url = 'https://fixture.invalid/audio/shared.mp3';
  try {
    await owner.media.put({ url, blob: new Blob(['owner'], { type: 'audio/mpeg' }) });
    online = false;
    globalThis.fetch = async () => assert.fail('Offline lookup fetched media');
    assert.match(await localMediaURL(owner, url, 'audio'), /^blob:/);
    assert.equal(await localMediaURL(other, url, 'audio'), url);
  } finally { await owner.delete(); await other.delete(); }
});

test('oversized and failed downloads do not become available offline', async () => {
  const db = database();
  let reads = 0;
  globalThis.fetch = async url => url.includes('large') ? {
    ok: true, headers: new Headers({ 'content-length': String(16 * 1024 * 1024) }),
    blob: () => { reads++; throw Error('must not read oversized body'); },
  } : new Response('unavailable', { status: 503 });
  try {
    await localMediaURL(db, 'large.mp4', 'videos');
    await localMediaURL(db, 'missing.mp3', 'audio');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reads, 0);
    assert.equal(await db.media.count(), 0);
  } finally { await db.delete(); }
});
