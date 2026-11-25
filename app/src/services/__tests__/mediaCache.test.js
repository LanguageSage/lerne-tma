import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

mock.module('../apiConfig.js', { namedExports: {
  mediaURL: (path, kind) => path ? (/^(https?:|blob:|data:)/.test(path) ? path : `https://fixture.invalid/${kind}/${path}`) : null,
} });
const { localMediaURL, cardMediaView, clearMediaCache } = await import('../mediaCache.js');
const { prepareLocalDb, closeLocalDb, resetAllDatabases } = await import('../localDb.js');
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

test('inline media uses the account cache without replacing canonical content paths', async () => {
  const db = database();
  const card = { content_v2: { schema_version: 2, card: { layout: [
    { id: 'picture', type: 'image', path: 'images/inline.webp' }, { id: 'exercise', type: 'exercise' }] } } };
  try {
    online = false;
    await db.media.put({ url: 'https://fixture.invalid/images/images/inline.webp', blob: new Blob(['inline'], { type: 'image/webp' }) });
    const view = await cardMediaView(db, card);
    assert.match(view.layout_media_urls.picture, /^blob:/);
    assert.deepEqual(view.content_v2, card.content_v2);
    assert.equal(card.layout_media_urls, undefined);
  } finally { await db.delete(); }
});

test('pull views resolve cached media without prefetching misses in a read transaction', async () => {
  const db = database();
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    return new Response(null, { status: 503 });
  };
  const image = 'https://fixture.invalid/images/cached.webp';
  const audio = 'https://fixture.invalid/audio/uncached.mp3';
  try {
    await db.media.put({ url: image, blob: new Blob(['cached'], { type: 'image/webp' }) });
    const view = await db.transaction('r', db.media, () =>
      cardMediaView(db, { image_path: image, audio_path: audio }, false));
    assert.match(view.image_url, /^blob:/);
    assert.equal(await (await fetchBlob(view.image_url)).text(), 'cached');
    assert.equal(view.audio_url, audio);
    assert.deepEqual(requests, []);
  } finally { await db.delete(); }
});

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

test('clearMediaCache revokes objectUrls per database and closeLocalDb triggers automatic cleanup', async () => {
  const dbA = database();
  const dbB = database();
  const revoked = [];
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    return origRevoke.call(URL, url);
  };
  online = false;

  try {
    const urlA = 'https://fixture.invalid/images/a.webp';
    const urlB = 'https://fixture.invalid/images/b.webp';
    await dbA.media.put({ url: urlA, blob: new Blob(['a'], { type: 'image/webp' }) });
    await dbB.media.put({ url: urlB, blob: new Blob(['b'], { type: 'image/webp' }) });

    const blobA1 = await localMediaURL(dbA, urlA, 'images');
    const blobB1 = await localMediaURL(dbB, urlB, 'images');
    assert.match(blobA1, /^blob:/);
    assert.match(blobB1, /^blob:/);
    assert.equal(await localMediaURL(dbA, urlA, 'images'), blobA1);

    clearMediaCache(dbA.name);
    assert.deepEqual(revoked, [blobA1]);

    const blobA2 = await localMediaURL(dbA, urlA, 'images');
    assert.notEqual(blobA2, blobA1);
    assert.equal(await localMediaURL(dbB, urlB, 'images'), blobB1);

    // Verify closeLocalDb / resetAllDatabases triggers onLocalDbClose -> clearMediaCache
    const mem = new Map([['lerne_user_id', '777']]);
    const prevStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k),
      clear: () => mem.clear(),
    };
    try {
      const local = await prepareLocalDb();
      const localUrl = 'https://fixture.invalid/images/local.webp';
      await local.media.put({ url: localUrl, blob: new Blob(['local'], { type: 'image/webp' }) });
      const localBlob = await localMediaURL(local, localUrl, 'images');
      assert.match(localBlob, /^blob:/);

      closeLocalDb(777);
      assert.equal(revoked.includes(localBlob), true);

      // Reopen via getLocalDb/prepareLocalDb, create another object URL, and verify resetAllDatabases revokes it
      const reopened = await prepareLocalDb();
      const localBlob2 = await localMediaURL(reopened, localUrl, 'images');
      assert.notEqual(localBlob2, localBlob);
      resetAllDatabases();
      assert.equal(revoked.includes(localBlob2), true);
      await reopened.delete();
    } finally {
      globalThis.localStorage = prevStorage;
    }
  } finally {
    clearMediaCache();
    URL.revokeObjectURL = origRevoke;
    await dbA.delete();
    await dbB.delete();
  }
});
