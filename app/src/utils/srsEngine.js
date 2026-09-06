import { tr } from '../i18n/locale';
/**
 * SRS SM-2 Spaced Repetition Engine for Lerne Offline Mode
 * Synchronized with backend logic in api/srs.py
 */

export const INITIAL_EASE_FACTOR = 2.5;
export const MINIMUM_EASE_FACTOR = 1.3;
export const MAXIMUM_EASE_FACTOR = 3.0;
export const LEARNING_STEPS = [5, 10]; // minutes
export const RELEARN_STEPS = [5]; // minutes
export const GRADUATING_INTERVAL_GOOD = 1; // days
export const GRADUATING_INTERVAL_EASY = 3; // days

export const HARD_MULTIPLIER = 1.15;
export const EASY_MULTIPLIER = 1.3;
export const LEECH_LAPSE_THRESHOLD = 5;

/**
 * Checks if card is a leech
 */
export const isLeech = (lapses) => {
  return typeof lapses === 'number' && lapses >= LEECH_LAPSE_THRESHOLD;
};

/**
 * Applies interval fuzzing to prevent review spikes
 */
export const applyFuzz = (interval) => {
  if (interval < 3) {
    return Math.max(1, interval);
  } else if (interval <= 7) {
    const fuzz = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
    return Math.max(2, interval + fuzz);
  } else if (interval <= 30) {
    const delta = Math.max(1, Math.round(interval * 0.10));
    const fuzz = Math.floor(Math.random() * (delta * 2 + 1)) - delta;
    return Math.max(7, interval + fuzz);
  } else {
    const delta = Math.max(2, Math.round(interval * 0.05));
    const fuzz = Math.floor(Math.random() * (delta * 2 + 1)) - delta;
    return Math.max(28, interval + fuzz);
  }
};

/**
 * Formats interval number for display
 */
export const formatInterval = (value, isDays = false) => {
  if (!isDays) {
    if (value < 60) {
      return tr("{{p0}} мин", { p0: Math.round(value) });
    }
    const hours = value / 60;
    if (hours < 24) return tr("{{p0}} ч", { p0: Math.round(hours) });
    return tr("{{p0}} дн", { p0: Math.round(hours / 24) });
  } else {
    if (value < 1) return tr("<1 дн", {  });
    if (value < 30) return tr("{{p0}} дн", { p0: Math.round(value) });
    const months = value / 30.0;
    if (months < 12) {
      return months % 1 !== 0 ? tr("{{p0}} мес", { p0: months.toFixed(1) }) : tr("{{p0}} мес", { p0: Math.round(months) });
    }
    return tr("{{p0}} г.", { p0: (value / 365.0).toFixed(1) });
  }
};

/**
 * Calculates 8 dynamic states for learning/relearning cards
 */
export const getLearning8States = (progress) => {
  const steps = progress.queue !== 'relearning' ? LEARNING_STEPS : RELEARN_STEPS;
  const stepIdx = progress.step_index || 0;
  const nextQueue = progress.queue === 'new' ? 'learning' : progress.queue;
  const hardInt = steps[1] || steps[0] * 2;

  return [
    { queue: nextQueue, interval: steps[0], stepIndex: 0, isDays: false },
    { queue: nextQueue, interval: Math.round((steps[0] + hardInt) / 2), stepIndex: 0, isDays: false },
    { queue: nextQueue, interval: hardInt, stepIndex: stepIdx, isDays: false },
    { queue: 'review', interval: 1, stepIndex: null, isDays: true },
    { queue: 'review', interval: GRADUATING_INTERVAL_GOOD, stepIndex: null, isDays: true },
    { queue: 'review', interval: 2, stepIndex: null, isDays: true },
    { queue: 'review', interval: GRADUATING_INTERVAL_EASY, stepIndex: null, isDays: true },
    { queue: 'review', interval: Math.max(4, Math.round(GRADUATING_INTERVAL_EASY * 1.6)), stepIndex: null, isDays: true }
  ];
};

export const getReview8States = (progress, applyFuzzFlag = false) => {
  const ef = progress.ease_factor || INITIAL_EASE_FACTOR;
  const interval = progress.interval || 1;
  const lapses = progress.lapses || 0;

  let daysSinceDue = 0;
  if (progress.next_review) {
    const nextDate = new Date(progress.next_review);
    const now = new Date();
    if (nextDate < now) {
      daysSinceDue = Math.max(0, Math.floor((now.getTime() - nextDate.getTime()) / 86400000));
    }
  }

  // 4 Core Anchor Calculations
  const efAgain = Math.max(MINIMUM_EASE_FACTOR, ef - (daysSinceDue > 7 ? 0.15 : 0.20));
  let intHard = interval <= 1 ? 1 : Math.max(interval, Math.round(interval * HARD_MULTIPLIER));
  let intGood = Math.max(intHard + 1, Math.ceil((interval + Math.min(daysSinceDue / 2, interval * 0.5)) * ef));
  let intEasy = Math.max(intGood + 1, Math.ceil((interval + Math.min(daysSinceDue, interval)) * ef * EASY_MULTIPLIER));

  if (applyFuzzFlag) {
    if (intHard >= 3) intHard = applyFuzz(intHard);
    if (intGood >= 3) intGood = applyFuzz(intGood);
    if (intEasy >= 3) intEasy = applyFuzz(intEasy);
  }

  const intMid = (low, high) => Math.max(low + 1, Math.min(high - 1, Math.round((low + high) / 2)));

  return [
    { queue: 'relearning', interval: RELEARN_STEPS[0], stepIndex: 0, easeFactor: efAgain, lapses: lapses + 1, isDays: false },
    { queue: 'review', interval: Math.max(1, Math.round(intHard / 2)), stepIndex: null, easeFactor: Math.max(MINIMUM_EASE_FACTOR, ef - 0.18), lapses: lapses + 1, isDays: true },
    { queue: 'review', interval: intHard, stepIndex: null, easeFactor: Math.max(MINIMUM_EASE_FACTOR, ef - 0.15), lapses, isDays: true },
    { queue: 'review', interval: intMid(intHard, intGood), stepIndex: null, easeFactor: Math.max(MINIMUM_EASE_FACTOR, ef - 0.06), lapses, isDays: true },
    { queue: 'review', interval: intGood, stepIndex: null, easeFactor: Math.min(MAXIMUM_EASE_FACTOR, ef + (ef < INITIAL_EASE_FACTOR ? 0.02 : 0)), lapses, isDays: true },
    { queue: 'review', interval: intMid(intGood, intEasy), stepIndex: null, easeFactor: Math.min(MAXIMUM_EASE_FACTOR, ef + 0.08), lapses, isDays: true },
    { queue: 'review', interval: intEasy, stepIndex: null, easeFactor: Math.min(MAXIMUM_EASE_FACTOR, ef + 0.15), lapses, isDays: true },
    { queue: 'review', interval: Math.max(intEasy + 2, Math.round(intEasy * 1.45)), stepIndex: null, easeFactor: Math.min(MAXIMUM_EASE_FACTOR, ef + 0.22), lapses, isDays: true },
  ];
};

/**
 * Returns deterministic next intervals for buttons preview (both 4-grade and 8-grade)
 */
export const getNextIntervals = (progress) => {
  const p = progress || {
    queue: 'new',
    step_index: 0,
    interval: 0,
    ease_factor: INITIAL_EASE_FACTOR,
    lapses: 0
  };
  const isLearning = ['new', 'learning', 'relearning'].includes(p.queue);
  const eightStates = isLearning ? getLearning8States(p) : getReview8States(p, false);

  const res = {
    // 4 standard buttons (backward compatible)
    0: formatInterval(eightStates[0].interval, eightStates[0].isDays),
    1: formatInterval(eightStates[2].interval, eightStates[2].isDays),
    2: formatInterval(eightStates[4].interval, eightStates[4].isDays),
    3: formatInterval(eightStates[6].interval, eightStates[6].isDays),
    // 8 extended buttons
    extended: eightStates.map(s => formatInterval(s.interval, s.isDays))
  };

  return res;
};

/**
 * Processes card review locally and returns updated progress object
 */
export const calculateCardReview = (progress, grade, isExtended = false) => {
  const now = new Date();
  const p = progress || {
    card_id: 0,
    user_id: 0,
    queue: 'new',
    step_index: 0,
    interval: 0,
    ease_factor: INITIAL_EASE_FACTOR,
    repetitions: 0,
    lapses: 0
  };

  const isLearning = ['new', 'learning', 'relearning'].includes(p.queue);
  const states = isLearning ? getLearning8States(p) : getReview8States(p, true);

  let nextState;
  if (isExtended) {
    const idx = Math.min(Math.max(0, grade), 7);
    nextState = states[idx];
  } else {
    // Standard 4 grades map to anchors: 0 -> 0, 1 -> 2, 2 -> 4, 3 -> 6
    const standardAnchorMap = [0, 2, 4, 6];
    const anchorIdx = standardAnchorMap[Math.min(Math.max(0, grade), 3)];
    nextState = states[anchorIdx];
  }

  const nextReviewDate = new Date(now);
  if (nextState.queue === 'review' && nextState.interval >= 1) {
    nextReviewDate.setDate(nextReviewDate.getDate() + nextState.interval);
  } else {
    nextReviewDate.setMinutes(nextReviewDate.getMinutes() + (nextState.interval || 5));
  }

  const newLapses = nextState.lapses != null ? nextState.lapses : (p.lapses || 0);

  return {
    ...p,
    queue: nextState.queue,
    interval: nextState.interval,
    step_index: nextState.stepIndex,
    ease_factor: nextState.easeFactor || p.ease_factor || INITIAL_EASE_FACTOR,
    lapses: newLapses,
    repetitions: (p.repetitions || 0) + 1,
    is_leech: isLeech(newLapses),
    next_review: nextReviewDate.toISOString(),
    last_reviewed: now.toISOString(),
    updated_at: now.toISOString(),
    is_dirty: 1
  };
};


