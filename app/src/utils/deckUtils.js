/**
 * Shared deck and folder utility functions.
 * Replaces duplicated metadata parsing and folder tree sorting across components.
 */
export const STANDALONE_SEED_DECK_IDS = new Set([9101, 9102, 9103]);

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

export const isBundledSeedDeck = (deck) => Boolean(
  deck && (
    deck.is_builtin === true
    || (!deck.standalone_source
      && STANDALONE_SEED_DECK_IDS.has(Number(deck.id))
      && (Boolean(parseDeckMetadata(deck)?.standalone_slug) || deck.is_global_readonly === true))
  )
);

export const isBundledSeedCard = (card) => Boolean(
  card
  && Number(card.id) > 0
  && Number(card.id) < 1_000_000
  && !card.standalone_source
  && typeof card.standalone_card_key === 'string'
  && card.standalone_card_key.includes(':')
);

export const canEditContainer = (item, isStandalone = false) => {
  if (!item) return Boolean(isStandalone);
  if (isBundledSeedDeck(item)) return false;
  return item.role === 'owner' || item.role === 'editor' || (!item.role && !item.is_global_readonly);
};

export const canAuthorDeckCards = (deck, isStandalone = false) => (
  Boolean(deck) && (isStandalone || canEditContainer(deck, false))
);

export const findCardDeck = ({ currentDeck, decks }, deckId) => {
  if (!deckId || deckId === 'duplicates') return currentDeck;
  if (Number(currentDeck?.id) === Number(deckId)) return currentDeck;
  return decks.find(deck => Number(deck.id) === Number(deckId));
};

/** Authored plan only. No stage completion / competence scores inferred from SRS. */
export const getDeckPedagogy = (deck) => {
  const pedagogy = parseDeckMetadata(deck)?.pedagogy;
  if (!pedagogy || pedagogy.schema_version !== 1) return null;
  const text = value => typeof value === 'string' ? value : '';
  const entries = value => Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && text(item.id) && text(item.title))
    : [];
  return {
    lessonType: text(pedagogy.lesson_type),
    expectedResult: text(pedagogy.expected_result),
    stages: entries(pedagogy.stages).map(stage => ({
      id: stage.id, title: stage.title, goal: text(stage.goal), support: text(stage.support),
      expectedSkill: text(stage.expected_skill),
      range: Number.isInteger(stage.from_card) && Number.isInteger(stage.to_card)
        && stage.from_card >= 1 && stage.to_card >= stage.from_card
        ? `${stage.from_card}–${stage.to_card}` : ''
    })),
    competencies: entries(pedagogy.competencies).map(item => ({ id: item.id, title: item.title })),
    recommendations: entries(pedagogy.review_recommendations).map(item => ({
      id: item.id, title: item.title, when: text(item.when), reason: text(item.reason)
    }))
  };
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

export const getFolderContentStats = (folderId, foldersList = [], decksList = []) => {
  const childFolders = (foldersList || []).filter(f => f.parent_id === folderId);
  const childDecks = (decksList || []).filter(d => d.folder_id === folderId);
  const descendantFolderIds = getDescendantFolderIds(folderId, foldersList || []);
  const allBranchFolderIds = [folderId, ...descendantFolderIds];
  const branchDecksCount = (decksList || []).filter(d => allBranchFolderIds.includes(d.folder_id)).length;
  const isBranchEmpty = branchDecksCount === 0;

  return {
    childFoldersCount: childFolders.length,
    childDecksCount: childDecks.length,
    branchDecksCount,
    isBranchEmpty
  };
};

export const getSortedFolderTree = (foldersList = [], excludeId = null, excludeDescendantIds = []) => {
  const result = [];
  const folderIds = new Set(foldersList.map(f => f.id));
  const visited = new Set();
  const traverse = (parentId, depth) => {
    // An accessible branch may omit its parent; older caches also omit root parent_id.
    const children = foldersList.filter(f => parentId === null
      ? f.parent_id == null || !folderIds.has(f.parent_id)
      : f.parent_id === parentId);
    for (const child of children) {
      if (visited.has(child.id) || child.id === excludeId || excludeDescendantIds.includes(child.id)) {
        continue;
      }
      visited.add(child.id);
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

export const getResourceSrc = (item, mediaType = 'images', resolver = null) => {
  if (!item) return '';
  const candidate = item.url || item.path;
  if (!candidate) return '';
  if (typeof resolver === 'function') {
    return resolver(candidate, mediaType) || '';
  }
  if (item.url) return item.url;
  if (item.path.startsWith('/api/media/')) return item.path;
  const cleanPath = item.path.replace(/^(images|audio|videos|backgrounds)\//, '');
  return `/api/media/${mediaType}/${cleanPath}`;
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

