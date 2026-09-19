const normalizeWordBankValue = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const getCardField = (card, primary, fallback) => {
  if (typeof card !== 'object' || !card) return '';
  return String(card[primary] || card[fallback] || '');
};

/**
 * Parses a shared word-bank exercise.
 *
 * FRONT:
 * @wordbank
 * Text with <<31>> gaps
 * @options
 * OPTION A | OPTION B
 *
 * BACK:
 * 31=OPTION A
 */
export const parseWordBankData = (card) => {
  if (!card) return null;

  const rawFront = (typeof card === 'string'
    ? card
    : getCardField(card, 'front', 'front_text')).trim();
  const rawBack = getCardField(card, 'back', 'back_text').trim();
  if (!rawFront || !rawBack) return null;

  const directiveMatch = /^@wordbank[ \t]*$/im.exec(rawFront);
  if (!directiveMatch || rawFront.slice(0, directiveMatch.index).trim()) return null;

  const afterDirective = rawFront.slice(directiveMatch.index + directiveMatch[0].length);
  const optionsMatch = /^@options[ \t]*$/im.exec(afterDirective);
  if (!optionsMatch) return null;

  const text = afterDirective
    .slice(0, optionsMatch.index)
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]*\n+/g, '\n');
  const rawOptions = afterDirective.slice(optionsMatch.index + optionsMatch[0].length).trim();
  if (!text || !rawOptions) return null;
  if (/\[\[|\]\]/.test(text)) return null;
  if (/<<|>>/.test(text.replace(/<<(\d+)>>/g, ''))) return null;

  const options = rawOptions
    .split(/\s*\|\s*|\r?\n+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map((value, index) => ({ id: `option-${index}`, value }));
  if (options.length === 0) return null;

  const gapMatches = Array.from(text.matchAll(/<<(\d+)>>/g));
  if (gapMatches.length === 0) return null;

  const gapIds = gapMatches.map(match => match[1]);
  if (new Set(gapIds).size !== gapIds.length) return null;

  const answerEntries = [];
  for (const rawLine of rawBack.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(\d+)\s*=\s*(.+)$/.exec(line);
    if (!match || !match[2].trim()) return null;
    answerEntries.push([match[1], match[2].trim()]);
  }

  const answers = new Map(answerEntries);
  if (answers.size !== answerEntries.length || answers.size !== gapIds.length) return null;
  if (gapIds.some(id => !answers.has(id)) || [...answers.keys()].some(id => !gapIds.includes(id))) return null;

  const optionCounts = new Map();
  for (const option of options) {
    const normalized = normalizeWordBankValue(option.value);
    optionCounts.set(normalized, (optionCounts.get(normalized) || 0) + 1);
  }

  const answerCounts = new Map();
  for (const answer of answers.values()) {
    const normalized = normalizeWordBankValue(answer);
    answerCounts.set(normalized, (answerCounts.get(normalized) || 0) + 1);
  }
  for (const [answer, count] of answerCounts) {
    if ((optionCounts.get(answer) || 0) < count) return null;
  }

  const gaps = gapIds.map((id, index) => ({
    id,
    index,
    correctAnswer: answers.get(id)
  }));

  return {
    isWordBank: true,
    text,
    maskedText: text.replace(/<<(\d+)>>/g, '___WORD_BANK_GAP_$1___'),
    gaps,
    options
  };
};

export { normalizeWordBankValue };
