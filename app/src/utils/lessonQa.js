import { parseExerciseContent, getInteractiveExerciseContent } from './exerciseContentParser.js';
import { detectExerciseType } from './exerciseDetector.js';
import { parseClozeData, normalizeAnswer } from './clozeParser.js';
import { parseQuizData } from './quizParser.js';
import { parseMatchData } from './matchParser.js';
import { parseFreeTextData } from './freeTextParser.js';
import { parseEditableTextData } from './editableTextParser.js';
import { parseWordBankData } from './wordBankParser.js';
import { evaluateTrainerGaps } from './trainerEvaluation.js';

const jsonObject = value => {
  const result = typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {};
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object');
  return result;
};
const frontOf = card => card.front ?? card.front_text ?? '';
const backOf = card => card.back ?? card.back_text ?? '';
const normalize = value => String(value).trim().replace(/\s+/g, ' ');

/** Read-only diagnostics using the same parsers and evaluators as StudyCard.
 * Passport schema validation is supplied by the Python CLI's canonical validator.
 * Warnings are candidates for human review, never automatic content rewrites.
 */
export function auditLesson(snapshot) {
  if (!Array.isArray(snapshot.decks) || !Array.isArray(snapshot.cards)) throw new Error('Expected decks and cards arrays');
  const findings = [], decks = [], seenCards = new Set(), duplicates = new Map();
  const add = (severity, code, target, message, details = {}) => findings.push({ severity, code, ...target, message, ...details });
  for (const error of snapshot.import_errors || []) add('ERROR', 'syntax.import_structure', {}, 'Import structure was rejected by the canonical author parser.', { details: error });
  const deckIds = new Set(snapshot.decks.map(d => d.id));
  for (const card of snapshot.cards) {
    if (!deckIds.has(card.deck_id)) add('ERROR', 'card.orphan', { card_id: card.id, deck_id: card.deck_id }, 'Card does not belong to an audited deck.');
  }
  for (const deck of snapshot.decks) {
    const target = { deck_id: deck.id, deck_name: deck.name };
    const cards = snapshot.cards.filter(c => c.deck_id === deck.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
    let metadata = {};
    try { metadata = jsonObject(deck.metadata); }
    catch { add('ERROR', 'deck.metadata', target, 'Deck metadata is not a JSON object.'); }
    if (!cards.length) add('WARNING', 'deck.empty', target, 'Deck has no active cards.');
    if (!metadata.intro) add('SUGGESTION', 'passport.intro_missing', target, 'Add an authored lesson introduction.');
    if (!metadata.pedagogy) add('SUGGESTION', 'passport.pedagogy_missing', target, 'Add an authored learning route.');
    const pedagogy = metadata.pedagogy || {};
    const coverage = new Map();
    for (const stage of Array.isArray(pedagogy.stages) ? pedagogy.stages : []) {
      if (!Number.isInteger(stage?.from_card) || !Number.isInteger(stage?.to_card)) continue;
      if (stage.from_card < 1 || stage.from_card > stage.to_card || stage.to_card > cards.length) {
        add('ERROR', 'passport.range', target, 'Stage range exceeds the actual card ordinals.', { stage_id: stage.id, from_card: stage.from_card, to_card: stage.to_card, cards: cards.length });
        continue;
      }
      for (let i = stage.from_card; i <= stage.to_card; i++) coverage.set(i, (coverage.get(i) || 0) + 1);
    }
    if (coverage.size) {
      const missing = cards.map((_, i) => i + 1).filter(i => !coverage.has(i));
      const overlap = [...coverage].filter(([, count]) => count > 1).map(([i]) => i);
      if (missing.length) add('WARNING', 'passport.range_gap', target, 'Stage ranges leave cards uncovered; confirm this is intentional.', { ordinals: missing });
      if (overlap.length) add('WARNING', 'passport.range_overlap', target, 'Stage ranges overlap; confirm this is intentional.', { ordinals: overlap });
    }
    const competencies = new Set((Array.isArray(pedagogy.competencies) ? pedagogy.competencies : []).map(c => c?.id));
    for (const rec of Array.isArray(pedagogy.review_recommendations) ? pedagogy.review_recommendations : []) {
      const unknown = (Array.isArray(rec?.competency_ids) ? rec.competency_ids : []).filter(id => !competencies.has(id));
      if (unknown.length) add('WARNING', 'passport.competency_reference', target, 'Recommendation names competencies absent from this deck. Confirm whether they describe the destination deck; the schema does not enforce local references.', { recommendation_id: rec.id, competency_ids: unknown });
    }
    const types = {};
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i], front = frontOf(card), back = backOf(card);
      const cardTarget = { ...target, card_id: card.id, ordinal: i + 1 };
      if (seenCards.has(card.id)) add('ERROR', 'card.duplicate_id', cardTarget, 'Repeated card ID.');
      seenCards.add(card.id);
      if (!String(front).trim()) add('ERROR', 'card.empty_front', cardTarget, 'Front is empty.');
      const fingerprint = JSON.stringify([normalize(front), normalize(back)]);
      if (duplicates.has(fingerprint)) add('WARNING', 'card.duplicate_content', cardTarget, 'Same front and back as another card; review the purpose of repetition.', { duplicate_of: duplicates.get(fingerprint) });
      else duplicates.set(fingerprint, card.id);
      let cardMeta = {};
      try { cardMeta = jsonObject(card.metadata); }
      catch { add('ERROR', 'card.metadata', cardTarget, 'Card metadata is not a JSON object.'); }
      const parsed = parseExerciseContent(front), type = detectExerciseType(card);
      types[type || 'standard'] = (types[type || 'standard'] || 0) + 1;
      const markers = [...parsed.exercise.matchAll(/^\s*@(\w+)\s*$/gm)].map(m => m[1].toLowerCase());
      for (const marker of markers) if (!['puzzle', 'match', 'wordbank', 'free', 'edit', 'options'].includes(marker)) add('ERROR', 'syntax.unsupported_directive', cardTarget, `Unsupported standalone @${marker}.`);
      const interactiveBlocks = parsed.blocks.filter(b => b.type === 'exercise' && detectExerciseType(b.content));
      if (interactiveBlocks.length > 1) add('ERROR', 'syntax.multiple_mechanics', cardTarget, 'Multiple interactive blocks need author review: directives select one block, while trainers merge blocks and may duplicate gaps.');
      if (!back.trim() && !type) add('WARNING', 'card.empty_back', cardTarget, 'Standard card has no back.');
      if (/^\s*::(level|topic)\s+\S/m.test(front)) add('WARNING', 'syntax.inline_info_marker', cardTarget, 'Inline FRONT information marker is not parsed as a visual block. Use a separate marker line or CONTEXT metadata.');
      if (type === 'trainer') {
        const data = parseClozeData(card, 'classic');
        if (!data?.gaps?.length) add('ERROR', 'parser.trainer', cardTarget, 'Trainer has no parsed gaps.');
        else {
          const values = Object.fromEntries(data.gaps.map(g => [g.id, g.correctAnswer.split('|')[0]]));
          if (!evaluateTrainerGaps(data.gaps, values).accepted) add('ERROR', 'answer.authored_rejected', cardTarget, 'Authored correct answer is rejected by the runtime evaluator.');
          for (const gap of data.gaps) {
            if (!gap.correctAnswer.trim()) add('ERROR', 'answer.empty', cardTarget, 'Gap has no correct answer.');
            if (gap.mode === 'choice' && gap.correctAnswer.split('|').some(a => !gap.choices.some(c => normalizeAnswer(c) === normalizeAnswer(a)))) add('ERROR', 'answer.unavailable_choice', cardTarget, 'Correct option is missing from choices.');
            if (gap.mode === 'input' && gap.correctAnswer.length > 35 && !gap.correctAnswer.includes('|')) add('WARNING', 'answer.single_long_reference', cardTarget, 'Long typed response accepts only one authored formulation. Review legitimate alternatives.', { original: gap.correctAnswer });
          }
        }
      }
      if (type === 'word_bank' && !parseWordBankData(card)) add('ERROR', 'parser.word_bank', cardTarget, 'Invalid word bank, gap IDs, answers or option multiplicity.');
      if (type === 'match' && !parseMatchData(card)) add('ERROR', 'parser.match', cardTarget, 'Match requires at least two valid pairs.');
      if (type === 'quiz' && !parseQuizData(card)) add('ERROR', 'parser.quiz', cardTarget, 'Quiz is invalid.');
      if (type === 'free_text') {
        const data = parseFreeTextData(card);
        if (!data?.prompt) add('ERROR', 'parser.free_text', cardTarget, 'Free text has no prompt.');
        if (!cardMeta.grading_policy) add('WARNING', 'answer.free_policy_default', cardTarget, 'Free text uses controlled_text defaults; open production may need open_text and an explicit rubric.');
        if (!back.trim() && !card.context?.trim() && cardMeta.grading_policy?.mode !== 'open_text') add('ERROR', 'answer.free_reference_missing', cardTarget, 'Controlled free text has no reference.');
      }
      if (type === 'editable_text') {
        const data = parseEditableTextData(card);
        if (!data) add('ERROR', 'parser.editable_text', cardTarget, 'Editable Text requires source text and a corrected BACK.');
        else if (data.sourceText === data.correctText) add('ERROR', 'answer.no_edit', cardTarget, 'Source and correction must differ.');
        if (data && (data.sourceText.length > 4000 || data.correctText.length > 4000)) add('ERROR', 'answer.too_long', cardTarget, 'Editable Text exceeds the 4000-character answer limit.');
      }
      if (type === 'puzzle') {
        const body = getInteractiveExerciseContent(front, 'puzzle').replace(/^@puzzle\s*/i, '').trim();
        if (!body) add('ERROR', 'parser.puzzle', cardTarget, 'Puzzle has no tokens.');
        if (body && back.includes(body)) add('WARNING', 'answer.puzzle_hint_reveals_solution', cardTarget, 'Puzzle translation hint contains the complete target sentence.');
      }
      if (type && parsed.examples.length) add('WARNING', 'answer.visible_example', cardTarget, 'Example is visible before answering; check that it does not solve this exercise.');
      if (/\bTest\b/.test(front) && !back.trim()) add('WARNING', 'content.possible_placeholder', cardTarget, 'Possible test placeholder in an active lesson.');
    }
    if (pedagogy.lesson_type === 'assessment' && !pedagogy.assessment) add('WARNING', 'assessment.runtime_missing', target, 'Assessment needs an explicit validated runtime configuration; lesson_type alone does not define base/bonus points or routing.');
    if (pedagogy.assessment) {
      const assessment = pedagogy.assessment;
      if (assessment.required_count + assessment.bonus_count !== cards.length) add('ERROR', 'assessment.count', target, 'Assessment card count differs from required + bonus count.');
      for (const card of cards) {
        const cardTarget = { ...target, card_id: card.id };
        let meta = {};
        try { meta = jsonObject(card.metadata); } catch { /* existing diagnostic */ }
        if (!['trainer', 'free_text', 'editable_text'].includes(detectExerciseType(card))) add('ERROR', 'assessment.mechanic', cardTarget, 'This assessment renderer supports trainer, free_text and editable_text.');
        if (!Array.isArray(meta.assessment?.competency_ids) || !meta.assessment.competency_ids.length || meta.assessment.competency_ids.some(id => !competencies.has(id))) add('ERROR', 'assessment.competencies', cardTarget, 'Assessment must name authored competencies for every card.');
      }
    }
    decks.push({ ...target, cards: cards.length, lesson_type: pedagogy.lesson_type || null, types });
  }
  return { schema_version: 1, checked: { decks: decks.length, cards: snapshot.cards.length }, decks,
    counts: Object.fromEntries(['ERROR', 'WARNING', 'SUGGESTION'].map(s => [s, findings.filter(f => f.severity === s).length])),
    findings, limitations: ['Structural diagnostics use production parsers. Grammar and semantic correctness require a separate documented review.', 'No SRS, learner history, content or production data is changed.', 'Assessment metadata does not establish an implemented exam engine.'] };
}
