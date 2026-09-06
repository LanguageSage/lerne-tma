/**
 * Normalizes text for search: removes accents/diacritics, converts umlauts,
 * converts to lowercase and trims whitespace.
 *
 * @param {string|any} text - The input text to normalize.
 * @returns {string} Normalized string.
 */
export const normalizeSearchText = (text) => {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritical marks
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .trim();
};

/**
 * Checks if a target string matches a query string using both exact lowercase and normalized matching.
 *
 * @param {string} target - The text to search in.
 * @param {string} query - The search query.
 * @returns {boolean} True if query is found in target.
 */
export const matchesSearchQuery = (target, query) => {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const qLower = query.toLowerCase().trim();
  const tLower = String(target).toLowerCase();
  if (tLower.includes(qLower)) return true;

  const qNorm = normalizeSearchText(query);
  const tNorm = normalizeSearchText(target);
  return tNorm.includes(qNorm);
};

/**
 * Matches a flashcard against a search query across front and back (translation).
 * Context search is excluded by default as requested.
 *
 * @param {object} card - The card object.
 * @param {string} query - The search query.
 * @param {object} [options] - Search options.
 * @param {boolean} [options.includeContext=false] - Whether to search inside context/example sentences.
 * @returns {boolean} True if card matches query.
 */
export const matchCard = (card, query, { includeContext = false } = {}) => {
  if (!query || !query.trim()) return true;
  if (!card) return false;

  const frontText = card.front || card.front_text;
  const backText = card.back || card.back_text;

  if (matchesSearchQuery(frontText, query) || matchesSearchQuery(backText, query)) {
    return true;
  }

  if (includeContext && matchesSearchQuery(card.context, query)) {
    return true;
  }

  return false;
};

/**
 * Returns an array containing the rootFolderId and all its recursive subfolder IDs.
 *
 * @param {Array} folders - All folders list.
 * @param {number|null} rootFolderId - The parent folder ID.
 * @returns {Array<number>} Array of folder IDs in scope.
 */
export const getFolderDescendantIds = (folders, rootFolderId) => {
  if (!rootFolderId) return [];
  if (!folders || !Array.isArray(folders)) return [rootFolderId];

  const descendants = [rootFolderId];
  const toCheck = [rootFolderId];

  while (toCheck.length > 0) {
    const currentId = toCheck.shift();
    for (const f of folders) {
      const parentId = f.parent_id;
      if (parentId === currentId && !descendants.includes(f.id)) {
        descendants.push(f.id);
        toCheck.push(f.id);
      }
    }
  }

  return descendants;
};

/**
 * Returns all decks within the active scope (either all decks in targetLanguage,
 * or decks inside activeFolderId and its descendant subfolders).
 *
 * @param {Array} decks - All decks.
 * @param {Array} folders - All folders.
 * @param {number|null} activeFolderId - Current active folder ID or null for root.
 * @param {string} targetLanguage - Active target language (e.g. 'de').
 * @returns {Array} Decks within scope.
 */
export const getScopedDecks = (decks, folders, activeFolderId, targetLanguage = 'de') => {
  if (!decks || !Array.isArray(decks)) return [];
  const lang = (targetLanguage || 'de').toLowerCase();

  if (activeFolderId !== null && activeFolderId !== undefined) {
    const scopeFolderIds = new Set(getFolderDescendantIds(folders, activeFolderId));
    return decks.filter(d => scopeFolderIds.has(d.folder_id));
  }

  return decks.filter(d => (d.target_language || 'de').toLowerCase() === lang);
};

/**
 * Returns all folders within the active scope.
 *
 * @param {Array} folders - All folders.
 * @param {number|null} activeFolderId - Current active folder ID or null for root.
 * @param {string} targetLanguage - Active target language (e.g. 'de').
 * @returns {Array} Folders within scope.
 */
export const getScopedFolders = (folders, activeFolderId, targetLanguage = 'de') => {
  if (!folders || !Array.isArray(folders)) return [];
  const lang = (targetLanguage || 'de').toLowerCase();

  if (activeFolderId !== null && activeFolderId !== undefined) {
    const scopeFolderIds = new Set(getFolderDescendantIds(folders, activeFolderId));
    return folders.filter(f => scopeFolderIds.has(f.id) && f.id !== activeFolderId);
  }

  return folders.filter(f => (f.target_language || 'de').toLowerCase() === lang);
};

/**
 * Matches a deck against a search query across name and description.
 *
 * @param {object} deck - The deck object.
 * @param {string} query - The search query.
 * @returns {boolean} True if deck matches query.
 */
export const matchDeck = (deck, query) => {
  if (!query || !query.trim()) return true;
  if (!deck) return false;

  const fields = [deck.name, deck.description, deck.topic, deck.level];
  return fields.some(field => matchesSearchQuery(field, query));
};

/**
 * Matches a folder against a search query across name.
 *
 * @param {object} folder - The folder object.
 * @param {string} query - The search query.
 * @returns {boolean} True if folder matches query.
 */
export const matchFolder = (folder, query) => {
  if (!query || !query.trim()) return true;
  if (!folder) return false;

  return matchesSearchQuery(folder.name, query);
};

/**
 * Generic filter function that filters an array of items by query.
 *
 * @param {Array} items - The list of items to filter.
 * @param {string} query - The search query.
 * @param {Function} [customMatchFn] - Optional custom match function `(item, query) => boolean`.
 * @returns {Array} Filtered list of items.
 */
export const filterItems = (items, query, customMatchFn) => {
  if (!items || !Array.isArray(items)) return [];
  if (!query || !query.trim()) return items;

  if (typeof customMatchFn === 'function') {
    return items.filter(item => customMatchFn(item, query));
  }

  return items.filter(item => {
    if (typeof item === 'string') return matchesSearchQuery(item, query);
    if (typeof item === 'object' && item !== null) {
      return Object.values(item).some(val => typeof val === 'string' && matchesSearchQuery(val, query));
    }
    return false;
  });
};
