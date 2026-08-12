/**
 * SRS SM-2 Spaced Repetition Engine for Lerne Offline Mode
 * Synchronized with backend logic in api/srs.py
 */

export const INITIAL_EASE_FACTOR = 2.5;
export const MINIMUM_EASE_FACTOR = 1.3;
export const LEARNING_STEPS = [5, 10];
export const RELEARN_STEPS = [5];
export const GRADUATING_INTERVAL_GOOD = 1;
export const GRADUATING_INTERVAL_EASY = 3;

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
const calcReviewNextState = (progress, grade) => {
  let ease = progress.ease_factor || INITIAL_EASE_FACTOR;
  let interval = progress.interval || 1;
  let lapses = progress.lapses || 0;

  if (grade === 0) { // Again
    lapses += 1;
    ease = Math.max(MINIMUM_EASE_FACTOR, ease - 0.2);
    return {
      queue: 'relearning',
      interval: RELEARN_STEPS[0],
      stepIndex: 0,
      easeFactor: ease,
      lapses
    };
  } else if (grade === 1) { // Hard
    ease = Math.max(MINIMUM_EASE_FACTOR, ease - 0.15);
    interval = Math.max(1, Math.round(interval * 1.2));
    return {
      queue: 'review',
      interval,
      stepIndex: null,
      easeFactor: ease,
      lapses
    };
  } else if (grade === 2) { // Good
    interval = Math.max(1, Math.round(interval * ease));
    return {
      queue: 'review',
      interval,
      stepIndex: null,
      easeFactor: ease,
      lapses
    };
  } else { // Easy (grade === 3)
    ease += 0.15;
    interval = Math.max(1, Math.round(interval * ease * 1.3));
    return {
      queue: 'review',
      interval,
      stepIndex: null,
      easeFactor: ease,
      lapses
    };
  }
};

/**
 * Processes card review locally and returns updated progress object
 */
export const calculateCardReview = (progress, grade) => {
  const now = new Date();
  const p = progress || {
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
    nextState = calcReviewNextState(p, grade);
  }

  const nextReviewDate = new Date(now);
  if (nextState.queue === 'review' && nextState.interval >= 1) {
    nextReviewDate.setDate(nextReviewDate.getDate() + nextState.interval);
  } else {
    nextReviewDate.setMinutes(nextReviewDate.getMinutes() + (nextState.interval || 5));
  }

  return {
    ...p,
    queue: nextState.queue,
    interval: nextState.interval,
    step_index: nextState.stepIndex,
    ease_factor: nextState.easeFactor || p.ease_factor || INITIAL_EASE_FACTOR,
    lapses: nextState.lapses || p.lapses || 0,
    repetitions: (p.repetitions || 0) + 1,
    next_review: nextReviewDate.toISOString(),
    last_reviewed: now.toISOString(),
    updated_at: now.toISOString(),
    is_dirty: 1
  };
};
