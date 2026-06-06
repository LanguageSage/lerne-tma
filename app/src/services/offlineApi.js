import { db, getNextTempId } from './localDb';
import { getUserId } from '../utils/auth';

const INITIAL_EASE_FACTOR = 2.5;
const MINIMUM_EASE_FACTOR = 1.3;
const LEARNING_STEPS = [1, 10]; // in minutes
const RELEARN_STEPS = [10];     // in minutes
const GRADUATING_INTERVAL_GOOD = 1; // in days
const GRADUATING_INTERVAL_EASY = 4; // in days
const HARD_MULTIPLIER = 1.1;
const EASY_MULTIPLIER = 1.3;

// --- Helper Functions ---

// Formats intervals for study grading buttons
const formatInterval = (value, isDays = false) => {
  if (!isDays) {
    if (value < 60) return `${Math.round(value * 10) / 10} мин`;
    const hours = value / 60;
    if (hours < 24) return `${Math.floor(hours)} ч`;
    return `${Math.floor(hours / 24)} дн`;
  } else {
    if (value < 1) return "<1 дн";
    if (value < 30) return `${Math.floor(value)} дн`;
    const months = value / 30.0;
    if (months < 12) {
      return months % 1 !== 0 ? `${months.toFixed(1)} мес` : `${Math.floor(months)} мес`;
    }
    return `${(value / 365.0).toFixed(1)} г.`;
  }
};

// Computes next states for cards in learning queue
const calcLearningNextState = (progress, grade) => {
  const steps = progress.queue !== 'relearning' ? LEARNING_STEPS : RELEARN_STEPS;
  const stepIdx = progress.step_index ?? 0;

  if (grade === 0) { // Again
    return [progress.queue === 'new' ? 'learning' : progress.queue, steps[0], 0];
  } else if (grade === 1) { // Hard
    return [progress.queue, steps[stepIdx] * 1.5, stepIdx];
  } else if (grade === 2) { // Good
    if (stepIdx + 1 < steps.length) {
      return ['learning', steps[stepIdx + 1], stepIdx + 1];
    } else {
      return ['review', GRADUATING_INTERVAL_GOOD, null];
    }
  } else { // Easy
    return ['review', GRADUATING_INTERVAL_EASY, null];
  }
};

// Computes next states for cards in review queue
const calcReviewNextState = (progress, grade, now) => {
  const interval = progress.interval || 1;
  const ef = progress.ease_factor || INITIAL_EASE_FACTOR;

  let daysSinceDue = 0;
  if (progress.next_review && new Date(progress.next_review) < now) {
    daysSinceDue = Math.floor((now - new Date(progress.next_review)) / (1000 * 60 * 60 * 24));
  }

  if (grade === 0) { // Again
    return ['relearning', RELEARN_STEPS[0], 0, Math.max(MINIMUM_EASE_FACTOR, ef - 0.2), (progress.lapses || 0) + 1];
  } else if (grade === 1) { // Hard
    const newInt = Math.round(Math.max(interval, interval * HARD_MULTIPLIER));
    return ['review', newInt, null, Math.max(MINIMUM_EASE_FACTOR, ef - 0.15), progress.lapses || 0];
  } else if (grade === 2) { // Good
    const newInt = Math.round(Math.max(interval + 1, (interval + daysSinceDue / 2) * ef));
    return ['review', newInt, null, ef, progress.lapses || 0];
  } else { // Easy
    const newInt = Math.round(Math.max(interval + 1, (interval + daysSinceDue) * ef * EASY_MULTIPLIER));
    return ['review', newInt, null, ef + 0.15, progress.lapses || 0];
  }
};

// Generates next interval previews for study buttons
const getNextIntervals = (progress) => {
  const res = {};
  const now = new Date();
  const tempProgress = { ...progress };

  for (let grade = 0; grade < 4; grade++) {
    let isDays = false;
    let val = 0;

    if (['new', 'learning', 'relearning'].includes(tempProgress.queue || 'new')) {
      const [newQueue, nextVal] = calcLearningNextState(tempProgress, grade);
      val = nextVal;
      isDays = (newQueue === 'review');
    } else {
      const [newQueue, nextVal] = calcReviewNextState(tempProgress, grade, now);
      val = nextVal;
      isDays = (newQueue !== 'relearning');
    }

    res[grade] = formatInterval(val, isDays);
  }
  return res;
};

// Formats a card to the schema the frontend expects
const buildCardResponse = (card, progress) => {
  const prog = progress || { queue: 'new', interval: 0, next_review: new Date().toISOString() };
  return {
    id: card.id,
    front: card.front_text,
    back: card.back_text,
    context: card.context || '',
    audio_url: card.audio_path || '',
    audio_back_url: card.audio_back_path || '',
    image_url: card.image_path || '',
    video_front_url: card.video_front_path || '',
    video_back_url: card.video_back_path || '',
    audio_path: card.audio_path || '',
    audio_back_path: card.audio_back_path || '',
    video_front_path: card.video_front_path || '',
    video_back_path: card.video_back_path || '',
    intervals: getNextIntervals(prog),
    deck_id: card.deck_id,
    deck_name: card.deck_name || '',
    want_to_learn: !!card.want_to_learn,
    creator_name: card.creator_name || null,
    creator_avatar: card.creator_avatar || null,
  };
};

// Ensure Inbox deck exists for a user
const ensureInboxDeck = async (userId) => {
  const inbox = await db.decks.where({ user_id: userId, is_inbox: 1 }).first();
  if (!inbox) {
    const inboxId = getNextTempId();
    await db.decks.add({
      id: inboxId,
      user_id: userId,
      name: "📥 Входящие",
      is_inbox: 1,
      is_deleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_dirty: 1
    });
  }
};

// --- API Router Mock ---

export const offlineApi = {
  async handle(method, url, data) {
    const userId = getUserId();
    const nowStr = new Date().toISOString();

    // 0. GET /init (Offline Initialization)
    if (method === 'get' && url === '/init') {
      const decksRes = await this.handle('get', '/decks');
      return {
        data: {
          decks: decksRes.data,
          settings: {},
          prompts: { translation_prompt: "", context_prompt: "" }
        }
      };
    }

    // 1. GET /decks
    if (method === 'get' && url === '/decks') {
      await ensureInboxDeck(userId);
      const decks = await db.decks
        .where('user_id')
        .equals(userId)
        .filter(d => !d.is_deleted && !d.hard_deleted_locally)
        .toArray();

      // Sort with inbox first, then position, then desc
      decks.sort((a, b) => {
        const aInbox = a.is_inbox ? 1 : 0;
        const bInbox = b.is_inbox ? 1 : 0;
        if (aInbox !== bInbox) return bInbox - aInbox;
        const aPos = a.position ?? 0;
        const bPos = b.position ?? 0;
        if (aPos !== bPos) return aPos - bPos;
        return b.id - a.id;
      });

      const result = [];
      for (const d of decks) {
        const cards = await db.cards.where('deck_id').equals(d.id).filter(c => !c.is_deleted).toArray();
        const cardIds = cards.map(c => c.id);
        const progressList = await db.progress
          .where('user_id')
          .equals(userId)
          .filter(p => cardIds.includes(p.card_id))
          .toArray();

        const progressMap = {};
        progressList.forEach(p => { progressMap[p.card_id] = p; });

        const now = new Date();
        let due = 0;
        let tracked = 0;

        cards.forEach(c => {
          const p = progressMap[c.id];
          if (p) {
            tracked++;
            if (p.next_review && new Date(p.next_review) <= now) {
              due++;
            }
          }
        });

        result.push({
          id: d.id,
          name: d.name,
          level: d.level || '',
          topic: d.topic || '',
          is_inbox: !!d.is_inbox,
          has_updates: false,
          position: d.position || 0,
          folder_id: d.folder_id || null,
          stats: {
            total: cards.length,
            new: Math.max(0, cards.length - tracked),
            learning: 0,
            due: due
          }
        });
      }
      return { data: result };
    }

    // 1.5 POST /decks/reorder
    if (method === 'post' && url === '/decks/reorder') {
      const { deck_ids } = data;
      if (deck_ids && deck_ids.length > 0) {
        for (let idx = 0; idx < deck_ids.length; idx++) {
          const deckId = deck_ids[idx];
          const deck = await db.decks.get(deckId);
          if (deck && deck.user_id === userId) {
            await db.decks.update(deckId, { position: idx, is_dirty: 1 });
          }
        }
      }
      return { data: { status: "success" } };
    }

    // 2. POST /decks (Create Deck)
    if (method === 'post' && url === '/decks') {
      const tempId = getNextTempId();
      const newDeck = {
        id: tempId,
        user_id: userId,
        name: data.name,
        is_deleted: 0,
        is_inbox: 0,
        created_at: nowStr,
        updated_at: nowStr,
        is_dirty: 1
      };
      await db.decks.add(newDeck);
      return { data: { status: "success", id: tempId } };
    }

    // 3. POST /decks/{id}/rename
    if (method === 'post' && url.match(/^\/decks\/(-?\d+)\/rename$/)) {
      const deckId = parseInt(url.match(/^\/decks\/(-?\d+)\/rename$/)[1], 10);
      const deck = await db.decks.get(deckId);
      if (!deck || deck.user_id !== userId) {
        throw new Error("Deck not found or access denied");
      }
      if (deck.is_inbox) {
        throw new Error("Cannot rename Inbox deck");
      }
      await db.decks.update(deckId, {
        name: data.name,
        updated_at: nowStr,
        is_dirty: 1
      });
      return { data: { status: "success", name: data.name } };
    }

    // 4. DELETE /decks/{id}
    if (method === 'delete' && url.match(/^\/decks\/(-?\d+)$/)) {
      const deckId = parseInt(url.match(/^\/decks\/(-?\d+)$/)[1], 10);
      const deck = await db.decks.get(deckId);
      if (deck) {
        await db.decks.update(deckId, {
          is_deleted: 1,
          updated_at: nowStr,
          is_dirty: 1
        });
        const cards = await db.cards.where('deck_id').equals(deckId).toArray();
        for (const c of cards) {
          await db.cards.update(c.id, {
            is_deleted: 1,
            updated_at: nowStr,
            is_dirty: 1
          });
        }
      }
      return { data: { status: "success" } };
    }

    // 5. GET /decks/{id}/cards
    if (method === 'get' && url.match(/^\/decks\/(-?\d+)\/cards$/)) {
      const deckId = parseInt(url.match(/^\/decks\/(-?\d+)\/cards$/)[1], 10);
      const deck = await db.decks.get(deckId);
      const deckName = deck ? deck.name : '';

      const cards = await db.cards
        .where('deck_id')
        .equals(deckId)
        .filter(c => !c.is_deleted)
        .toArray();

      // Sort by ID asc
      cards.sort((a, b) => a.id - b.id);

      const cardIds = cards.map(c => c.id);
      const progressList = await db.progress
        .where('user_id')
        .equals(userId)
        .filter(p => cardIds.includes(p.card_id))
        .toArray();

      const progressMap = {};
      progressList.forEach(p => { progressMap[p.card_id] = p; });

      const result = cards.map(c => {
        const p = progressMap[c.id];
        return {
          id: c.id,
          deck_id: c.deck_id,
          deck_name: deckName,
          front: c.front_text,
          back: c.back_text,
          context: c.context || '',
          audio_url: c.audio_path || '',
          audio_back_url: c.audio_back_path || '',
          image_url: c.image_path || '',
          video_front_url: c.video_front_path || '',
          video_back_url: c.video_back_path || '',
          want_to_learn: !!c.want_to_learn,
          queue: p ? p.queue : 'new',
          interval: p ? p.interval : 0,
          next_review: p ? p.next_review : null
        };
      });

      return { data: result };
    }

    // 6. GET /decks/{id}/next (Study Next Card)
    if (method === 'get' && url.match(/^\/decks\/(-?\d+)\/next$/)) {
      const deckId = parseInt(url.match(/^\/decks\/(-?\d+)\/next$/)[1], 10);
      const parsedUrl = new URL(url, 'http://localhost');
      const excludeIds = (parsedUrl.searchParams.get('exclude_ids') || '')
        .split(',')
        .map(i => parseInt(i, 10))
        .filter(i => !isNaN(i));
      const learnMore = parsedUrl.searchParams.get('learn_more') === 'true';

      const deck = await db.decks.get(deckId);
      const deckName = deck ? deck.name : '';

      const cards = await db.cards
        .where('deck_id')
        .equals(deckId)
        .filter(c => !c.is_deleted && !excludeIds.includes(c.id))
        .toArray();

      if (cards.length === 0) {
        return { data: { finished: true } };
      }

      const cardIds = cards.map(c => c.id);
      const progressList = await db.progress
        .where('user_id')
        .equals(userId)
        .filter(p => cardIds.includes(p.card_id))
        .toArray();

      const progressMap = {};
      progressList.forEach(p => { progressMap[p.card_id] = p; });

      const now = new Date();

      // Find due cards: tracked progress where next_review <= now (or any next_review if learnMore)
      const dueCardsWithProgress = [];
      const newCards = [];

      cards.forEach(c => {
        const p = progressMap[c.id];
        if (p) {
          if (learnMore || (p.next_review && new Date(p.next_review) <= now)) {
            dueCardsWithProgress.push({ card: c, progress: p });
          }
        } else {
          newCards.push(c);
        }
      });

      let nextCard = null;
      let nextProgress = null;

      if (learnMore) {
        // In learn_more mode, prioritize new cards first
        if (newCards.length > 0) {
          nextCard = newCards[0];
        } else if (dueCardsWithProgress.length > 0) {
          // Sort by queue (new/learning/review) and next_review asc
          dueCardsWithProgress.sort((a, b) => {
            const queueOrder = { new: 0, learning: 1, relearning: 2, review: 3 };
            const qA = queueOrder[a.progress.queue] ?? 99;
            const qB = queueOrder[b.progress.queue] ?? 99;
            return qA - qB || new Date(a.progress.next_review) - new Date(b.progress.next_review);
          });
          nextCard = dueCardsWithProgress[0].card;
          nextProgress = dueCardsWithProgress[0].progress;
        }
      } else {
        // Normal SRS: prioritize due cards first
        if (dueCardsWithProgress.length > 0) {
          dueCardsWithProgress.sort((a, b) => {
            const queueOrder = { new: 0, learning: 1, relearning: 2, review: 3 };
            const qA = queueOrder[a.progress.queue] ?? 99;
            const qB = queueOrder[b.progress.queue] ?? 99;
            return qA - qB || new Date(a.progress.next_review) - new Date(b.progress.next_review);
          });
          nextCard = dueCardsWithProgress[0].card;
          nextProgress = dueCardsWithProgress[0].progress;
        } else if (newCards.length > 0) {
          nextCard = newCards[0];
        }
      }

      if (!nextCard) {
        return { data: { finished: true } };
      }

      if (!nextProgress) {
        nextProgress = {
          card_id: nextCard.id,
          user_id: userId,
          queue: 'new',
          interval: 0,
          ease_factor: INITIAL_EASE_FACTOR,
          repetitions: 0,
          lapses: 0,
          step_index: 0,
          next_review: now.toISOString(),
          created_at: nowStr,
          updated_at: nowStr,
          is_dirty: 1
        };
        await db.progress.put(nextProgress);
      }

      nextCard.deck_name = deckName;
      return { data: buildCardResponse(nextCard, nextProgress) };
    }

    // 7. GET /study/card/{card_id}
    if (method === 'get' && url.match(/^\/study\/card\/(-?\d+)$/)) {
      const cardId = parseInt(url.match(/^\/study\/card\/(-?\d+)$/)[1], 10);
      const card = await db.cards.get(cardId);
      if (!card) {
        throw new Error("Card not found");
      }
      const deck = await db.decks.get(card.deck_id);
      card.deck_name = deck ? deck.name : '';

      let progress = await db.progress.get([cardId, userId]);
      if (!progress) {
        progress = {
          card_id: cardId,
          user_id: userId,
          queue: 'new',
          interval: 0,
          ease_factor: INITIAL_EASE_FACTOR,
          repetitions: 0,
          lapses: 0,
          step_index: 0,
          next_review: nowStr,
          created_at: nowStr,
          updated_at: nowStr,
          is_dirty: 1
        };
        await db.progress.put(progress);
      }
      return { data: buildCardResponse(card, progress) };
    }

    // 8. POST /study/grade (Grade and get next)
    if (method === 'post' && url === '/study/grade') {
      const { card_id, deck_id, grade, learn_more } = data;
      const progress = await db.progress.get([card_id, userId]);
      const now = new Date();

      if (progress) {
        let newQueue, newInterval, newStep, newEase, newLapses;

        if (['new', 'learning', 'relearning'].includes(progress.queue || 'new')) {
          [newQueue, newInterval, newStep] = calcLearningNextState(progress, grade);
          progress.queue = newQueue;
          progress.interval = newInterval;
          progress.step_index = newStep;

          if (newQueue === 'review') {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + newInterval);
            progress.next_review = nextDate.toISOString();
            progress.repetitions = (progress.repetitions || 0) + 1;
          } else {
            const nextDate = new Date();
            nextDate.setMinutes(nextDate.getMinutes() + newInterval);
            progress.next_review = nextDate.toISOString();
          }
        } else {
          [newQueue, newInterval, newStep, newEase, newLapses] = calcReviewNextState(progress, grade, now);
          progress.queue = newQueue;
          progress.interval = newInterval;
          progress.step_index = newStep;
          progress.ease_factor = newEase;
          progress.lapses = newLapses;

          if (newQueue === 'relearning') {
            const nextDate = new Date();
            nextDate.setMinutes(nextDate.getMinutes() + newInterval);
            progress.next_review = nextDate.toISOString();
          } else {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + newInterval);
            progress.next_review = nextDate.toISOString();
            progress.repetitions = (progress.repetitions || 0) + 1;
          }
        }

        progress.last_reviewed = nowStr;
        progress.updated_at = nowStr;
        progress.is_dirty = 1;

        await db.progress.put(progress);
      }

      // Fetch next card immediately
      const nextRes = await this.handle('get', `/decks/${deck_id}/next?learn_more=${!!learn_more}`);
      return nextRes;
    }

    // 9. POST /cards/save (Create or update card)
    if (method === 'post' && url === '/cards/save') {
      const cardId = data.card_id || data.id;
      let card = null;

      if (cardId) {
        card = await db.cards.get(cardId);
      }

      if (card) {
        // Update
        const updates = {
          front_text: data.front !== undefined ? data.front : card.front_text,
          back_text: data.back !== undefined ? data.back : card.back_text,
          context: data.context !== undefined ? data.context : card.context,
          image_path: data.image_path !== undefined ? data.image_path : card.image_path,
          audio_path: data.audio_path !== undefined ? data.audio_path : card.audio_path,
          audio_back_path: data.audio_back_path !== undefined ? data.audio_back_path : card.audio_back_path,
          updated_at: nowStr,
          is_dirty: 1
        };
        if (data.want_to_learn !== undefined) {
          updates.want_to_learn = !!data.want_to_learn;
        }
        if (data.deck_id !== undefined && data.deck_id !== 'duplicates') {
          updates.deck_id = parseInt(data.deck_id, 10);
        }
        await db.cards.update(cardId, updates);
        card = { ...card, ...updates };
      } else {
        // Create
        const tempId = getNextTempId();
        card = {
          id: tempId,
          deck_id: parseInt(data.deck_id, 10) || null,
          front_text: data.front || '',
          back_text: data.back || '',
          context: data.context || '',
          image_path: data.image_path || '',
          audio_path: data.audio_path || '',
          audio_back_path: data.audio_back_path || '',
          card_type: 'translation',
          is_deleted: 0,
          want_to_learn: !!data.want_to_learn,
          created_at: nowStr,
          updated_at: nowStr,
          is_dirty: 1
        };
        await db.cards.add(card);
      }

      const deck = await db.decks.get(card.deck_id);
      card.deck_name = deck ? deck.name : '';

      const progress = await db.progress.get([card.id, userId]);
      return { data: buildCardResponse(card, progress) };
    }

    // 10. DELETE /cards/{id}
    if (method === 'delete' && url.match(/^\/cards\/(-?\d+)$/)) {
      const cardId = parseInt(url.match(/^\/cards\/(-?\d+)$/)[1], 10);
      const card = await db.cards.get(cardId);
      if (card) {
        await db.cards.update(cardId, {
          is_deleted: 1,
          updated_at: nowStr,
          is_dirty: 1
        });
      }
      return { data: { status: "success" } };
    }

    // 11. POST /cards/{id}/toggle-learn
    if (method === 'post' && url.match(/^\/cards\/(-?\d+)\/toggle-learn$/)) {
      const cardId = parseInt(url.match(/^\/cards\/(-?\d+)\/toggle-learn$/)[1], 10);
      const card = await db.cards.get(cardId);
      if (!card) {
        throw new Error("Card not found");
      }
      const newStatus = !card.want_to_learn;
      await db.cards.update(cardId, {
        want_to_learn: newStatus,
        updated_at: nowStr,
        is_dirty: 1
      });
      card.want_to_learn = newStatus;
      return { data: { id: cardId, want_to_learn: newStatus } };
    }

    // 12. POST /decks/{id}/reset (Reset progress)
    if (method === 'post' && url.match(/^\/decks\/(-?\d+)\/reset$/)) {
      const deckId = parseInt(url.match(/^\/decks\/(-?\d+)\/reset$/)[1], 10);
      const cards = await db.cards.where('deck_id').equals(deckId).toArray();
      const cardIds = cards.map(c => c.id);

      for (const cardId of cardIds) {
        await db.progress.delete([cardId, userId]);
        // Also add a marked item or sync flag so the server knows we reset progress.
        // Wait, for simplicity, we'll delete the progress locally and we can push progress deletions
        // or just let the sync service handle it. We will mark a sync metadata row if needed,
        // or during sync we'll let the server know we reset it.
      }
      return { data: { status: "success" } };
    }

    // 13. GET /trash
    if (method === 'get' && url === '/trash') {
      const deletedDecks = await db.decks
        .where('user_id')
        .equals(userId)
        .filter(d => !!d.is_deleted && !d.hard_deleted_locally)
        .toArray();

      const deletedCards = await db.cards
        .filter(c => !!c.is_deleted && !c.hard_deleted_locally)
        .toArray();

      return {
        data: {
          decks: deletedDecks.map(d => ({
            id: d.id,
            name: d.name,
            updated_at: d.updated_at
          })),
          cards: deletedCards.map(c => ({
            id: c.id,
            front: c.front_text,
            back: c.back_text,
            updated_at: c.updated_at
          }))
        }
      };
    }

    // 14. POST /trash/deck/{id}/restore
    if (method === 'post' && url.match(/^\/trash\/deck\/(-?\d+)\/restore$/)) {
      const deckId = parseInt(url.match(/^\/trash\/deck\/(-?\d+)\/restore$/)[1], 10);
      await db.decks.update(deckId, {
        is_deleted: 0,
        updated_at: nowStr,
        is_dirty: 1
      });
      const cards = await db.cards.where('deck_id').equals(deckId).toArray();
      for (const c of cards) {
        await db.cards.update(c.id, {
          is_deleted: 0,
          updated_at: nowStr,
          is_dirty: 1
        });
      }
      return { data: { status: "success" } };
    }

    // 15. POST /trash/card/{id}/restore
    if (method === 'post' && url.match(/^\/trash\/card\/(-?\d+)\/restore$/)) {
      const cardId = parseInt(url.match(/^\/trash\/card\/(-?\d+)\/restore$/)[1], 10);
      const card = await db.cards.get(cardId);
      if (card) {
        await db.cards.update(cardId, {
          is_deleted: 0,
          updated_at: nowStr,
          is_dirty: 1
        });
        // Ensure its parent deck is also restored if it was deleted
        const deck = await db.decks.get(card.deck_id);
        if (deck && deck.is_deleted) {
          await db.decks.update(card.deck_id, {
            is_deleted: 0,
            updated_at: nowStr,
            is_dirty: 1
          });
        }
      }
      return { data: { status: "success" } };
    }

    // 16. DELETE /trash/clear
    if (method === 'delete' && url === '/trash/clear') {
      const deletedDecks = await db.decks.where('user_id').equals(userId).filter(d => !!d.is_deleted).toArray();
      for (const d of deletedDecks) {
        await db.decks.update(d.id, { hard_deleted_locally: 1, is_dirty: 1, updated_at: nowStr });
      }

      const deletedCards = await db.cards.filter(c => !!c.is_deleted).toArray();
      for (const c of deletedCards) {
        await db.cards.update(c.id, { hard_deleted_locally: 1, is_dirty: 1, updated_at: nowStr });
      }
      return { data: { status: "success" } };
    }

    throw new Error(`Offline API: Unsupported endpoint [${method.toUpperCase()}] ${url}`);
  }
};
