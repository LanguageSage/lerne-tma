import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DESIGN_PRESETS } from '../designPresets.js';
import { normalizeDesignConfig } from '../designConfig.js';

// Captured from all built-ins before removal of their V1 definitions.
// Compare every field, including inherited typography, exercise roles and backgrounds.
const beforeMigration = {
  "strict_dark": "a73ef9078d076a9ac35af868fe2cbe38941bf5b9c2a71d480896d2354084064f",
  "strict_minimal": "7045e625de487077c2561f96eecd4cb3e268a58e6920c54c85112be3dc9e6981",
  "strict_midnight": "47c0a5a89bc076f37e1b7543f8ced7ca3534f49e2978738ca19c6dcd432fc743",
  "strict_emerald": "d03a7d3a9cb667717d5eef8143ab5fe06ff011770862af8d4dc4c7d36659c32d",
  "lerne_2026": "b96058061e01f2718c152813bb8b07c9b015fe4f0d51360a1ee5c921b65426be",
  "premium": "ff8782d9aa4868a2b5309b1ca67a2cf53f6aa6f4bbb1711ee3e0dc9b6bb02e38",
  "aurora": "7c688c5c805e66927ba21613601d6fa8b7c85c45a52ab016d2452e37f311dde3",
  "morning_sea": "91c5e870571add5e7b4e35230e280c1daca3d368f0d2a9bf5e89a6f1c59a97e0",
  "cyberpunk": "d9985a483218fc6178ef8367cc2dc892f6f3b629d2496168cc1b5f7188480feb",
  "deep_ocean": "9699528ea2a1091100981639f2b2ac5761d8942384c04e7a720dc0bcac1431d2"
};
const canonical = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])))
  : value;

test('native V2 built-ins preserve the complete configuration and ordering of all V1 presets', () => {
  assert.deepEqual(DESIGN_PRESETS.map(preset => preset.id), Object.keys(beforeMigration));
  for (const { id, name, configV2 } of DESIGN_PRESETS) {
    assert.ok(name);
    assert.equal(configV2.schemaVersion, 2);
    assert.deepEqual(normalizeDesignConfig(configV2), configV2);
    // Reconstruct the two removed, unused defaults only for comparison with
    // the immutable stage 4A snapshot. Every remaining field is still checked.
    const snapshot = structuredClone(configV2);
    snapshot.exercises.bodyText = { font: 'Comfortaa', size: 1.7, weight: '700',
      style: 'normal', color: '#fde047', lineHeight: 1.35 };
    snapshot.exercises.paletteMode = 'auto';
    const digest = createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
    assert.equal(digest, beforeMigration[id], id);
  }
});
