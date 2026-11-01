import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let apiCalls = [];
let apiPut = async (url, data) => { apiCalls.push({ method: 'PUT', url, data }); return { data }; };
let apiGet = async (url) => { apiCalls.push({ method: 'GET', url }); return { data: [] }; };

mock.module('../api.js', {
  defaultExport: {
    put: (url, data) => apiPut(url, data),
    get: (url) => apiGet(url),
  },
});

const {
  loadDeckRatings,
  saveRating,
  getRating,
  subscribeRatings,
} = await import('../cardRatings.js');

beforeEach(() => {
  apiCalls = [];
});

test('saveRating optimistically updates state, calls API, and rollback on error', async () => {
  let notifications = 0;
  const unsubscribe = subscribeRatings(() => { notifications++; });

  // 1. Successful save
  await saveRating(1, 100, 1, null);
  assert.equal(getRating(1, 100)?.rating, 1);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].url, '/card-ratings/100');
  assert.deepEqual(apiCalls[0].data, { rating: 1, reason: null });

  // 2. Dislike with reason
  await saveRating(1, 100, -1, 'unclear');
  assert.equal(getRating(1, 100)?.rating, -1);
  assert.equal(getRating(1, 100)?.reason, 'unclear');

  // 3. Rollback on failure
  apiPut = async () => { throw new Error('Network error'); };
  await assert.rejects(saveRating(1, 100, 1, null));
  // Rolled back to previous state (-1, 'unclear')
  assert.equal(getRating(1, 100)?.rating, -1);
  assert.equal(getRating(1, 100)?.reason, 'unclear');

  // 4. Clear rating (rating = null)
  apiPut = async (url, data) => { apiCalls.push({ method: 'PUT', url, data }); return { data }; };
  await saveRating(1, 100, null);
  assert.equal(getRating(1, 100), undefined);

  unsubscribe();
});

test('loadDeckRatings populates cache without overwriting newer touched votes', async () => {
  apiGet = async (url) => {
    apiCalls.push({ method: 'GET', url });
    return {
      data: [
        { card_id: 201, rating: 1, reason: null },
        { card_id: 202, rating: -1, reason: 'error' },
      ],
    };
  };

  // Locally vote on 201 first
  await saveRating(2, 201, -1, 'boring');
  assert.equal(getRating(2, 201)?.rating, -1);

  // Now load deck
  await loadDeckRatings(2, 999);
  // 201 should NOT be overwritten because it was touched
  assert.equal(getRating(2, 201)?.rating, -1);
  assert.equal(getRating(2, 201)?.reason, 'boring');
  // 202 should be loaded
  assert.equal(getRating(2, 202)?.rating, -1);
  assert.equal(getRating(2, 202)?.reason, 'error');
});
