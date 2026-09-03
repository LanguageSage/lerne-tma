import { getUserProfile } from '../utils/auth';
import { useDeckStore } from '../store/useDeckStore';
import { BUNDESLAENDER } from '../data/bundeslaender';
import lidQuestionsData from '../data/lidQuestions.json';
import api from './api';

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
 * Ensures 'Leben in Deutschland' folder and 16 Bundesland decks populated with 10 cards each exist for aruna27
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
    currentChildDecks = (useDeckStore.getState().decks || []).filter(d => d.folder_id === rootLidFolder.id);
  }

  // 3. Populate cards for any empty state decks
  const allQuestions = lidQuestionsData.questions || [];
  let hasPopulatedCards = false;

  for (const land of BUNDESLAENDER) {
    const targetDeck = currentChildDecks.find(d => d.name.toLowerCase() === land.nameDe.toLowerCase());
    const cardCount = targetDeck?.cards_count ?? targetDeck?.stats?.total ?? 0;

    if (targetDeck && cardCount === 0) {
      const stateQuestions = allQuestions.filter(
        q => q.block === 'state' && q.stateCode?.toUpperCase() === land.code.toUpperCase()
      );

      if (stateQuestions.length > 0) {
        const payloadCards = stateQuestions.map(q => {
          const optionsText = q.options.map(opt => {
            return opt.id === q.correctOption ? `*${opt.text}` : opt.text;
          }).join('\n');

          const front = `${q.question}\n\n${optionsText}`;
          const backRu = q.translationRu?.question || '';
          const contextNote = q.context ? `\n\n💡 ${q.context}` : '';
          const back = `${backRu}${contextNote}`.trim();

          return {
            deck_id: targetDeck.id,
            front,
            back,
            card_type: 'quiz',
            level: 'B1',
            media_url: q.image || null
          };
        });

        try {
          await api.post('/cards/bulk-save', { cards: payloadCards });
          hasPopulatedCards = true;
        } catch (err) {
          console.warn(`Could not bulk save cards for ${land.nameDe}:`, err);
        }
      }
    }
  }

  if (hasPopulatedCards) {
    await deckState.fetchDecks(true);
  }
};
