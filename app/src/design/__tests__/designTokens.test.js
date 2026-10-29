import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignConfig, mergeDesignConfig } from '../designConfig.js';
import { designConfigToCssVariables, applyPublishedDesignTokens } from '../designTokens.js';

test('all three background modes, independent stops, position and glow produce CSS', () => {
  const config = normalizeDesignConfig({ global: { background: { mode: 'solid', color1: '#102030' } } });
  assert.equal(designConfigToCssVariables(config)['--design-app-bg'], '#102030');
  config.global.background.mode = 'linear';
  config.global.background.colorCount = 2;
  config.global.background.angle = 270;
  assert.equal(designConfigToCssVariables(config)['--design-app-bg'], 'linear-gradient(270deg, #102030, #16213e)');
  config.global.background.mode = 'radial';
  config.global.background.positionX = 20;
  config.global.background.positionY = 70;
  config.global.background.glow = 0.4;
  assert.match(designConfigToCssVariables(config)['--design-app-bg'], /circle at 20% 70%/);
  assert.match(designConfigToCssVariables(config)['--design-app-bg'], /rgba\(167,139,250,0.4\)/);
});

test('panel alpha, border alpha, blur, radius, shadow and light are independent', () => {
  const vars = designConfigToCssVariables({ global: { glassOpacity: 0, glassBlur: '0px', commonRadius: '0px', panels: { color: '#123456', borderColor: '#abcdef', borderOpacity: 0.4, shadow: 0, innerLight: 0.2 } } });
  assert.equal(vars['--design-glass-bg'], 'rgba(18,52,86,0)');
  assert.equal(vars['--design-glass-border'], 'rgba(171,205,239,0.4)');
  assert.equal(vars['--design-glass-blur'], '0px');
  assert.equal(vars['--design-radius'], '0px');
  assert.match(vars['--design-panel-shadow'], /inset 0 1px 0 rgba\(255,255,255,0.2\)/);
});

test('global button states and interface typography never replace exercise or card tokens', () => {
  const baseline = designConfigToCssVariables({});
  const vars = designConfigToCssVariables({ global: { typography: { textColor: '#123456' }, buttons: { primary: { hover: { color1: '#ff0000', textColor: '#00ff00', iconColor: '#0000ff' } } } } });
  assert.equal(vars['--design-ui-btn-primary-hover-color'], '#00ff00');
  assert.equal(vars['--design-ui-btn-primary-hover-icon'], '#0000ff');
  for (const key of Object.keys(baseline).filter(key => !key.startsWith('--design-ui-'))) {
    if (/front|back|choice|correct|wrong|cloze|match|wb-|ft-|cl-|btn-/.test(key)) assert.equal(vars[key], baseline[key], key);
  }
});

test('converter is pure; only applying published config writes global tokens', () => {
  const writes = new Map();
  const original = globalThis.document;
  globalThis.document = { documentElement: { style: { setProperty: (key, value) => writes.set(key, value) } } };
  try {
    const published = normalizeDesignConfig({ global: { background: { mode: 'solid', color1: '#111111' } } });
    applyPublishedDesignTokens(published);
    const draft = mergeDesignConfig(published, { global: { background: { color1: '#222222' } } });
    assert.equal(designConfigToCssVariables(draft)['--design-app-bg'], '#222222');
    assert.equal(writes.get('--design-app-bg'), '#111111');
  } finally { globalThis.document = original; }
});


test('legacy V2 surface and border values retain their original transparency', () => {
  const vars = designConfigToCssVariables({ global: { glassBg: 'rgba(20,30,40,0.65)', glassOpacity: 0.05, glassBorder: 'rgba(50,60,70,0.3)' } });
  assert.equal(vars['--design-glass-bg'], 'rgba(20,30,40,0.65)');
  assert.equal(vars['--design-glass-border'], 'rgba(50,60,70,0.3)');
});

test('local preview tokens can update root properties without server publication', () => {
  const writes = new Map();
  const original = globalThis.document;
  globalThis.document = { documentElement: { style: { setProperty: (key, value) => writes.set(key, value) } } };
  try {
    const draft = normalizeDesignConfig({ global: { background: { mode: 'solid', color1: '#445566' } } });
    applyPublishedDesignTokens(draft);
    assert.equal(writes.get('--design-app-bg'), '#445566');
  } finally { globalThis.document = original; }
});


test('Quiz and Match preserve independent text, background and border for every state', () => {
  const config = normalizeDesignConfig({});
  const states = ['normal', 'selected', 'correct', 'wrong', 'disabled'];
  for (const [i, state] of states.entries()) {
    config.exercises.choice[state] = { color: `#11${i}011`, bg: `#22${i}022`, borderColor: `#33${i}033` };
    const matchState = state === 'normal' ? 'item' : state === 'correct' ? 'matched' : state;
    config.exercises.match[matchState] = { color: `#44${i}044`, bg: `#55${i}055`, borderColor: `#66${i}066` };
  }
  const vars = designConfigToCssVariables(config);
  for (const [i, state] of states.entries()) {
    const matchState = state === 'normal' ? 'item' : state === 'correct' ? 'matched' : state;
    for (const [prop, digit] of [['color', 1], ['bg', 2], ['border', 3]]) {
      assert.equal(vars[`--design-choice-${state}-${prop}`], `#${digit}${digit}${i}0${digit}${digit}`);
      assert.equal(vars[`--design-match-${matchState}-${prop}`], `#${digit+3}${digit+3}${i}0${digit+3}${digit+3}`);
    }
  }
  const oldV2 = normalizeDesignConfig({ schemaVersion: 2, exercises: { match: { item: { color: '#abcdef' } } } });
  assert.equal(oldV2.exercises.match.item.color, '#abcdef');
  assert.equal(oldV2.exercises.match.disabled.color, '#475569');
});

test('WordBank and Free Text export their own surfaces and feedback, independently of choice', () => {
  const config = normalizeDesignConfig({});
  for (const [i, state] of ['word', 'selected', 'correct', 'wrong'].entries()) {
    config.exercises.wordBank[state] = { color: `#aa${i}abb`, bg: `#11${i}122`, borderColor: `#cc${i}cdd`, radius: `${i + 5}px` };
  }
  config.exercises.wordBank.container = { bg: '#123456', borderColor: '#654321', radius: '17px' };
  config.exercises.freeText.focus = { bg: '#112244', borderColor: '#224466' };
  config.exercises.freeText.correct = { color: '#aabbcc', borderColor: '#bbccdd' };
  config.exercises.freeText.wrong = { color: '#ddbbcc', borderColor: '#eebbcc' };
  const vars = designConfigToCssVariables(config);
  for (const [i, state] of ['word', 'selected', 'correct', 'wrong'].entries()) {
    assert.equal(vars[`--design-wb-${state}-color`], `#aa${i}abb`);
    assert.equal(vars[`--design-wb-${state}-bg`], `#11${i}122`);
    assert.equal(vars[`--design-wb-${state}-border`], `#cc${i}cdd`);
    assert.equal(vars[`--design-wb-${state}-radius`], `${i + 5}px`);
  }
  assert.equal(vars['--design-wb-container-bg'], '#123456');
  assert.equal(vars['--design-wb-container-border'], '#654321');
  assert.equal(vars['--design-wb-container-radius'], '17px');
  assert.equal(vars['--design-ft-focus-bg'], '#112244');
  assert.equal(vars['--design-ft-focus-border'], '#224466');
  for (const state of ['correct', 'wrong']) {
    assert.equal(vars[`--design-ft-${state}-color`], config.exercises.freeText[state].color);
    assert.equal(vars[`--design-ft-${state}-border`], config.exercises.freeText[state].borderColor);
    assert.equal(vars[`--design-choice-${state}-color`], config.exercises.choice[state].color);
  }
  const oldV2 = designConfigToCssVariables({ schemaVersion: 2, exercises: { wordBank: { word: { color: '#abcdef' } } } });
  assert.equal(oldV2['--design-wb-word-color'], '#abcdef');
  assert.equal(oldV2['--design-wb-correct-color'], '#4ade80');
  assert.equal(oldV2['--design-ft-wrong-border'], '#ef4444');
});

test('Trainer filled and Puzzle surfaces/feedback round-trip independently of choice', () => {
  assert.equal(designConfigToCssVariables({ exercises: { gapDropdown: { font: 'inherit' } } })['--design-gap-dd-font'], 'initial');
  const config = normalizeDesignConfig({ exercises: { puzzle: {
    item: { color: '#abcdef', radius: '17px' },
    selected: { color: '#deabcd', bg: '#123456', borderColor: '#654321' },
  } } });
  assert.equal(config.exercises.puzzle.item.color, '#abcdef');
  assert.equal(config.exercises.puzzle.item.radius, '17px');
  assert.equal(config.exercises.puzzle.selected.bg, '#123456');
  assert.deepEqual(config.exercises.puzzle.correct, { color: '#86efac', bg: 'rgba(34,197,94,0.12)', borderColor: '#22c55e' });
  for (const [i, state] of ['gap', 'filled', 'correct', 'wrong'].entries()) {
    config.exercises.clozeGap[state] = { color: `#ab${i}def`, bg: `#12${i}456`, borderColor: `#65${i}321` };
  }
  config.exercises.puzzle.correct = { color: '#bbaaee', bg: '#112233', borderColor: '#998877' };
  config.exercises.puzzle.wrong = { color: '#ccaadd', bg: '#223344', borderColor: '#887766' };
  const vars = designConfigToCssVariables(config);
  for (const state of ['gap', 'filled', 'correct', 'wrong']) {
    assert.equal(vars[`--design-cloze-${state}-color`], config.exercises.clozeGap[state].color);
    assert.equal(vars[`--design-cloze-${state}-bg`], config.exercises.clozeGap[state].bg);
    assert.equal(vars[`--design-cloze-${state}-border`], config.exercises.clozeGap[state].borderColor);
  }
  for (const state of ['item', 'selected', 'correct', 'wrong']) {
    for (const [token, prop] of [['color', 'color'], ['bg', 'bg'], ['border', 'borderColor']]) {
      assert.equal(vars[`--design-puzzle-${state}-${token}`], config.exercises.puzzle[state][prop]);
    }
  }
  assert.equal(vars['--design-puzzle-container-radius'], config.exercises.puzzle.container.radius);
  assert.equal(vars['--design-puzzle-container-bg'], config.exercises.puzzle.container.bg);
  assert.equal(vars['--design-puzzle-container-border'], config.exercises.puzzle.container.borderColor);
  assert.equal(vars['--design-choice-correct-color'], config.exercises.choice.correct.color);
  const roundTrip = normalizeDesignConfig(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(roundTrip.exercises.puzzle, config.exercises.puzzle);
});

