import { db } from './localDb';
import { calculateCardReview } from '../utils/srsEngine';
import { getUserId } from '../utils/auth';

export const offlineApi = {
  async handle(method, rawUrl, data = null) {
    const url = rawUrl.replace(/\?.*$/, ''); // Strip query params
    const m = method.toLowerCase();

    const userId = getUserId();

    // 1. GET /init -> Return local decks, folders, settings
    if (m === 'get' && url === '/init') {
      const decks = await db.decks.filter(d => !d.is_deleted).toArray();
      const folders = await db.folders.filter(f => !f.is_deleted).toArray();
      return {
        data: {
          decks,
          folders,
          settings: {},
          prompts: {},
          user_info: { is_guest: true, has_selected_language: true }
        }
      };
    }

    // 2. GET /decks -> Return local decks
    if (m === 'get' && url === '/decks') {
      const decks = await db.decks.filter(d => !d.is_deleted).toArray();
      return { data: decks };
    }

    // 3. GET /folders -> Return local folders
    if (m === 'get' && url === '/folders') {
      const folders = await db.folders.filter(f => !f.is_deleted).toArray();
      return { data: folders };
    }

    // 4. GET /study/card/:id -> Return specific card by ID
    if (m === 'get' && url.startsWith('/study/card/')) {
      const cardId = url.replace('/study/card/', '');
      const numId = parseInt(cardId, 10);
      const card = await db.cards.get(isNaN(numId) ? cardId : numId);
      if (card) {
        return {
          data: {
            id: card.id,
            deck_id: card.deck_id,
            front: card.front_text || card.front,
            back: card.back_text || card.back,
            context: card.context,
            image_url: card.image_path || card.image_url,
            audio_url: card.audio_path || card.audio_url,
            flag: card.flag || 0
          }
        };
      }
      throw new Error(`Card ${cardId} not found in local DB`);
    }

    // 5. POST /study/grade or POST /study/duplicates/grade -> Process card rating offline
    if (m === 'post' && (url === '/study/grade' || url === '/study/duplicates/grade')) {
      const { card_id, deck_id, grade } = data || {};
      const cardNumId = parseInt(card_id, 10);
      const targetCardId = isNaN(cardNumId) ? card_id : cardNumId;

      // Fetch local progress or create default
      let progress = await db.progress.get([targetCardId, userId]);
      if (!progress) {
        progress = { card_id: targetCardId, user_id: userId, queue: 'new', ease_factor: 2.5, interval: 0, lapses: 0, repetitions: 0 };
      }

      // Calculate SRS review state
      const updatedProgress = calculateCardReview(progress, grade);
      await db.progress.put(updatedProgress);

      // Find remaining cards in this deck
      const deckCards = await db.cards.where('deck_id').equals(deck_id).filter(c => !c.is_deleted).toArray();
      const remainingCards = deckCards.filter(c => c.id !== targetCardId);

      if (remainingCards.length === 0) {
        return { data: { finished: true } };
      }

      // Pick next card
      const nextCard = remainingCards[Math.floor(Math.random() * remainingCards.length)];
      return {
        data: {
          finished: false,
          id: nextCard.id,
          deck_id: nextCard.deck_id,
          front: nextCard.front_text || nextCard.front,
          back: nextCard.back_text || nextCard.back,
          context: nextCard.context,
          image_url: nextCard.image_path || nextCard.image_url,
          audio_url: nextCard.audio_path || nextCard.audio_url,
          flag: nextCard.flag || 0
        }
      };
    }

    // Default fallback
    throw new Error(`Offline endpoint not implemented: [${method.toUpperCase()}] ${rawUrl}`);
  }
};
