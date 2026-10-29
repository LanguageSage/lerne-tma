import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignConfig } from '../designConfig.js';
import { designConfigToCssVariables } from '../designTokens.js';
import { getDesignStylesFromV2, getDesignTextStyle, getHarmonizedContextColor } from '../../utils/cardStyles.js';
import { CARD_BACKGROUND_PRESETS, getTextShadow, getContextShadow, getResolvedStyle } from '../../utils/style.js';
import { migrateLegacyDesignSettings, adaptDesignPresetsToV2 } from '../legacyAdapter.js';

test('old V2 retains an unspecified background; explicit backgrounds round-trip without legacy keys', () => {
  assert.equal(normalizeDesignConfig({ schemaVersion: 2 }).front.card.background, '');
  const values = [...CARD_BACKGROUND_PRESETS, 'custom_my-background.mp4', '#123456', '#abc', 'rgba(10,20,30,.4)',
    'linear-gradient(135deg, #123456, #654321)', 'radial-gradient(circle at top, #123456, transparent)',
    'linear-gradient(90deg, rgba(10,20,30,.4), hsl(120, 50%, 50%))'];
  for (const value of values) {
    const config = normalizeDesignConfig({ front: { card: { background: value } }, back: { card: { background: value } } });
    assert.equal(config.front.card.background, value);
    assert.deepEqual(normalizeDesignConfig(JSON.parse(JSON.stringify(config))), config);
  }
  for (const value of ['url(https://example.com/x)', 'linear-gradient(#123, #456), url(https://example.com/x)',
    'linear-gradient(url(relative), #123)', 'custom_../../secret.mp4', 'custom_bad/name.mp4', '#12345', 'invalid']) {
    assert.equal(normalizeDesignConfig({ front: { card: { background: value } } }).front.card.background, '');
  }
});

test('manual import and preset conversion retain their background in actual V2 fields', () => {
  const flat = { cardBgFront: 'liquid_morning', cardBgBack: 'custom_saved.mp4', cardTextColor: '#abcdef' };
  const frozen = structuredClone(flat);
  const config = migrateLegacyDesignSettings(flat);
  assert.equal(config.front.card.background, 'liquid_morning');
  assert.equal(config.back.card.background, 'custom_saved.mp4');
  assert.deepEqual(flat, frozen);
  assert.equal(config.global._legacyBgFront, undefined);
  const [preset] = adaptDesignPresetsToV2([{ id: 'test', name: 'test', settings: flat }]);
  assert.equal(preset.configV2.front.card.background, 'liquid_morning');
  assert.equal(preset.legacyBgFront, undefined);
  assert.equal(getResolvedStyle('auto', 23), 'holographic');
  assert.equal(getResolvedStyle('auto', 0), 'standard');
  assert.equal(getResolvedStyle('dark_mocha', 23), 'dark_mocha');
});

test('all V2 text roles implement shadows, auto context and explicit context consistently', () => {
  const config = normalizeDesignConfig({ back: { answerText: { color: '#ffaa00' }, context: { color: 'auto' } } });
  const contextColor = getHarmonizedContextColor('#ffaa00');
  const styles = getDesignStylesFromV2(config);
  assert.equal(styles.contextText.color, contextColor);
  assert.equal(designConfigToCssVariables(config)['--design-ctx-color'], contextColor);
  assert.equal(designConfigToCssVariables(config)['--design-ctx-shadow'], styles.contextText.textShadow);
  for (const shadow of ['none', 'shadow', 'glow', 'neon', 'outline', 'glass']) {
    assert.equal(getDesignTextStyle({ shadow }).textShadow, getTextShadow(shadow, 'currentColor'));
  }
  config.back.context.color = '#112233';
  assert.equal(getDesignStylesFromV2(config).contextText.color, '#112233');
  assert.equal(getDesignStylesFromV2(null), null);
});

test('glows support harmonized HSL, rgba and currentColor; list uses the same full typography', () => {
  for (const color of ['hsl(100, 30%, 84%)', 'rgba(100,200,100,.7)', 'currentColor']) {
    assert.match(getTextShadow('glow', color), /color-mix\(in srgb,/);
    assert.match(getContextShadow('glow', color), /color-mix\(in srgb,/);
  }
  assert.match(getTextShadow('glow', '#abcdef'), /#abcdefaa/);
  const config = normalizeDesignConfig({ cardList: { frontText: { style: 'italic', lineHeight: 1.8, shadow: 'neon' } } });
  const vars = designConfigToCssVariables(config);
  assert.equal(vars['--design-cl-front-style'], 'italic');
  assert.equal(vars['--design-cl-front-shadow'], getDesignTextStyle(config.cardList.frontText).textShadow);
  assert.equal(getDesignTextStyle(config.cardList.frontText).lineHeight, 1.8);
});
