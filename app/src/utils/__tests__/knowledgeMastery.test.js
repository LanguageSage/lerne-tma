import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectKnowledgeMastery } from '../knowledgeMastery.js';
import { studyTrainer } from '../structuredStudyCard.js';

const key = 'de.syntax.prepositions';
const now = '2026-11-26T12:00:00Z';
const skills = [{ rule_code: key, name: 'Prepositions', kind: 'skill', prerequisite_keys: ['de.syntax.case'] }];
const zeroHelp = { tracking_complete: true, hint_count: 0, translation_view_count: 0, answer_reveal_count: 0, other_help_count: 0 };
const noScaffold = { answer_options_present: false, sentence_frame_present: false, source_text_present: false,
  source_vocabulary_present: false, authored_example_present: false };

function attempt(id, { type = 'quiz', right = true, mistakes = 0, task = String(id), content = task,
  authoredExample, ability, support, scaffold, evaluator = 'rules', source = 'study', relevance, time = now } = {}) {
  return {
    client_event_id: String(id), task_key: task, example_fingerprint: content,
    example_key: authoredExample, event_time: time, knowledge_item_id: key, card_type: type, ability,
    evaluation_data: {
      source, rating: 3, extended: false, exercise: { correct: right, mistake_count: mistakes },
      grading: { final_evaluator: evaluator, final_target_relevance: relevance }, support, task_support: scaffold,
    },
  };
}
const dimension = (attempts, ability = 'recognition', asOf = now) => (
  projectKnowledgeMastery({ skills, attempts, now: asOf }).skills[0].dimensions.find(item => item.ability === ability)
);

test('untested, insufficient, partial, mastered and weak represent different kinds of evidence', () => {
  assert.equal(dimension([]).status, 'not_checked');
  assert.equal(dimension([attempt(1, { right: false })]).status, 'insufficient_evidence');
  assert.equal(dimension([attempt(1), attempt(2)]).status, 'partially_mastered');
  assert.equal(dimension([attempt(1), attempt(2), attempt(3)]).status, 'mastered');
  assert.equal(dimension([attempt(1), attempt(2), attempt(3), attempt(4, { right: false })]).status, 'partially_mastered');
  const weak = dimension([attempt(1, { mistakes: 1 }), attempt(2, { right: false })]);
  assert.equal(weak.status, 'weak');
  assert.deepEqual(weak.evidence.map(item => item.reason), ['mistakes_before_success', 'verified_error']);
});

test('duplicate deliveries, identical tasks, revisions of a card and authored sibling examples do not multiply confidence', () => {
  const base = [
    attempt(1, { task: 'from-deck-1', content: 'same-prompt' }),
    attempt(2, { task: 'from-deck-2', content: 'same-prompt', authoredExample: 'family-a' }),
    attempt(3, { task: 'from-deck-2', content: 'revised-prompt' }),
    attempt(4, { task: 'from-deck-3', content: 'different-phrasing', authoredExample: 'family-a' }),
  ];
  const attempts = [base[2], ...base].reverse();
  const result = dimension(attempts);
  assert.equal(result.event_count, 4);
  assert.equal(result.independent_examples, 1);
  assert.equal(result.status, 'insufficient_evidence');
  assert.deepEqual(result, dimension(base));
});

test('recent independent rechecks can improve an assessment while aging lowers confidence without changing proficiency', () => {
  const june = '2026-06-01T12:00:00Z';
  const attempts = [attempt(1, { time: june }), attempt(2, { time: june }), attempt(3, { time: june })];
  const fresh = dimension(attempts, 'recognition', june);
  const stale = dimension(attempts);
  assert.equal(fresh.status, 'mastered');
  assert.equal(stale.status, 'needs_recheck');
  assert.equal(stale.proficiency, fresh.proficiency);
  assert.equal(stale.confidence, fresh.confidence / 2);
  assert.equal(dimension([...attempts, attempt(4, { task: '1', content: '1' })]).status, 'mastered');
});

test('recognition, actual assistance, self-rating and independent written application remain distinct', () => {
  const recognition = [attempt(1), attempt(2), attempt(3)];
  const applications = [4, 5].map(id => attempt(id, {
    type: 'free_text', ability: 'application', evaluator: 'rules', source: 'diagnostic', relevance: 'primary', right: false, support: zeroHelp,
    scaffold: noScaffold,
  }));
  assert.equal(dimension([...recognition, ...applications]).status, 'mastered');
  assert.equal(dimension([...recognition, ...applications], 'application').status, 'weak');
  const free = [6, 7, 8].map(id => attempt(id, {
    type: 'free_text', ability: 'application', evaluator: 'local', support: zeroHelp, scaffold: noScaffold,
  }));
  assert.equal(dimension(free, 'application').status, 'mastered');
  const assisted = [6, 7, 8].map(id => attempt(id,
    { type: 'free_text', ability: 'application', evaluator: 'local', support: { ...zeroHelp, hint_count: 1 } }));
  assert.equal(dimension(assisted, 'application').status, 'not_checked');
  assert.ok(dimension(assisted, 'reproduction').confidence < dimension(free, 'application').confidence);
  const unknown = [6, 7, 8].map(id => attempt(id, { type: 'free_text', ability: 'application', evaluator: 'local' }));
  assert.equal(dimension(unknown, 'reproduction').status, 'partially_mastered');
  assert.equal(dimension(unknown, 'application').status, 'not_checked');
  const unverified = [6, 7].map(id => attempt(id, { type: 'free_text', evaluator: 'local', right: false }));
  assert.equal(dimension(unverified, 'reproduction').status, 'insufficient_evidence');
  const recoveredFree = free.map((event) => ({ ...event, evaluation_data: { ...event.evaluation_data,
    exercise: { correct: true, mistake_count: 1 } } }));
  assert.equal(dimension(recoveredFree, 'application').status, 'partially_mastered');
  assert.equal(dimension(recoveredFree, 'application').evidence.some(item => item.error), false);
  const rating = attempt(6, { type: 'standard' });
  delete rating.evaluation_data.exercise;
  assert.equal(dimension([rating], 'self_rating').status, 'insufficient_evidence');
  assert.equal(dimension([rating]).status, 'not_checked');
});

test('D07 scores Trainer by observed answer mode and requires explicit absence of Free Text scaffolding', () => {
  const fallback = studyTrainer({ parts: [{ type: 'choice', distractors: 'auto', options: [{ text: 'Zwetschgenbaum', correct: true }] }] });
  assert.equal(fallback.gaps[0].mode, 'input');
  assert.equal(fallback.answerMode, 'input');
  const input = attempt(1, { type: 'trainer', ability: 'recognition', scaffold: { answer_options_present: false } });
  assert.equal(dimension([input], 'guided_application').event_count, 1);
  assert.equal(dimension([input], 'recognition').event_count, 0);
  const observedInput = attempt(2, { type: 'trainer', ability: 'recognition',
    scaffold: { answer_options_present: true, trainer_answer_mode: fallback.answerMode } });
  const observedChoice = attempt(3, { type: 'trainer', ability: 'guided_application',
    scaffold: { answer_options_present: true, trainer_answer_mode: 'choice' } });
  assert.equal(dimension([observedInput], 'guided_application').independent_examples, 1);
  assert.equal(dimension([observedChoice], 'recognition').independent_examples, 1);
  const unclearMode = attempt(4, { type: 'trainer', ability: 'recognition', scaffold: { answer_options_present: true } });
  assert.equal(dimension([unclearMode], 'guided_application').independent_examples, 0);
  for (const scaffold of [undefined, {}, { ...noScaffold, sentence_frame_present: null }, { ...noScaffold, source_text_present: true }]) {
    const free = [6, 7, 8].map(id => attempt(id, { type: 'free_text', ability: 'application', evaluator: 'local', support: zeroHelp, scaffold }));
    assert.equal(dimension(free, 'application').status, 'not_checked');
    assert.equal(dimension(free, 'reproduction').status, 'partially_mastered');
  }
});

test('D08 includes exact percentage boundaries and leaves the adjacent scores on their correct sides', () => {
  const score = (correct, total) => dimension(Array.from({ length: total }, (_, i) => attempt(i, { right: i < correct })));
  assert.equal(score(4, 5).status, 'mastered');
  assert.equal(score(399, 500).status, 'partially_mastered');
  assert.equal(score(400, 500).proficiency, 0.8);
  assert.equal(score(401, 500).status, 'mastered');
  assert.equal(score(549, 1000).status, 'weak');
  assert.equal(score(550, 1000).proficiency, 0.55);
  assert.equal(score(550, 1000).status, 'weak');
  assert.equal(score(551, 1000).status, 'partially_mastered');
  assert.equal(score(1, 2).status, 'partially_mastered');
  const attempts = [1, 2, 3].map(id => attempt(id));
  const freshnessBoundary = Date.parse(now) + 90 * 86_400_000;
  for (const [offset, expected] of [[-1, 'mastered'], [0, 'mastered'], [1, 'needs_recheck']]) {
    assert.equal(dimension(attempts, 'recognition', freshnessBoundary + offset).status, expected);
  }
});

test('revealed solutions and untrusted grading do not add objective evidence', () => {
  const rows = [attempt(1, { support: { answer_reveal_count: 1 } }), attempt(2, { evaluator: 'ai' })];
  assert.equal(dimension(rows).status, 'insufficient_evidence');
  assert.equal(dimension(rows).independent_examples, 0);
  assert.equal(dimension(rows).proficiency, null);
});
