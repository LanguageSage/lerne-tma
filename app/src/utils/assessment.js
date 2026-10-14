import { parseDeckMetadata } from './deckUtils.js';

export const readCardMetadata = card => {
  try { return typeof card.metadata === 'string' ? JSON.parse(card.metadata) : card.metadata || {}; }
  catch { return {}; }
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
      return card.id === current.id
        && (card.front ?? card.front_text) === (current.front ?? current.front_text)
        && (card.back ?? card.back_text) === (current.back ?? current.back_text)
        && card.context === current.context
        && JSON.stringify(readCardMetadata(card)) === JSON.stringify(readCardMetadata(current));
    }));
}

export function recordAssessmentResult(session, cardId, evidence) {
  const card = session.cards[session.index];
  if (!card || card.id !== cardId || session.results[cardId]) return session;
  const skipped = evidence.skipped === true;
  const status = skipped ? 'skipped' : evidence.isCorrect === true ? 'correct' : 'incorrect';
  const result = { cardId, ordinal: session.index + 1, status,
    competencyIds: readCardMetadata(card).assessment.competency_ids,
    errorTypes: evidence.gradingSummary?.error_types_seen || [],
    errorCodes: evidence.gradingSummary?.error_codes_seen || [], at: new Date().toISOString() };
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
      error_types_seen: result.errorTypes, error_codes_seen: result.errorCodes } };
}
