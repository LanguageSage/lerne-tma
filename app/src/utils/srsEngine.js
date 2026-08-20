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
      return `${Math.round(value)} мин`;
    }
    const hours = value / 60;
    if (hours < 24) return `${Math.round(hours)} ч`;
    return `${Math.round(hours / 24)} дн`;
  } else {
    if (value < 1) return '<1 дн';
    if (value < 30) return `${Math.round(value)} дн`;
    const months = value / 30.0;
    if (months < 12) {
      return months % 1 !== 0 ? `${months.toFixed(1)} мес` : `${Math.round(months)} мес`;
    }
    return `${(value / 365.0).toFixed(1)} г.`;
  }
};

/**
 * Calculates next state for learning/relearning cards
 */
const calcLearningNextState = (progress, grade) => {
  const steps = progress.queue !== 'relearning' ? LEARNING_STEPS : RELEARN_STEPS;
  const stepIdx = progress.step_index || 0;
  const nextQueue = progress.queue === 'new' ? 'learning' : progress.queue;

  if (grade === 0) { // Again
    return { queue: nextQueue, interval: steps[0], stepIndex: 0 };
  } else if (grade === 1) { // Hard
    const hardInterval = steps[1] || steps[0] * 2;
    return { queue: nextQueue, interval: hardInterval, stepIndex: stepIdx };
  } else if (grade === 2) { // Good
    return { queue: 'review', interval: GRADUATING_INTERVAL_GOOD, stepIndex: null };
  } else { // Easy (grade === 3)
    return { queue: 'review', interval: GRADUATING_INTERVAL_EASY, stepIndex: null };
  }
};

/**
 * Calculates next state for review cards
 */
const calcReviewNextState = (progress, grade, applyFuzzFlag = false) => {
  const ef = progress.ease_factor || INITIAL_EASE_FACTOR;
  const interval = progress.interval || 1;
  const lapses = progress.lapses || 0;

  // Calculate overdue delay (days_since_due)
  let daysSinceDue = 0;
  if (progress.next_review) {
    const nextDate = new Date(progress.next_review);
    const now = new Date();
    if (nextDate < now) {
      daysSinceDue = Math.max(0, Math.floor((now.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24)));
    }
  }

  if (grade === 0) { // Again
    const easePenalty = daysSinceDue > 7 ? 0.15 : 0.20;
    const newEf = Math.max(MINIMUM_EASE_FACTOR, ef - easePenalty);
    return {
      queue: 'relearning',
      interval: RELEARN_STEPS[0],
      stepIndex: 0,
      easeFactor: newEf,
      lapses: lapses + 1
    };
  } else if (grade === 1) { // Hard
    const newEf = Math.max(MINIMUM_EASE_FACTOR, ef - 0.15);
    let newInt = Math.round(Math.max(interval + 1, interval * HARD_MULTIPLIER));
    if (applyFuzzFlag) newInt = applyFuzz(newInt);
    return {
      queue: 'review',
      interval: newInt,
      stepIndex: null,
      easeFactor: newEf,
      lapses
    };
  } else if (grade === 2) { // Good
    const dueBonus = Math.min(daysSinceDue / 2, interval * 0.5);
    let newInt = Math.round(Math.max(interval + 1, (interval + dueBonus) * ef));
    const newEf = ef < INITIAL_EASE_FACTOR ? Math.min(MAXIMUM_EASE_FACTOR, ef + 0.02) : ef;
    if (applyFuzzFlag) newInt = applyFuzz(newInt);
    return {
      queue: 'review',
      interval: newInt,
      stepIndex: null,
      easeFactor: newEf,
      lapses
    };
  } else { // Easy (grade === 3)
    const dueBonus = Math.min(daysSinceDue, interval * 1.0);
    let newInt = Math.round(Math.max(interval + 2, (interval + dueBonus) * ef * EASY_MULTIPLIER));
    const newEf = Math.min(MAXIMUM_EASE_FACTOR, ef + 0.15);
    if (applyFuzzFlag) newInt = applyFuzz(newInt);
    return {
      queue: 'review',
      interval: newInt,
      stepIndex: null,
      easeFactor: newEf,
      lapses
    };
  }
};

/**
 * Returns deterministic next intervals for buttons preview
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
  const res = {};

  for (let grade = 0; grade < 4; grade++) {
    if (isLearning) {
      const state = calcLearningNextState(p, grade);
      const isDays = state.queue === 'review';
      res[grade] = formatInterval(state.interval, isDays);
    } else {
      const state = calcReviewNextState(p, grade, false);
      const isDays = state.queue !== 'relearning';
      res[grade] = formatInterval(state.interval, isDays);
    }
  }
  return res;
};

/**
 * Processes card review locally and returns updated progress object
 */
export const calculateCardReview = (progress, grade) => {
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

  let nextState;
  const isLearning = ['new', 'learning', 'relearning'].includes(p.queue);

  if (isLearning) {
    nextState = calcLearningNextState(p, grade);
  } else {
    nextState = calcReviewNextState(p, grade, true); // apply fuzz on save
  }

  const nextReviewDate = new Date(now);
  if (nextState.queue === 'review' && nextState.interval >= 1) {
    nextReviewDate.setDate(nextReviewDate.getDate() + nextState.interval);
  } else {
    nextReviewDate.setMinutes(nextReviewDate.getMinutes() + (nextState.interval || 5));
  }

  const newLapses = nextState.lapses || p.lapses || 0;

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

