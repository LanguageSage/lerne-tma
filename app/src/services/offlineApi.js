import { db } from './localDb';
import { calculateCardReview, getNextIntervals, isLeech } from '../utils/srsEngine';
import { getUserId } from '../utils/auth';

const getOfflineDeckStats = async (deckId, userId) => {
  try {
    const cards = await db.cards.where('deck_id').equals(deckId).filter(c => !c.is_deleted).toArray();
    const allProgress = await db.progress.where('user_id').equals(userId).toArray();
    const progressMap = new Map(allProgress.map(p => [p.card_id, p]));
    const now = new Date();
    let newCount = 0;
    let learningCount = 0;
    let dueCount = 0;

    cards.forEach(c => {
      const p = progressMap.get(c.id);
      const q = p?.queue || 'new';
      if (q === 'new') {
        newCount++;
      } else if (q === 'learning' || q === 'relearning') {
        learningCount++;
      } else if (q === 'review') {
        if (!p?.next_review || new Date(p.next_review) <= now) {
          dueCount++;
        }
      }
    });

    return {
      total: cards.length,
      new: newCount,
      learning: learningCount,
      due: dueCount
    };
  } catch (err) {
    console.warn("getOfflineDeckStats failed:", err);
    return { total: 0, new: 0, learning: 0, due: 0 };
  }
};

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

    // 4. GET /study/card/:id -> Return specific card by ID with SRS intervals
    if (m === 'get' && url.startsWith('/study/card/')) {
      const cardId = url.replace('/study/card/', '');
      const numId = parseInt(cardId, 10);
      const card = await db.cards.get(isNaN(numId) ? cardId : numId);
      if (card) {
        const progress = await db.progress.get([card.id, userId]);
        const deckStats = await getOfflineDeckStats(card.deck_id, userId);
        return {
          data: {
            id: card.id,
            deck_id: card.deck_id,
            front: card.front_text || card.front,
            back: card.back_text || card.back,
            context: card.context,
            level: card.level,
            tags: card.tags,
            image_url: card.image_path || card.image_url,
            audio_url: card.audio_path || card.audio_url,
            flag: card.flag || 0,
            intervals: getNextIntervals(progress),
            is_leech: isLeech(progress?.lapses || 0),
            lapses: progress?.lapses || 0,
            queue: progress?.queue || 'new',
            interval: progress?.interval || 0,
            deck_stats: deckStats
          }
        };
      }
      throw new Error(`Card ${cardId} not found in local DB`);
    }

    // 4.1. POST /cards/save -> Save card to local DB offline
    if (m === 'post' && url === '/cards/save') {
      const cardData = data || {};
      const rawCardId = cardData.card_id || cardData.id;
      const cardId = rawCardId || `temp_${Date.now()}`;
      
      const newCard = {
        id: cardId,
        deck_id: cardData.deck_id,
        front_text: cardData.front || cardData.front_text || '',
        back_text: cardData.back || cardData.back_text || '',
        context: cardData.context || '',
        level: cardData.level || null,
        tags: cardData.tags || null,
        image_path: cardData.image_path || '',
        audio_path: cardData.audio_path || '',
        video_front_path: cardData.video_front_path || '',
        video_back_path: cardData.video_back_path || '',
        flag: cardData.flag || 0,
        is_dirty: 1,
        updated_at: new Date().toISOString()
      };

      await db.cards.put(newCard);

      return {
        data: {
          id: newCard.id,
          deck_id: newCard.deck_id,
          front: newCard.front_text,
          back: newCard.back_text,
          context: newCard.context,
          level: newCard.level,
          tags: newCard.tags,
          image_url: newCard.image_path,
          audio_url: newCard.audio_path,
          flag: newCard.flag
        }
      };
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
      const nextCardProgress = await db.progress.get([nextCard.id, userId]);

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
          flag: nextCard.flag || 0,
          intervals: getNextIntervals(nextCardProgress),
          is_leech: isLeech(nextCardProgress?.lapses || 0),
          lapses: nextCardProgress?.lapses || 0,
          queue: nextCardProgress?.queue || 'new',
          interval: nextCardProgress?.interval || 0,
          deck_stats: await getOfflineDeckStats(nextCard.deck_id, userId)
        }
      };
    }

    // 6. GET /study/stats -> Offline SRS Statistics
    if (m === 'get' && url === '/study/stats') {
      const allCards = await db.cards.filter(c => !c.is_deleted).toArray();
      const allProgress = await db.progress.where('user_id').equals(userId).toArray();
      const progressMap = new Map(allProgress.map(p => [p.card_id, p]));

      let newCount = 0;
      let learningCount = 0;
      let youngCount = 0;
      let matureCount = 0;
      let leechCount = 0;

      const now = new Date();
      const forecastDays = [0, 0, 0, 0, 0, 0, 0];

      for (const card of allCards) {
        const p = progressMap.get(card.id);
        if (!p || p.queue === 'new') {
          newCount++;
        } else if (p.queue === 'learning' || p.queue === 'relearning') {
          learningCount++;
        } else if (p.queue === 'review') {
          if (p.interval >= 21) {
            matureCount++;
          } else {
            youngCount++;
          }
        }

        if (p && isLeech(p.lapses)) {
          leechCount++;
        }

        if (p && p.next_review) {
          const revDate = new Date(p.next_review);
          const diffDays = Math.floor((revDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays < 7) {
            forecastDays[diffDays]++;
          }
        }
      }

      return {
        data: {
          total_cards: allCards.length,
          new_cards: newCount,
          learning_cards: learningCount,
          young_cards: youngCount,
          mature_cards: matureCount,
          leech_cards: leechCount,
          retention_rate: 88.0,
          forecast_7d: forecastDays.map((count, idx) => {
            const d = new Date(now);
            d.setDate(d.getDate() + idx);
            return {
              day_index: idx,
              date: d.toISOString().split('T')[0],
              day_name: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()],
              count
            };
          })
        }
      };
    }

    // Default fallback
    throw new Error(`Offline endpoint not implemented: [${method.toUpperCase()}] ${rawUrl}`);
  }
};

