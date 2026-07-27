/**
 * Shared deck utility functions.
 * Replaces duplicated metadata parsing across DeckMediaModal, CardList, StudyView.
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
