import { shuffleFY } from './shuffle.js';

export const AUTOPLAY_VERSION = 2;
export const AUTOPLAY_DEFAULTS = {
  autoplayVersion: AUTOPLAY_VERSION,
  autoplayOrder: 'list',
  autoplayFrontRepeat: 3,
  autoplayCycleRepeat: 2,
  autoplayGap: 2,
  autoplayCardPause: 3,
  autoplayPhraseSpeed: 0,
  autoplayTranslationSpeed: 0,
  autoplayLoop: true,
  autoplayForceFrontAudio: false,
  autoplayForceBackAudio: false,
};

export const normalizeAutoplaySettings = (settings = {}) => {
  const result = { ...AUTOPLAY_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (settings[key] !== undefined) result[key] = settings[key];
  }
  for (const [key, min, max] of [
    ['autoplayFrontRepeat', 1, 10], ['autoplayCycleRepeat', 1, 10],
    ['autoplayGap', 0, 30], ['autoplayCardPause', 0, 30],
    ['autoplayPhraseSpeed', -50, 50], ['autoplayTranslationSpeed', -50, 50],
  ]) {
    const value = Number(result[key]);
    result[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : AUTOPLAY_DEFAULTS[key];
  }
  for (const key of ['autoplayLoop', 'autoplayForceFrontAudio', 'autoplayForceBackAudio']) {
    result[key] = result[key] === true || result[key] === 'true';
  }
  if (!['list', 'srs', 'random'].includes(result.autoplayOrder)) result.autoplayOrder = 'list';
  result.autoplayVersion = AUTOPLAY_VERSION;
  return result;
};

export const buildAutoplaySequence = (settings) => {
  const { autoplayFrontRepeat: phrases, autoplayCycleRepeat: cycles } = normalizeAutoplaySettings(settings);
  const cycle = ['front', 'back', ...Array(phrases - 1).fill('front')];
  return Array.from({ length: cycles }, () => [...cycle]).flat();
};

export const filterAndSortAutoplayCards = (cards, order) => {
  if (!cards || !cards.length) return [];

  if (order === 'srs') {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const dueReviewCards = [];
    const dueLearningCards = [];
    const newCards = [];

    for (const c of cards) {
      if (!c.queue || c.queue === 'new') {
        newCards.push(c);
      } else if (c.queue === 'learning' || c.queue === 'relearning') {
        if (!c.next_review || new Date(c.next_review) <= endOfToday) {
          dueLearningCards.push(c);
        }
      } else if (c.queue === 'review') {
        if (!c.next_review || new Date(c.next_review) <= endOfToday) {
          dueReviewCards.push(c);
        }
      }
    }

    // Overdue / due review cards first (oldest review time first)
    dueReviewCards.sort((a, b) => {
      const timeA = a.next_review ? new Date(a.next_review).getTime() : 0;
      const timeB = b.next_review ? new Date(b.next_review).getTime() : 0;
      return timeA - timeB;
    });

    // Learning / relearning cards scheduled for today
    dueLearningCards.sort((a, b) => {
      const timeA = a.next_review ? new Date(a.next_review).getTime() : 0;
      const timeB = b.next_review ? new Date(b.next_review).getTime() : 0;
      return timeA - timeB;
    });

    // New cards sorted by position asc, id asc
    newCards.sort((a, b) => (a.position || 0) - (b.position || 0) || (a.id || 0) - (b.id || 0));

    return [...dueReviewCards, ...dueLearningCards, ...newCards];
  }

  // Default 'list' mode: linear sequence by position asc, id asc
  return [...cards].sort((a, b) => (a.position || 0) - (b.position || 0) || (a.id || 0) - (b.id || 0));
};


export const createAutoplayQueue = (cards, order, previousId = null) => {
  const unique = [...new Map((cards || []).filter(c => c && !c.is_deleted).map(c => [String(c.id), c])).values()];
  if (order !== 'random') return filterAndSortAutoplayCards(unique, order);
  const shuffled = shuffleFY(unique);
  if (shuffled.length > 1 && String(shuffled[0].id) === String(previousId)) {
    const index = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    [shuffled[0], shuffled[index]] = [shuffled[index], shuffled[0]];
  }
  return shuffled;
};

