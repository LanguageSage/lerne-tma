// Transport metadata lives only before FRONT, never inside stored card content.
export const persistentTextId = value => Number.isSafeInteger(Number(value))
  && Number(value) > 0 && Number(value) <= 2147483647 ? Number(value) : null;

export function extractCardTextMetadata(block) {
  const lines = block.replace(/\r\n?/g, '\n').split('\n');
  const metadata = { card_id: null, deck_id: null };
  const errors = [];
  const seen = new Set();
  let inContent = false;
  const content = [];
  for (const line of lines) {
    if (/^\s*FRONT\s*:/i.test(line)) inContent = true;
    const match = !inContent && /^\s*::(card_id|deck_id)\b(.*)$/i.exec(line);
    if (!match) {
      content.push(line);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (seen.has(key)) errors.push('duplicate_metadata');
    seen.add(key);
    if (!/^\d+$/.test(value) || !persistentTextId(value)) errors.push('invalid_identifier');
    else metadata[key] = persistentTextId(value);
  }
  return { ...metadata, content: content.join('\n').trim(), errors };
}

export function cardTextMetadata(cardId, deckId) {
  return [persistentTextId(deckId) && `::deck_id ${Number(deckId)}`,
    persistentTextId(cardId) && `::card_id ${Number(cardId)}`].filter(Boolean).join('\n');
}
