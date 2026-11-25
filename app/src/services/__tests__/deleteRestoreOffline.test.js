import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { registerHooks } from 'node:module';

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

const memStorage = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: key => (memStorage.has(key) ? memStorage.get(key) : null),
    setItem: (key, val) => memStorage.set(key, String(val)),
    removeItem: key => memStorage.delete(key),
    clear: () => memStorage.clear(),
  };
}
if (!globalThis.window) {
  globalThis.window = {
    location: { search: '', hostname: 'localhost', port: '', origin: 'https://localhost' },
    Capacitor: null,
  };
}

let activeUserId = 101;
mock.module('../../utils/auth.js', {
  namedExports: {
    getUserId: () => activeUserId,
    getSessionIdentity: () => `${activeUserId}:test`,
    getUserProfile: () => ({ user_id: activeUserId, username: `user${activeUserId}` }),
    getAccessToken: () => 'test-token',
    getAuthSession: () => ({ user_id: activeUserId, access_token: 'test-token' }),
    saveAuthSession: () => {},
    requireAuthSession: () => ({ user_id: activeUserId, access_token: 'test-token' }),
    storage: {
      get: k => (memStorage.has(k) ? memStorage.get(k) : null),
      set: (k, v) => memStorage.set(k, String(v)),
      remove: k => memStorage.delete(k),
    },
  },
});

mock.module('../apiConfig.js', {
  namedExports: {
    API_BASE_URL: '/api',
    mediaURL: (path) => path || null,
  },
});

const { offlineApi } = await import('../offlineApi.js');
const { isFolderActiveInCache, isFolderParentReadyForRestore, isDeckActiveInCache, buildFolderMap } = await import('../cardOfflineQueue.js');
const { getExportableMaterialsTree, buildMaterialArchiveExport } = await import('../../pilot/materialArchive.js');

let dbSeq = 0;
function createTestDb(prefix = 'LerneDeleteRestoreTest') {
  dbSeq += 1;
  const db = new Dexie(`${prefix}_${dbSeq}`);
  db.version(5).stores({
    folders: 'id, user_id, name, is_deleted, is_dirty',
    decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
    cards: 'id, deck_id, front_text, is_deleted, is_dirty',
    progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty',
    syncState: 'key',
    media: 'url',
    knowledge_items: 'id, language, category',
    card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
    knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
    user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id',
    card_notes: 'id, card_id, is_dirty',
  });
  return db;
}

const contentV2 = (front, back) => ({
  schema_version: 2,
  card: {
    type: 'classic',
    data: { prompt: front, answer: back },
    info: [],
  },
});

describe('Audit A-01 offline & standalone delete/restore semantics', () => {
  test('folder delete preserves child hierarchy without reparenting and hides entire subtree', async () => {
    activeUserId = 101;
    const db = createTestDb();
    await db.open();
    memStorage.set('lerne_target_language', 'de');

    await db.folders.bulkPut([
      { id: 1, user_id: 101, parent_id: null, name: 'Root', target_language: 'de', position: 0, is_deleted: 0, role: 'owner' },
      { id: 2, user_id: 101, parent_id: 1, name: 'Child Active', target_language: 'de', position: 1, is_deleted: 0, role: 'owner' },
      { id: 3, user_id: 101, parent_id: 1, name: 'Child Predeleted', target_language: 'de', position: 2, is_deleted: 1, role: 'owner' },
    ]);
    await db.decks.bulkPut([
      { id: 10, user_id: 101, folder_id: 2, name: 'Deck A', target_language: 'de', position: 0, is_deleted: 0, role: 'owner' },
      { id: 11, user_id: 101, folder_id: 1, name: 'Deck Predeleted', target_language: 'de', position: 1, is_deleted: 1, role: 'owner' },
    ]);
    await db.cards.bulkPut([
      { id: 100, deck_id: 10, front_text: 'Haus', content_v2: contentV2('Haus', 'House'), revision: 1, position: 0, is_deleted: 0 },
      { id: 101, deck_id: 10, front_text: 'Baum', content_v2: contentV2('Baum', 'Tree'), revision: 1, position: 1, is_deleted: 1 },
    ]);

    await offlineApi.handle('delete', '/folders/1', null, { _testDb: db });

    // No reparenting up a level and no cascading overwrite of child flags.
    const rootAfter = await db.folders.get(1);
    const childAfter = await db.folders.get(2);
    const deckAfter = await db.decks.get(10);
    const cardActiveAfter = await db.cards.get(100);
    const cardDeletedAfter = await db.cards.get(101);
    assert.equal(rootAfter.is_deleted, 1);
    assert.equal(childAfter.parent_id, 1);
    assert.equal(childAfter.is_deleted, 0);
    assert.equal(deckAfter.folder_id, 2);
    assert.equal(deckAfter.is_deleted, 0);
    assert.equal(cardActiveAfter.is_deleted, 0);
    assert.equal(cardDeletedAfter.is_deleted, 1);

    // Every active read endpoint excludes the deleted subtree.
    const initRes = await offlineApi.handle('get', '/init', null, { _testDb: db });
    assert.deepEqual(initRes.data.folders, []);
    assert.deepEqual(initRes.data.decks, []);
    assert.deepEqual((await offlineApi.handle('get', '/decks', null, { _testDb: db })).data, []);
    assert.deepEqual((await offlineApi.handle('get', '/folders', null, { _testDb: db })).data, []);
    await assert.rejects(() => offlineApi.handle('get', '/decks/10/cards', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('get', '/decks/10/next', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('get', '/cards/100', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('get', '/study/card/100', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('post', '/study/grade', { card_id: 100, grade: 2 }, { _testDb: db }));
    assert.equal(await db.progress.count(), 0);
    const searchRes = await offlineApi.handle('get', '/cards/search', { params: { q: 'Haus' } }, { _testDb: db });
    assert.deepEqual(searchRes.data, { folders: [], decks: [], cards: [] });
    const scopedSearchRes = await offlineApi.handle('get', '/cards/search', { params: { q: 'Haus', folder_id: 2 } }, { _testDb: db });
    assert.deepEqual(scopedSearchRes.data, { folders: [], decks: [], cards: [] });
    const statsRes = await offlineApi.handle('get', '/study/stats', null, { _testDb: db });
    assert.equal(statsRes.data.total_cards, 0);

    // Trash shows deleted root folder & pre-deleted descendants with parent_deleted / deck_deleted hints.
    const trashRes = await offlineApi.handle('get', '/trash', null, { _testDb: db });
    assert.equal(trashRes.data.folders.find(f => f.id === 1).parent_deleted, false);
    assert.equal(trashRes.data.folders.find(f => f.id === 1).decks_count, 1);
    assert.equal(trashRes.data.folders.find(f => f.id === 1).cards_count, 1);
    assert.equal(trashRes.data.folders.find(f => f.id === 3).parent_deleted, true);
    assert.equal(trashRes.data.decks.find(d => d.id === 11).parent_deleted, true);
    assert.equal(trashRes.data.cards.find(c => c.id === 101).deck_deleted, true);

    // Restoring child folder / deck / card while root is deleted is blocked with 409/error.
    await assert.rejects(() => offlineApi.handle('post', '/trash/folder/3/restore', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('post', '/trash/deck/11/restore', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('post', '/trash/card/101/restore', { revision: 1 }, { _testDb: db }));
    assert.equal((await db.folders.get(1)).is_deleted, 1);

    // Restoring root restores subtree while keeping pre-deleted items deleted.
    await offlineApi.handle('post', '/trash/folder/1/restore', null, { _testDb: db });
    const afterRestoreInit = await offlineApi.handle('get', '/init', null, { _testDb: db });
    assert.deepEqual(afterRestoreInit.data.folders.map(f => f.id), [1, 2]);
    assert.deepEqual(afterRestoreInit.data.decks.map(d => d.id), [10]);
    const activeCards = await offlineApi.handle('get', '/decks/10/cards', null, { _testDb: db });
    assert.equal(activeCards.data.length, 1);
    assert.equal((await db.folders.get(3)).is_deleted, 1);
    assert.equal((await db.decks.get(11)).is_deleted, 1);
    assert.equal((await db.cards.get(101)).is_deleted, 1);

    // Repeat delete & repeat restore are idempotent.
    await offlineApi.handle('delete', '/folders/1', null, { _testDb: db });
    await offlineApi.handle('delete', '/folders/1', null, { _testDb: db });
    await offlineApi.handle('post', '/trash/folder/1/restore', null, { _testDb: db });
    await offlineApi.handle('post', '/trash/folder/1/restore', null, { _testDb: db });
    assert.equal((await db.folders.get(3)).is_deleted, 1);
    assert.equal((await db.cards.get(100)).is_deleted, 0);
    await db.close();
  });

  test('incomplete Dexie cache: shared subfolder stays visible, orphan restore is blocked, non-owner delete rejected', async () => {
    activeUserId = 202;
    const db = createTestDb();
    await db.open();
    // Shared subfolder 20 whose unshared parent 10 is absent from db.folders.
    await db.folders.bulkPut([
      { id: 20, user_id: 101, parent_id: 10, name: 'Shared Leaf', is_deleted: 0, role: 'editor' },
      { id: 30, user_id: 202, parent_id: 999, name: 'Orphan Deleted', is_deleted: 1, role: 'owner' },
    ]);
    await db.decks.put({ id: 200, user_id: 101, folder_id: 20, name: 'Shared Deck', is_deleted: 0, role: 'editor' });

    const folderMap = buildFolderMap(await db.folders.toArray());
    assert.equal(isFolderActiveInCache(folderMap, 20), true);
    assert.equal(isDeckActiveInCache(await db.decks.get(200), folderMap), true);
    assert.deepEqual(isFolderParentReadyForRestore(folderMap, 999), { ok: false, reason: 'missing' });

    // Non-owner editor cannot delete folder 20 or deck 200.
    await assert.rejects(() => offlineApi.handle('delete', '/folders/20', null, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('delete', '/decks/200', null, { _testDb: db }));

    // Restoring folder whose parent is missing in Dexie is blocked.
    await assert.rejects(() => offlineApi.handle('post', '/trash/folder/30/restore', null, { _testDb: db }));
    await db.close();
  });

  test('standalone material archive & card storage hide/block decks inside deleted folders', async () => {
    activeUserId = 101;
    const db = createTestDb('LerneStandaloneDB_DeleteRestoreTest');
    await db.open();

    await db.folders.bulkPut([
      { id: 50, user_id: 101, parent_id: null, name: 'Deleted Root', is_deleted: 1 },
      { id: 51, user_id: 101, parent_id: 50, name: 'Child Active Flag', is_deleted: 0 },
      { id: 52, user_id: 101, parent_id: null, name: 'Visible Root', is_deleted: 0 },
    ]);
    await db.decks.bulkPut([
      { id: 500, user_id: 101, folder_id: 51, name: 'Hidden Deck', is_deleted: 0 },
      { id: 501, user_id: 101, folder_id: 52, name: 'Visible Deck', is_deleted: 0 },
    ]);
    await db.cards.bulkPut([
      { id: 5000, deck_id: 500, content_v2: contentV2('Hidden', 'Card'), revision: 1, position: 0, is_deleted: 0 },
      { id: 5001, deck_id: 501, content_v2: contentV2('Visible', 'Card'), revision: 1, position: 0, is_deleted: 0 },
    ]);

    const tree = await getExportableMaterialsTree({ db });
    assert.deepEqual(tree.rootFolders.map(f => f.id), [52]);
    assert.deepEqual(tree.allDecks.map(d => d.id), [501]);
    assert.equal(tree.totals.cards, 1);

    await assert.rejects(() => buildMaterialArchiveExport({ db, deckIds: [500] }));
    await assert.rejects(() => offlineApi.handle('post', '/cards/save', { deck_id: 500, request_id: 'req-c', content_v2: contentV2('A', 'B') }, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('patch', '/cards/5000', { revision: 1, request_id: 'req-u', content_v2: contentV2('A', 'B') }, { _testDb: db }));
    await assert.rejects(() => offlineApi.handle('post', '/cards/batch-delete', { card_ids: [5000], request_id: 'req-d' }, { _testDb: db }));
    await db.close();
  });
});
