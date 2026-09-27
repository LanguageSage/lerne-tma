import { useCallback, useMemo } from 'react';
import { getUserId } from '../utils/auth';

/**
 * Module-level storage for pending import entries.
 * Survives React re-renders and provides a write-through cache over localStorage.
 * Key format: lerne_bulk_import_{userId}_{deckId}
 */
const pendingInMemory = new Map();

const importStorageKey = (deckId) =>
  `lerne_bulk_import_${getUserId() || 'anon'}_${deckId}`;

const readPendingImports = (deckId) => {
  const key = importStorageKey(deckId);
  if (pendingInMemory.has(key)) return pendingInMemory.get(key);
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return pendingInMemory.get(key) || [];
  }
};

const writePendingImports = (deckId, entries) => {
  const key = importStorageKey(deckId);
  pendingInMemory.set(key, entries);
  try {
    if (entries.length) localStorage.setItem(key, JSON.stringify(entries));
    else localStorage.removeItem(key);
  } catch { /* Keep the retry in memory when storage is unavailable. */ }
};

/**
 * Hook that exposes idempotent pending-import helpers for a given deck.
 * All returned functions are stable (memoized) as long as deckId doesn't change,
 * so the object is safe to include in useEffect dependency arrays.
 *
 * @param {string|number|undefined} deckId
 * @returns {{
 *   read:       () => Array,
 *   add:        (entry: object) => void,
 *   remove:     (importId: string) => void,
 *   findByText: (rawText: string) => object|undefined,
 *   last:       () => object|undefined,
 * }}
 */
export function usePendingImport(deckId) {
  const read = useCallback(
    () => (deckId ? readPendingImports(deckId) : []),
    [deckId]
  );

  const add = useCallback(
    (entry) => {
      if (!deckId) return;
      writePendingImports(deckId, [...readPendingImports(deckId), entry]);
    },
    [deckId]
  );

  const remove = useCallback(
    (importId) => {
      if (!deckId) return;
      writePendingImports(
        deckId,
        readPendingImports(deckId).filter((e) => e.import_id !== importId)
      );
    },
    [deckId]
  );

  const findByText = useCallback(
    (rawText) => (deckId ? readPendingImports(deckId).find((e) => e.rawText === rawText) : undefined),
    [deckId]
  );

  const last = useCallback(
    () => (deckId ? readPendingImports(deckId).at(-1) : undefined),
    [deckId]
  );

  return useMemo(
    () => ({ read, add, remove, findByText, last }),
    [read, add, remove, findByText, last]
  );
}
