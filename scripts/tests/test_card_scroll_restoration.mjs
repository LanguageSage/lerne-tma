import test from 'node:test';
import assert from 'node:assert/strict';

// Core logic function matching CardList.jsx
function calculateRequiredVisibleCount(cards, lastId, savedTop) {
  let count = 40;
  if (!cards || !cards.length) return count;
  if (lastId) {
    const idx = cards.findIndex(c => String(c.id) === String(lastId));
    if (idx !== -1) {
      count = Math.max(count, idx + 30);
    }
  }
  if (savedTop > 0) {
    count = Math.max(count, Math.ceil(savedTop / 50) + 20);
  }
  return Math.min(cards.length, count);
}

test('calculateRequiredVisibleCount ensures card 120 is included in visible items', () => {
  const cards = Array.from({ length: 200 }, (_, i) => ({ id: `card-${i + 1}`, front: `Word ${i + 1}` }));
  
  // User scrolled down to card 120 (index 119)
  const result = calculateRequiredVisibleCount(cards, 'card-120', 6000);
  
  assert.ok(result >= 149, `Expected at least 149 visible cards, got ${result}`);
  assert.ok(result <= 200, `Expected at most 200 cards, got ${result}`);

  const rendered = cards.slice(0, result);
  const found = rendered.find(c => c.id === 'card-120');
  assert.ok(found, 'Card 120 must be present in rendered items so it exists in the DOM');
});

test('calculateRequiredVisibleCount handles fresh deck opening gracefully', () => {
  const cards = Array.from({ length: 200 }, (_, i) => ({ id: `card-${i + 1}`, front: `Word ${i + 1}` }));
  
  // Brand new deck entrance from grid: no lastId, no savedTop
  const result = calculateRequiredVisibleCount(cards, null, 0);
  assert.equal(result, 40, 'Should default to 40 for newly opened decks');
});

test('calculateRequiredVisibleCount handles small decks without exceeding bounds', () => {
  const cards = Array.from({ length: 15 }, (_, i) => ({ id: `card-${i + 1}`, front: `Word ${i + 1}` }));
  
  const result = calculateRequiredVisibleCount(cards, 'card-10', 500);
  assert.equal(result, 15, 'Should clamp to total cards count for short decks');
});

test('isRestoringScrollRef blocks premature scroll overwrites', () => {
  let storedScrollTop = 7500;
  let isRestoring = true;

  const mockHandleScroll = (currentContainerScrollTop) => {
    if (isRestoring) return;
    storedScrollTop = currentContainerScrollTop;
  };

  // Premature layout scroll event (scrollTop is 0 or clamped during render)
  mockHandleScroll(0);
  assert.equal(storedScrollTop, 7500, 'storedScrollTop must not be overwritten while restoring');

  // Once restoration is complete and cooldown expires:
  isRestoring = false;
  mockHandleScroll(7620);
  assert.equal(storedScrollTop, 7620, 'storedScrollTop should update when user actively scrolls');
});
