import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAssessment, canResumeAssessment, recordAssessmentResult, assessmentSummary, assessmentAttempt } from '../assessment.js';
import { auditLesson } from '../lessonQa.js';
import { studyQuiz } from '../structuredStudyCard.js';
import { evaluateQuizOption } from '../quizEvaluation.js';

const sourceCourse = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/lesson-qa/corrected.json', import.meta.url)));
const course = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/lesson-qa/assessment-v2.json', import.meta.url)));
const deck = course.decks.find(d => d.id === 114);
const cards = course.cards.filter(c => c.deck_id === deck.id);
const start = () => createAssessment(deck, cards, 1, 'session');
const complete = status => {
  let session = start();
  for (const card of session.cards) {
    session = recordAssessmentResult(session, card.id, status(session.index));
    session = { ...session, index: session.index + 1 };
  }
  return session;
};

test('46 correct core answers stay 46/46 with two failed bonus answers', () => {
  const summary = assessmentSummary(complete(i => ({ isCorrect: i < 46 })));
  assert.equal(summary.score, 46);
  assert.equal(summary.total, 46);
  assert.equal(summary.bonus, 0);
  assert.equal(summary.band, 'Уверенное освоение');
  assert.equal(summary.complete, true);
});
test('all skipped: 0/46, 48 skips, routes follow named competencies', () => {
  const summary = assessmentSummary(complete(() => ({ skipped: true })));
  assert.equal(summary.score, 0);
  assert.equal(summary.skipped, 48);
  assert.equal(summary.recommendations.length, 5);
});
test('first answer is immutable; stale/different card callbacks do nothing', () => {
  const first = start();
  const next = recordAssessmentResult(first, first.cards[0].id, { isCorrect: false });
  assert.equal(recordAssessmentResult(next, first.cards[0].id, { isCorrect: true }), next);
  assert.equal(recordAssessmentResult(first, first.cards[1].id, { isCorrect: true }), first);
  assert.equal(assessmentSummary(next).score, 0);
});
test('corrected course has explicit policies, valid assessment mechanics and preserved IDs', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/lesson-qa/source-ids.json', import.meta.url)));
  assert.deepEqual(sourceCourse.cards.map(c => c.id), source.cards.map(c => c.id));
  const report = auditLesson(sourceCourse);
  assert.equal(report.counts.ERROR, 0);
  assert.equal(report.findings.some(f => f.code === 'assessment.runtime_missing'), false);
  const options = studyQuiz(course.cards.find(c => c.id === 10002).content_v2.card.data).options;
  assert.equal(evaluateQuizOption(options, options.find(o => o.text.includes(', den ich')).id).accepted, true);
  assert.equal(evaluateQuizOption(options, options.find(o => o.text.includes(', der ich')).id).accepted, false);
});
test('knowledge evidence uses objective correctness, no self-rating, stable idempotency ID', () => {
  const session = start();
  const next = recordAssessmentResult(session, session.cards[0].id, { isCorrect: false,
    gradingSummary: { error_types_seen: ['grammar'], error_codes_seen: ['relative.case'] } });
  const attempt = assessmentAttempt(next, next.results[session.cards[0].id], 7);
  assert.equal(attempt.client_event_id, `session:${session.cards[0].id}`);
  assert.equal(attempt.evaluation_data.correct, false);
  assert.equal(attempt.evaluation_data.rating, undefined);
  assert.deepEqual(attempt.evaluation_data.assessment.competency_ids, ['comp_exam_nominative']);
});
test('bad required/bonus count cannot begin an exam; ordinary decks return null', () => {
  assert.throws(() => createAssessment(deck, cards.slice(1), 1));
  assert.equal(createAssessment(course.decks[0], [], 1), null);
});

test('invalid competency payload becomes a QA error and cannot start an exam', () => {
  const malformed = structuredClone(course);
  const card = malformed.cards.find(c => c.id === cards[0].id);
  card.content_v2.card.metadata.assessment.competency_ids = 'comp_exam_nominative';
  assert.throws(() => createAssessment(deck, malformed.cards.filter(c => c.deck_id === deck.id), 1));
});

test('server DTO keeps authored order and resumes cloned metadata; changed content or account cannot resume', () => {
  const dto = cards.map(card => { const row = structuredClone(card); delete row.position; return row; });
  const reordered = [dto[1], dto[0], ...dto.slice(2)];
  const fresh = createAssessment(deck, reordered, 1, 'fresh');
  assert.deepEqual(fresh.cards.map(c => c.id), reordered.map(c => c.id));
  const saved = structuredClone(fresh);
  saved.index = 1;
  assert.equal(canResumeAssessment(saved, fresh), true);
  saved.cards[0].content_v2.card.explanation += 'Changed';
  assert.equal(canResumeAssessment(saved, fresh), false);
  assert.equal(canResumeAssessment({ ...fresh, userId: 2 }, fresh), false);
});
