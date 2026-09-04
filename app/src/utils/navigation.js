import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useLanguageStore } from '../store/useLanguageStore';

/**
 * Navigates strictly ONE level up in the application hierarchy:
 * - Level 4 (Modals): Closes the active modal, stays on current view.
 * - Level 3 (Study / Trainer / Editor / Creator): Exits to Deck Cards list or Duplicates.
 * - Level 2 (Cards / Duplicates / Trash): Exits to Decks view.
 * - Level 1 (Decks in subfolder): Exits to parent folder or root.
 * - Level 0 (Root decks): At top level.
 * 
 * @returns {boolean} true if navigated up, false if already at root.
 */
export const navigateUp = () => {
  const uiState = useUiStore.getState();
  const deckState = useDeckStore.getState();
  const session = useSessionStore.getState();
  const langState = useLanguageStore.getState();

  // 1. Any Modal Open -> Close modal
  const isAnyModalOpen = Boolean(
    uiState.isSettingsOpen ||
    uiState.isNewDeckModalOpen ||
    uiState.isRenameModalOpen ||
    uiState.isCardActionModalOpen ||
    uiState.isAuthModalOpen ||
    uiState.isBatchModalOpen ||
    uiState.isCollaboratorsModalOpen ||
    uiState.importShareId ||
    deckState.syncModalOpen ||
    langState.isLanguageModalOpen
  );

  if (isAnyModalOpen) {
    uiState.setIsSettingsOpen(false);
    uiState.setIsNewDeckModalOpen(false);
    uiState.setIsRenameModalOpen(false);
    uiState.setIsCardActionModalOpen(false);
    uiState.setIsAuthModalOpen(false);
    uiState.setIsBatchModalOpen(false);
    uiState.setIsCollaboratorsModalOpen(false);
    uiState.clearImportShareId();
    deckState.setSyncModalOpen(false);
    langState.setLanguageModalOpen(false);
    return true;
  }

  // 2. Study or Trainer mode -> Return to Cards list or Duplicates
  if (uiState.view === 'study' || uiState.view === 'trainer') {
    session.stopAutoplay?.();
    if (session.card?.id) {
      if (deckState.currentDeck?.id === 'duplicates') {
        deckState.setLastDuplicateCardId(session.card.id);
      } else {
        uiState.setLastSelectedCardId(session.card.id);
      }
    }
    const targetView = deckState.currentDeck?.id === 'duplicates' ? 'duplicates' : 'cards';
    uiState.setView(targetView);
    session.resetSession();
    return true;
  }

  // 3. Card Editor or Creator -> Return to source view
  if (uiState.view === 'editor' || uiState.view === 'creator') {
    uiState.setView(uiState.editorSourceView || 'cards');
    return true;
  }

  // 4. Cards list, Duplicates, or Trash -> Return to Decks grid
  if (uiState.view === 'cards' || uiState.view === 'duplicates' || uiState.view === 'trash') {
    uiState.setView('decks');
    return true;
  }

  // 5. Decks grid inside a folder -> Return to parent folder or root
  if (uiState.view === 'decks' && uiState.activeFolderId !== null) {
    const activeFolder = deckState.folders?.find(f => f.id === uiState.activeFolderId);
    const parentId = activeFolder ? (activeFolder.parent_id || null) : null;
    uiState.setActiveFolderId(parentId);
    return true;
  }

  // 6. Already at root level
  return false;
};
