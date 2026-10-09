/**
 * Utility functions for tracking, evaluating, and formatting study session statistics,
 * as well as deriving deck SRS distribution numbers.
 */

/**
 * Evaluates whether an individual review attempt was successful and how many mistakes occurred.
 *
 * @param {Object} options
 * @param {number} options.grade - Numeric SRS grade
 * @param {boolean} [options.isExtended=false] - Whether extended 8-grade scale is active
 * @param {Object|null} [options.exerciseEvidence=null] - Interactive exercise evidence if available
 * @returns {{ isCorrect: boolean, mistakes: number }}
 */
export function evaluateReviewResult({ grade, isExtended = false, exerciseEvidence = null } = {}) {
  let isCorrect;
  let mistakes = 0;

  if (exerciseEvidence && typeof exerciseEvidence === 'object') {
    if (typeof exerciseEvidence.isCorrect === 'boolean') {
      isCorrect = exerciseEvidence.isCorrect;
    } else if (typeof exerciseEvidence.completed === 'boolean') {
      isCorrect = exerciseEvidence.completed;
    } else {
      isCorrect = isExtended ? grade >= 3 : grade >= 2;
    }

    if (typeof exerciseEvidence.mistakeCount === 'number') {
      mistakes = Math.max(0, exerciseEvidence.mistakeCount);
    } else {
      mistakes = isCorrect ? 0 : 1;
    }
  } else {
    // Standard self-assessment flashcard:
    // 4-grade scale: 0 (Again) & 1 (Hard) are lapses/struggles, 2 (Good) & 3 (Easy) are correct
    // 8-grade scale: 0..2 are lapses/struggles, 3..7 are correct
    isCorrect = isExtended ? grade >= 3 : grade >= 2;
    mistakes = isCorrect ? 0 : 1;
  }

  return { isCorrect, mistakes };
}

/**
 * Formats a duration in seconds to a human-readable string (M:SS or H:MM:SS).
 *
 * @param {number} seconds
 * @returns {string} Formatted duration string
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) {
    return '0:00';
  }
  const totalSeconds = Math.round(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculates finalized session statistics for presentation on the completion screen.
 *
 * @param {Object} options
 * @param {number} [options.reviewsCount=0]
 * @param {number} [options.correctCount=0]
 * @param {number} [options.mistakeCount=0]
 * @param {number|string|Date} [options.startedAt=null]
 * @param {number|string|Date} [options.endedAt=null]
 * @param {Array} [options.studyHistory=[]]
 * @returns {Object|null}
 */
export function calculateSessionStats({
  reviewsCount = 0,
  correctCount = 0,
  mistakeCount = 0,
  startedAt = null,
  endedAt = null,
  studyHistory = []
} = {}) {
  const exercises = reviewsCount > 0 ? reviewsCount : (Array.isArray(studyHistory) ? studyHistory.length : 0);
  if (exercises === 0) {
    return null;
  }

  const effectiveCorrect = reviewsCount > 0 ? correctCount : exercises;
  const effectiveMistakes = reviewsCount > 0 ? mistakeCount : 0;
  const accuracyNum = exercises > 0
    ? Math.max(0, Math.min(100, Math.round((effectiveCorrect / exercises) * 100)))
    : 100;

  const startTime = startedAt ? (typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime()) : Date.now();
  const endTime = endedAt ? (typeof endedAt === 'number' ? endedAt : new Date(endedAt).getTime()) : Date.now();
  const elapsedSecs = Math.max(1, Math.round((endTime - startTime) / 1000));

  return {
    exercises,
    correct: effectiveCorrect,
    mistakes: effectiveMistakes,
    accuracy: `${accuracyNum}%`,
    duration: formatDuration(elapsedSecs)
  };
}

/**
 * Derives current SRS counters (total, new, learning, due) for a deck from its card array
 * or pre-calculated stats object.
 *
 * @param {Object} deck
 * @param {Array} [deckCards=[]]
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ total: number, new: number, learning: number, due: number }}
 */
export function computeDeckSrsStats(deck, deckCards = [], referenceDate = new Date()) {
  if (Array.isArray(deckCards) && deckCards.length > 0) {
    let newCount = 0;
    let learningCount = 0;
    let dueCount = 0;

    deckCards.forEach(c => {
      const q = c?.queue || 'new';
      if (q === 'new') {
        newCount++;
      } else if (q === 'learning' || q === 'relearning') {
        learningCount++;
      } else if (q === 'review') {
        if (!c?.next_review || new Date(c.next_review) <= referenceDate) {
          dueCount++;
        }
      }
    });

    return {
      total: deckCards.length,
      new: newCount,
      learning: learningCount,
      due: dueCount
    };
  }

  const stats = deck?.stats || {};
  return {
    total: stats.total ?? deck?.card_count ?? 0,
    new: stats.new ?? 0,
    learning: stats.learning ?? 0,
    due: stats.due ?? 0
  };
}
