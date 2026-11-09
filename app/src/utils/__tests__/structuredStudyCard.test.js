import test from 'node:test';
import assert from 'node:assert/strict';
import { isStudyMigrationError, studyContent, studyErrorDetail, studyExerciseType, studyInfoBlocks,
  studyMatch, studyQuiz, studySideText, studyTrainer, studyWordBank, trainerWords } from '../structuredStudyCard.js';
import { evaluateTrainerGaps } from '../trainerEvaluation.js';
import { evaluateQuizOption } from '../quizEvaluation.js';
import { evaluateMatchPair } from '../matchEvaluation.js';
import { checkWordBankAssignments } from '../wordBankState.js';
import { getSpeechFollowupTarget } from '../speechFollowup.js';
import { freeTextTaskSupport } from '../supportEvidence.js';

const dto = (type, data, fields = {}) => ({
  content_v2: { schema_version: 2, card: { type, data, ...fields } },
  front: '@match\nThis legacy field must never take precedence',
});

test('native sides and exercise dispatch cover all nine types without interpreting marker text', () => {
  const cases = [
    ['theory', { text: '[[literal]] @quiz', summary: 'summary' }, '[[literal]] @quiz', 'summary'],
    ['standard', { prompt: '@free', answer: 'back' }, '@free', 'back'],
    ['trainer', { parts: [{ type: 'text', text: '___GAP_0___ ' }, { type: 'input', answers: ['eins|zwei'] }] },
      '___GAP_0___ eins|zwei', ''],
    ['quiz', { prompt: '@puzzle', back_note: 'translation' }, '@puzzle', 'translation'],
    ['match', { pairs: [{ left: 'a => b', right: 'c' }] }, 'a => b → c', ''],
    ['puzzle', { tokens: ['Am Montag', 'lerne', 'ich'], translation: 'Monday' }, 'Am Montag lerne ich', 'Monday'],
    ['word_bank', { parts: [{ type: 'gap', option: 1 }], options: ['x', 'y'] }, 'y', ''],
    ['free_text', { prompt: '@edit', sample_answer: 'sample' }, '@edit', 'sample'],
    ['editable_text', { source_text: 'incorrect', correct_text: 'correct' }, 'incorrect', 'correct'],
  ];
  for (const [type, data, prompt, answer] of cases) {
    const content = studyContent(dto(type, data));
    assert.equal(studySideText(content), prompt);
    assert.equal(studySideText(content, 'back'), answer);
    assert.equal(studyExerciseType(content), ['standard', 'theory'].includes(type) ? null : type);
  }
  assert.equal(studyContent({ front: '@match' }), null);
  assert.equal(studyContent({ content_v2: { schema_version: 1, card: { type: 'standard', data: {} } } }), null);
});

test('trainer preserves affixes and literal gap markers, accepts whole authored variants only', () => {
  const data = { parts: [
    { type: 'text', text: '___GAP_0___ klein' }, { type: 'input', answers: ['en', 'en|literal'] },
    { type: 'text', text: ' Hund ' }, { type: 'choice', options: [
      { text: 'Ja', correct: true }, { text: 'ja', correct: false },
    ] },
  ] };
  const { gaps, parts } = studyTrainer(data);
  assert.equal(gaps[0].isAffix, true);
  assert.equal(trainerWords(parts)[0][0].text, '___GAP_0___');
  assert.equal(evaluateTrainerGaps(gaps, { 0: 'en|literal', 1: 'Ja' }).accepted, true);
  assert.equal(evaluateTrainerGaps(gaps, { 0: 'literal', 1: 'Ja' }).accepted, false);
  assert.equal(evaluateTrainerGaps(gaps, { 0: 'en', 1: 'ja' }).accepted, false);
  assert.equal(getSpeechFollowupTarget(dto('trainer', data)), null);
});

test('native auto choices cover articles, prepositions and affixes without changing authored data', () => {
  for (const [answer, affix] of [['den', false], ['Den', false], ['mit', false], ['en', true]]) {
    const data = { parts: [...(affix ? [{ type: 'text', text: 'klein' }] : []),
      { type: 'choice', options: [{ text: answer, correct: true }], distractors: 'auto' }] };
    const before = structuredClone(data);
    const { gaps } = studyTrainer(data);
    assert.equal(gaps[0].mode, 'choice');
    assert.ok(gaps[0].choices.length > 1);
    assert.equal(new Set(gaps[0].choices).size, gaps[0].choices.length);
    assert.ok(gaps[0].choices.includes(answer));
    assert.equal(evaluateTrainerGaps(gaps, { 0: answer }).accepted, true);
    assert.equal(evaluateTrainerGaps(gaps, { 0: gaps[0].choices.find(text => text !== answer) }).accepted, false);
    assert.deepEqual(data, before);
  }
});

test('native auto fallback is typed input; explicit choices and multiple gaps preserve their keys', () => {
  const { gaps } = studyTrainer({ parts: [
    { type: 'choice', options: [{ text: 'unlisted-word', correct: true }], distractors: 'auto' },
    { type: 'text', text: ' ' },
    { type: 'choice', options: [{ text: 'den', correct: true }, { text: 'dem', correct: false }] },
    { type: 'text', text: ' ' }, { type: 'input', answers: ['das'] },
  ] });
  assert.equal(gaps[0].mode, 'input');
  assert.deepEqual(gaps[0].choices, []);
  assert.deepEqual(gaps[1].choices, ['den', 'dem']);
  assert.deepEqual(gaps.map(gap => gap.id), [0, 1, 2]);
  assert.equal(evaluateTrainerGaps(gaps, { 0: 'unlisted-word', 1: 'den', 2: 'das' }).accepted, true);
});

test('quiz, match, and word bank keep authored keys and distinguish similar labels', () => {
  const { options } = studyQuiz({ prompt: '', options: [
    { text: 'A', correct: true }, { text: 'B', correct: true }, { text: 'C', correct: false },
  ] });
  assert.equal(evaluateQuizOption(options, 1).accepted, true);
  assert.equal(evaluateQuizOption(options, 2).accepted, false);
  const { pairs } = studyMatch({ pairs: [{ left: '1', right: 'x  y' }, { left: '2', right: 'x y' }] });
  assert.equal(evaluateMatchPair(pairs, {}, 0, 1, { exact: true }).interactionCorrect, false);
  const bank = studyWordBank({ options: ['Ja', 'ja', 'Ja'], parts: [{ type: 'gap', option: 0 }] });
  assert.equal(checkWordBankAssignments(bank.gaps, bank.options, { 'gap-0': 'option-1' }).allCorrect, false);
  assert.equal(checkWordBankAssignments(bank.gaps, bank.options, { 'gap-0': 'option-2' }).allCorrect, true);
});

test('information/support and migration errors use structured fields', () => {
  const info = [{ type: 'source', text: 'Literal ::example' }, { type: 'options', items: ['one | two'] }];
  const card = dto('free_text', { prompt: '@quiz', sample_answer: 'Sample' }, { info });
  assert.deepEqual(studyInfoBlocks(studyContent(card)), [
    { type: 'source', content: 'Literal ::example' }, { type: 'options', options: ['one | two'] },
  ]);
  assert.equal(freeTextTaskSupport(card).source_text_present, true);
  assert.equal(freeTextTaskSupport(card).authored_example_present, false);
  assert.equal(isStudyMigrationError(studyErrorDetail({
    response: { status: 409, data: { detail: { code: 'card_requires_migration' } } },
  })), true);
});
