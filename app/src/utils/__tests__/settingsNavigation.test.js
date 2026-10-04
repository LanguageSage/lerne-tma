import test from 'node:test';
import assert from 'node:assert/strict';
import { accessibleSettingsTab, readLastSettingsTab } from '../settingsNavigation.js';

test('admin can open diagnostics', () => {
  assert.equal(accessibleSettingsTab('diagnostics', true), 'diagnostics');
});

test('non-admin cannot open diagnostics, including a saved tab', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => 'diagnostics' };
  try {
    assert.equal(readLastSettingsTab(), 'diagnostics');
    assert.equal(accessibleSettingsTab(readLastSettingsTab(), false), 'general');
    assert.equal(accessibleSettingsTab('diagnostics', false), 'general');
  } finally {
    globalThis.localStorage = previous;
  }
});
