import { getUserProfile } from '../utils/auth';
import { useDeckStore } from '../store/useDeckStore';
import { BUNDESLAENDER } from '../data/bundeslaender';

export const LID_FOLDER_NAME = 'Leben in Deutschland';

/**
 * Checks if current user is aruna27
 */
export const isLidUser = () => {
  try {
    const profile = getUserProfile();
    if (!profile) return false;
    const username = (profile.username || '').toLowerCase();
    const firstName = (profile.first_name || '').toLowerCase();
    return username === 'aruna27' || firstName === 'aruna27' || profile.user_id === 121;
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
 * Ensures 'Leben in Deutschland' folder and 16 empty Bundesland decks exist for aruna27
 */
export const ensureLidStructureForUser = async () => {
  if (!isLidUser()) return;

  const deckState = useDeckStore.getState();
  const folders = deckState.folders || [];
  const decks = deckState.decks || [];

  // 1. Find or create root 'Leben in Deutschland' folder
  let rootLidFolder = folders.find(f => f.name === LID_FOLDER_NAME && (f.parent_id === null || f.parent_id === undefined));

  if (!rootLidFolder) {
    try {
      await deckState.createFolder(LID_FOLDER_NAME, null, '#ffd043', 'de');
      const refreshedFolders = useDeckStore.getState().folders || [];
      rootLidFolder = refreshedFolders.find(f => f.name === LID_FOLDER_NAME && (f.parent_id === null || f.parent_id === undefined));
    } catch (err) {
      console.warn('Could not auto-create root LiD folder:', err);
      return;
    }
  }

  if (!rootLidFolder) return;

  // 2. Check and create 16 empty Bundesländer decks inside rootLidFolder
  const currentChildDecks = (useDeckStore.getState().decks || []).filter(d => d.folder_id === rootLidFolder.id);
  const existingDeckNames = new Set(currentChildDecks.map(d => d.name.toLowerCase()));

  for (const land of BUNDESLAENDER) {
    const expectedName = land.nameDe;
    if (!existingDeckNames.has(expectedName.toLowerCase())) {
      try {
        await deckState.createDeck(expectedName, rootLidFolder.id, 'de', 'standard');
      } catch (err) {
        console.warn(`Could not create deck ${expectedName}:`, err);
      }
    }
  }
};
