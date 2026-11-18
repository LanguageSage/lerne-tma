export function addWordBankGap(data, { index, text, start, end }) {
  const part = data.parts[index];
  if (part?.type !== 'text' || part.text !== text) return data;
  const selection = text.slice(start, end);
  const word = selection.trim();
  if (!word) return data;

  const used = new Set(data.parts.filter(item => item.type === 'gap').map(item => item.option));
  const spare = data.options.findIndex((value, i) => value === word && !used.has(i));
  const option = spare < 0 ? data.options.length : spare;
  const wordStart = start + selection.indexOf(word);
  const before = text.slice(0, wordStart);
  const after = text.slice(wordStart + word.length);
  return {
    ...data,
    options: spare < 0 ? [...data.options, word] : data.options,
    parts: [
      ...data.parts.slice(0, index),
      ...(before ? [{ type: 'text', text: before }] : []),
      { type: 'gap', option },
      ...(after ? [{ type: 'text', text: after }] : []),
      ...data.parts.slice(index + 1),
    ],
  };
}

export function removeWordBankGap(data, index) {
  const gap = data.parts[index];
  if (gap?.type !== 'gap') return data;
  const text = data.options[gap.option];
  return joinWordBankText({
    ...data,
    parts: [
      ...data.parts.slice(0, index),
      ...(text ? [{ type: 'text', text }] : []),
      ...data.parts.slice(index + 1),
    ],
  });
}

export function removeWordBankDraftOption(data, index) {
  if (data.parts.some(part => part.type === 'gap' && part.option === index)) return data;
  return {
    ...data,
    options: data.options.filter((_, i) => i !== index),
    parts: data.parts.map(part => part.type === 'gap' && part.option > index
      ? { ...part, option: part.option - 1 } : part),
  };
}

export function joinWordBankText(data) {
  const parts = [];
  for (const part of data.parts) {
    const previous = parts.at(-1);
    if (part.type === 'text' && previous?.type === 'text') {
      parts[parts.length - 1] = { type: 'text', text: previous.text + part.text };
    } else {
      parts.push(part);
    }
  }
  return parts.length === data.parts.length ? data : { ...data, parts };
}
