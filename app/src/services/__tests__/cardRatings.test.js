import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let apiCalls, apiPut, apiGet;
const row = (id, rating = null, likes = rating === 1 ? 1 : 0, dislikes = rating === -1 ? 1 : 0) =>
  ({ card_id: id, rating, reason: null, likes, dislikes });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
mock.module('../api.js', { defaultExport: {
  put: (url, data, config) => { apiCalls.push({ method: 'PUT', url, data, config }); return apiPut(url, data); },
  get: (url, config) => { apiCalls.push({ method: 'GET', url, config }); return apiGet(url); },
} });
const { loadDeckRatings, saveRating, getRating, isRatingBusy, subscribeRatings } = await import('../cardRatings.js');
beforeEach(() => {
  apiCalls = [];
  apiPut = async (url, data) => ({ data: { ...row(Number(url.split('/').pop()), data.rating), reason: data.reason } });
  apiGet = async () => ({ data: [] });
});

test('only a confirmed server response selects a vote and supplies real totals', async () => {
  const gate = deferred();
  apiPut = () => gate.promise;
  let notifications = 0;
  const unsubscribe = subscribeRatings(() => notifications++);
  const saving = saveRating(1, 100, 1);
  assert.equal(getRating(1, 100), undefined);
  assert.equal(isRatingBusy(1, 100), true);
  gate.resolve({ data: row(100, 1, 31, 4) });
  await saving;
  assert.deepEqual(getRating(1, 100), row(100, 1, 31, 4));
  assert.equal(isRatingBusy(1, 100), false);
  assert.ok(notifications >= 2);
  assert.equal(apiCalls[0].config._expectedUserId, 1);
  unsubscribe();
});

test('switching and clearing use the server snapshot, reasons clear with a like', async () => {
  await saveRating(1, 101, -1, 'unclear');
  assert.equal(getRating(1, 101).reason, 'unclear');
  await saveRating(1, 101, 1, 'unclear');
  assert.equal(getRating(1, 101).reason, null);
  await saveRating(1, 101, null);
  assert.deepEqual(getRating(1, 101), row(101));
  assert.deepEqual(apiCalls.at(-1).data, { rating: null, reason: null });
});

test('404/503/500/401/403 and connection loss all reject; reconciliation reflects server state', async () => {
  for (const status of [404, 503, 500, 401, 403, undefined]) {
    const id = 200 + (status ?? 0);
    await saveRating(2, id, 1);
    apiPut = async () => { throw Object.assign(new Error('write failed'), { response: { status } }); };
    apiGet = async () => ({ data: row(id, 1, 7, 3) });
    await assert.rejects(saveRating(2, id, -1));
    assert.deepEqual(getRating(2, id), row(id, 1, 7, 3));
    assert.equal(apiCalls.at(-1).config._expectedUserId, 2);
    apiPut = async (url, data) => ({ data: row(Number(url.split('/').pop()), data.rating) });
  }
});

test('lost commit response reads actual new state, still rejects; unavailable read means unknown', async () => {
  apiPut = async () => { throw new Error('lost response after commit'); };
  apiGet = async () => ({ data: row(800, -1, 5, 9) });
  await assert.rejects(saveRating(3, 800, -1));
  assert.deepEqual(getRating(3, 800), row(800, -1, 5, 9));
  apiGet = async () => { throw new Error('offline'); };
  await assert.rejects(saveRating(3, 800, 1));
  assert.equal(getRating(3, 800), undefined);
  assert.equal(isRatingBusy(3, 800), false);
});

test('duplicate synchronous clicks cannot send overlapping writes; other cards and accounts stay independent', async () => {
  const gate = deferred();
  apiPut = (url, data) => url.endsWith('/900') ? gate.promise : Promise.resolve({ data: row(901, data.rating) });
  const first = saveRating(4, 900, 1);
  await assert.rejects(saveRating(4, 900, -1));
  await saveRating(4, 901, -1);
  assert.equal(isRatingBusy(4, 901), false);
  assert.equal(getRating(5, 900), undefined);
  gate.resolve({ data: row(900, 1) });
  await first;
  assert.equal(apiCalls.filter(c => c.method === 'PUT' && c.url.endsWith('/900')).length, 1);
  assert.equal(getRating(4, 901).rating, -1);
});

test('late deck load cannot overwrite a confirmed write or clear; concurrent loads batch once', async () => {
  const gate = deferred();
  apiGet = () => gate.promise;
  const loading = loadDeckRatings(6, 90);
  const duplicate = loadDeckRatings(6, 90);
  await saveRating(6, 910, null);
  gate.resolve({ data: [row(910, -1), row(911, 1, 2, 1)] });
  await Promise.all([loading, duplicate]);
  assert.deepEqual(getRating(6, 910), row(910));
  assert.deepEqual(getRating(6, 911), row(911, 1, 2, 1));
  assert.equal(apiCalls.filter(c => c.method === 'GET').length, 1);
  apiGet = async () => ({ data: [row(910), row(911)] });
  await loadDeckRatings(6, 90, true);
  assert.deepEqual(getRating(6, 911), row(911)); // External clear can refresh a previously touched card.
});

test('a failed or malformed batch remains retryable, malformed write never confirms success', async () => {
  apiGet = async () => { throw new Error('offline'); };
  await assert.rejects(loadDeckRatings(7, 91));
  apiGet = async () => ({ data: [row(920)] });
  await loadDeckRatings(7, 91);
  assert.deepEqual(getRating(7, 920), row(920));
  apiPut = async () => ({ data: { rating: 1 } });
  apiGet = async () => { throw new Error('offline'); };
  await assert.rejects(saveRating(7, 920, 1));
  assert.equal(getRating(7, 920), undefined);
});
