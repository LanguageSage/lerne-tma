import { isTrainerAnswerMode, TASK_SUPPORT_FIELDS } from './supportEvidence.js';

export const KNOWLEDGE_CALCULATION_VERSION = 'offline-mastery-v1';
export const KNOWLEDGE_MASTERY_POLICY = Object.freeze({
  minExamples: 2,
  minConfirmedExamples: 3,
  minErrorExamples: 2,
  masteryThreshold: 0.8,
  weaknessThreshold: 0.55,
  recoveredScore: 0.4,
  maxFreshAgeDays: 90,
  staleConfidenceFactor: 0.5,
  assistedWeightFactor: 0.6,
  unknownSupportWeightFactor: 0.8,
  weights: Object.freeze({ self_rating: 0.25, recognition: 0.85, guided_application: 0.9, reproduction: 0.95, application: 1 }),
  standardRatings: Object.freeze([0.10, 0.40, 0.75, 0.95]),
  extendedRatings: Object.freeze([0.10, 0.25, 0.40, 0.575, 0.75, 0.85, 0.95, 1]),
});

const DAY_MS = 86_400_000;
// Policy inputs use at most three decimal places. Integer units preserve exact threshold comparisons.
const EVIDENCE_SCALE = 1000;
const CHECKED_RULE_TYPES = new Set(['quiz', 'match', 'trainer', 'puzzle', 'word_bank', 'editable_text']);
const REVEALS = ['answer_reveal_count'];
const HELP = ['hint_count', 'translation_view_count', 'other_help_count'];
const SCORABLE_DIMENSIONS = Object.keys(KNOWLEDGE_MASTERY_POLICY.weights);
const policy = KNOWLEDGE_MASTERY_POLICY;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function interpret(event) {
  const { exercise, grading, support, task_support: taskSupport, source, rating, extended } = event.evaluation_data;
  const type = event.card_type;
  if (type === 'theory') return null;
  if (!exercise) {
    const score = (extended ? policy.extendedRatings : policy.standardRatings)[rating];
    return score == null ? null : { ability: 'self_rating', score, weight: policy.weights.self_rating, reason: 'self_rating' };
  }

  const revealed = REVEALS.some(field => support?.[field] > 0);
  const helped = HELP.some(field => support?.[field] > 0);
  const completeSupport = support?.tracking_complete === true && [...HELP, ...REVEALS].every(field => support[field] === 0);
  const noScaffold = TASK_SUPPORT_FIELDS.every(field => taskSupport?.[field] === false);
  const independent = completeSupport && noScaffold;
  let ability;
  let verified;

  if (type === 'free_text') {
    ability = event.ability === 'application' && independent ? 'application' : 'reproduction';
    // A match checks the authored answer. A mismatch may be a valid variant.
    verified = grading?.final_evaluator === 'local' && exercise.correct === true;
    if (source === 'diagnostic' && grading?.final_evaluator === 'rules' && grading.final_target_relevance === 'primary') {
      verified = typeof exercise.correct === 'boolean';
    }
  } else {
    // Older observations can establish input when no options were present. Visible options alone may be authored clues.
    const observation = taskSupport?.trainer_answer_mode;
    const trainerMode = isTrainerAnswerMode(observation) ? observation
      : taskSupport?.answer_options_present === false ? 'input' : null;
    const choice = type === 'quiz' || type === 'match' || (type === 'trainer' && trainerMode === 'choice');
    ability = choice ? 'recognition' : 'guided_application';
    verified = CHECKED_RULE_TYPES.has(type) && grading?.final_evaluator === 'rules' && typeof exercise.correct === 'boolean'
      && (type !== 'trainer' || trainerMode !== null);
  }

  if (revealed || !verified) return { ability, score: null, weight: 0, reason: revealed ? 'answer_revealed' : 'unverified' };
  const priorMistakes = exercise.correct && exercise.mistake_count > 0;
  const recovered = priorMistakes && type !== 'free_text';
  const weightFactor = helped ? policy.assistedWeightFactor : completeSupport ? 1 : policy.unknownSupportWeightFactor;
  return {
    ability,
    score: exercise.correct ? (recovered ? policy.recoveredScore : 1) : 0,
    weight: policy.weights[ability] * weightFactor,
    confirms: !priorMistakes && exercise.correct && !helped && (type !== 'free_text' || independent),
    error: !exercise.correct || recovered,
    reason: exercise.correct ? (recovered ? 'mistakes_before_success' : 'verified_success') : 'verified_error',
  };
}

function exampleRepresentatives(observations) {
  const parents = observations.map((_, index) => index);
  const tokenOwners = new Map();
  const root = index => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (const [index, { event }] of observations.entries()) {
    const tokens = [`task:${event.task_key}`, `content:${event.example_fingerprint}`];
    if (event.example_key) tokens.push(`authored:${event.example_key}`);
    for (const token of tokens) {
      if (tokenOwners.has(token)) parents[root(index)] = root(tokenOwners.get(token));
      else tokenOwners.set(token, index);
    }
  }
  const representatives = new Map();
  for (const [index, observation] of observations.entries()) {
    if (observation.score !== null) representatives.set(root(index), observation);
  }
  return [...representatives.values()];
}

function evaluateDimension(ability, observations, nowMs) {
  const representatives = exampleRepresentatives(observations);
  let weightUnits = 0;
  let earnedUnits = 0;
  for (const observation of representatives) {
    const weight = Math.round(observation.weight * EVIDENCE_SCALE);
    weightUnits += weight;
    earnedUnits += weight * Math.round(observation.score * EVIDENCE_SCALE);
  }
  const proficiency = weightUnits ? earnedUnits / (weightUnits * EVIDENCE_SCALE) : null;
  const confirmed = representatives.filter(observation => observation.confirms);
  const errors = representatives.filter(observation => observation.error);
  const relevant = ability === 'self_rating' ? [] : representatives;
  const statusBeforeRecency = observations.length === 0 ? 'not_checked'
    : relevant.length < policy.minExamples ? 'insufficient_evidence'
      : confirmed.length >= policy.minConfirmedExamples
        && earnedUnits >= weightUnits * Math.round(policy.masteryThreshold * EVIDENCE_SCALE) ? 'mastered'
        : errors.length >= policy.minErrorExamples
          && earnedUnits <= weightUnits * Math.round(policy.weaknessThreshold * EVIDENCE_SCALE) ? 'weak'
          : 'partially_mastered';
  const lastEvidence = representatives.reduce((last, item) => Math.max(last, item.time), -Infinity);
  const lastConfirmation = confirmed.reduce((last, item) => Math.max(last, item.time), -Infinity);
  const referenceTime = statusBeforeRecency === 'mastered' ? lastConfirmation : lastEvidence;
  const stale = Number.isFinite(referenceTime) && nowMs - referenceTime > policy.maxFreshAgeDays * DAY_MS;
  const status = stale && ['mastered', 'weak'].includes(statusBeforeRecency) ? 'needs_recheck' : statusBeforeRecency;
  return {
    ability, status, status_before_recency: statusBeforeRecency, proficiency,
    confidence: Math.min(1, weightUnits / (EVIDENCE_SCALE * policy.minConfirmedExamples)) * (stale ? policy.staleConfidenceFactor : 1),
    event_count: observations.length,
    independent_examples: representatives.length,
    last_checked_at: observations.at(-1)?.event.event_time ?? null,
    last_confirmed_at: Number.isFinite(lastConfirmation) ? new Date(lastConfirmation).toISOString() : null,
    evidence: representatives.map(({ event, score, weight, reason, error }) => ({
      event_id: event.client_event_id, task_key: event.task_key, checked_at: event.event_time, score, weight, reason, error: Boolean(error),
    })),
  };
}

/** Raw attempts and a clock are the only inputs to the portable projection. */
export function projectKnowledgeMastery({ skills, attempts, now }) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('An explicit Knowledge calculation time is required');
  const catalog = new Map(skills.filter(item => item.kind === 'skill').map(item => [item.rule_code, item]));
  const bySkill = new Map();
  const seen = new Set();
  const orderedAttempts = attempts.map(event => ({ event, time: Date.parse(event.event_time) }))
    .filter(({ time }) => Number.isFinite(time)).sort((a, b) => a.time - b.time
      || compareText(a.event.client_event_id, b.event.client_event_id));
  for (const { event, time } of orderedAttempts) {
    if (seen.has(event.client_event_id)) continue;
    seen.add(event.client_event_id);
    const interpretation = interpret(event);
    if (!interpretation) continue;
    const key = event.knowledge_item_id;
    if (!bySkill.has(key)) bySkill.set(key, new Map());
    const dimensions = bySkill.get(key);
    const group = dimensions.get(interpretation.ability) ?? [];
    group.push({ event, time, ...interpretation });
    dimensions.set(interpretation.ability, group);
  }
  const skillKeys = [...new Set([...catalog.keys(), ...bySkill.keys()])].sort();
  return {
    calculation_version: KNOWLEDGE_CALCULATION_VERSION,
    skills: skillKeys.map(key => ({
      skill_key: key,
      name: catalog.get(key)?.name ?? key,
      prerequisite_keys: catalog.get(key)?.prerequisite_keys ?? [],
      dimensions: SCORABLE_DIMENSIONS.map(ability => evaluateDimension(ability, bySkill.get(key)?.get(ability) ?? [], nowMs)),
    })),
  };
}
