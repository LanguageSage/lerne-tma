import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { useFreeTextEvaluation } from '../../hooks/useFreeTextEvaluation.js';

const evaluateHandler = async (_cardId, answer) => {
  if (answer.toLowerCase().includes('wrong')) {
    return {
      result: { verdict: 'needs_retry', accepted: false, error_type: 'grammar', error_code: 'grammar.article_case', evaluator: 'ai' },
      grading_policy: { max_retries: 3 },
    };
  }
  return {
    result: { verdict: 'correct', accepted: true, evaluator: 'exact' },
    grading_policy: { max_retries: 3 },
  };
};

// Setup minimal React hook harness for node:test runner
function createHookHarness(hookFn) {
  let hookStates = [];
  let hookIndex = 0;
  let activeEffectCleanups = [];

  const dispatcher = {
    useState(initial) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = action => {
        hookStates[idx] = typeof action === 'function' ? action(hookStates[idx]) : action;
      };
      return [hookStates[idx], setState];
    },
    useRef(initial) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = { current: initial };
      }
      return hookStates[idx];
    },
    useEffect(effect) {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = true;
        const cleanup = effect();
        if (typeof cleanup === 'function') activeEffectCleanups.push(cleanup);
      }
    },
  };

  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = dispatcher;

  let latestResult = null;
  const render = (...args) => {
    hookIndex = 0;
    latestResult = hookFn(...args);
    return latestResult;
  };

  const unmount = () => {
    activeEffectCleanups.forEach(c => c());
    activeEffectCleanups = [];
  };

  return { render, get result() { return latestResult; }, unmount };
}

test('free_text card A -> correct -> free_text card B starts completely from clean state', async () => {
  const harness = createHookHarness((cardId, savedState, reviewKey) =>
    useFreeTextEvaluation(cardId, savedState, reviewKey, evaluateHandler)
  );

  // 1. Mount Card A (reviewKey "cardA:0")
  harness.render('cardA', undefined, 'cardA:0');
  assert.equal(harness.result.state.attemptCount, 0);
  assert.equal(harness.result.state.mistakeCount, 0);
  assert.equal(harness.result.state.result, null);
  assert.equal(harness.result.evidence, null);

  // Submit correct answer on Card A
  await harness.result.submit('Answer A');
  harness.render('cardA', undefined, 'cardA:0');
  assert.equal(harness.result.state.attemptCount, 1);
  assert.equal(harness.result.state.mistakeCount, 0);
  assert.equal(harness.result.state.result?.accepted, true);
  assert.equal(harness.result.evidence?.isCorrect, true);

  // 2. Transition to Card B (reviewKey "cardB:1") within the same mounted component
  harness.render('cardB', undefined, 'cardB:1');

  // Card B MUST start completely clean!
  assert.equal(harness.result.state.attemptCount, 0, 'Card B must have attemptCount = 0');
  assert.equal(harness.result.state.mistakeCount, 0, 'Card B must have mistakeCount = 0');
  assert.equal(harness.result.state.result, null, 'Card B must have result = null');
  assert.equal(harness.result.evidence, null, 'Card B must have evidence = null');
  assert.equal(harness.result.state.loading, false, 'Card B must not be loading');
  harness.unmount();
});

test('card A review #1 -> errors/answer -> later card A review #2 has a new evaluation session', async () => {
  const harness = createHookHarness((cardId, savedState, reviewKey) =>
    useFreeTextEvaluation(cardId, savedState, reviewKey, evaluateHandler)
  );

  // Review #1 for Card A (historyIndex = 0, reviewKey "cardA:0")
  harness.render('cardA', undefined, 'cardA:0');
  await harness.result.submit('wrong answer');
  harness.render('cardA', undefined, 'cardA:0');
  assert.equal(harness.result.state.attemptCount, 1);
  assert.equal(harness.result.state.mistakeCount, 1);

  await harness.result.submit('correct answer');
  harness.render('cardA', undefined, 'cardA:0');
  assert.equal(harness.result.state.attemptCount, 2);
  assert.equal(harness.result.state.mistakeCount, 1);
  assert.equal(harness.result.evidence?.isFirstTry, false);

  // Cards B, C, D are reviewed... Then Card A appears again in Review #2 (historyIndex = 15, reviewKey "cardA:15")
  harness.render('cardA', undefined, 'cardA:15');

  // Review #2 for SAME cardA MUST start a fresh evaluation session!
  assert.equal(harness.result.state.attemptCount, 0, 'Review #2 must start with attemptCount = 0');
  assert.equal(harness.result.state.mistakeCount, 0, 'Review #2 must start with mistakeCount = 0');
  assert.equal(harness.result.state.result, null, 'Review #2 must start with result = null');
  assert.equal(harness.result.evidence, null, 'Review #2 must start with evidence = null');
  harness.unmount();
});

test('flip restoration inside one review preserves current state and errors', async () => {
  // Review #1 for Card A: user makes a mistake
  const harness1 = createHookHarness((cardId, savedState, reviewKey) =>
    useFreeTextEvaluation(cardId, savedState, reviewKey, evaluateHandler)
  );
  harness1.render('cardA', undefined, 'cardA:0');
  await harness1.result.submit('wrong answer');
  harness1.render('cardA', undefined, 'cardA:0');
  assert.equal(harness1.result.state.attemptCount, 1);
  assert.equal(harness1.result.state.mistakeCount, 1);

  // Simulate flip: state is saved to exerciseStates['cardA:0']
  const savedEvaluationState = harness1.result.state;
  harness1.unmount();

  // User flips back to front: component remounts with savedState for 'cardA:0'
  const harness2 = createHookHarness((cardId, savedState, reviewKey) =>
    useFreeTextEvaluation(cardId, savedState, reviewKey, evaluateHandler)
  );
  harness2.render('cardA', savedEvaluationState, 'cardA:0');

  // State must be accurately restored from review!
  assert.equal(harness2.result.state.attemptCount, 1, 'Restored state must keep attemptCount = 1');
  assert.equal(harness2.result.state.mistakeCount, 1, 'Restored state must keep mistakeCount = 1');
  assert.equal(harness2.result.state.errors.length, 1, 'Restored state must keep errors');

  // Next correct attempt counts as attempt 2, not first try!
  await harness2.result.submit('correct answer');
  harness2.render('cardA', savedEvaluationState, 'cardA:0');
  assert.equal(harness2.result.state.attemptCount, 2);
  assert.equal(harness2.result.evidence?.isFirstTry, false);
  harness2.unmount();
});
