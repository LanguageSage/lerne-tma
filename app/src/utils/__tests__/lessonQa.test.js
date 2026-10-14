import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditLesson } from '../lessonQa.js';
import { detectExerciseType } from '../exerciseDetector.js';
import { parseClozeData } from '../clozeParser.js';
import { evaluateTrainerGaps } from '../trainerEvaluation.js';
import { parseQuizData } from '../quizParser.js';
import { evaluateQuizOption } from '../quizEvaluation.js';
import { calculateSessionStats } from '../sessionStats.js';

const snapshot = JSON.parse(fs.readFileSync(new URL('../../../../reports/lesson-qa/relativsaetze.snapshot.json', import.meta.url)));
const lesson = front => ({ decks: [{ id: 1, name: 'Fixture', metadata: {} }], cards: [{ id: 2, deck_id: 1, front, back: '' }] });

test('viewing or skipping all real D14 cards cannot invent a perfect score; generic stats include bonus reviews', () => {
  const d14 = snapshot.cards.filter(c => c.deck_id === 7139);
  assert.equal(calculateSessionStats({ reviewsCount: 0, studyHistory: d14 }), null);
  assert.equal(calculateSessionStats({ reviewsCount: 48, correctCount: 46, mistakeCount: 2 }).accuracy, '96%');
});

test('every real trainer rejects empty/foreign input, accepts every authored variant; quizzes obey their authored keys', () => {
  for (const card of snapshot.cards) {
    const type = detectExerciseType(card);
    if (type === 'trainer') {
      const { gaps } = parseClozeData(card, 'classic');
      assert.equal(evaluateTrainerGaps(gaps, {}).accepted, false, String(card.id));
      assert.equal(evaluateTrainerGaps(gaps, Object.fromEntries(gaps.map(g => [g.id, 'zz_unrelated_answer']))).accepted, false, String(card.id));
      const base = Object.fromEntries(gaps.map(g => [g.id, g.correctAnswer.split('|')[0]]));
      for (const gap of gaps) for (const answer of gap.correctAnswer.split('|')) {
        assert.equal(evaluateTrainerGaps(gaps, { ...base, [gap.id]: answer }).accepted, true, String(card.id));
      }
    } else if (type === 'quiz') {
      const { options } = parseQuizData(card);
      for (const option of options) assert.equal(evaluateQuizOption(options, option.id).accepted, option.isCorrect, String(card.id));
    }
  }
});

test('Markdown preserves multiple authored choice answers, rejects distractors and retains surrounding spaces', () => {
  const data = parseClozeData({ front: '**Das** ist der Anbieter, {*mit dem|*bei dem|für den} ich den Vertrag abgeschlossen habe.' }, 'classic');
  assert.equal(data.maskedText, 'Das ist der Anbieter, ___GAP_0___ ich den Vertrag abgeschlossen habe.');
  for (const answer of ['mit dem', 'bei dem']) assert.equal(evaluateTrainerGaps(data.gaps, { 0: answer }).accepted, true);
  assert.equal(evaluateTrainerGaps(data.gaps, { 0: 'für den' }).accepted, false);
});

test('review evidence: explicitly permitted D14 and D13 alternatives are currently rejected by exact input', () => {
  for (const [id, alternative] of [[358402, 'in der mein Sohn lernt'], [358406, 'Ich suche eine Wohnung, die sehr hell ist.'],
    [358330, 'Das ist die Firma, in der mein Bruder arbeitet.'], [358335, 'Ein Freund, dem ich oft helfe, hat ihn repariert.']]) {
    const card = snapshot.cards.find(c => c.id === id);
    assert.equal(evaluateTrainerGaps(parseClozeData(card, 'classic').gaps, { 0: alternative }).accepted, false, String(id));
  }
});

test('review evidence: real quiz 348708 accepts the grammatically wrong starred key and rejects den', () => {
  const { options } = parseQuizData(snapshot.cards.find(c => c.id === 348708));
  const wrong = options.find(o => o.text.includes(', der ich'));
  const right = options.find(o => o.text.includes(', den ich'));
  assert.equal(evaluateQuizOption(options, wrong.id).accepted, true);
  assert.equal(evaluateQuizOption(options, right.id).accepted, false);
});

test('all 678 real course cards run through runtime parsers without mutating the source', () => {
  const before = JSON.stringify(snapshot);
  const report = auditLesson(snapshot);
  assert.deepEqual(report.checked, { decks: 14, cards: 678 });
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(report.findings.filter(f => f.code.startsWith('parser.') || f.code === 'answer.authored_rejected').length, 0);
  assert.ok(report.findings.some(f => f.card_id === 349141 && f.code === 'content.possible_placeholder'));
  assert.ok(report.findings.some(f => f.deck_id === 7139 && f.code === 'assessment.runtime_missing'));
});

test('broken word bank and multiple interactive blocks are errors; task directives are literal', () => {
  assert.ok(auditLesson(lesson('@wordbank\nHallo <<1>>\n@options\nWelt')).findings.some(f => f.code === 'parser.word_bank'));
  assert.ok(auditLesson(lesson('@puzzle\nHallo Welt\n::exercise\n[[gut]]')).findings.some(f => f.code === 'syntax.multiple_mechanics'));
  assert.equal(auditLesson(lesson('::task\n@unsupported\n::exercise\n[[gut]]')).findings.some(f => f.code === 'syntax.unsupported_directive'), false);
});

test('ranges use sorted ordinal cards, flag gaps/overlap/out-of-bounds, never raw positions', () => {
  const data = { decks: [{ id: 1, metadata: { pedagogy: { stages: [
    { id: 'a', from_card: 1, to_card: 1 }, { id: 'b', from_card: 1, to_card: 1 }, { id: 'c', from_card: 2, to_card: 10 },
  ] } } }], cards: [1, 2, 3].map(id => ({ id, deck_id: 1, position: id * 100, front: '[[der]]' })) };
  const codes = auditLesson(data).findings.map(f => f.code);
  for (const code of ['passport.range', 'passport.range_gap', 'passport.range_overlap']) assert.ok(codes.includes(code));
});

test('duplicate text is a review warning, missing fields and unsupported directives retain stable IDs', () => {
  const data = lesson('@unknown\nX');
  data.cards.push({ ...data.cards[0], id: 3 });
  data.cards.push({ id: 4, deck_id: 1, front: '' });
  const report = auditLesson(data);
  assert.ok(report.findings.some(f => f.code === 'syntax.unsupported_directive' && f.severity === 'ERROR'));
  assert.ok(report.findings.some(f => f.code === 'card.duplicate_content' && f.card_id === 3 && f.duplicate_of === 2 && f.severity === 'WARNING'));
  assert.ok(report.findings.some(f => f.card_id === 4 && f.code === 'card.empty_front'));
});
