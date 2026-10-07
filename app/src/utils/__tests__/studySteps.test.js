import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStudyStepFlow, completeStudyStep, getStudyStepState, reconcileStudyStepFlow,
  normalizeStudySteps, isSuccessfulStudyAnswer, canGradeStudyFlow,
} from '../studySteps.js';

const complete = (flow, evidence = null) => completeStudyStep(flow, {
  reviewKey: flow.reviewKey, stepId: getStudyStepState(flow).currentStep?.id, evidence,
});

test('default card: answer then finish; grading remains self-assessed', () => {
  const start = createStudyStepFlow('card:1');
  assert.equal(getStudyStepState(start).currentStep.action, 'answer');
  assert.equal(getStudyStepState(start).isFinished, false);
  assert.equal(canGradeStudyFlow(start, false), true);
  assert.equal(getStudyStepState(complete(start)).isFinished, true);
});

test('answer+speak: answer evidence completes a step, not the card', () => {
  const start = createStudyStepFlow('card:1', ['answer', 'speak']);
  const evidence = { isCorrect: true, mistakeCount: 2 };
  const speaking = complete(start, evidence);
  assert.equal(getStudyStepState(speaking).currentStep.action, 'speak');
  assert.equal(getStudyStepState(speaking).isFinished, false);
  assert.equal(canGradeStudyFlow(speaking, true), false);
  assert.deepEqual(speaking.completedSteps[0].evidence, evidence);
  const finished = complete(speaking, { success: true });
  assert.equal(getStudyStepState(finished).isFinished, true);
  assert.equal(canGradeStudyFlow(finished, true), true);
  assert.equal(start.completedSteps.length, 0);
});

test('listen+speak and answer+listen+speak preserve order', () => {
  for (const actions of [['listen', 'speak'], ['answer', 'listen', 'speak']]) {
    let flow = createStudyStepFlow('card:1', actions);
    for (const action of actions) {
      assert.equal(getStudyStepState(flow).currentStep.action, action);
      assert.equal(getStudyStepState(flow).isFinished, false);
      flow = complete(flow);
    }
    assert.equal(getStudyStepState(flow).isFinished, true);
  }
});

test('duplicate, out-of-order and stale completion cannot advance another step', () => {
  const start = createStudyStepFlow('card:1', ['answer', 'speak']);
  const answerEvent = { reviewKey: start.reviewKey, stepId: start.steps[0].id };
  const speaking = completeStudyStep(start, answerEvent);
  assert.equal(completeStudyStep(speaking, answerEvent), speaking);
  assert.equal(completeStudyStep(start, { ...answerEvent, stepId: start.steps[1].id }), start);
  assert.equal(completeStudyStep(start, { ...answerEvent, reviewKey: 'old-review' }), start);
  const finished = complete(speaking);
  assert.equal(complete(finished), finished);
});

test('card ID, review index, session revision and mode reset completion', () => {
  const key = JSON.stringify([0, 1, 0, 'classic']);
  const finished = complete(createStudyStepFlow(key));
  assert.equal(reconcileStudyStepFlow(finished, key), finished);
  for (const identity of [[0, 2, 0, 'classic'], [0, 1, 1, 'classic'], [1, 1, 0, 'classic'], [0, 1, 0, 'reverse']]) {
    const reset = reconcileStudyStepFlow(finished, JSON.stringify(identity));
    assert.equal(getStudyStepState(reset).isFinished, false);
    assert.equal(reset.completedSteps.length, 0);
    assert.equal(completeStudyStep(reset, { reviewKey: key, stepId: finished.steps[0].id }), reset);
  }
});

test('configuration updates reset flow; equal descriptors preserve it', () => {
  const speaking = complete(createStudyStepFlow('card:1', ['answer', 'speak']));
  assert.equal(reconcileStudyStepFlow(speaking, 'card:1', ['answer', 'speak']), speaking);
  const reset = reconcileStudyStepFlow(speaking, 'card:1', ['listen', 'speak']);
  assert.equal(getStudyStepState(reset).currentStep.action, 'listen');
});

test('unknown future action blocks explicitly and never silently finishes', () => {
  const blocked = complete(createStudyStepFlow('card:1', ['answer', 'future-action', 'speak']));
  assert.equal(getStudyStepState(blocked).blockedAction, 'future-action');
  assert.equal(getStudyStepState(blocked).isFinished, false);
  assert.equal(complete(blocked), blocked);
  assert.equal(canGradeStudyFlow(blocked, true), false);
});

test('dialogue repeats question/answer with independent step IDs', () => {
  let flow = createStudyStepFlow('dialogue:1', [
    { id: 'listen', action: 'listen', audioRole: 'dialogue' },
    { id: 'q1', action: 'question', questionId: 1 },
    { id: 'a1', action: 'answer', questionId: 1 },
    { id: 'f1', action: 'feedback' },
    { id: 'q2', action: 'question', questionId: 2 },
    { id: 'a2', action: 'answer', questionId: 2 },
  ]);
  for (let index = 0; index < flow.steps.length; index++) {
    assert.equal(getStudyStepState(flow).currentStep.id, flow.steps[index].id);
    flow = complete(flow);
    if (index === 4) assert.equal(completeStudyStep(flow, { reviewKey: flow.reviewKey, stepId: 'a1' }), flow);
  }
  assert.equal(getStudyStepState(flow).isFinished, true);
});

test('empty/malformed plans fail explicitly instead of creating finished cards', () => {
  for (const actions of [[], 'answer', [null], [{}], [''], [{ action: 'answer', id: '' }], [{ action: 'answer', id: 'a' }, { action: 'speak', id: 'a' }]]) {
    assert.throws(() => normalizeStudySteps(actions), TypeError);
  }
});

test('legacy and failed/exhausted evidence are not confused with completion', () => {
  assert.equal(isSuccessfulStudyAnswer(true), true);
  assert.equal(isSuccessfulStudyAnswer({ isCorrect: true, completed: true }), true);
  for (const evidence of [false, null, {}, { isCorrect: false, completed: false }, { completed: true }]) {
    assert.equal(isSuccessfulStudyAnswer(evidence), false);
  }
});
