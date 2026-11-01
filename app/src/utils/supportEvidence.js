import { parseExerciseContent } from './exerciseContentParser.js';

const counters = ['hint_count', 'translation_view_count', 'answer_reveal_count', 'other_help_count'];

/** Counts are observations within declared sources, never a judgement of independence. */
export function createSupportSession(initial, observed = []) {
  const values = Object.fromEntries(counters.map(key => [key, initial
    ? Number.isSafeInteger(initial[key]) && initial[key] >= 0 ? initial[key] : null
    : observed.includes(key) ? 0 : null]));
  let state = { tracking_complete: (!initial || initial.tracking_complete === true)
    && counters.every(key => observed.includes(key) && values[key] !== null), ...values };
  return {
    record(kind) {
      if (!counters.includes(kind)) throw new Error(`Unknown support action: ${kind}`);
      // An unobserved prefix cannot be repaired by observing a later action.
      if (Number.isInteger(state[kind])) state = { ...state, [kind]: state[kind] + 1 };
    },
    snapshot: () => structuredClone(state),
  };
}

export const captureSupportEvidence = (state, capturePoint, attemptCount) => ({
  ...structuredClone(state), capture_point: capturePoint, answer_attempt_count: attemptCount,
});

/** Explicit authoring syntax only. Arbitrary prompt prose is not classified heuristically. */
export function freeTextTaskSupport(card) {
  const content = parseExerciseContent(card?.front || card?.front_text || '');
  return {
    answer_options_present: content.options.length > 0,
    source_text_present: Boolean(content.source),
    authored_example_present: content.examples.length > 0,
    sentence_frame_present: null,
    source_vocabulary_present: null,
  };
}

/** Trainer supplies fixed gap positions and visible sentence fragments, not free construction. */
export function trainerTaskSupport(card, clozeData) {
  const support = freeTextTaskSupport(card);
  const gaps = clozeData?.gaps || [];
  const frame = clozeData?.maskedText || '';
  return { ...support,
    answer_options_present: support.answer_options_present || gaps.some(gap => gap.mode === 'choice' && gap.choices?.length > 0),
    sentence_frame_present: gaps.length > 0 && /___GAP_\d+___/.test(frame),
    source_vocabulary_present: support.source_text_present || /[\p{L}\p{N}]/u.test(frame.replace(/___GAP_\d+___/g, '')),
  };
}
