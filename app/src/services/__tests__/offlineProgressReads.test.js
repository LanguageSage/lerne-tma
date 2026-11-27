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

let activeUserId = 71;
globalThis.localStorage = {
  getItem: key => key === 'lerne_user_id' ? String(activeUserId) : null,
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
      card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
      knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
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

  test(`${prefix} preserves A-01 deleted folder hiding, account isolation, and study card batching`, async t => {
    activeUserId = userId;
    t.after(() => { activeUserId = userId; });
    const db = new Dexie(`${prefix}_progress_hierarchy_test`);
    db.version(1).stores({
      decks: 'id',
      folders: 'id',
      cards: 'id, deck_id',
      progress: '[card_id+user_id], user_id',
      syncState: 'key',
      media: 'url',
    });
    t.after(() => db.delete());

    await db.folders.bulkPut([
      { id: 100, user_id: userId, parent_id: null, name: 'Deleted Parent', position: 1, is_deleted: 1 },
      { id: 101, user_id: userId, parent_id: 100, name: 'Child Active Flag', position: 2, is_deleted: 0 },
      { id: 200, user_id: userId, parent_id: null, name: 'Visible Root', position: 3, is_deleted: 0 },
    ]);
    await db.decks.bulkPut([
      { id: 100, user_id: userId, folder_id: 101, name: 'Hidden Deck', position: 1, is_deleted: 0 },
      { id: 200, user_id: userId, folder_id: 200, name: 'Visible Deck', position: 2, is_deleted: 0 },
    ]);
    await db.cards.bulkPut([
      { id: 1000, deck_id: 100, position: 1, content_v2: content('HiddenTreeWord'), is_deleted: 0, flag: 1 },
      { id: 2000, deck_id: 200, position: 1, content_v2: content('VisibleTreeWord'), is_deleted: 0, flag: 4 },
      { id: 2001, deck_id: 200, position: 2, content_v2: content('VisibleTreeWord Two'), is_deleted: 0, flag: 2 },
    ]);
    await db.progress.bulkPut([
      { card_id: 1000, user_id: userId, queue: 'new', flag: 1 },
      { card_id: 2000, user_id: userId, queue: 'review', flag: 0, next_review: '2999-01-01T00:00:00Z' },
      { card_id: 2001, user_id: userId + 1, queue: 'learning', flag: 5 },
    ]);

    const read = path => offlineApi.handle('get', path, null, { _testDb: db });
    const rangeReads = t.mock.method(db.progress, 'where');
    const pointReads = t.mock.method(db.progress, 'get');
    const batchReads = t.mock.method(db.progress, 'bulkGet');

    const { data: init } = await read('/init');
    assert.deepEqual(init.folders.map(folder => folder.id), [200]);
    assert.deepEqual(init.decks.map(deck => [deck.id, deck.stats]), [
      [200, { total: 2, new: 1, learning: 0, due: 0 }],
    ]);
    const { data: decks } = await read('/decks');
    assert.deepEqual(decks.map(deck => deck.id), [200]);
    const { data: folders } = await read('/folders');
    assert.deepEqual(folders.map(folder => folder.id), [200]);
    assert.equal(rangeReads.mock.callCount(), 2, 'one scan each for /init and /decks, none for /folders');

    assert.deepEqual((await read('/cards/search?q=HiddenTreeWord')).data, { folders: [], decks: [], cards: [] });
    assert.deepEqual((await read('/cards/search?q=HiddenTreeWord&folder_id=101')).data, { folders: [], decks: [], cards: [] });

    const { data: visibleSearch } = await read('/cards/search?q=VisibleTreeWord&folder_id=200');
    assert.deepEqual(visibleSearch.cards.map(card => [card.id, card.flag]), [[2000, 0], [2001, 2]]);

    await assert.rejects(() => read('/decks/100/cards'));
    await assert.rejects(() => read('/decks/100/next'));
    await assert.rejects(() => read('/cards/1000'));
    await assert.rejects(() => read('/study/card/1000'));
    await assert.rejects(() => offlineApi.handle('post', '/study/grade', {
      card_id: 1000, grade: 2, action_id: 'deleted-parent-grade',
    }, { _testDb: db }));
    assert.equal(await db.syncState.get('grade:deleted-parent-grade'), undefined);
    assert.equal(await db.syncState.get('review:deleted-parent-grade'), undefined);

    const { data: studyCard } = await read('/study/card/2000');
    assert.equal(studyCard.id, 2000);
    assert.equal(studyCard.flag, 0);
    assert.deepEqual(studyCard.deck_stats, { total: 2, new: 1, learning: 0, due: 0 });
    assert.equal(rangeReads.mock.callCount(), 2, '/study/card uses batch read instead of account scan');
    assert.equal(pointReads.mock.callCount(), 0, 'batched progress avoids per-card point reads');
    assert.equal(batchReads.mock.callCount(), 2, 'one batch read for /cards/search and one for /study/card');

    activeUserId = userId + 1;
    const { data: otherInit } = await read('/init');
    assert.deepEqual(otherInit.decks.map(deck => [deck.id, deck.stats]), [
      [200, { total: 2, new: 1, learning: 1, due: 0 }],
    ]);
    const { data: otherCards } = await read('/decks/200/cards');
    assert.deepEqual(otherCards.map(card => [card.id, card.flag, card.queue]), [
      [2000, 4, 'new'],
      [2001, 5, 'learning'],
    ]);
    const { data: otherStudyCard } = await read('/study/card/2000');
    assert.equal(otherStudyCard.flag, 4);
    assert.equal(otherStudyCard.queue, 'new');
  });
}
