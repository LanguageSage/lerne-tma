import { cardDuplicateKey } from './search.js';
import { studyContent } from './structuredStudyCard.js';
import { sha256Hex } from '../pilot/sha256.js';

const ACTION_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const RULE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?(?:\.[a-z0-9_][a-z0-9_-]*)+$/;
const SUPPORT_FIELDS = ['hint_count', 'translation_view_count', 'answer_reveal_count', 'other_help_count'];
const TASK_SUPPORT_FIELDS = ['answer_options_present', 'sentence_frame_present', 'source_text_present',
  'source_vocabulary_present', 'authored_example_present'];
const EXERCISE_COUNTERS = { attemptCount: 'attempt_count', mistakeCount: 'mistake_count' };
const EXERCISE_FLAGS = { isCorrect: 'correct', completed: 'completed', isFirstTry: 'first_try_correct' };
const count = value => Number.isSafeInteger(value) && value >= 0;
const boundedText = (value, limit = 128) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const pick = (input, keys, valid) => Object.fromEntries(
  keys.filter(key => valid(input?.[key])).map(key => [key, input[key]]),
);
const boolean = value => typeof value === 'boolean';

export const standaloneTaskKey = card => card.standalone_card_key || `bundled:${card.id}`;
export const isKnowledgeKey = value => boundedText(value) && RULE_CODE.test(value);
export const isKnowledgeKeyForLanguage = (key, language) => isKnowledgeKey(key) && key.startsWith(`${language}.`);
export const isKnowledgeActionId = value => typeof value === 'string' && ACTION_ID.test(value);
export const knowledgeGradeFingerprint = (card, rating, extended, context) => (
  sha256Hex(JSON.stringify([standaloneTaskKey(card), rating, extended, context]))
);

export function knowledgeTaskSignature(content, includeInfo = false) {
  if (!content) return null;
  const { back_note: _note, ...data } = content.data ?? {};
  return cardDuplicateKey({ type: content.type, task: content.task ?? null, data,
    ...(includeInfo && { info: content.info ?? [] }),
  });
}

export function studyKnowledgeObservation(card, rating, extended, exercise, eventTime) {
  const content = studyContent(card);
  if (!content || content.type === 'theory') return null;
  const exerciseData = {};
  for (const [key, field] of Object.entries(EXERCISE_COUNTERS)) {
    if (count(exercise?.[key])) exerciseData[field] = exercise[key];
  }
  for (const [key, field] of Object.entries(EXERCISE_FLAGS)) {
    if (boolean(exercise?.[key])) exerciseData[field] = exercise[key];
  }
  const grading = pick(exercise?.gradingSummary,
    ['final_verdict', 'final_evaluator', 'final_target_relevance'], boundedText);
  const codes = exercise?.gradingSummary?.error_codes_seen;
  if (Array.isArray(codes)) grading.error_codes_seen = codes.filter(code => boundedText(code)).slice(0, 32);
  const support = {
    ...pick(exercise?.supportEvidence, SUPPORT_FIELDS, value => value === null || count(value)),
    ...pick(exercise?.supportEvidence, ['tracking_complete'], boolean),
  };
  const taskSupport = pick(exercise?.taskSupport, TASK_SUPPORT_FIELDS, value => value === null || boolean(value));
  if (count(exercise?.gradingSummary?.interaction_count)) {
    exerciseData.interaction_count = exercise.gradingSummary.interaction_count;
  }
  return {
    event_time: eventTime,
    task_key: standaloneTaskKey(card),
    example_fingerprint: sha256Hex(knowledgeTaskSignature(content)),
    card_type: content.type,
    evaluation_data: {
      schema_version: 1, source: 'study', rating, extended,
      ...(Object.keys(exerciseData).length && { exercise: exerciseData }),
      ...(Object.keys(grading).length && { grading }),
      ...(Object.keys(support).length && { support }),
      ...(Object.keys(taskSupport).length && { task_support: taskSupport }),
    },
  };
}

const sameObject = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => Object.hasOwn(expected, key) && expected[key](value[key]));
const optionalText = value => value === null || boundedText(value);
const validExercise = value => sameObject(value, {
  attempt_count: count, mistake_count: count, interaction_count: count,
  correct: boolean, completed: boolean, first_try_correct: boolean,
});
const validSupportValue = value => value === null || count(value);
const validSupport = value => sameObject(value, {
  ...Object.fromEntries(SUPPORT_FIELDS.map(key => [key, validSupportValue])), tracking_complete: boolean,
});
const validTaskSupport = value => sameObject(value, Object.fromEntries(
  TASK_SUPPORT_FIELDS.map(key => [key, candidate => candidate === null || boolean(candidate)]),
));
const validGrading = value => sameObject(value, {
  final_verdict: boundedText, final_evaluator: boundedText, final_target_relevance: boundedText,
  error_codes_seen: codes => Array.isArray(codes) && codes.length <= 32 && codes.every(code => boundedText(code)),
});
const validEvaluation = value => sameObject(value, {
  schema_version: version => version === 1,
  source: source => source === 'study' || source === 'diagnostic',
  rating: number => count(number) && number <= 7, extended: boolean,
  exercise: validExercise, grading: validGrading, support: validSupport, task_support: validTaskSupport,
}) && value.schema_version === 1 && (value.source === 'study'
  ? count(value.rating) && boolean(value.extended) && value.rating <= (value.extended ? 7 : 3)
  : value.source === 'diagnostic');

/** Portable events omit mutable local row IDs and never carry answer text. */
export function isPortableKnowledgeAttempt(event) {
  return sameObject(event, {
    client_event_id: isKnowledgeActionId,
    event_time: value => typeof value === 'string' && Number.isFinite(Date.parse(value)),
    knowledge_item_id: isKnowledgeKey,
    task_key: value => boundedText(value, 256),
    card_type: boundedText,
    example_fingerprint: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    ability: optionalText, example_key: optionalText,
    complexity: value => value === null || (count(value) && value >= 1 && value <= 5),
    grade_fingerprint: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    evaluation_data: validEvaluation,
  }) && ['client_event_id', 'event_time', 'knowledge_item_id', 'task_key', 'example_fingerprint',
    'evaluation_data', 'card_type'].every(key => Object.hasOwn(event, key));
}
