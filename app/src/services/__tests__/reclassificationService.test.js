import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let user = 1;
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
const requests = [];
let respond;
mock.module('../api.js', { namedExports: { networkApi: { post: (...args) => {
  requests.push(args);
  return respond(...args);
} } } });
mock.module('../../utils/auth.js', { namedExports: { getUserId: () => user } });
mock.module('../../i18n/locale.js', { namedExports: { tr: (s, params) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k]) } });
const { reclassifyDeck } = await import('../reclassificationService.js');
const deck = { id: 11, target_language: 'en' };
const toasts = [];
let reads = 0;
const options = { showToast: (...args) => toasts.push(args), refresh: async () => { reads++; } };
const result = (body, extra = {}) => ({ data: {
  operation_id: body.operation_id, status: 'ok', complete: true, total_count: 20,
  completed_count: 20, remaining_count: 0, next_batch: body.batch_index + 1, updated_count: 10, ...extra,
} });
function reset() {
  storage.clear(); requests.length = 0; toasts.length = 0; reads = 0; user = 1;
}

test('sequential batches show progress and only report success after the final response', async () => {
  reset();
  let finish;
  respond = async (_, body) => body.batch_index === 0
    ? result(body, { status: 'more', complete: false, completed_count: 10, remaining_count: 10 })
    : new Promise(resolve => { finish = () => resolve(result(body)); });
  const first = reclassifyDeck(deck, options);
  const duplicate = reclassifyDeck(deck, options);
  assert.equal(first, duplicate);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(toasts.some(([, type]) => type === 'success'), false);
  assert.match(toasts.at(-1)[0], /10.*20/);
  finish();
  await first;
  assert.equal(toasts.at(-1)[1], 'success');
  assert.equal(storage.size, 0);
  assert.equal(reads, 1);
  assert.equal(requests[0][1].operation_id, requests[1][1].operation_id);
  assert.equal(requests[1][1].batch_index, 1);
});

test('unknown network result and reload replay the same operation and batch', async () => {
  reset();
  respond = async () => { throw new Error('connection lost'); };
  await reclassifyDeck(deck, options);
  assert.equal(storage.size, 1);
  assert.equal(toasts.at(-1)[1], 'error');
  const original = requests[0][1];
  const reloaded = await import('../reclassificationService.js?reload');
  respond = async (_, body) => result(body);
  await reloaded.reclassifyDeck(deck, options);
  assert.deepEqual(requests[1][1], original);
});

test('partial AI result stops without automatic retries and explicit action continues from saved progress', async () => {
  reset();
  respond = async (_, body) => result(body, { status: 'partial', complete: false,
    completed_count: 5, remaining_count: 15, error_code: 'classification.ai_unavailable' });
  await reclassifyDeck(deck, options);
  assert.equal(requests.length, 1);
  assert.equal(toasts.at(-1)[1], 'error');
  respond = async (_, body) => result(body);
  await reclassifyDeck(deck, options);
  assert.equal(requests[1][1].batch_index, 1);
  assert.equal(requests[0][1].operation_id, requests[1][1].operation_id);
});

test('busy, attempt limit and inconsistent success never display success', async () => {
  for (const extra of [
    { status: 'busy', complete: false, completed_count: 0, remaining_count: 20, next_batch: 0 },
    { status: 'partial', complete: false, error_code: 'classification.attempt_limit' },
    { status: 'ok', complete: false, completed_count: 10, remaining_count: 10 },
    { status: 'ok', complete: true, remaining_count: 1 },
    { status: 'more', complete: false, next_batch: 0 },
  ]) {
    reset();
    respond = async (_, body) => result(body, extra);
    await reclassifyDeck(deck, options);
    assert.equal(requests.length, 1);
    assert.equal(toasts.some(([, type]) => type === 'success'), false);
    assert.equal(storage.size, 1);
  }
});

test('HTTP rejection retains the operation; changing accounts cannot resume it', async () => {
  reset();
  respond = async () => { throw { response: { status: 403 } }; };
  await reclassifyDeck(deck, options);
  const first = requests[0][1].operation_id;
  user = 2;
  respond = async (_, body) => result(body);
  await reclassifyDeck(deck, options);
  assert.notEqual(requests[1][1].operation_id, first);
  assert.equal(storage.size, 1);
});

test('account switching during a response does not show success or send another batch', async () => {
  reset();
  respond = async (_, body) => {
    user = 2;
    return result(body, { status: 'more', complete: false });
  };
  await reclassifyDeck(deck, options);
  assert.equal(requests.length, 1);
  assert.equal(toasts.some(([, type]) => type === 'success'), false);
  assert.equal(reads, 0);
});

test('failure to reload the list cannot reclassify already completed cards', async () => {
  reset();
  respond = async (_, body) => result(body);
  await reclassifyDeck(deck, { ...options, refresh: async () => { throw new Error('reload failed'); } });
  assert.equal(storage.size, 0);
  assert.equal(toasts.at(-1)[0], 'Уровни обновлены. Не удалось загрузить список; обновите страницу.');
});
