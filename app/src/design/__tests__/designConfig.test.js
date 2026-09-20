/**
 * Design Config V2 Unit Tests
 * Используют нативный Node.js test runner (node:test).
 *
 * Запуск: npm --prefix app test
 * (предполагает что скрипт test обновлён для включения design/__tests__)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Импорты напрямую из файлов (ESM)
import {
  DEFAULT_DESIGN_CONFIG_V2,
  normalizeDesignConfig,
  mergeDesignConfig,
  getDesignValue,
  patchDesignValue,
} from '../designConfig.js';

import {
  migrateLegacyDesignSettings,
  legacyPresetToDesignConfigV2,
  adaptDesignPresetsToV2,
} from '../legacyAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEFAULT_DESIGN_CONFIG_V2 — структурная валидность
// ─────────────────────────────────────────────────────────────────────────────

test('DEFAULT: schemaVersion === 2', () => {
  assert.strictEqual(DEFAULT_DESIGN_CONFIG_V2.schemaVersion, 2);
});

test('DEFAULT: has all top-level sections', () => {
  const sections = ['global', 'front', 'back', 'exercises', 'cardList'];
  for (const section of sections) {
    assert.ok(section in DEFAULT_DESIGN_CONFIG_V2, `Missing section: ${section}`);
  }
});

test('DEFAULT: front has all required subsections', () => {
  const { front } = DEFAULT_DESIGN_CONFIG_V2;
  assert.ok(front.card, 'front.card missing');
  assert.ok(front.mainText, 'front.mainText missing');
  assert.ok(front.task, 'front.task missing');
  assert.ok(front.source, 'front.source missing');
  assert.ok(front.example, 'front.example missing');
  assert.ok(front.options, 'front.options missing');
  assert.ok(front.options.label, 'front.options.label missing');
  assert.ok(front.options.chip, 'front.options.chip missing');
});

test('DEFAULT: back has all required subsections', () => {
  const { back } = DEFAULT_DESIGN_CONFIG_V2;
  assert.ok(back.card, 'back.card missing');
  assert.ok(back.referenceText, 'back.referenceText missing');
  assert.ok(back.separator, 'back.separator missing');
  assert.ok(back.answerText, 'back.answerText missing');
  assert.ok(back.context, 'back.context missing');
});

test('DEFAULT: exercises has semantic states', () => {
  const { exercises: ex } = DEFAULT_DESIGN_CONFIG_V2;
  assert.ok(ex.choice.normal, 'choice.normal missing');
  assert.ok(ex.choice.correct, 'choice.correct missing');
  assert.ok(ex.choice.wrong, 'choice.wrong missing');
  assert.ok(ex.choice.selected, 'choice.selected missing');
  assert.ok(ex.choice.disabled, 'choice.disabled missing');
  assert.ok(ex.clozeGap, 'clozeGap missing');
  assert.ok(ex.wordBank, 'wordBank missing');
  assert.ok(ex.freeText, 'freeText missing');
  assert.ok(ex.match, 'match missing');
  assert.ok(ex.puzzle, 'puzzle missing');
  assert.ok(ex.actionButton, 'actionButton missing');
});

test('DEFAULT: cardList has required fields', () => {
  const { cardList: cl } = DEFAULT_DESIGN_CONFIG_V2;
  assert.ok(cl.card, 'cardList.card missing');
  assert.ok(cl.frontText, 'cardList.frontText missing');
  assert.ok(cl.backText, 'cardList.backText missing');
  assert.ok(cl.divider, 'cardList.divider missing');
  assert.ok(cl.controls, 'cardList.controls missing');
});

test('DEFAULT: numeric sizes are numbers', () => {
  assert.ok(typeof DEFAULT_DESIGN_CONFIG_V2.front.mainText.size === 'number');
  assert.ok(typeof DEFAULT_DESIGN_CONFIG_V2.back.answerText.size === 'number');
  assert.ok(typeof DEFAULT_DESIGN_CONFIG_V2.cardList.frontText.size === 'number');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeDesignConfig — safe fill + unknown key rejection
// ─────────────────────────────────────────────────────────────────────────────

test('normalize: null returns full defaults', () => {
  const result = normalizeDesignConfig(null);
  assert.strictEqual(result.schemaVersion, 2);
  assert.ok(result.front.mainText.color);
});

test('normalize: undefined returns full defaults', () => {
  const result = normalizeDesignConfig(undefined);
  assert.strictEqual(result.schemaVersion, 2);
});

test('normalize: empty object returns full defaults', () => {
  const result = normalizeDesignConfig({});
  assert.strictEqual(result.schemaVersion, 2);
  assert.ok(result.front.mainText.font);
});

test('normalize: array returns full defaults', () => {
  const result = normalizeDesignConfig([]);
  assert.strictEqual(result.schemaVersion, 2);
});

test('normalize: string returns full defaults', () => {
  const result = normalizeDesignConfig('hello');
  assert.strictEqual(result.schemaVersion, 2);
});

test('normalize: partial config fills missing with defaults', () => {
  const partial = {
    front: {
      mainText: {
        color: '#ff0000'
      }
    }
  };
  const result = normalizeDesignConfig(partial);
  // Patched value preserved
  assert.strictEqual(result.front.mainText.color, '#ff0000');
  // Other values filled from defaults
  assert.strictEqual(result.front.mainText.font, DEFAULT_DESIGN_CONFIG_V2.front.mainText.font);
  assert.strictEqual(result.front.mainText.size, DEFAULT_DESIGN_CONFIG_V2.front.mainText.size);
  // Other sections intact
  assert.ok(result.back.answerText.color);
  assert.ok(result.cardList.frontText.font);
});

test('normalize: unknown top-level keys are rejected', () => {
  const withUnknown = {
    unknownSection: { foo: 'bar' },
    front: { mainText: { color: '#00ff00' } }
  };
  const result = normalizeDesignConfig(withUnknown);
  assert.strictEqual(result.unknownSection, undefined);
  assert.strictEqual(result.front.mainText.color, '#00ff00');
});

test('normalize: unknown nested keys are rejected', () => {
  const withUnknown = {
    front: {
      mainText: {
        color: '#00ff00',
        injectedProp: 'malicious'
      }
    }
  };
  const result = normalizeDesignConfig(withUnknown);
  assert.strictEqual(result.front.mainText.injectedProp, undefined);
  assert.strictEqual(result.front.mainText.color, '#00ff00');
});

test('normalize: does not mutate input', () => {
  const input = { front: { mainText: { color: '#aaaaaa' } } };
  const inputCopy = JSON.stringify(input);
  normalizeDesignConfig(input);
  assert.strictEqual(JSON.stringify(input), inputCopy);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. mergeDesignConfig — safe merge
// ─────────────────────────────────────────────────────────────────────────────

test('merge: patch overrides base values', () => {
  const base = normalizeDesignConfig(null);
  const patch = { front: { mainText: { color: '#123456' } } };
  const result = mergeDesignConfig(base, patch);
  assert.strictEqual(result.front.mainText.color, '#123456');
  // Other front values intact
  assert.strictEqual(result.front.mainText.font, base.front.mainText.font);
});

test('merge: unknown patch keys ignored', () => {
  const base = normalizeDesignConfig(null);
  const patch = { injected: true, front: { mainText: { color: '#abcdef', evil: 'x' } } };
  const result = mergeDesignConfig(base, patch);
  assert.strictEqual(result.injected, undefined);
  assert.strictEqual(result.front.mainText.evil, undefined);
  assert.strictEqual(result.front.mainText.color, '#abcdef');
});

test('merge: null patch returns normalized base', () => {
  const base = { front: { mainText: { color: '#ffffff' } } };
  const result = mergeDesignConfig(base, null);
  assert.strictEqual(result.schemaVersion, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getDesignValue / patchDesignValue
// ─────────────────────────────────────────────────────────────────────────────

test('getDesignValue: reads nested value by dot-path', () => {
  const config = normalizeDesignConfig(null);
  const color = getDesignValue(config, 'front.mainText.color');
  assert.strictEqual(color, DEFAULT_DESIGN_CONFIG_V2.front.mainText.color);
});

test('getDesignValue: returns undefined for unknown path', () => {
  const config = normalizeDesignConfig(null);
  assert.strictEqual(getDesignValue(config, 'front.unknown.color'), undefined);
});

test('patchDesignValue: updates known path', () => {
  const config = normalizeDesignConfig(null);
  const updated = patchDesignValue(config, 'front.mainText.color', '#deadbe');
  assert.strictEqual(updated.front.mainText.color, '#deadbe');
  // Original not mutated
  assert.notStrictEqual(config.front.mainText.color, '#deadbe');
});

test('patchDesignValue: ignores unknown path', () => {
  const config = normalizeDesignConfig(null);
  const result = patchDesignValue(config, 'front.unknown.color', 'x');
  // Returns original config unchanged (no crash)
  assert.strictEqual(result.schemaVersion, 2);
  assert.strictEqual(result.front.unknown, undefined);
});

test('patchDesignValue: does not mutate original', () => {
  const config = normalizeDesignConfig(null);
  const orig = config.front.mainText.color;
  patchDesignValue(config, 'front.mainText.color', '#new');
  assert.strictEqual(config.front.mainText.color, orig);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. migrateLegacyDesignSettings — V1 flat → V2
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_FLAT = {
  cardBgFront: 'liquid_emerald',
  cardBgBack: 'liquid_emerald',
  cardFont: 'Comfortaa',
  cardTextColor: '#fde047',
  cardFontSize: 1.7,
  cardFontWeight: '700',
  cardFontStyle: 'normal',
  cardTextAlign: 'left',
  cardTextShadow: 'glow',
  backTextColor: '#cbd5e1',
  contextFont: 'Inter',
  contextTextColor: 'auto',
  contextFontSize: 1.4,
  contextFontWeight: '400',
  contextFontStyle: 'normal',
  contextTextAlign: 'left',
  contextTextShadow: 'glow',
  previewCardFont: 'Comfortaa',
  previewCardTextColor: '#cbdeb5',
  previewBackTextColor: '#b1e7e0',
  previewCardFontSize: 1.19,
  previewBackFontSize: 0.98,
  previewCardFontWeight: '700',
  previewCardFontStyle: 'normal',
  previewTextShadow: 'none',
  previewCardTextAlign: 'left',
  previewCardLines: 3,
  previewCardBg: 'dark_obsidian',
};

test('migrate: converts front mainText fields', () => {
  const v2 = migrateLegacyDesignSettings(LEGACY_FLAT);
  assert.strictEqual(v2.front.mainText.font, 'Comfortaa');
  assert.strictEqual(v2.front.mainText.color, '#fde047');
  assert.strictEqual(v2.front.mainText.size, 1.7);
  assert.strictEqual(v2.front.mainText.weight, '700');
  assert.strictEqual(v2.front.mainText.align, 'left');
  assert.strictEqual(v2.front.mainText.shadow, 'glow');
});

test('migrate: converts back answerText color', () => {
  const v2 = migrateLegacyDesignSettings(LEGACY_FLAT);
  assert.strictEqual(v2.back.answerText.color, '#cbd5e1');
});

test('migrate: converts context fields', () => {
  const v2 = migrateLegacyDesignSettings(LEGACY_FLAT);
  assert.strictEqual(v2.back.context.font, 'Inter');
  assert.strictEqual(v2.back.context.size, 1.4);
  assert.strictEqual(v2.back.context.color, 'auto');
});

test('migrate: converts cardList frontText fields', () => {
  const v2 = migrateLegacyDesignSettings(LEGACY_FLAT);
  assert.strictEqual(v2.cardList.frontText.font, 'Comfortaa');
  assert.strictEqual(v2.cardList.frontText.color, '#cbdeb5');
  assert.strictEqual(v2.cardList.frontText.size, 1.19);
  assert.strictEqual(v2.cardList.frontText.lines, 3);
});

test('migrate: result is always valid V2 (schemaVersion = 2)', () => {
  const v2 = migrateLegacyDesignSettings(LEGACY_FLAT);
  assert.strictEqual(v2.schemaVersion, 2);
  assert.ok(v2.global);
  assert.ok(v2.exercises);
});

test('migrate: null input returns defaults', () => {
  const v2 = migrateLegacyDesignSettings(null);
  assert.strictEqual(v2.schemaVersion, 2);
});

test('migrate: empty object returns defaults', () => {
  const v2 = migrateLegacyDesignSettings({});
  assert.strictEqual(v2.schemaVersion, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Invalid/dangerous imports
// ─────────────────────────────────────────────────────────────────────────────

test('normalize: null config safe', () => {
  assert.doesNotThrow(() => normalizeDesignConfig(null));
});

test('normalize: prototype injection safe', () => {
  const evil = JSON.parse('{"__proto__":{"polluted":true},"front":{"mainText":{"color":"#fff"}}}');
  const result = normalizeDesignConfig(evil);
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(result.front.mainText.color, '#fff');
});

test('normalize: deeply nested unknown keys rejected', () => {
  const input = {
    exercises: {
      choice: {
        normal: { bg: '#000', evilScript: 'alert(1)' }
      }
    }
  };
  const result = normalizeDesignConfig(input);
  assert.strictEqual(result.exercises.choice.normal.evilScript, undefined);
  assert.strictEqual(result.exercises.choice.normal.bg, '#000');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. legacyPresetToDesignConfigV2
// ─────────────────────────────────────────────────────────────────────────────

test('legacyPreset: null preset returns defaults', () => {
  const v2 = legacyPresetToDesignConfigV2(null);
  assert.strictEqual(v2.schemaVersion, 2);
});

test('legacyPreset: preset without settings returns defaults', () => {
  const v2 = legacyPresetToDesignConfigV2({ id: 'test', name: 'Test' });
  assert.strictEqual(v2.schemaVersion, 2);
});

test('legacyPreset: converts preset settings correctly', () => {
  const preset = {
    id: 'strict_dark',
    name: 'Строгий тёмный',
    settings: {
      cardFont: 'Inter',
      cardTextColor: '#ffffff',
      cardFontSize: 1.8,
    }
  };
  const v2 = legacyPresetToDesignConfigV2(preset);
  assert.strictEqual(v2.front.mainText.font, 'Inter');
  assert.strictEqual(v2.front.mainText.color, '#ffffff');
  assert.strictEqual(v2.front.mainText.size, 1.8);
});

test('adaptDesignPresetsToV2: returns array with id, name, configV2', () => {
  const presets = [
    { id: 'p1', name: 'Preset 1', settings: { cardFont: 'Roboto' } },
    { id: 'p2', name: 'Preset 2', settings: { cardTextColor: '#aabbcc' } },
  ];
  const adapted = adaptDesignPresetsToV2(presets);
  assert.strictEqual(adapted.length, 2);
  assert.strictEqual(adapted[0].id, 'p1');
  assert.strictEqual(adapted[0].configV2.front.mainText.font, 'Roboto');
  assert.strictEqual(adapted[1].configV2.front.mainText.color, '#aabbcc');
});

test('adaptDesignPresetsToV2: empty array safe', () => {
  const adapted = adaptDesignPresetsToV2([]);
  assert.strictEqual(adapted.length, 0);
});
