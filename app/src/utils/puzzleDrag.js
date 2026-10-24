export const puzzleWordDndId = id => `puzzle-word-${id}`;

export function createPuzzleLists(words, savedState) {
  const valid = new Set(words.map(word => word.id));
  const answer = [...new Set((savedState?.selectedPuzzles || []).map(word => word.id))].filter(id => valid.has(id));
  const pool = [...new Set([...(savedState?.poolOrder || []), ...words.map(word => word.id)])]
    .filter(id => valid.has(id) && !answer.includes(id));
  return { pool, answer };
}

// The insertion index refers to the destination with the active token removed.
export function movePuzzleToken(lists, activeId, destination, index) {
  if (!['pool', 'answer'].includes(destination)
    || ![...lists.pool, ...lists.answer].includes(activeId)) return lists;
  const next = {
    pool: lists.pool.filter(id => id !== activeId),
    answer: lists.answer.filter(id => id !== activeId)
  };
  next[destination].splice(Math.max(0, Math.min(index, next[destination].length)), 0, activeId);
  return next.pool.length === lists.pool.length && next.pool.every((id, i) => id === lists.pool[i])
    && next.answer.length === lists.answer.length && next.answer.every((id, i) => id === lists.answer[i]) ? lists : next;
}

// Choose the closest flex row vertically, then the insertion boundary horizontally.
export function getPuzzleInsertion(rects, point, zone) {
  if (!rects.length) return { index: 0, x: zone.left + zone.width / 2, y: zone.top + 12, height: 32 };
  const rows = [];
  rects.forEach((rect, index) => {
    let row = rows.at(-1);
    if (!row || rect.top >= row.bottom - 1) {
      row = { top: rect.top, bottom: rect.bottom, items: [] };
      rows.push(row);
    }
    row.top = Math.min(row.top, rect.top);
    row.bottom = Math.max(row.bottom, rect.bottom);
    // DOMRect coordinates are prototype getters and are not copied by spread.
    row.items.push({ left: rect.left, right: rect.right, index });
  });
  const distance = row => Math.max(row.top - point.y, point.y - row.bottom, 0);
  const row = rows.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
  const following = row.items.find(rect => point.x < (rect.left + rect.right) / 2);
  const last = row.items.at(-1);
  return {
    index: following ? following.index : last.index + 1,
    x: following ? following.left - 4 : last.right + 4,
    y: row.top,
    height: row.bottom - row.top
  };
}
