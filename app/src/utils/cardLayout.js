/** Layout IDs identify visual elements; info indices only address their content. */
export function readableLayout(card) {
  if (card.layout == null) return true;
  return Array.isArray(card.layout) && card.layout.every(item => item && typeof item.id === 'string'
    && (item.type === 'exercise' || (item.type === 'image' && typeof item.path === 'string'
      && (item.alt === undefined || typeof item.alt === 'string')
      && (item.caption === undefined || typeof item.caption === 'string'))
      || (item.type === 'info' && Number.isInteger(item.index) && item.index >= 0 && card.info?.[item.index]
        && (typeof card.info[item.index].text === 'string' || (card.info[item.index].type === 'options'
          && Array.isArray(card.info[item.index].items))))));
}

export function defaultLayout(card) {
  return [
    ...(card?.info || []).map((_, index) => ({ id: `info-${index}`, type: 'info', index, visibility: 'before_answer' })),
    { id: 'exercise', type: 'exercise' },
  ];
}

export function enableLayout(card) {
  return card.layout ? card : { ...card, layout: defaultLayout(card) };
}

export function moveLayout(card, id, offset) {
  const layout = [...card.layout];
  const index = layout.findIndex(item => item.id === id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= layout.length) return card;
  const [item] = layout.splice(index, 1);
  layout.splice(target, 0, item);
  return { ...card, layout };
}

export function removeLayout(card, id) {
  const item = card.layout.find(entry => entry.id === id);
  if (!item || item.type === 'exercise') return card;
  const layout = card.layout.filter(entry => entry.id !== id).map(entry => item.type === 'info'
    && entry.type === 'info' && entry.index > item.index ? { ...entry, index: entry.index - 1 } : entry);
  return { ...card, layout, ...(item.type === 'info' ? { info: card.info.filter((_, index) => index !== item.index) } : {}) };
}

export function patchInfoBlock(card, index, patch) {
  return { ...card, info: card.info.map((block, i) => i === index ? { ...block, ...patch } : block) };
}

export function patchLayoutItem(card, id, patch) {
  const current = enableLayout(card);
  return { ...current, layout: current.layout.map(item => item.id === id ? { ...item, ...patch } : item) };
}

export function addLayoutInfo(card, position) {
  const current = enableLayout(card);
  const info = current.info || [];
  const layout = [...current.layout];
  layout.splice(position ?? layout.length, 0,
    { id: crypto.randomUUID(), type: 'info', index: info.length, visibility: 'before_answer' });
  return { ...current, info: [...info, { type: 'text', text: '' }], layout };
}

export function addLayoutImage(card, path) {
  const current = enableLayout(card);
  return { ...current, layout: [...current.layout, { id: crypto.randomUUID(), type: 'image', path,
    alt: '', caption: '', visibility: 'before_answer' }] };
}
