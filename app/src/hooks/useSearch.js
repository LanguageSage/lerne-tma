import { useState, useMemo, useCallback } from 'react';
import { filterItems } from '../utils/search';

/**
 * Custom hook for managing search state and filtering list of items.
 *
 * @param {object} options
 * @param {Array} options.items - The source list of items.
 * @param {Function} [options.matchFn] - Custom function `(item, query) => boolean`.
 * @param {string} [options.initialQuery=''] - Initial query string.
 * @returns {object} Search state and utilities.
 */
export const useSearch = ({ items = [], matchFn, initialQuery = '' } = {}) => {
  const [query, setQuery] = useState(initialQuery);

  const filteredItems = useMemo(() => {
    return filterItems(items, query, matchFn);
  }, [items, query, matchFn]);

  const clearQuery = useCallback(() => {
    setQuery('');
  }, []);

  const isSearching = Boolean(query && query.trim());

  return {
    query,
    setQuery,
    clearQuery,
    filteredItems,
    isSearching,
    count: filteredItems.length,
    total: Array.isArray(items) ? items.length : 0
  };
};
