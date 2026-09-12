/**
 * Shared deck and folder utility functions.
 * Replaces duplicated metadata parsing and folder tree sorting across components.
 */

export const parseDeckMetadata = (deck) => {
  if (!deck) return { resources: [] };
  try {
    const raw = deck.metadata || deck.deck_metadata;
    if (!raw) return { resources: [] };
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { resources: [] };
  }
};

export const getDescendantFolderIds = (folderId, foldersList = []) => {
  const descendantIds = [];
  const traverse = (parentId) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      descendantIds.push(child.id);
      traverse(child.id);
    }
  };
  traverse(folderId);
  return descendantIds;
};

export const getSortedFolderTree = (foldersList = [], excludeId = null, excludeDescendantIds = []) => {
  const result = [];
  const traverse = (parentId, depth) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      if (child.id === excludeId || excludeDescendantIds.includes(child.id)) {
        continue;
      }
      result.push({
        ...child,
        depth: depth,
        displayName: `${'\u00A0'.repeat(depth * 3)}${child.name}`
      });
      traverse(child.id, depth + 1);
    }
  };
  traverse(null, 0);
  return result;
};

export const getSortedFolderAndDeckTree = (foldersList = [], decksList = [], expandedFolders = {}) => {
  const result = [];
  const traverse = (folderId, depth, isParentVisible) => {
    if (!isParentVisible) return;

    // 1. Process child folders first
    const childFolders = (foldersList || []).filter(f => f.parent_id === folderId);
    for (const folder of childFolders) {
      const isExpanded = !!expandedFolders[folder.id];
      result.push({
        type: 'folder',
        id: folder.id,
        name: folder.name,
        depth: depth,
        isExpanded: isExpanded
      });
      traverse(folder.id, depth + 1, isExpanded);
    }

    // 2. Process child decks
    const childDecks = (decksList || []).filter(d => d.folder_id === folderId);
    for (const deck of childDecks) {
      result.push({
        type: 'deck',
        id: deck.id,
        name: deck.name,
        totalCards: deck.stats?.total || 0,
        depth: depth
      });
    }
  };

  traverse(null, 0, true);
  return result;
};

export const getResourceSrc = (item, mediaType = 'images') => {
  if (!item) return '';
  if (item.url) return item.url;
  if (item.path) {
    const cleanPath = item.path.replace(/^(images|audio|videos)\//, '');
    return `/api/media/${mediaType}/${cleanPath}`;
  }
  return '';
};

/**
 * Parses user-entered number ranges or comma-separated numbers (e.g. "1-5, 8, 11-15", "от 1 до 10")
 * and returns a sorted array of 1-based indices within [1, totalCount].
 */
export const parseRangeSelection = (inputStr, totalCount) => {
  if (!inputStr || typeof inputStr !== 'string' || !totalCount || totalCount <= 0) return [];

  // Normalize "от 1 до 5", "с 1 по 5", "1 - 5", "1..5", "1—5"
  const normalized = inputStr
    .replace(/\b(?:от|с|from)\s+/gi, '')
    .replace(/\s*(?:до|по|to|[-–—:]+|\.{2,})\s*/gi, '-');

  const tokens = normalized.split(/[,;\s]+/).filter(Boolean);
  const indices = new Set();

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const num1 = parseInt(rangeMatch[1], 10);
      const num2 = parseInt(rangeMatch[2], 10);
      const from = Math.max(1, Math.min(num1, num2));
      const to = Math.min(totalCount, Math.max(num1, num2));
      for (let i = from; i <= to; i++) {
        indices.add(i);
      }
    } else {
      const numMatch = token.match(/^(\d+)$/);
      if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (val >= 1 && val <= totalCount) {
          indices.add(val);
        }
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
};

