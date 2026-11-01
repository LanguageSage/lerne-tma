import test from 'node:test';
import assert from 'node:assert/strict';

import { getFolderContentStats, getSortedFolderTree } from '../deckUtils.js';

test('folder choices include cached roots without parent_id and their descendants', () => {
  const folders = [
    { id: 1, name: 'Cached root' },
    { id: 2, name: 'Child', parent_id: 1 },
    { id: 3, name: 'Server root', parent_id: null },
  ];
  const tree = getSortedFolderTree(folders);
  assert.deepEqual(tree.map(f => [f.id, f.depth]), [[1, 0], [2, 1], [3, 0]]);
  assert.equal(tree[1].displayName.trim(), 'Child');
  assert.equal(folders[0].depth, undefined);
});

test('folder choices retain accessible branches whose parent is outside the catalog', () => {
  const folders = [
    { id: 1, name: 'Shared branch', parent_id: 99 },
    { id: 2, name: 'Child', parent_id: 1 },
    { id: 3, name: 'Other root', parent_id: null },
  ];
  assert.deepEqual(getSortedFolderTree(folders).map(f => [f.id, f.depth]), [[1, 0], [2, 1], [3, 0]]);
  assert.deepEqual(getSortedFolderTree(folders, 1, [2]).map(f => f.id), [3]);
  assert.deepEqual(getSortedFolderTree(folders, 3).map(f => f.id), [1, 2]);
});

test('getFolderContentStats: empty folder with no subfolders and no decks is empty', () => {
  const folders = [{ id: 1, name: 'Root Folder', parent_id: null }];
  const decks = [];

  const stats = getFolderContentStats(1, folders, decks);
  assert.equal(stats.childFoldersCount, 0);
  assert.equal(stats.childDecksCount, 0);
  assert.equal(stats.branchDecksCount, 0);
  assert.equal(stats.isBranchEmpty, true);
});

test('getFolderContentStats: folder with direct decks is not empty', () => {
  const folders = [{ id: 1, name: 'Root Folder', parent_id: null }];
  const decks = [
    { id: 101, folder_id: 1, name: 'Deck 1' },
    { id: 102, folder_id: 1, name: 'Deck 2' }
  ];

  const stats = getFolderContentStats(1, folders, decks);
  assert.equal(stats.childFoldersCount, 0);
  assert.equal(stats.childDecksCount, 2);
  assert.equal(stats.branchDecksCount, 2);
  assert.equal(stats.isBranchEmpty, false);
});

test('getFolderContentStats: folder with subfolders but 0 decks anywhere in branch is empty', () => {
  const folders = [
    { id: 1, name: 'Root', parent_id: null },
    { id: 2, name: 'Child A', parent_id: 1 },
    { id: 3, name: 'Grandchild', parent_id: 2 }
  ];
  const decks = [
    { id: 999, folder_id: null, name: 'Deck without folder' },
    { id: 888, folder_id: 99, name: 'Deck in another folder' }
  ];

  const stats = getFolderContentStats(1, folders, decks);
  assert.equal(stats.childFoldersCount, 1);
  assert.equal(stats.childDecksCount, 0);
  assert.equal(stats.branchDecksCount, 0);
  assert.equal(stats.isBranchEmpty, true);
});

test('getFolderContentStats: folder with 0 direct decks but nested subfolder has a deck is NOT empty', () => {
  const folders = [
    { id: 1, name: 'Root', parent_id: null },
    { id: 2, name: 'Child A', parent_id: 1 },
    { id: 3, name: 'Grandchild', parent_id: 2 }
  ];
  const decks = [
    { id: 101, folder_id: 3, name: 'Nested Deck' }
  ];

  const stats = getFolderContentStats(1, folders, decks);
  assert.equal(stats.childFoldersCount, 1);
  assert.equal(stats.childDecksCount, 0);
  assert.equal(stats.branchDecksCount, 1);
  assert.equal(stats.isBranchEmpty, false);
});

test('getFolderContentStats: handles empty or undefined lists gracefully', () => {
  const stats = getFolderContentStats(1, null, undefined);
  assert.equal(stats.childFoldersCount, 0);
  assert.equal(stats.childDecksCount, 0);
  assert.equal(stats.branchDecksCount, 0);
  assert.equal(stats.isBranchEmpty, true);
});
