import { useUiStore } from '../store/useUiStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { useLidStore } from '../store/useLidStore';

/**
 * Navigates strictly ONE level up in the application hierarchy:
 * - Level 4 (Modals): Closes the active modal, stays on current view.
 * - Level 3 (Study / Trainer / Editor / Creator / LiD Exam): Exits to Deck Cards list, Duplicates, or LiD menu.
 * - Level 2 (Cards / Duplicates / Trash / LiD Menu): Exits to Decks view (in containing folder or root).
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
  const lidState = useLidStore?.getState?.();

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
    langState.isLanguageModalOpen ||
    lidState?.isLandModalOpen ||
    lidState?.selectedMistakeCard
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
    if (lidState?.isLandModalOpen && lidState?.closeLandModal) lidState.closeLandModal();
    if (lidState?.selectedMistakeCard && lidState?.setSelectedMistakeCard) lidState.setSelectedMistakeCard(null);
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

  // 3b. LiD Exam View -> If in exam/results, return to LiD menu; if at menu, return to Decks
  if (uiState.view === 'lid_exam' || uiState.view === 'lid') {
    if (lidState && lidState.screen !== 'menu' && lidState.resetToMenu) {
      lidState.resetToMenu();
      return true;
    }
    uiState.setView('decks');
    return true;
  }

  // 4. Cards list, Duplicates, or Trash -> Return to Decks grid (into parent folder if cards in folder)
  if (uiState.view === 'cards' || uiState.view === 'duplicates' || uiState.view === 'trash') {
    if (uiState.view === 'cards' && deckState.currentDeck?.folder_id) {
      uiState.setActiveFolderId(deckState.currentDeck.folder_id);
    } else if (uiState.view === 'duplicates' || uiState.view === 'trash') {
      uiState.setActiveFolderId(null);
    }
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
