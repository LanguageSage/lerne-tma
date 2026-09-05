import { getUserProfile } from '../utils/auth';
import { useDeckStore } from '../store/useDeckStore';
import { BUNDESLAENDER } from '../data/bundeslaender';

export const LID_FOLDER_NAME = 'Leben in Deutschland';

/**
 * Checks if current user has access to LiD (all active users)
 */
export const isLidUser = () => {
  try {
    const profile = getUserProfile();
    return Boolean(profile && profile.user_id);
  } catch {
    return false;
  }
};

/**
 * Checks if a folder is the root 'Leben in Deutschland' folder
 */
export const isLidRootFolder = (folder) => {
  if (!folder || !folder.name) return false;
  const name = folder.name.trim().toLowerCase();
  return name === LID_FOLDER_NAME.toLowerCase() || name.includes('leben in deutschland');
};

let isEnsuringLid = false;

/**
 * Ensures 'Leben in Deutschland' folder and 16 Bundesland decks exist for user
 */
export const ensureLidStructureForUser = async () => {
  if (!isLidUser()) return;
  if (isEnsuringLid) return;
  isEnsuringLid = true;

  try {
    const deckState = useDeckStore.getState();
    let folders = deckState.folders;

    // If folders have not loaded yet from backend or localDb, do not create duplicate folders!
    if (!folders || folders.length === 0) return;

  // 1. Find existing root 'Leben in Deutschland' folder (case-insensitive)
  const matchingFolders = folders.filter(f => 
    !f.is_deleted &&
    isLidRootFolder(f) &&
    (f.parent_id === null || f.parent_id === undefined)
  );

  let rootLidFolder = null;
  if (matchingFolders.length > 0) {
    // If multiple exist, prioritize the one that contains decks to prevent using an empty ghost folder
    const allDecks = deckState.decks || [];
    matchingFolders.sort((a, b) => {
      const aCount = allDecks.filter(d => d.folder_id === a.id && !d.is_deleted).length;
      const bCount = allDecks.filter(d => d.folder_id === b.id && !d.is_deleted).length;
      return bCount - aCount;
    });
    rootLidFolder = matchingFolders[0];
  }

  if (!rootLidFolder) {
    try {
      await deckState.createFolder(LID_FOLDER_NAME, null, '#ffd043', 'de');
      await deckState.fetchFolders();
      folders = useDeckStore.getState().folders || [];
      rootLidFolder = folders.find(f => 
        !f.is_deleted &&
        isLidRootFolder(f) &&
        (f.parent_id === null || f.parent_id === undefined)
      );
    } catch (err) {
      console.warn('Could not auto-create root LiD folder:', err);
      return;
    }
  }

  if (!rootLidFolder) return;

  // 2. Fetch fresh decks to inspect existing decks inside rootLidFolder
  let currentChildDecks = (useDeckStore.getState().decks || []).filter(d => d.folder_id === rootLidFolder.id);
  let hasCreatedNew = false;

  for (const land of BUNDESLAENDER) {
    const expectedName = land.nameDe;
    let targetDeck = currentChildDecks.find(d => d.name.toLowerCase() === expectedName.toLowerCase());

    if (!targetDeck) {
      try {
        await deckState.createDeck(expectedName, rootLidFolder.id, 'de', 'quiz');
        hasCreatedNew = true;
      } catch (err) {
        console.warn(`Could not create deck ${expectedName}:`, err);
      }
    }
  }

  if (hasCreatedNew) {
    await deckState.fetchDecks(true);
  }
  } finally {
    isEnsuringLid = false;
  }
};
