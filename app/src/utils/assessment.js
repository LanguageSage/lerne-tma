import { studyContent } from './structuredStudyCard.js';
import { parseDeckMetadata } from './deckUtils.js';
import { isValidAnswerEvaluationResult } from './freeTextEvaluationState.js';

const validTargetRelevance = value => ['primary', 'secondary', 'none'].includes(value);

export function assessmentTrainerEvidence(submission) {
  const state = submission.state;
  return { isCorrect: state.result.accepted, completed: true,
    isFirstTry: true, attemptCount: 1, mistakeCount: state.result.accepted ? 0 : 1,
    ...(submission.supportEvidence ? { supportEvidence: structuredClone(submission.supportEvidence),
      taskSupport: structuredClone(submission.taskSupport) } : {}),
    gradingSummary: { final_verdict: state.result.verdict,
      error_types_seen: [...state.errorTypesSeen], error_codes_seen: [...state.errorCodesSeen] } };
}

// Assessment captures the first classified check, even when Classic would allow retries.
export function assessmentFreeTextEvidence(result, support = {}) {
  if (!isValidAnswerEvaluationResult(result) || result.verdict === 'unavailable') return null;
  return { isCorrect: result.accepted, completed: true, isFirstTry: true,
    attemptCount: 1, mistakeCount: result.accepted ? 0 : 1,
    ...(support.supportEvidence ? { supportEvidence: structuredClone(support.supportEvidence),
      ...(support.taskSupport ? { taskSupport: structuredClone(support.taskSupport) } : {}) } : {}),
    gradingSummary: { final_verdict: result.verdict, final_evaluator: result.evaluator,
      error_types_seen: result.error_type ? [result.error_type] : [],
      error_codes_seen: result.error_code ? [result.error_code] : [],
      ...(validTargetRelevance(result.target_relevance) ? { final_target_relevance: result.target_relevance } : {}) } };
}

export const readCardMetadata = card => {
  const native = studyContent(card);
  if (native) return native.metadata || {};
  return {};
};

// Explicit authored configuration; never infer bonus cards from a translated title.
export function createAssessment(deck, cards, userId, id = crypto.randomUUID()) {
  const metadata = parseDeckMetadata(deck);
  const config = metadata.pedagogy?.assessment;
  if (metadata.pedagogy?.lesson_type !== 'assessment' || !config) return null;
  const ordered = [...cards];
  // The study API already orders by position/id, but its DTO omits position.
  // Preserve that order; sorting DTOs by ID would undo an author's reordering.
  if (ordered.every(card => Number.isFinite(card.position))) ordered.sort((a, b) => a.position - b.position || a.id - b.id);
  if (config.schema_version !== 1 || !Number.isInteger(config.required_count) || config.required_count < 1
    || !Number.isInteger(config.bonus_count) || config.bonus_count < 0
    || ordered.length !== config.required_count + config.bonus_count
    || config.required_count > 5000 || config.bonus_count > 5000
    || !Array.isArray(config.bands) || !Array.isArray(config.review_routes)) throw new Error('Invalid assessment configuration');
  const coverage = new Set();
  for (const band of config.bands) {
    if (!band || !band.id || !band.title || !Number.isInteger(band.min) || !Number.isInteger(band.max)
      || band.min < 0 || band.max > config.required_count || band.min > band.max) throw new Error('Invalid assessment score band');
    for (let score = band.min; score <= band.max; score++) {
      if (coverage.has(score)) throw new Error('Assessment score bands overlap');
      coverage.add(score);
    }
  }
  if (coverage.size !== config.required_count + 1) throw new Error('Assessment score bands are incomplete');
  const competencies = new Set(metadata.pedagogy.competencies?.map(item => item.id));
  if (config.review_routes.some(route => !route || !route.id || !route.title
    || !Array.isArray(route.competency_ids) || !route.competency_ids.length || route.competency_ids.some(id => !competencies.has(id))
    || !Array.isArray(route.deck_ids) || !route.deck_ids.length || route.deck_ids.some(id => !Number.isInteger(id) || id < 1))) throw new Error('Invalid assessment review route');
  if (new Set(ordered.map(card => card.id)).size !== ordered.length || ordered.some(card => {
    const ids = readCardMetadata(card).assessment?.competency_ids;
    return !Array.isArray(ids) || !ids.length || ids.some(id => !competencies.has(id));
  })) throw new Error('Assessment competency mapping is missing');
  return { id, userId, deckId: deck.id, config, cards: ordered, index: 0, results: {}, startedAt: Date.now() };
}

export function canResumeAssessment(saved, fresh) {
  return Boolean(saved && saved.userId === fresh.userId && saved.deckId === fresh.deckId
    && Array.isArray(saved.cards) && saved.cards.length === fresh.cards.length
    && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < saved.cards.length
    && JSON.stringify(saved.config) === JSON.stringify(fresh.config)
    && saved.cards.every((card, index) => {
      const current = fresh.cards[index];
      if (studyContent(card) || studyContent(current)) {
        return card.id === current.id && card.revision === current.revision
          && JSON.stringify(card.content_v2) === JSON.stringify(current.content_v2);
      }
      return card.id === current.id

        && card.context === current.context
        && JSON.stringify(readCardMetadata(card)) === JSON.stringify(readCardMetadata(current));
    }));
}

export function recordAssessmentResult(session, cardId, evidence) {
  const card = session.cards[session.index];
  if (!card || card.id !== cardId || session.results[cardId]) return session;
  const skipped = evidence.skipped === true;
  if (!skipped && evidence.gradingSummary?.final_verdict === 'unavailable') return session;
  const status = skipped ? 'skipped' : evidence.isCorrect === true ? 'correct' : 'incorrect';
  const result = { cardId, ordinal: session.index + 1, status,
    competencyIds: readCardMetadata(card).assessment.competency_ids,
    errorTypes: evidence.gradingSummary?.error_types_seen || [],
    errorCodes: evidence.gradingSummary?.error_codes_seen || [], at: new Date().toISOString(),
    ...(!skipped && validTargetRelevance(evidence.gradingSummary?.final_target_relevance)
      ? { targetRelevance: evidence.gradingSummary.final_target_relevance } : {}),
    ...(!skipped && evidence.supportEvidence ? { supportEvidence: structuredClone(evidence.supportEvidence),
      ...(evidence.taskSupport ? { taskSupport: structuredClone(evidence.taskSupport) } : {}) } : {}) };
  return { ...session, results: { ...session.results, [cardId]: result } };
}

export function assessmentSummary(session) {
  const results = Object.values(session.results);
  const core = results.filter(r => r.ordinal <= session.config.required_count);
  const bonus = results.filter(r => r.ordinal > session.config.required_count);
  const score = core.filter(r => r.status === 'correct').length;
  const weaknesses = [...new Set(results.filter(r => r.status !== 'correct').flatMap(r => r.competencyIds))];
  return { score, total: session.config.required_count, bonus: bonus.filter(r => r.status === 'correct').length,
    bonusTotal: session.config.bonus_count, skipped: results.filter(r => r.status === 'skipped').length,
    complete: results.length === session.cards.length,
    band: session.config.bands.find(b => score >= b.min && score <= b.max)?.title || '',
    recommendations: session.config.review_routes.filter(r => r.competency_ids.some(id => weaknesses.includes(id))),
    results };
}

export function assessmentAttempt(session, result, knowledgeItemId) {
  return { client_event_id: `${session.id}:${result.cardId}`, user_id: session.userId,
    card_id: result.cardId, knowledge_item_id: knowledgeItemId, review_id: null, event_time: result.at,
    evaluation_data: { schema_version: 3, evaluation_type: 'assessment', status: result.status,
      correct: result.status === 'correct', assessment: { session_id: session.id, deck_id: session.deckId,
        ordinal: result.ordinal, required_count: session.config.required_count, competency_ids: result.competencyIds },
      error_types_seen: result.errorTypes, error_codes_seen: result.errorCodes,
      ...(result.status !== 'skipped' && validTargetRelevance(result.targetRelevance)
        ? { target_relevance: result.targetRelevance } : {}),
      ...(result.status !== 'skipped' && result.supportEvidence ? { support_evidence: structuredClone(result.supportEvidence),
        ...(result.taskSupport ? { task_support: structuredClone(result.taskSupport) } : {}) } : {}) } };
}
