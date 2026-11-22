import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { mock } from 'node:test';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
        return next(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

globalThis.localStorage = {
  getItem: key => key === 'lerne_user_id' ? '71' : null,
};
mock.module('../apiConfig.js', { namedExports: { API_BASE_URL: '/api', mediaURL: value => value } });
const { offlineApi } = await import('../offlineApi.js');

const userId = 71;
const content = text => ({ schema_version: 2, card: {
  type: 'standard', data: { prompt: text, answer: 'Antwort' },
} });

for (const prefix of ['LerneLocalDB', 'LerneStandaloneDB']) {
  test(`${prefix} catalog and study reuse scoped progress without changing results`, async t => {
    const db = new Dexie(`${prefix}_progress_reads_test`);
    db.version(1).stores({
      decks: 'id',
      folders: 'id',
      cards: 'id, deck_id',
      progress: '[card_id+user_id], user_id',
      syncState: 'key',
      media: 'url',
    });
    t.after(() => db.delete());
    await db.decks.bulkPut([{ id: 1 }, { id: 2 }, { id: 3, target_language: 'en' }, { id: 4 }]);
    await db.cards.bulkPut([
      { id: 11, deck_id: 1, position: 1, content_v2: content('Suchwort'), flag: 2 },
      { id: 12, deck_id: 1, position: 2, content_v2: content('Suchwort'), flag: 3, want_to_learn: true },
      { id: -13, deck_id: 1, position: 0, content_v2: content('Andere'), offline_create_status: 'pending' },
      { id: 14, deck_id: 1, position: 3, content_v2: content('Suchwort'), is_deleted: 1 },
      { id: 15, deck_id: 1, position: 4 },
      { id: 21, deck_id: 2, position: 1, content_v2: content('Suchwort') },
      { id: 31, deck_id: 3, position: 1, content_v2: content('Suchwort') },
    ]);
    await db.progress.bulkPut([
      { card_id: 11, user_id: userId, queue: 'review', flag: 0, next_review: '2999-01-01T00:00:00Z' },
      { card_id: 12, user_id: userId + 1, queue: 'learning', flag: 5 },
      { card_id: 21, user_id: userId, queue: 'relearning' },
      { card_id: 31, user_id: userId, queue: 'learning' },
    ]);

    const read = path => offlineApi.handle('get', path, null, { _testDb: db });
    const rangeReads = t.mock.method(db.progress, 'where');
    const pointReads = t.mock.method(db.progress, 'get');
    const batchReads = t.mock.method(db.progress, 'bulkGet');

    const { data: init } = await read('/init');
    assert.deepEqual(init.decks.map(deck => [deck.id, deck.stats]), [
      [1, { total: 3, new: 2, learning: 0, due: 0 }],
      [2, { total: 1, new: 0, learning: 1, due: 0 }],
      [4, { total: 0, new: 0, learning: 0, due: 0 }],
    ]);
    assert.equal(rangeReads.mock.callCount(), 1, 'one progress scan for the catalog');
    await read('/folders');
    assert.equal(rangeReads.mock.callCount(), 1, 'folder reads need no progress');

    const { data: next } = await read('/decks/1/next');
    assert.equal(next.id, 12);
    assert.equal(next.flag, 3);
    assert.equal(next.want_to_learn, true);
    assert.deepEqual(next.deck_stats, init.decks[0].stats);
    const { data: forced } = await read('/decks/1/next?review_context=forced');
    assert.equal(forced.id, 11);
    assert.equal(forced.flag, 0);

    const { data: cards, complete } = await read('/decks/1/cards');
    assert.equal(complete, true);
    assert.deepEqual(cards.map(card => [card.id, card.flag]), [[-13, 0], [11, 0], [12, 3]]);
    const { data: search } = await read('/cards/search?q=Suchwort&limit=2');
    assert.deepEqual(search.cards.map(card => [card.id, card.card_number, card.total_cards, card.flag]),
      [[11, 2, 3, 0], [12, 3, 3, 3]]);
    assert.equal(rangeReads.mock.callCount(), 1);
    assert.equal(pointReads.mock.callCount(), 0, 'a missing batch row uses the card fallback');
    assert.equal(batchReads.mock.callCount(), 4);

    const grade = () => offlineApi.handle('post', '/study/grade', {
      card_id: 12, grade: 2, action_id: 'fixture-grade', include_progress: true,
    }, { _testDb: db });
    const graded = await grade();
    assert.equal(graded.data.finished, true);
    assert.equal(graded.data.graded_progress.flag, 3);
    assert.deepEqual(await grade(), graded);
    assert.equal(rangeReads.mock.callCount(), 1, 'grading does not scan the account');
    assert.equal(pointReads.mock.callCount(), 1, 'only the first grade needs a point read for the write');
  });
}
