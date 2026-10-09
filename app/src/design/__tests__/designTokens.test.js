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
