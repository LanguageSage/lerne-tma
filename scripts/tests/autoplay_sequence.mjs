import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPLAY_DEFAULTS,
  buildAutoplaySequence,
  createAutoplayQueue,
  normalizeAutoplaySettings,
} from '../../app/src/utils/autoplaySequence.js';
import { readLastSettingsTab, rememberSettingsTab } from '../../app/src/utils/settingsNavigation.js';

test('default card uses phrase-translation-phrase-phrase for two cycles', () => {
  assert.deepEqual(buildAutoplaySequence(AUTOPLAY_DEFAULTS), [
    'front', 'back', 'front', 'front',
    'front', 'back', 'front', 'front',
  ]);
});

test('custom phrase count keeps one translation per cycle', () => {
  const sequence = buildAutoplaySequence({ autoplayFrontRepeat: 2, autoplayCycleRepeat: 3 });
  assert.deepEqual(sequence, [
    'front', 'back', 'front',
    'front', 'back', 'front',
    'front', 'back', 'front',
  ]);
});

test('settings from browser and server are normalized and bounded', () => {
  const settings = normalizeAutoplaySettings({
    autoplayOrder: 'unknown',
    autoplayFrontRepeat: '99',
    autoplayCycleRepeat: '2',
    autoplayGap: '-1',
    autoplayLoop: 'false',
  });
  assert.equal(settings.autoplayOrder, 'list');
  assert.equal(settings.autoplayFrontRepeat, 10);
  assert.equal(settings.autoplayCycleRepeat, 2);
  assert.equal(settings.autoplayGap, 0);
  assert.equal(settings.autoplayLoop, false);
});

test('SRS queue contains only eligible cards in priority order', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const cards = [
    { id: 5, queue: 'new', position: 2 },
    { id: 1, queue: 'review', next_review: yesterday },
    { id: 2, queue: 'review', next_review: tomorrow },
    { id: 3, queue: 'learning', next_review: yesterday },
    { id: 4, queue: 'new', position: 1 },
  ];
  assert.deepEqual(createAutoplayQueue(cards, 'srs').map(card => card.id), [1, 3, 4, 5]);
});

test('random queue has no duplicates and avoids the previous boundary card', () => {
  const cards = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 3 }];
  for (let i = 0; i < 50; i++) {
    const queue = createAutoplayQueue(cards, 'random', 3);
    assert.equal(queue.length, 3);
    assert.equal(new Set(queue.map(card => card.id)).size, 3);
    assert.notEqual(queue[0].id, 3);
  }
  assert.equal(cards.length, 4);
});

test('settings remember only valid manually selected tabs', () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  rememberSettingsTab('voice');
  assert.equal(readLastSettingsTab(), 'voice');
  rememberSettingsTab('unknown');
  assert.equal(readLastSettingsTab(), 'voice');
});
