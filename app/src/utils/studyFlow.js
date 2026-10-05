// Decks are already ordered by the store. Share the grid's visibility rule.
export const getThemeDecks = (decks, folderId, language = 'de') => decks.filter(deck =>
  !deck.is_deleted && Number.isInteger(deck.id) && !deck.is_pseudo &&
  (deck.folder_id ?? null) === (folderId ?? null) &&
  (folderId != null || (deck.target_language || 'de') === language)
);

export const getNextThemeDeck = (decks, currentDeck) => {
  if (currentDeck?.folder_id == null) return null;
  const theme = getThemeDecks(decks, currentDeck.folder_id);
  const index = theme.findIndex(deck => deck.id === currentDeck.id);
  return index < 0 ? null : theme[index + 1] || null;
};

export const isLastThemeDeck = (decks, currentDeck) => {
  if (currentDeck?.folder_id == null) return false;
  const theme = getThemeDecks(decks, currentDeck.folder_id);
  return theme.length > 0 && theme.at(-1).id === currentDeck.id;
};
