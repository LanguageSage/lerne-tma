/** Layout IDs identify visual elements; info indices only address their content. */
export function readableLayout(card) {
  if (card.layout == null) return true;
  return Array.isArray(card.layout) && card.layout.every(item => item && typeof item.id === 'string'
    && (item.type === 'exercise' || (item.type === 'image' && typeof item.path === 'string')
      || (item.type === 'info' && Number.isInteger(item.index) && item.index >= 0 && card.info?.[item.index]
        && (typeof card.info[item.index].text === 'string' || (card.info[item.index].type === 'options'
          && Array.isArray(card.info[item.index].items))))));
}

export function enableLayout(card) {
  return card.layout ? card : { ...card, layout: [
    ...(card.info || []).map((_, index) => ({ id: crypto.randomUUID(), type: 'info', index, visibility: 'before_answer' })),
    { id: crypto.randomUUID(), type: 'exercise' },
  ] };
}

export function moveLayout(card, id, offset) {
  const layout = [...card.layout];
  const index = layout.findIndex(item => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= layout.length) return card;
  [layout[index], layout[target]] = [layout[target], layout[index]];
  return { ...card, layout };
}

export function removeLayout(card, id) {
  const item = card.layout.find(entry => entry.id === id);
  if (!item || item.type === 'exercise') return card;
  const layout = card.layout.filter(entry => entry.id !== id).map(entry => item.type === 'info'
    && entry.type === 'info' && entry.index > item.index ? { ...entry, index: entry.index - 1 } : entry);
  return { ...card, layout, ...(item.type === 'info' ? { info: card.info.filter((_, index) => index !== item.index) } : {}) };
}

export function addLayoutInfo(card, type = 'text') {
  const current = enableLayout(card);
  return { ...current, info: [...(current.info || []), { type, text: '' }],
    layout: [...current.layout, { id: crypto.randomUUID(), type: 'info', index: current.info?.length || 0, visibility: 'before_answer' }] };
}

export function addLayoutImage(card, path) {
  const current = enableLayout(card);
  return { ...current, layout: [...current.layout, { id: crypto.randomUUID(), type: 'image', path,
    alt: '', caption: '', visibility: 'before_answer' }] };
}
