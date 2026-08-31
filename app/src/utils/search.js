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
 * Matches a flashcard against a search query across front, back, context, notes, and tags.
 *
 * @param {object} card - The card object.
 * @param {string} query - The search query.
 * @returns {boolean} True if card matches query.
 */
export const matchCard = (card, query) => {
  if (!query || !query.trim()) return true;
  if (!card) return false;

  const fields = [
    card.front,
    card.back,
    card.context,
    card.notes,
    card.tags ? (Array.isArray(card.tags) ? card.tags.join(' ') : card.tags) : ''
  ];

  return fields.some(field => matchesSearchQuery(field, query));
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
