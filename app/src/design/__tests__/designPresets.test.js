import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DESIGN_PRESETS } from '../designPresets.js';
import { normalizeDesignConfig } from '../designConfig.js';

// Captured from the previous V2 presets after excluding the two removed back fields.
const expectedDigests = {
  "strict_dark": "3e28dc468868bddc05dd4f560ffa223823bd353c3e73ce4d0d2d3ab1ef7c4534",
  "strict_minimal": "539ab7c71daf0a81e95da1e3da74057d87125cd4e003b4a16ef47cb7fbaeb2ea",
  "strict_midnight": "f7519024b91aac5758743e60f12f772f1616b533253631957d9517a3535d1d90",
  "strict_emerald": "85651e201b668767a206b16fb11a22ca32357bc4ad5517c7d48c4b1da84c364f",
  "lerne_2026": "a925f31024f1b5c307198d8f9d6dd166e56da6dcdb1aee534889b9df5d673343",
  "premium": "97bfaf3f0c6fdfcf1c2722f74b8532b2e3a623d46aec8533fb140dfce6e29796",
  "aurora": "e5f41d01f8e4bffafc0dcd2ccf9f0e058e85db6c56b4ece4b4652805366d4296",
  "morning_sea": "dde5c66586b4bbca9d1c02d5579903d1acfda65db723d2c0611b1a75cf4a9e51",
  "cyberpunk": "9675c69765d96a98de29e4ebaa784843c5a01950a0220eaf7927f813e38c3280",
  "deep_ocean": "d65ab2a718eefd63b62140545a3449137e2f8f00a19bf7d0655492dc05bf55a9"
};
const canonical = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])))
  : value;

test('native V2 built-ins preserve the supported configuration and preset order', () => {
  assert.deepEqual(DESIGN_PRESETS.map(preset => preset.id), Object.keys(expectedDigests));
  for (const { id, name, configV2 } of DESIGN_PRESETS) {
    assert.ok(name);
    assert.equal(configV2.schemaVersion, 2);
    assert.deepEqual(normalizeDesignConfig(configV2), configV2);
    const digest = createHash('sha256').update(JSON.stringify(canonical(configV2))).digest('hex');
    assert.equal(digest, expectedDigests[id], id);
  }
});
