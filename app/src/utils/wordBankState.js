import { normalizeWordBankValue } from './wordBankParser.js';

export const getUsedWordBankOptionIds = (assignments = {}) => new Set(Object.values(assignments));

export const getFirstEmptyWordBankGapId = (gaps = [], assignments = {}) => (
  gaps.find(gap => !assignments[gap.id])?.id ?? null
);

export const getNextEmptyWordBankGapId = (gaps = [], assignments = {}, currentGapId = null) => {
  if (gaps.length === 0) return null;
  const currentIndex = Math.max(gaps.findIndex(gap => gap.id === currentGapId), -1);
  const ordered = [...gaps.slice(currentIndex + 1), ...gaps.slice(0, currentIndex + 1)];
  return ordered.find(gap => !assignments[gap.id])?.id ?? null;
};

export const assignWordBankOption = (assignments = {}, gapId, optionId) => {
  if (!gapId || !optionId) return assignments;
  const occupiedGapId = Object.keys(assignments).find(id => assignments[id] === optionId && id !== gapId);
  if (occupiedGapId) return assignments;
  return { ...assignments, [gapId]: optionId };
};

export const removeWordBankOption = (assignments = {}, gapId) => {
  if (!assignments[gapId]) return assignments;
  const next = { ...assignments };
  delete next[gapId];
  return next;
};

export const sanitizeWordBankAssignments = (assignments = {}, gaps = [], options = []) => {
  const gapIds = new Set(gaps.map(gap => gap.id));
  const optionIds = new Set(options.map(option => option.id));
  const used = new Set();
  const sanitized = {};

  for (const gap of gaps) {
    const optionId = assignments[gap.id];
    if (gapIds.has(gap.id) && optionIds.has(optionId) && !used.has(optionId)) {
      sanitized[gap.id] = optionId;
      used.add(optionId);
    }
  }
  return sanitized;
};

export const checkWordBankAssignments = (gaps = [], options = [], assignments = {}) => {
  const optionById = new Map(options.map(option => [option.id, option]));
  const results = {};

  for (const gap of gaps) {
    const selected = optionById.get(assignments[gap.id]);
    results[gap.id] = selected
      && normalizeWordBankValue(selected.value) === normalizeWordBankValue(gap.correctAnswer)
      ? 'correct'
      : 'incorrect';
  }

  return {
    results,
    allCorrect: gaps.length > 0 && gaps.every(gap => results[gap.id] === 'correct')
  };
};
