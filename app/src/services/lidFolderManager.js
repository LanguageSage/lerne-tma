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
  if (!folder) return false;
  return folder.name === LID_FOLDER_NAME;
};

/**
 * Ensures 'Leben in Deutschland' folder and 16 Bundesland decks exist for user
 */
export const ensureLidStructureForUser = async () => {
  if (!isLidUser()) return;

  const deckState = useDeckStore.getState();
  let folders = deckState.folders || [];

  // 1. Find or create root 'Leben in Deutschland' folder
  let rootLidFolder = folders.find(f => f.name === LID_FOLDER_NAME && (f.parent_id === null || f.parent_id === undefined));

  if (!rootLidFolder) {
    try {
      await deckState.createFolder(LID_FOLDER_NAME, null, '#ffd043', 'de');
      await deckState.fetchFolders();
      folders = useDeckStore.getState().folders || [];
      rootLidFolder = folders.find(f => f.name === LID_FOLDER_NAME && (f.parent_id === null || f.parent_id === undefined));
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
};

